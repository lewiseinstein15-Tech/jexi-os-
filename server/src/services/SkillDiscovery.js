/**
 * B98 — SKILL AUTO-DISCOVERY (mirror of DeepSeek Harness
 * `packages/skill/skill-filesystem` + `packages/skill/tool-skill`).
 *
 * Ranked skill roots (exactly DSH's discovery model):
 *   project-dsh    WORKSPACE_DIR/.jexi/skills     rank 100
 *   project-agents WORKSPACE_DIR/.agents/skills   rank 200
 *   custom         plugin-mounted skills (ctx.skills) rank 300
 *   user-dsh       DATA_DIR/skills                rank 400
 *   bundled        server/skills (SkillChain)     rank 600
 *
 * Rules (DSH-faithful):
 *  - A root entry that is a DIRECTORY contributes `<dir>/SKILL.md`;
 *    a FILE ending in `.md` is a flat skill.
 *  - Frontmatter REQUIRES `name` (kebab-case) + `description`; optional
 *    `whenToUse`, `user-invocable`, `disable-model-invocation`, `metadata`.
 *    Legacy invocation keys are rejected; invalid files are IGNORED with a
 *    recorded warning — discovery is never fatal.
 *  - PROGRESSIVE DISCLOSURE: the catalog carries metadata only (name,
 *    description, whenToUse, invocation, source, rank, path). The full body
 *    loads only via getSkillBody(name) — the model-facing `skill-load` tool.
 *  - Same-name collisions: lowest rank wins (project beats user beats bundled).
 *  - Watch + invalidation: fs watchers on every root (and on the parents of
 *    roots that do not exist yet) call invalidate(); every discovery pass
 *    re-stats files so mtime changes are picked up deterministically.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WORKSPACE_DIR, DATA_DIR } from '../config.js';
import { listPluginSkills } from './PluginContext.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Bundled root = the on-disk SkillChain library (server/skills). */
export const BUNDLED_SKILLS_DIR = path.resolve(__dirname, '../../skills');

// DSH ranks (lower number = higher priority).
export const PROJECT_DSH_RANK = 100;
export const PROJECT_AGENTS_RANK = 200;
export const CUSTOM_RANK = 300;
export const USER_DSH_RANK = 400;
export const BUNDLED_SKILL_RANK = 600;

export const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const WARN = [];

/** Root table — DSH roots() mirror. */
function roots() {
  return [
    { path: path.join(WORKSPACE_DIR, '.jexi/skills'), source: 'project-dsh', rank: PROJECT_DSH_RANK, label: 'Project (.jexi/skills)' },
    { path: path.join(WORKSPACE_DIR, '.agents/skills'), source: 'project-agents', rank: PROJECT_AGENTS_RANK, label: 'Project (.agents/skills)' },
    { path: path.join(DATA_DIR, 'skills'), source: 'user-dsh', rank: USER_DSH_RANK, label: 'User (DATA_DIR/skills)' },
    { path: BUNDLED_SKILLS_DIR, source: 'bundled', rank: BUNDLED_SKILL_RANK, label: 'Bundled (server/skills)' },
  ];
}

/* ---------------- frontmatter parsing (DSH parseSkillFile mirror) --------- */

function frontmatterBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    switch (value.trim().toLowerCase()) {
      case 'true': case 'yes': case 'on': return true;
      case 'false': case 'no': case 'off': return false;
    }
  }
  return undefined;
}

function parseFrontmatter(md) {
  const m = String(md || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([a-zA-Z0-9-]+):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].trim();
    let val = raw;
    if (/^\[.*\]$/.test(raw)) {
      val = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (raw === 'true' || raw === 'false') {
      val = raw === 'true';
    }
    data[kv[1]] = val;
  }
  return { data, body: m[0].length < md.length ? md.slice(m[0].length).trim() : '' };
}

function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME_RE.test(name) && name.length <= 80;
}

/** DSH parseInvocationPolicy — legacy camelCase keys are rejected. */
function parseInvocationPolicy(data) {
  for (const legacy of ['disableModelInvocation', 'modelInvocable']) {
    if (Object.prototype.hasOwnProperty.call(data, legacy)) {
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "disable-model-invocation"`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'userInvocable')) {
    throw new Error('frontmatter field "userInvocable" is unsupported; use "user-invocable"');
  }
  const disableModelInvocation = frontmatterBoolean(data['disable-model-invocation']);
  const userInvocable = frontmatterBoolean(data['user-invocable']);
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  };
}

/**
 * Parse a skill file into metadata + body. Returns undefined (with a
 * recorded warning) when the file is not a valid skill — DSH ignores
 * invalid files instead of failing discovery.
 */
function parseSkillFile(filePath) {
  let md;
  try {
    md = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return undefined;
    throw e;
  }
  const parsed = parseFrontmatter(md);
  if (!parsed) {
    WARN.push(`Ignored ${filePath}: missing YAML frontmatter`);
    return undefined;
  }
  const { data, body } = parsed;
  const name = data.name;
  const description = data.description;
  if (typeof name !== 'string' || typeof description !== 'string' || !description.trim()) {
    WARN.push(`Ignored ${filePath}: frontmatter requires name and description`);
    return undefined;
  }
  if (!isSkillName(name)) {
    WARN.push(`Ignored ${filePath}: invalid skill name "${name}" (kebab-case required)`);
    return undefined;
  }
  let invocation;
  try {
    invocation = parseInvocationPolicy(data);
  } catch (e) {
    WARN.push(`Ignored ${filePath}: invalid invocation frontmatter: ${e.message}`);
    return undefined;
  }
  const whenToUse = typeof data['whenToUse'] === 'string' && data['whenToUse'].length ? data['whenToUse'] : undefined;
  let metadata;
  if (data.metadata && typeof data.metadata === 'string') {
    try { metadata = JSON.parse(data.metadata); } catch { metadata = undefined; }
  }
  // JEXI-native extra keys (kept as metadata so the coding-pipeline keeps meaning).
  const extra = {};
  if (Array.isArray(data['allowed-tools'])) extra.allowedTools = data['allowed-tools'];
  if (typeof data.context === 'string' && data.context) extra.context = data.context;
  return {
    name, description, whenToUse, invocation, metadata,
    extra: Object.keys(extra).length ? extra : undefined,
    content: body,
  };
}

/* ---------------- discovery (DSH discoverRoot mirror) -------------------- */

let cache = null; // { at, files: Map<absPath, {mtimeMs,size}>, candidates, warnings }

/** True when p (a path string) is inside any skill root (host mutation check). */
export function isSkillPath(p) {
  const abs = path.resolve(String(p || ''));
  return roots().some((r) => {
    const rp = path.resolve(r.path);
    return abs === rp || abs.startsWith(rp + path.sep);
  });
}

/** DSH observeHostMutation — a first-party write under a skill root invalidates. */
export function observeHostMutation(p) {
  if (p && isSkillPath(p)) invalidateSkillCache();
}

/** DSH observeHostMutationFromArgs — extract path-ish args after a write tool. */
export function observeHostMutationFromArgs(args = {}) {
  for (const key of ['path', 'file', 'target', 'dir', 'name']) {
    if (typeof args[key] === 'string' && args[key].length < 500) {
      if (isSkillPath(args[key])) { invalidateSkillCache(); return; }
    }
  }
  // nested args (e.g. { options: { path } }) — shallow scan only.
  if (args.options && typeof args.options === 'object') {
    const p = args.options.path || args.options.file;
    if (typeof p === 'string' && isSkillPath(p)) invalidateSkillCache();
  }
}

/** Force the next discovery pass to rescan everything. */
export function invalidateSkillCache() {
  cache = null;
}

/**
 * Discover all skills across ranked roots. Returns candidates (metadata
 * ONLY — no bodies) sorted by (rank, name); same-name collisions resolve
 * to the highest-priority root, DSH-style.
 *
 * Self-healing: when the cache is warm, a cheap probe re-stats every root
 * dir + every known skill file; any change (create/delete/edit) triggers a
 * full rescan — so discovery converges even without a watcher event.
 */
export function discoverSkills(force = false) {
  if (cache && !force && !probeChanged()) return cache.candidates;
  WARN.length = 0;
  const files = new Map();
  const seen = new Map(); // name → candidate (winner by lowest rank)

  const consider = (candidate) => {
    const prev = seen.get(candidate.name);
    if (!prev || candidate.rank < prev.rank) seen.set(candidate.name, candidate);
  };

  for (const root of roots()) {
    let entries = [];
    try {
      entries = fs.readdirSync(root.path, { withFileTypes: true });
    } catch (e) {
      if (e && e.code === 'ENOENT') continue; // absent root — never fatal
      WARN.push(`Cannot read skill root ${root.path}: ${e.message}`);
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.system') continue; // DSH skips .system in user roots
      let filePath, dir;
      if (entry.isDirectory()) {
        filePath = path.join(root.path, entry.name, 'SKILL.md');
        dir = path.join(root.path, entry.name);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        filePath = path.join(root.path, entry.name);
        dir = root.path;
      } else {
        continue;
      }
      let st;
      try { st = fs.statSync(filePath); } catch { continue; }
      const cached = files.get(filePath);
      let parsed;
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        parsed = cached.parsed; // unchanged since last pass — cheap rescan
      } else {
        parsed = parseSkillFile(filePath);
        files.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, parsed });
      }
      if (!parsed) continue;
      consider({
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
        invocation: parsed.invocation,
        ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
        ...(parsed.extra ? { extra: parsed.extra } : {}),
        source: root.source,
        rank: root.rank,
        provider: 'filesystem',
        path: filePath,
        dir,
        hasReference: entry.isDirectory() && fs.existsSync(path.join(dir, 'reference.md')),
      });
    }
  }

  // DSH custom roots: plugin-mounted skills (ctx.skills) rank 300.
  for (const sk of listPluginSkills()) {
    const name = String(sk.slug || sk.name || '').trim();
    if (!isSkillName(name)) continue;
    consider({
      name,
      description: String(sk.desc || sk.description || '').slice(0, 300),
      invocation: { modelInvocable: sk.modelInvocable !== false, userInvocable: sk.userInvocable !== false },
      source: 'custom',
      rank: CUSTOM_RANK,
      provider: 'plugin',
      path: null,
      dir: null,
      hasReference: false,
      pluginSkill: sk,
    });
  }

  const candidates = [...seen.values()].sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name));
  const rootStats = {};
  for (const root of roots()) {
    try { const st = fs.statSync(root.path); rootStats[root.path] = { mtimeMs: st.mtimeMs, size: st.size }; } catch { rootStats[root.path] = null; }
  }
  cache = { at: Date.now(), files, candidates, warnings: [...WARN], rootStats };
  return candidates;
}

/** Cheap warm-cache probe: root dir or known-file mtime/size changes? */
function probeChanged() {
  if (!cache) return true;
  for (const root of roots()) {
    let st = null;
    try { st = fs.statSync(root.path); } catch { /* absent */ }
    const prev = cache.rootStats && cache.rootStats[root.path];
    const now = st ? { mtimeMs: st.mtimeMs, size: st.size } : null;
    if (!prev || !now || prev.mtimeMs !== now.mtimeMs || prev.size !== now.size) return true;
  }
  for (const [filePath, cached] of cache.files) {
    let st = null;
    try { st = fs.statSync(filePath); } catch { return true; } // deleted
    if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) return true;
  }
  return false;
}

/** Discovery summary for logs / API. */
export function discoverySummary() {
  const candidates = discoverSkills();
  const bySource = {};
  for (const c of candidates) bySource[c.source] = (bySource[c.source] || 0) + 1;
  return {
    total: candidates.length,
    bySource,
    roots: roots().map((r) => ({ ...r, exists: fs.existsSync(r.path) })),
    warnings: cache ? cache.warnings : [],
    at: cache ? cache.at : null,
  };
}

/** Catalog entries (metadata only) for the API. */
export function listSkillCatalog() {
  return discoverSkills().map((c) => ({
    name: c.name,
    description: c.description,
    ...(c.whenToUse ? { whenToUse: c.whenToUse } : {}),
    invocation: c.invocation,
    source: c.source,
    rank: c.rank,
    provider: c.provider,
    hasReference: !!c.hasReference,
  }));
}

/* ---------------- full body loading (DSH get() mirror) ------------------- */

/**
 * Load the FULL body of a discovered skill (progressive disclosure — the
 * catalog never carries this). Folders with reference.md return the merged
 * body exactly like SkillChain.loadSkill. Returns undefined when the skill
 * is unknown or its file disappeared.
 */
export function getSkillBody(name) {
  const candidate = discoverSkills().find((c) => c.name === name);
  if (!candidate) return undefined;
  if (candidate.pluginSkill) {
    const load = candidate.pluginSkill.load || candidate.pluginSkill.handler;
    const body = typeof load === 'function' ? load() : candidate.pluginSkill.body;
    return {
      name: candidate.name,
      description: candidate.description,
      ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
      invocation: candidate.invocation,
      source: candidate.source,
      rank: candidate.rank,
      provider: candidate.provider,
      resourceBase: { kind: 'opaque', description: 'plugin skill' },
      content: String(body || '').slice(0, 8000),
    };
  }
  if (!candidate.path || !fs.existsSync(candidate.path)) {
    invalidateSkillCache();
    return undefined;
  }
  let content;
  try {
    const parsed = parseSkillFile(candidate.path);
    if (!parsed) return undefined;
    content = parsed.content;
  } catch { return undefined; }
  let reference;
  if (candidate.hasReference && candidate.dir) {
    try { reference = fs.readFileSync(path.join(candidate.dir, 'reference.md'), 'utf-8').trim(); } catch { reference = undefined; }
  }
  return {
    name: candidate.name,
    description: candidate.description,
    ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
    invocation: candidate.invocation,
    source: candidate.source,
    rank: candidate.rank,
    provider: candidate.provider,
    resourceBase: { kind: 'directory', path: candidate.dir },
    content,
    ...(reference ? { reference } : {}),
  };
}

/** DSH skill tool execute: full body for the model, merged with reference. */
export function loadSkillForModel(name) {
  const skill = getSkillBody(name);
  if (!skill) return undefined;
  return {
    name: skill.name,
    provider: skill.provider,
    resourceBase: skill.resourceBase,
    content: skill.reference ? `${skill.content}\n\n${skill.reference}` : skill.content,
  };
}

/* ---------------- model-facing catalog (DSH session catalog) ------------- */

/**
 * Bounded, metadata-only skill catalog injected into the agent system prompt
 * (DSH catalogDescriptionMaxLength analog). Only model-invocable skills
 * appear; full bodies are NEVER included here.
 */
export function buildSkillCatalog(limit = 30, descriptionMax = 140) {
  const candidates = discoverSkills()
    .filter((c) => c.invocation.modelInvocable)
    .slice(0, Math.max(3, Number(limit) || 30));
  if (!candidates.length) return '';
  const lines = candidates.map((c) => {
    const desc = c.description.length > descriptionMax ? `${c.description.slice(0, descriptionMax - 1)}…` : c.description;
    return `- ${c.name} — ${desc} [${c.source}·${c.rank}]`;
  });
  return `\n## Available skills (load with skill-load before using — catalog is metadata only)\n${lines.join('\n')}\n`;
}

/* ---------------- watcher (DSH SkillWatchManager mirror, bounded) --------- */

let watchers = [];
let watcherTimer = null;

function scheduleInvalidate() {
  if (watcherTimer) clearTimeout(watcherTimer);
  watcherTimer = setTimeout(() => { watcherTimer = null; invalidateSkillCache(); }, 250);
}

/** Watch every existing root + the parents of missing roots (creation events). */
export function startSkillWatcher() {
  if (watchers.length) return watchers.length;
  const watchSet = new Set();
  for (const root of roots()) {
    let target = root.path;
    if (!fs.existsSync(root.path)) {
      const parent = path.dirname(root.path);
      if (!fs.existsSync(parent)) continue; // parent missing (no workspace yet)
      target = parent;
    }
    if (watchSet.has(target)) continue;
    watchSet.add(target);
    try {
      const w = fs.watch(target, { persistent: false }, (evt, filename) => {
        const name = String(filename || '');
        if (!name || name === 'skills' || name.endsWith('.md') || name === 'SKILL.md') scheduleInvalidate();
      });
      w.on('error', () => { try { w.close(); } catch { /* noop */ } });
      watchers.push(w);
    } catch { /* watcher unsupported — mtime rescans still catch changes */ }
  }
  return watchers.length;
}

/** Stop all watchers (tests). */
export function stopSkillWatcher() {
  for (const w of watchers) { try { w.close(); } catch { /* noop */ } }
  watchers = [];
  if (watcherTimer) { clearTimeout(watcherTimer); watcherTimer = null; }
}

/* ---------------- user skill authoring (Add Skill from the app) ----------- */

function assertValidNewSkill({ name, description, body }) {
  if (!isSkillName(name)) throw new Error('Skill name must be kebab-case letters/digits (e.g. "meeting-notes")');
  if (typeof description !== 'string' || description.trim().length < 10) throw new Error('Description must be at least 10 characters');
  if (typeof body !== 'string' || body.trim().length < 50) throw new Error('Skill body must be at least 50 characters');
}

/**
 * Persist a user-authored skill to DATA_DIR/skills/<name>/SKILL.md
 * (rank 400, user-dsh root). Validated; invalidate() after write so the
 * watcher + next discovery pick it up instantly.
 */
export function createUserSkill({ name, description, whenToUse, body, reference, userInvocable = true, modelInvocable = true }) {
  assertValidNewSkill({ name, description, body });
  const dir = path.join(DATA_DIR, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  const fm = [
    '---',
    `name: ${name}`,
    `description: ${String(description).trim().replace(/\n+/g, ' ')}`,
  ];
  if (whenToUse && String(whenToUse).trim()) fm.push(`whenToUse: ${String(whenToUse).trim().replace(/\n+/g, ' ')}`);
  fm.push(`user-invocable: ${userInvocable !== false}`);
  fm.push(`disable-model-invocation: ${modelInvocable === false}`);
  fm.push('---');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `${fm.join('\n')}\n\n${body.trim()}\n`, 'utf-8');
  if (reference && String(reference).trim()) {
    fs.writeFileSync(path.join(dir, 'reference.md'), String(reference).trim() + '\n', 'utf-8');
  }
  invalidateSkillCache();
  return { ok: true, name, path: path.join(dir, 'SKILL.md'), rank: USER_DSH_RANK, source: 'user-dsh' };
}
