/**
 * B188 — WORKSPACE PUBLISHER (JEXI's separate build home).
 *
 * A dedicated GitHub Pages repo (jexi-workspace) — completely separate from
 * JEXI's own hosting. Finished builds get published there with one commit
 * per project via the Contents API:
 *
 *   https://<user>.github.io/jexi-workspace/<project>/     live app
 *   https://<user>.github.io/jexi-workspace/               portfolio index
 *
 * Lifecycle (the "clear after done" contract):
 *   - every project carries a manifest (published-at, brief, files)
 *   - SWEEP: on boot, on every publish, and via /api/workspace-admin/sweep —
 *     projects older than TTL (default 24h) are deleted automatically
 *   - manual: clearProject(name) via chat ("clear my workspace" / "done with X")
 *
 * Zero new infra: rides the existing GITHUB_TOKEN + free Pages. No card.
 */

import fetch from 'node-fetch';
import { resolveCredential } from './CredentialStore.js';

const REPO = process.env.JEXI_WORKSPACE_REPO || 'lewiseinstein15-Tech/jexi-workspace';
const BASE = process.env.JEXI_WORKSPACE_URL || 'https://lewiseinstein15-tech.github.io/jexi-workspace';
const API = `https://api.github.com/repos/${REPO}`;
const UA = 'JEXI-OS/1.0 (workspace publisher)';
const TTL_MS = Number(process.env.JEXI_WORKSPACE_TTL_HOURS || 24) * 3600 * 1000;
const MANIFEST = '.jexi-projects.json'; // hidden from the index, drives listing+TTL

function token() {
  try {
    const v = resolveCredential('github') || resolveCredential('github_token');
    if (v) return v;
  } catch { /* store absent */ }
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

async function gh(pathname, opts = {}) {
  const t = token();
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.method) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${pathname}`, { ...opts, headers, signal: AbortSignal.timeout(30000) });
  return { ok: res.ok, status: res.status, res };
}

async function getJson(pathname) {
  const r = await gh(pathname);
  if (!r.ok) return null;
  return r.res.json();
}

async function putFile(path, content, message, sha = null, branch = 'main') {
  const body = {
    message: String(message).slice(0, 200),
    content: Buffer.from(String(content), 'utf-8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  };
  const r = await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.res.json()).message || msg; } catch { /* keep */ }
    return { ok: false, error: msg };
  }
  const data = await r.res.json();
  return { ok: true, sha: data.commit?.sha?.slice(0, 10) };
}

async function deleteFile(path, sha, message, branch = 'main') {
  const r = await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: String(message).slice(0, 200), sha, branch }),
  });
  return { ok: r.ok };
}

/* ─────────── manifest (the project registry) ─────────── */

async function readManifest() {
  const data = await getJson(`/contents/${MANIFEST}`);
  if (!data || data.encoding !== 'base64') return { projects: {} };
  try {
    const m = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
    m.projects = m.projects || {};
    return { ...m, _sha: data.sha };
  } catch { return { projects: {}, _sha: null }; }
}

async function writeManifest(manifest, sha) {
  return putFile(MANIFEST, JSON.stringify({ projects: manifest.projects }, null, 2), 'workspace: update registry', sha);
}

/* ─────────── the portfolio index (professional listing) ─────────── */

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderIndex(projects) {
  const list = Object.entries(projects)
    .sort((a, b) => (b[1].publishedAt || '').localeCompare(a[1].publishedAt || ''))
    .map(([name, p]) => {
      const age = p.publishedAt ? Math.round((Date.now() - new Date(p.publishedAt).getTime()) / 3600000) : 0;
      const expires = p.publishedAt ? Math.max(0, Math.round((new Date(p.publishedAt).getTime() + TTL_MS - Date.now()) / 3600000)) : 24;
      return `<a class="proj" href="${esc(name)}/">
  <span class="fav">${p.icon || '📦'}</span>
  <span class="t"><b>${esc(p.title || name)}</b><span>${esc((p.brief || '').slice(0, 90))}</span></span>
  <span class="go">${p.entry ? 'OPEN →' : 'FILES →'}<br><small>${expires}h left</small></span>
</a>`;
    }).join('\n');
  const count = Object.keys(projects).length;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>JEXI Workspace</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{background:#0a0e17;color:#e8e8e8;font-family:Inter,system-ui,sans-serif;margin:0;padding:32px 20px}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:22px;margin:0}h1 span{color:#00ff9d}
p.sub{color:#8a93a3;font-size:12.5px;font-family:ui-monospace,monospace;margin:8px 0 22px}
.empty{border:1px dashed #2a3140;border-radius:14px;padding:40px;text-align:center;color:#5c6470;font-family:monospace;font-size:13px}
.proj{display:flex;align-items:center;gap:14px;background:#111726;border:1px solid #232b3a;border-radius:14px;padding:16px 18px;margin:12px 0;text-decoration:none;transition:.15s}
.proj:hover{border-color:#00ff9d;transform:translateY(-1px)}
.fav{font-size:22px}.t{flex:1;min-width:0}.t b{display:block;color:#fff;font-size:15px;margin-bottom:3px}
.t span{color:#8a93a3;font-size:12px;font-family:ui-monospace,monospace;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.go{color:#00ff9d;font-family:ui-monospace,monospace;font-size:12px;text-align:right}
.go small{display:block;color:#5c6470;font-size:10px;margin-top:3px}
footer{margin-top:28px;color:#4a5262;font-size:11px;font-family:monospace;text-align:center}
</style></head><body><div class="wrap">
<h1>⚡ JEXI <span>Workspace</span></h1>
<p class="sub">${count} project${count === 1 ? '' : 's'} · apps jexi builds land here · auto-cleaned ${TTL_MS / 3600000}h after publish</p>
${count ? list : '<div class="empty">no projects yet — ask JEXI to build something and say "publish it"</div>'}
<footer>maintained automatically by JEXI OS · builds and previews only — this is not JEXI herself</footer>
</div></body></html>`;
}

async function refreshIndex(projects) {
  const data = await getJson('/contents/index.html');
  return putFile('index.html', renderIndex(projects), 'workspace: refresh index', data?.sha || null);
}

/* ─────────── public API ─────────── */

/**
 * Publish a finished build. files = [{ name, code }] (paths may include /).
 * Returns { ok, url, filesUrl } where url is the LIVE app (entry file) or
 * the project folder on the workspace Pages site.
 */
export async function publishProject({ name, title, brief = '', icon = '', files = [], entry = null }) {
  if (!files.length) return { ok: false, error: 'no files to publish' };
  const slug = String(name || 'project').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  const entryName = entry || files.find((f) => /^index\.html$/i.test(f.name))?.name || files.find((f) => /\.html$/i.test(f.name))?.name || null;

  // 1) commit each file under <slug>/…
  for (const f of files.slice(0, 40)) {
    const path = `${slug}/${String(f.name).replace(/^\/+/, '')}`;
    const existing = await getJson(`/contents/${path}`);
    const r = await putFile(path, f.code, `workspace: ${slug} — ${f.name}`, existing?.sha || null);
    if (!r.ok) return { ok: false, error: `could not publish ${f.name}: ${r.error}` };
  }

  // 2) manifest + index
  const manifest = await readManifest();
  manifest.projects[slug] = {
    title: title || slug,
    brief: String(brief).slice(0, 200),
    icon: icon || '📦',
    entry: entryName,
    files: files.slice(0, 40).map((f) => f.name),
    publishedAt: new Date().toISOString(),
  };
  await writeManifest(manifest, manifest._sha || null);
  await refreshIndex(manifest.projects);

  const url = entryName
    ? `${BASE}/${slug}/${entryName}`
    : `${BASE}/${slug}/`;
  return { ok: true, slug, url, indexUrl: `${BASE}/`, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
}

/** Delete one project (the "done with it" clear). */
export async function clearProject(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const manifest = await readManifest();
  if (!manifest.projects[slug]) return { ok: false, error: `no project "${slug}"` };
  const tree = await getJson('/git/trees/main?recursive=1');
  const paths = (tree?.tree || []).filter((e) => e.type === 'blob' && e.path.startsWith(`${slug}/`));
  for (const p of paths) {
    const info = await getJson(`/contents/${p.path}`);
    await deleteFile(p.path, info?.sha, `workspace: clear ${slug}`);
  }
  delete manifest.projects[slug];
  await writeManifest(manifest, manifest._sha || null);
  await refreshIndex(manifest.projects);
  return { ok: true, cleared: slug };
}

/** TTL sweep — deletes expired projects. Runs on boot + every publish. */
export async function sweepWorkspace({ force = false } = {}) {
  const manifest = await readManifest();
  const now = Date.now();
  const expired = Object.entries(manifest.projects).filter(([, p]) => {
    const t = new Date(p.publishedAt || 0).getTime();
    return force || (t && now - t > TTL_MS);
  });
  let cleared = [];
  for (const [slug] of expired) {
    const r = await clearProject(slug);
    if (r.ok) cleared.push(slug);
  }
  return { ok: true, cleared, remaining: Object.keys((await readManifest()).projects).length };
}

export async function listPublished() {
  const m = await readManifest();
  return Object.entries(m.projects).map(([slug, p]) => ({
    slug, title: p.title, brief: p.brief, entry: p.entry, files: p.files,
    publishedAt: p.publishedAt,
    url: p.entry ? `${BASE}/${slug}/${p.entry}` : `${BASE}/${slug}/`,
    expiresAt: new Date(new Date(p.publishedAt).getTime() + TTL_MS).toISOString(),
  }));
}

export function workspaceHome() { return BASE; }
