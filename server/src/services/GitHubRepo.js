/**
 * JEXI OS — GitHub Repository Analyzer (B154).
 *
 * When the user shares a GitHub repository link, the generic link pipeline
 * (video/social/article) used to deep-read the rendered GitHub page — which
 * yields navigation garbage or "no readable content". This module gives
 * GitHub repo links a REAL analysis path:
 *
 *   1. PARSE — normalize any github.com/owner/repo URL (tree/blob refs,
 *      .git suffix, query strings, www) into { owner, repo, ref }.
 *   2. METADATA — GitHub REST API: description, language, stars, forks,
 *      open issues, license, size, topics, default branch, archived flag.
 *   3. TREE — recursive file tree (capped, junk dirs skipped), grouped into
 *      top-level directories + language histogram.
 *   4. README + KEY MANIFESTS — fetched raw (README.md, package.json,
 *      requirements.txt, pyproject.toml, Cargo.toml, go.mod, Dockerfile…).
 *   5. REPORT — an LLM pass produces a structured review
 *      (OVERVIEW → ARCHITECTURE → KEY FILES → STRENGTHS → ISSUES → FIXES →
 *      VERDICT). If the LLM is unavailable, a deterministic report is built
 *      from the same context so the user ALWAYS gets a real analysis.
 *   6. FALLBACK — if the GitHub API is rate-limited/unreachable, try a
 *      shallow `git clone` and map the working tree instead.
 *
 * Every dependency is injectable for tests; every failure degrades honestly
 * with the real reason in `error`.
 */

const GITHUB_API = 'https://api.github.com';
const RAW_GITHUB = 'https://raw.githubusercontent.com';
const UA = 'JEXI-OS-RepoAnalyzer/1.0';

// github.com site sections that are NOT repositories (owner-less pages).
const NON_REPO_SECTIONS = new Set([
  'features', 'about', 'pricing', 'login', 'signup', 'topics', 'collections',
  'sponsors', 'marketplace', 'settings', 'orgs', 'explore', 'search',
  'contact', 'site', 'security', 'customer-stories', 'readme', 'trending',
  'events', 'integrations', 'enterprise', 'team', 'copilot', 'codespaces',
  'mobile', 'actions', 'packages', 'sessions', 'new', 'notifications',
  'sponsorships', 'account', 'watching', 'discussions', 'apps',
]);

// Directories that carry no signal for a repo overview.
const JUNK_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', '.next',
  '.nuxt', '.output', '.svelte-kit', '.parcel-cache', '.cache', 'vendor',
  '.venv', 'venv', '__pycache__', '.tox', '.pytest_cache', '.mypy_cache',
  '.ruff_cache', '.idea', '.vscode', '.git', 'tmp', 'temp', 'site-packages',
  'egg-info', '.sass-cache', 'bower_components', '.turbo', '.yarn', '.pnpm-store',
]);

const MANIFEST_PRIORITY = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'Gemfile', 'Dockerfile', 'docker-compose.yml', 'Makefile', 'CMakeLists.txt',
  'README.md', 'README', 'readme.md', 'LICENSE',
];

/**
 * Parse any GitHub URL into a repo descriptor.
 * @param {string} url
 * @returns {{type:'repo'|'gist'|'file'|'other', owner?:string, repo?:string, ref?:string, path?:string, gistId?:string, host?:string}}
 */
export function classifyGithubUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return { type: 'other' }; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'gist.github.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    return { type: 'gist', gistId: parts[1] || parts[0] || null };
  }
  if (host === 'raw.githubusercontent.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 4) return { type: 'file', owner: parts[0], repo: parts[1], ref: parts[2], path: parts.slice(3).join('/') };
    return { type: 'other' };
  }
  if (host !== 'github.com') return { type: 'other' };

  const parts = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (parts.length < 2) return { type: 'other' };
  if (NON_REPO_SECTIONS.has(parts[0])) return { type: 'other' };

  const owner = parts[0];
  let repo = parts[1].replace(/\.git$/i, '');
  const rest = parts.slice(2);
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return { type: 'other' };

  let ref = null;
  let path = null;
  if (rest[0] === 'tree' && rest[1]) { ref = rest[1]; path = rest.slice(2).join('/') || null; }
  else if (rest[0] === 'blob' && rest[1]) { ref = rest[1]; path = rest.slice(2).join('/') || null; }
  else if (rest[0] === 'raw' && rest[1]) { ref = rest[1]; path = rest.slice(2).join('/') || null; }

  return { type: 'repo', owner, repo, ref, path, host: 'github.com' };
}

/**
 * Best-effort shallow clone + tree map, used only when the GitHub API is
 * unreachable/rate-limited. Injectable `gitClone` for tests (null = disabled).
 */
async function cloneAndMap(url, gitClone) {
  if (!gitClone) return null;
  const dir = await gitClone(url);
  if (!dir) return null;
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const files = [];
    const walk = (d, depth) => {
      if (depth > 6) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          if (JUNK_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
          walk(full, depth + 1);
        } else if (ent.isFile()) {
          files.push(path.relative(dir, full));
        }
      }
    };
    walk(dir, 0);
    let readme = '';
    for (const cand of ['README.md', 'README', 'readme.md', 'Readme.md']) {
      try {
        const c = fs.readFileSync(path.join(dir, cand), 'utf8');
        if (c && c.trim()) { readme = c; break; }
      } catch { /* try next */ }
    }
    return { files: files.slice(0, 1500), readme: readme.slice(0, 12000), method: 'git-clone' };
  } finally {
    try { (await import('node:fs')).rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

async function fetchJson(fetchImpl, url, accept) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: accept || 'application/vnd.github+json' },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 404) throw Object.assign(new Error('GitHub returned 404 — repository not found'), { code: 'NOT_FOUND' });
  if (res.status === 403 || res.status === 429) throw Object.assign(new Error('GitHub API rate limit reached (403)'), { code: 'RATE_LIMITED' });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  return res.json();
}

async function fetchText(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Full repository analysis.
 * @param {string} url — github.com/owner/repo link (any shape).
 * @param {object} [opts]
 * @param {string} [opts.instruction] — the user's ask ("analyze this", "review the code quality"...)
 * @param {function} [opts.sendEvent]
 * @param {function} [opts.generateContent] — (prompt, system, image, opts) => Promise<string>
 * @param {function} [opts.fetchImpl] — injectable fetch (tests)
 * @param {function} [opts.gitClone] — (url) => Promise<dir|null>; null disables clone fallback
 * @returns {Promise<{success:boolean, summary:string, meta:object, error?:string}>}
 */
export async function analyzeGithubRepo(url, opts = {}) {
  const { instruction = '', sendEvent = () => {}, generateContent = null, fetchImpl = globalThis.fetch, gitClone = null } = opts;
  const emit = (t, d) => { try { sendEvent(t, d); } catch { /* noop */ } };
  const link = String(url || '').trim();

  const parsed = classifyGithubUrl(link);
  if (parsed.type !== 'repo') {
    return { success: false, error: 'not a GitHub repository link', summary: '### ⚠ JEXI OS\n\nThat does not look like a GitHub repository link — paste the full `https://github.com/owner/repo` URL.' };
  }
  const { owner, repo } = parsed;

  let meta = null;
  let treeEntries = [];
  let readme = '';
  let manifests = [];
  let method = 'api';
  let apiFailed = null;

  try {
    // 1) repository metadata
    emit('link.github.meta', { owner, repo, phase: 'metadata' });
    meta = await fetchJson(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}`);
    const branch = parsed.ref || meta.default_branch || 'HEAD';

    // 2) recursive file tree (capped)
    let treeRes;
    try {
      treeRes = await fetchJson(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    } catch (e) {
      // Some refs (shallow links) can't be resolved by git/trees — retry on the default branch.
      if (meta.default_branch && branch !== meta.default_branch) {
        treeRes = await fetchJson(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`);
      } else throw e;
    }
    for (const ent of treeRes.tree || []) {
      if (ent.type !== 'blob') continue;
      const top = ent.path.split('/')[0];
      if (JUNK_DIRS.has(top) || top.startsWith('.')) continue;
      treeEntries.push(ent.path);
      if (treeEntries.length >= 1500) break;
    }

    // 3) README (raw) with fallbacks
    try {
      const raw = await fetchImpl(`${GITHUB_API}/repos/${owner}/${repo}/readme`, {
        headers: { 'User-Agent': UA, Accept: 'application/vnd.github.raw+json' },
        signal: AbortSignal.timeout(12000),
      });
      if (raw.ok) readme = (await raw.text()).slice(0, 12000);
    } catch { /* fall through to raw.githubusercontent */ }
    if (!readme) {
      const branch = meta.default_branch || 'HEAD';
      for (const cand of ['README.md', 'README', 'readme.md', 'README.markdown']) {
        try {
          const txt = await fetchText(fetchImpl, `${RAW_GITHUB}/${owner}/${repo}/${encodeURIComponent(branch)}/${cand}`);
          if (txt && txt.trim().length > 40) { readme = txt.slice(0, 12000); break; }
        } catch { /* try next */ }
      }
    }

    // 4) key manifests (top 6 found in the tree, raw fetches)
    const fileSet = new Set(treeEntries);
    const wanted = MANIFEST_PRIORITY.filter((m) => fileSet.has(m) || treeEntries.some((f) => f.startsWith('.github/workflows/') && m === 'Dockerfile'));
    if (treeEntries.some((f) => f.startsWith('.github/workflows/'))) {
      const wf = treeEntries.find((f) => f.startsWith('.github/workflows/'));
      if (wf && !wanted.includes(wf)) wanted.push(wf);
    }
    const fetchBranch = meta.default_branch || 'HEAD';
    for (const m of wanted.slice(0, 6)) {
      try {
        const txt = await fetchText(fetchImpl, `${RAW_GITHUB}/${owner}/${repo}/${encodeURIComponent(fetchBranch)}/${m}`);
        if (txt && txt.trim()) manifests.push({ path: m, content: txt.slice(0, 6000) });
      } catch { /* skip */ }
    }
    emit('link.github.meta', { owner, repo, branch, stars: meta.stargazers_count ?? 0, language: meta.language || null, files: treeEntries.length, archived: !!meta.archived });
  } catch (e) {
    apiFailed = (e && e.message) || String(e);
    // Rate-limited / unreachable → try a shallow clone as a fallback.
    try {
      const mapped = await cloneAndMap(link.replace(/\/tree\/.*$/, ''), gitClone);
      if (mapped) {
        treeEntries = mapped.files;
        readme = mapped.readme;
        meta = { full_name: `${owner}/${repo}`, default_branch: 'HEAD', description: null, language: null, stargazers_count: null, forks_count: null, open_issues_count: null, license: null, archived: false, topics: [], size: null, updated_at: null };
        method = 'git-clone';
        apiFailed = null;
      }
    } catch (e2) { /* fall through to honest failure */ }
    if (apiFailed) {
      emit('link.error', { error: apiFailed });
      return {
        success: false,
        error: apiFailed,
        summary: `### ⚠ JEXI OS\n\nI could not reach GitHub to analyze **${owner}/${repo}** right now (${apiFailed}). Try again in a minute — or paste the link again.`,
      };
    }
  }

  if (!treeEntries.length && !readme) {
    return { success: false, error: 'repository is empty or unreadable', summary: `### ⚠ JEXI OS\n\n**${owner}/${repo}** appears to be empty or has no readable files.` };
  }

  // ---- Build the context snapshot ----
  const dirs = new Map();
  const langs = new Map();
  for (const f of treeEntries) {
    const top = f.split('/')[0];
    dirs.set(top, (dirs.get(top) || 0) + 1);
    const ext = f.includes('.') ? f.split('.').pop().toLowerCase().slice(0, 10) : '(none)';
    langs.set(ext, (langs.get(ext) || 0) + 1);
  }
  const topDirs = [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
    .map(([d, n]) => `- \`${d}/\` — ${n} file(s)`).join('\n');
  const topLangs = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([l, n]) => `\`${l}\` ×${n}`).join(', ');
  const entryFiles = MANIFEST_PRIORITY.filter((m) => new Set(treeEntries).has(m) || (m === 'Dockerfile' && treeEntries.some((f) => f.startsWith('Dockerfile'))));
  const keyFiles = treeEntries.filter((f) => f.split('/').length <= 2).slice(0, 40).join('\n');

  const ctx = {
    fullName: meta.full_name || `${owner}/${repo}`,
    description: meta.description || null,
    language: meta.language || null,
    stars: meta.stargazers_count ?? null,
    forks: meta.forks_count ?? null,
    openIssues: meta.open_issues_count ?? null,
    license: meta.license ? (meta.license.spdx_id || meta.license.name) : null,
    archived: !!meta.archived,
    topics: (meta.topics || []).slice(0, 10).join(', ') || null,
    sizeMb: meta.size ? (meta.size / 1024).toFixed(1) : null,
    updatedAt: meta.updated_at ? new Date(meta.updated_at).toISOString().slice(0, 10) : null,
    branch: meta.default_branch || 'HEAD',
    totalFiles: treeEntries.length,
    topDirs,
    topLangs: topLangs || '(unknown)',
    entryFiles: entryFiles.length ? entryFiles.join(', ') : '(none detected)',
    keyFiles: keyFiles || '(flat/small tree)',
    manifests: manifests.map((m) => `### ${m.path}\n${m.content}`).join('\n\n') || '(none fetched)',
    readme: readme.slice(0, 12000) || '(no README)',
    method,
  };

  // ---- Report ----
  let summary = '';
  if (generateContent) {
    try {
      const prompt =
        `The user asked you to: ${instruction || 'analyze this GitHub repository'}\n\n` +
        `REPOSITORY: ${ctx.fullName}\n` +
        `METADATA: ${ctx.description ? `"${ctx.description}" · ` : ''}${ctx.language || 'language unknown'} · ⭐${ctx.stars ?? '?'} · 🍴${ctx.forks ?? '?'} · issues ${ctx.openIssues ?? '?'}${ctx.license ? ` · license ${ctx.license}` : ''}${ctx.archived ? ' · ARCHIVED' : ''}${ctx.topics ? ` · topics: ${ctx.topics}` : ''}${ctx.sizeMb ? ` · ~${ctx.sizeMb} MB` : ''}${ctx.updatedAt ? ` · last push ${ctx.updatedAt}` : ''} (branch ${ctx.branch})\n` +
        `FILE COUNT: ${ctx.totalFiles} (mapped via ${ctx.method})\n` +
        `LANGUAGES: ${ctx.topLangs}\n` +
        `TOP-LEVEL LAYOUT:\n${ctx.topDirs}\n` +
        `ENTRY FILES DETECTED: ${ctx.entryFiles}\n` +
        `KEY FILES (sample):\n${ctx.keyFiles}\n\n` +
        `KEY MANIFESTS:\n${ctx.manifests}\n\n` +
        `README:\n${ctx.readme.slice(0, 8000)}\n\n` +
        `Produce a structured report in plain markdown with EXACTLY these sections:\n` +
        `## OVERVIEW — what this project is, one paragraph.\n` +
        `## ARCHITECTURE — how the code is organized, key modules and how they connect (cite real paths from KEY FILES).\n` +
        `## KEY FILES — the files that matter most and why.\n` +
        `## STRENGTHS — what is done well.\n` +
        `## ISSUES — real problems you can see (missing tests, dead code, security smells, no CI, etc). Cite \`file:line\` where possible, otherwise \`file\`.\n` +
        `## FIXES — concrete, prioritized fixes for the issues.\n` +
        `## VERDICT — would you use this / what is it ready for.\n` +
        `Be specific and honest. If the repository is too thin to judge something, say so — never invent files or claims.`;
      summary = String(await generateContent(prompt, 'You are JEXI OS, an autonomous agent. You write concise, accurate technical reviews.', null, { prefer: 'groq', temperature: 0.3 })).trim();
    } catch { summary = ''; }
  }

  if (!summary) {
    // Deterministic fallback — the user still gets a real analysis.
    summary =
      `## OVERVIEW\n\n**${ctx.fullName}** — ${ctx.description || 'no description provided.'} ` +
      `Built primarily in ${ctx.language || 'an unknown language'} with ${ctx.totalFiles} file(s) mapped (via ${ctx.method}). ` +
      `${ctx.stars != null ? `⭐ ${ctx.stars} stars · ` : ''}${ctx.forks != null ? `🍴 ${ctx.forks} forks · ` : ''}${ctx.openIssues != null ? `${ctx.openIssues} open issues · ` : ''}${ctx.license ? `license ${ctx.license} · ` : ''}${ctx.archived ? '**ARCHIVED** · ' : ''}${ctx.updatedAt ? `last push ${ctx.updatedAt}.` : '.'}\n\n` +
      `## ARCHITECTURE\n\nTop-level layout:\n${ctx.topDirs}\n\nLanguage mix: ${ctx.topLangs}.\n\nEntry files detected: ${ctx.entryFiles}.\n\n` +
      `## KEY FILES\n\n\`\`\`\n${ctx.keyFiles}\n\`\`\`\n\n` +
      `## README\n\n${ctx.readme.slice(0, 2500) || '(no README found)'}\n\n` +
      `## STRENGTHS\n\n- ${ctx.readme ? 'Documented with a README.' : 'No README — documentation is the first improvement.'}\n- ${treeEntries.length ? `${treeEntries.length} files mapped; structure visible above.` : 'Small tree.'}\n\n` +
      `## ISSUES\n\n- ${ctx.readme && ctx.readme !== '(no README)' ? '' : 'Missing README.\n- '}${ctx.manifests === '(none fetched)' ? 'No manifests detected — dependency management unclear.' : `Manifests inspected: ${ctx.manifests.match(/^### (.+)$/gm) ? [...ctx.manifests.matchAll(/^### (.+)$/gm)].map((m) => m[1]).join(', ') : ctx.manifests.slice(0, 120)}`}\n\n` +
      `## FIXES\n\n- Add/complete the README with setup + usage.\n- Add tests and CI if absent.\n- Review the key files above for TODOs or dead code.\n\n` +
      `## VERDICT\n\nThis snapshot was generated without a live LLM (providers unavailable). The structure above is factual from the repository; ask me again in a minute for a deeper review.`;
  }

  emit('link.content-ready', { kind: 'github-repo', chars: summary.length, repo: `${owner}/${repo}` });
  emit('link.answer', { chars: summary.length });
  emit('done', { success: true, summary });
  return {
    success: true,
    summary,
    meta: {
      kind: 'github-repo', owner, repo, branch: meta.default_branch || parsed.ref || 'HEAD',
      stars: meta.stargazers_count ?? null, language: meta.language || null,
      filesCount: treeEntries.length, method,
    },
    url: link,
  };
}
