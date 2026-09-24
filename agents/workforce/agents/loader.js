/**
 * JEXI OS — PHASE 13 SCOPE A — AGENT LOADER.
 *
 * Loads the roster from disk. No hardcoded lists: every row is parsed from a
 * real file. Two inputs, one roster:
 *
 *   1. Live tree  — agents/catalog/**\/*.agent.md, server/agents, agents/jexi,
 *                   plugin.json contributions, SOUL profiles, runtime
 *                   employees. Re-read on every load so edits land immediately.
 *   2. Vendor catalog — agents/workforce/agents/vendor/agency-agents.specs.json, the
 *                   machine-usable projection of msitarzewski/agency-agents
 *                   (see vendor/README.md for provenance and the pinned SHA).
 *
 *   import { load } from './loader.js';
 *   const { count, agents } = load();          // repo root inferred
 *   const { agents } = load('/path/to/repo');
 *
 * Load is deterministic: ids sort lexicographically; duplicate ids resolve by
 * origin precedence (JEXI's own files win over vendored ones) and are reported
 * through `duplicates`, never silently dropped.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { makeSpec, ERRORS } from './agent-spec.js';
import { inferCapabilities } from './capabilities.js';
import { inferDivision, initialTrustLevel } from './infer.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(MODULE_DIR, '../../..');

export const VENDOR_CATALOG = path.join(MODULE_DIR, 'vendor', 'agency-agents.specs.json');

/** JEXI origin wins over vendored origin when the same id appears twice. */
const ORIGIN_PRECEDENCE = [
  'jexi-canonical', 'jexi-coworker', 'server-contract',
  'plugin', 'soul-profile', 'runtime-employee', 'agency-agents',
];

function originRank(origin) {
  const i = ORIGIN_PRECEDENCE.indexOf(origin);
  return i === -1 ? ORIGIN_PRECEDENCE.length : i;
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.jexi') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Parse flat YAML frontmatter, tolerating quotes and array brackets. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function parseTools(meta) {
  if (!meta || !meta.tools) return [];
  const inner = /\[([^\]]*)\]/.exec(meta.tools);
  const raw = inner ? inner[1] : meta.tools;
  return raw.split(',').map((t) => t.trim()).filter(Boolean).sort();
}

function firstRole(text, fallback) {
  const m = /^\s*[-*]?\s*\*{0,2}Role\*{0,2}:\s*(.+)$/m.exec(String(text || ''));
  if (m) return m[1].trim().replace(/^[-–—]\s*/, '').slice(0, 300);
  return String(fallback || '').trim().slice(0, 300) || 'specialist';
}

function tryMake(row, errors) {
  try {
    const division = row.division || inferDivision(row.id, row.name);
    return makeSpec({
      ...row,
      division,
      capabilities: Array.isArray(row.capabilities) && row.capabilities.length
        ? row.capabilities
        : inferCapabilities({ ...row, division }),
      trustLevel: row.trustLevel || initialTrustLevel(row.origin),
    });
  } catch (err) {
    const list = Array.isArray(err.errors) && err.errors.length
      ? err.errors
      : [{ code: ERRORS.INVALID_SPEC, field: null, message: err.message }];
    for (const e of list) {
      errors.push({ ...e, source: row.sourcePath || row.id || null });
    }
    return null;
  }
}

function loadTree(root, errors) {
  const out = [];
  const add = (row) => { const s = tryMake(row, errors); if (s) out.push(s); };

  for (const f of walk(path.join(root, 'agents/catalog'))) {
    if (!f.endsWith('.agent.md')) continue;
    const text = fs.readFileSync(f, 'utf8');
    const meta = parseFrontmatter(text);
    if (!meta || !meta.name) continue;
    const id = path.basename(f, '.agent.md');
    add({
      id,
      name: meta.name,
      division: meta.division,
      role: firstRole(text, meta.description),
      description: meta.description || '',
      capabilities: [],
      origin: 'jexi-canonical',
      sourcePath: path.relative(root, f),
      tools: parseTools(meta),
    });
  }

  const srvDir = path.join(root, 'server/agents');
  if (fs.existsSync(srvDir)) {
    for (const name of fs.readdirSync(srvDir)) {
      if (!name.endsWith('.md')) continue;
      const f = path.join(srvDir, name);
      if (!fs.statSync(f).isFile()) continue;
      const text = fs.readFileSync(f, 'utf8');
      const meta = parseFrontmatter(text) || {};
      const id = path.basename(name, '.md');
      add({
        id,
        name: meta.name || id,
        division: meta.division,
        role: firstRole(text, meta.mission || meta.description),
        description: meta.description || meta.mission || '',
        capabilities: [],
        origin: 'server-contract',
        sourcePath: `server/agents/${name}`,
      });
    }
  }

  for (const f of walk(path.join(root, 'agents/jexi'))) {
    if (!f.endsWith('.md')) continue;
    const text = fs.readFileSync(f, 'utf8');
    const meta = parseFrontmatter(text);
    if (!meta || !meta.name) continue;
    add({
      id: path.basename(f, '.md').toLowerCase(),
      name: meta.name,
      division: meta.division,
      role: firstRole(text, meta.description),
      description: meta.description || '',
      capabilities: [],
      origin: 'jexi-coworker',
      sourcePath: path.relative(root, f),
    });
  }

  const pluginsDir = path.join(root, 'server/plugins');
  if (fs.existsSync(pluginsDir)) {
    for (const dir of fs.readdirSync(pluginsDir)) {
      const pf = path.join(pluginsDir, dir, 'plugin.json');
      if (!fs.existsSync(pf)) continue;
      let j;
      try { j = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch { continue; }
      for (const a of ((j.contributes && j.contributes.agents) || [])) {
        add({
          id: String(a),
          name: String(a),
          division: j.division,
          role: `${j.name || dir} pipeline role`,
          description: `Agent contributed by the ${j.name || dir} plugin.`,
          capabilities: [],
          origin: 'plugin',
          sourcePath: `server/plugins/${dir}/plugin.json`,
        });
      }
    }
  }

  const profilesDir = path.join(root, 'server/agents/profiles');
  if (fs.existsSync(profilesDir)) {
    for (const dir of fs.readdirSync(profilesDir)) {
      const sf = path.join(profilesDir, dir, 'SOUL.md');
      if (!fs.existsSync(sf)) continue;
      const text = fs.readFileSync(sf, 'utf8');
      const meta = parseFrontmatter(text) || {};
      add({
        id: dir,
        name: meta.name || dir,
        division: meta.division,
        role: firstRole(text, meta.description),
        description: meta.description || `Runtime profile: ${dir}.`,
        capabilities: [],
        origin: 'soul-profile',
        sourcePath: `server/agents/profiles/${dir}/SOUL.md`,
      });
    }
  }

  const empPath = path.join(root, 'server/src/services/director/Employees.js');
  if (fs.existsSync(empPath)) {
    const src = fs.readFileSync(empPath, 'utf8');
    const re = /agentId:\s*'([a-z0-9-]+)',\s*\n\s*displayName:\s*'([^']+)',\s*\n\s*role:\s*'([^']+)',\s*\n\s*description:\s*'([^']*)'/g;
    for (const m of src.matchAll(re)) {
      add({
        id: m[1],
        name: m[2],
        division: undefined,
        role: m[3],
        description: m[4],
        capabilities: [],
        origin: 'runtime-employee',
        sourcePath: 'server/src/services/director/Employees.js',
      });
    }
  }

  return out;
}

function loadVendor(root, errors) {
  const catalog = path.join(root, 'agents/workforce/agents/vendor/agency-agents.specs.json');
  if (!fs.existsSync(catalog)) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(catalog, 'utf8')); } catch { return []; }
  const out = [];
  for (const row of (data.agents || [])) {
    const s = tryMake({ ...row, origin: 'agency-agents' }, errors);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Load the full roster from `root` (defaults to the repo root).
 *
 *   -> { count, agents[], duplicates[], errors[], byOrigin, byDivision }
 *
 * `errors` collects malformed sources instead of throwing, so one bad file
 * does not make the other 400 unreadable. `duplicates` names every id that
 * appeared in more than one source.
 */
export function load(root = DEFAULT_ROOT) {
  const errors = [];
  const tree = loadTree(root, errors);
  const vendor = loadVendor(root, errors);

  const byId = new Map();
  const duplicates = [];
  for (const spec of [...tree, ...vendor]) {
    const prev = byId.get(spec.id);
    if (!prev) { byId.set(spec.id, spec); continue; }
    duplicates.push({ id: spec.id, kept: prev.origin, dropped: spec.origin });
    if (originRank(spec.origin) < originRank(prev.origin)) byId.set(spec.id, spec);
  }

  const agents = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const byOrigin = {};
  const byDivision = {};
  for (const a of agents) {
    byOrigin[a.origin] = (byOrigin[a.origin] || 0) + 1;
    byDivision[a.division] = (byDivision[a.division] || 0) + 1;
  }
  return { count: agents.length, agents, duplicates, errors, byOrigin, byDivision };
}

/** Read every agent spec from a directory of `*.agent.md` files. */
export function loadDir(dir) {
  const errors = [];
  const out = [];
  for (const f of walk(dir)) {
    if (!f.endsWith('.agent.md')) continue;
    const meta = parseFrontmatter(fs.readFileSync(f, 'utf8'));
    if (!meta || !meta.name) continue;
    const s = tryMake({
      id: path.basename(f, '.agent.md'),
      name: meta.name,
      division: meta.division,
      role: meta.description || 'specialist',
      description: meta.description || '',
      capabilities: [],
      origin: 'jexi-canonical',
      sourcePath: f,
    }, errors);
    if (s) out.push(s);
  }
  return { count: out.length, agents: out.sort((a, b) => a.id.localeCompare(b.id)), errors };
}