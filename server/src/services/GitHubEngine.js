/**
 * B165 — GITHUB ENGINE (DeepSeek Harness approach: dsh mounts GitHub as
 * first-class model tools — `mcp__github__*` — so the agent can READ repos,
 * EDIT files, and REVIEW code itself, over the REST API with the user's
 * token. JEXI port: native tools, no MCP server process needed).
 *
 *   parseGitHubTarget(text)  — 'owner/repo' or any github.com URL (+path/+PR)
 *   repoScan(target)         — metadata + tree (bounded) + manifests + README
 *   readFile(target, path)   — decoded file content (≤64 KB)
 *   editFile(target, path, text, msg) — commit an update via the Contents API
 *   reviewRepo(target)       — structure report + open PRs + latest PR diff
 *   reviewPR(target, n)      — files + patch hunks for one PR
 *
 * Token: GITHUB_TOKEN / GH_TOKEN env (Render) or CredentialStore('github').
 * Everything degrades honestly with GITHUB_UNAUTHORIZED when no token.
 */

import fetch from 'node-fetch';
import { resolveCredential } from './CredentialStore.js';

const API = 'https://api.github.com';
const UA = 'JEXI-OS/1.0 (github engine)';

function token() {
  try {
    const v = resolveCredential('github') || resolveCredential('github_token');
    if (v) return v;
  } catch { /* store unavailable */ }
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

async function gh(pathname, opts = {}) {
  const t = token();
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.method) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${pathname}`, { ...opts, headers, signal: opts.signal || AbortSignal.timeout(20000) });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (res.status === 401 || res.status === 403) {
    if (remaining === '0') return { ok: false, code: 'GITHUB_RATE_LIMIT', error: 'GitHub API rate limit exhausted — try again in a few minutes' };
    return { ok: false, code: 'GITHUB_UNAUTHORIZED', error: !t ? 'No GITHUB_TOKEN configured — add it in Settings or Render env to use the GitHub engine' : 'Token rejected (403/401) — check its scopes (repo)' };
  }
  return { ok: res.ok, status: res.status, res };
}

/** 'owner/repo', github.com/owner/repo(/tree/branch/path), /pull/N → target. */
export function parseGitHubTarget(text) {
  const s = String(text || '').trim();
  // PR form FIRST (the generic tree/blob pattern would otherwise swallow /pull/N).
  const pr = s.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/);
  if (pr) return { owner: pr[1], repo: pr[2].replace(/\.git$/, ''), pull: Number(pr[3]) };
  let m = s.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(?:tree|blob)\/[^/]+\/?(.*))?$/);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, ''), ...(m[3] ? { path: m[3] } : {}) };
  m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
  return null;
}

/** Metadata + bounded tree + manifests + README — one structured scan. */
export async function repoScan(target, { maxEntries = 400 } = {}) {
  const t = typeof target === 'string' ? parseGitHubTarget(target) : target;
  if (!t) return { ok: false, code: 'GITHUB_BAD_TARGET', error: 'expected owner/repo or a github.com URL' };
  const slug = `${t.owner}/${t.repo}`;

  const meta = await gh(`/repos/${slug}`);
  if (!meta.ok) return { ok: false, code: meta.code || 'GITHUB_HTTP', error: meta.error || `repo ${slug} → HTTP ${meta.status}` };
  const repo = await meta.res.json();

  const treeRes = await gh(`/repos/${slug}/git/trees/${repo.default_branch}?recursive=1`);
  let files = [];
  if (treeRes.ok) {
    const tree = await treeRes.res.json();
    files = (tree.tree || []).filter((e) => e.type === 'blob').slice(0, maxEntries).map((e) => e.path);
  }

  const manifests = ['package.json', 'render.yaml', 'Dockerfile', 'requirements.txt', 'pyproject.toml', 'capacitor.config.json', 'android/app/build.gradle', 'server/package.json'];
  const present = [];
  for (const m of manifests) if (files.includes(m)) present.push(m);

  const langs = repo.language ? [repo.language] : Object.keys(repo.languages || {});

  return {
    ok: true,
    repo: slug,
    description: repo.description || '',
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language || null,
    topics: repo.topics || [],
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    license: repo.license?.spdx_id || null,
    openIssues: repo.open_issues_count,
    fileCount: files.length,
    files: files.slice(0, 120),
    manifests: present,
    structure: summarize(files),
    langs,
  };
}

function summarize(files) {
  const dirs = {};
  for (const f of files) {
    const top = f.split('/')[0];
    dirs[top] = (dirs[top] || 0) + 1;
  }
  const top = Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return top.map(([d, n]) => `${d}/ (${n})`).join(' · ');
}

/** Read one file (decoded; ≤64 KB honest cap). */
export async function readFile(target, filePath) {
  const t = typeof target === 'string' ? parseGitHubTarget(target) : target;
  if (!t) return { ok: false, code: 'GITHUB_BAD_TARGET' };
  const r = await gh(`/repos/${t.owner}/${t.repo}/contents/${String(filePath).replace(/^\/+/, '')}`);
  if (!r.ok) return { ok: false, code: r.code || 'GITHUB_HTTP', error: r.error || `HTTP ${r.status}` };
  const data = await r.res.json();
  if (data.encoding !== 'base64') return { ok: false, code: 'GITHUB_NOT_A_FILE', error: 'path is a directory or unsupported encoding' };
  const text = Buffer.from(data.content, 'base64').toString('utf-8');
  return {
    ok: true, path: data.path, size: data.size,
    text: text.length > 64 * 1024 ? text.slice(0, 64 * 1024) + '\n<response clipped — file larger than 64 KB>' : text,
  };
}

/** Edit a file = one commit through the Contents API (needs repo scope). */
export async function editFile(target, filePath, newText, { message = 'Update via JEXI', branch = null } = {}) {
  const t = typeof target === 'string' ? parseGitHubTarget(target) : target;
  if (!t) return { ok: false, code: 'GITHUB_BAD_TARGET' };
  if (!token()) return { ok: false, code: 'GITHUB_UNAUTHORIZED', error: 'editing needs a GITHUB_TOKEN with repo scope' };
  const p = String(filePath).replace(/^\/+/, '');
  const cur = await gh(`/repos/${t.owner}/${t.repo}/contents/${p}${branch ? `?ref=${branch}` : ''}`);
  let sha = null;
  if (cur.ok) sha = (await cur.res.json()).sha;
  const body = {
    message: String(message).slice(0, 200),
    content: Buffer.from(String(newText ?? ''), 'utf-8').toString('base64'),
    ...(sha ? { sha } : {}),
    ...(branch ? { branch } : {}),
  };
  const put = await gh(`/repos/${t.owner}/${t.repo}/contents/${p}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!put.ok) {
    let msg = `HTTP ${put.status}`;
    try { msg = (await put.res.json()).message || msg; } catch { /* keep */ }
    return { ok: false, code: 'GITHUB_COMMIT_FAILED', error: msg };
  }
  const commit = await put.res.json();
  return { ok: true, path: p, commit: commit.commit?.sha?.slice(0, 10), url: commit.content?.html_url || commit.commit?.html_url, created: !sha };
}

/** Review: structure report + open PRs + the latest PR's changed files. */
export async function reviewRepo(target, { maxFiles = 12 } = {}) {
  const scan = await repoScan(target);
  if (!scan.ok) return scan;
  const slug = `${scan.repo}`;

  const prs = await gh(`/repos/${slug}/pulls?state=open&per_page=5`);
  let openPrs = [];
  if (prs.ok) openPrs = (await prs.res.json()).map((p) => ({ number: p.number, title: p.title, author: p.user?.login, branch: p.head?.ref, updated: p.updated_at }));

  let latestReview = null;
  if (openPrs.length) {
    latestReview = await reviewPR(slug, openPrs[0].number, { maxFiles });
  }

  const signals = [];
  if (!scan.manifests.length) signals.push('no recognizable manifest — custom or generated project');
  if ((scan.fileCount || 0) > 800) signals.push('very large tree — focus review on the manifests + entry points');
  if (scan.openIssues > 50) signals.push(`${scan.openIssues} open issues — active maintenance surface`);
  if (!scan.license) signals.push('no license file');

  return { ok: true, ...scan, openPrs, ...(latestReview ? { latestPr: latestReview } : {}), reviewSignals: signals };
}

/** One PR: metadata + changed files with patch hunks (bounded). */
export async function reviewPR(target, prNumber, { maxFiles = 12, maxPatch = 4000 } = {}) {
  const t = typeof target === 'string' ? parseGitHubTarget(target) : target;
  if (!t) return { ok: false, code: 'GITHUB_BAD_TARGET' };
  const r = await gh(`/repos/${t.owner}/${t.repo}/pulls/${Number(prNumber)}`);
  if (!r.ok) return { ok: false, code: r.code || 'GITHUB_HTTP', error: r.error || `PR ${prNumber} → HTTP ${r.status}` };
  const pr = await r.res.json();
  const filesRes = await gh(`/repos/${t.owner}/${t.repo}/pulls/${Number(prNumber)}/files?per_page=${maxFiles}`);
  let files = [];
  if (filesRes.ok) {
    files = (await filesRes.res.json()).map((f) => ({
      file: f.filename, status: f.status, additions: f.additions, deletions: f.deletions,
      ...(f.patch ? { patch: f.patch.slice(0, maxPatch) } : {}),
    }));
  }
  return {
    ok: true, number: pr.number, title: pr.title, state: pr.state,
    author: pr.user?.login, branch: pr.head?.ref, base: pr.base?.ref,
    additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files,
    commits: pr.commits, body: String(pr.body || '').slice(0, 1500), files,
  };
}

export function githubEngineStatus() {
  return { configured: !!token(), tokenSource: token() ? (process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? 'env' : 'credentials') : null };
}
