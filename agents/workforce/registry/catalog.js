/**
 * JEXI OS — WORKFORCE REGISTRY — canonical agent-file catalog (Phase 7 I).
 *
 * Indexes the canonical specialist pool under the agents/ tree (per-division files):
 *
 *   import { buildIndex, indexSummary, mergedRoster } from './catalog.js';
 *
 * - buildIndex(): walks agents/, parses every frontmatter, indexes by id.
 * - mergedRoster(): merges the runtime registry (Phase 2D — the Director's
 *   hot-path employees, server/src/services/director/Employees.js) with the
 *   canonical catalog. Runtime wins for hot-path coworkers; canonical files
 *   supply the specialist pool.
 *
 * The canonical template (agents/meta/_template.md) is deliberately NOT
 * `*.agent.md`, so it never enters the index — the catalog is exactly the
 * 68 real agents.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const REG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(REG_DIR, '../../..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents/catalog');

/** Parse flat YAML frontmatter (key: value; `tools: [a, b]` → array; nested
 *  `services:` blocks are tolerated — their `- name:` lines are skipped). */
export function parseFrontmatter(text) {
  const src = String(text || '');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: null, body: src };
  const meta = {};
  let lastKey = null;
  for (const line of m[1].split('\n')) {
    if (/^\s*-\s/.test(line) && lastKey) continue; // nested list item → tolerated
    if (/^\s+[A-Za-z0-9_-]+:/.test(line)) continue; // nested mapping line → tolerated
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    lastKey = key;
    let value = raw.trim();
    if (/^\[.*\]$/.test(value)) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      value = value.replace(/^['"]|['"]$/g, '');
    }
    meta[key] = value;
  }
  return { meta, body: src.slice(m[0].length).replace(/^\s*\n/, '') };
}

function walkAgentFiles(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e);
    let st = null;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkAgentFiles(full, out);
    else if (e.endsWith('.agent.md')) out.push(full);
  }
  return out;
}

export function agentFilePaths() {
  return walkAgentFiles(AGENTS_DIR).sort();
}

/** Index every canonical agent file. Returns { byId, divisions, errors }. */
export function buildIndex() {
  const byId = new Map();
  const divisions = new Map();
  const errors = [];
  for (const full of agentFilePaths()) {
    const id = idFromFile(full);
    const division = path.basename(path.dirname(full));
    try {
      const text = fs.readFileSync(full, 'utf8');
      const { meta, body } = parseFrontmatter(text);
      if (!meta || !meta.name || !meta.description) {
        errors.push({ file: path.relative(REPO_ROOT, full), error: 'frontmatter missing name/description' });
        continue;
      }
      const entry = {
        id,
        division,
        name: meta.name,
        description: meta.description,
        color: meta.color || null,
        emoji: meta.emoji || null,
        vibe: meta.vibe || null,
        tools: Array.isArray(meta.tools) ? meta.tools : [],
        services: meta.services || null,
        file: path.relative(REPO_ROOT, full),
        body,
        source: 'canonical',
      };
      byId.set(id, entry);
      if (!divisions.has(division)) divisions.set(division, []);
      divisions.get(division).push(id);
    } catch (e) {
      errors.push({ file: path.relative(REPO_ROOT, full), error: String(e.message) });
    }
  }
  return { byId, divisions, errors };
}

function idFromFile(full) {
  return path.basename(full, '.agent.md');
}

/** Runtime roster (Phase 2D hot-path coworkers) — loaded lazily and tolerantly:
 *  the registry works even when the server tree cannot be imported. */
export async function runtimeRoster() {
  try {
    const m = await import(path.join(REPO_ROOT, 'server/src/services/director/Employees.js'));
    return m.rosterSummary();
  } catch {
    return [];
  }
}

/**
 * Merge the runtime registry with the canonical catalog.
 * Runtime wins for hot-path coworkers; canonical files supply specialists.
 * Resolves to [{ source: 'runtime'|'canonical', ...entry }].
 */
export async function mergedRoster() {
  const { byId } = buildIndex();
  let runtime = [];
  try {
    const m = await import(path.join(REPO_ROOT, 'server/src/services/director/Employees.js'));
    runtime = m.rosterSummary();
  } catch {
    runtime = [];
  }
  const merged = [];
  const seen = new Set();
  for (const r of runtime) {
    seen.add(String(r.agentId).toLowerCase());
    merged.push({ source: 'runtime', id: r.agentId, name: r.displayName, role: r.role, capabilities: r.capabilities, status: r.status });
  }
  for (const [id, a] of byId) {
    if (seen.has(id)) continue; // runtime wins
    merged.push({ source: 'canonical', id, name: a.name, division: a.division, description: a.description, tools: a.tools });
  }
  return merged;
}

/** Compact index summary (id, division, name) — probe-friendly. */
export function indexSummary() {
  const { byId, divisions, errors } = buildIndex();
  return {
    count: byId.size,
    divisionCount: divisions.size,
    divisions: [...divisions.entries()]
      .map(([d, ids]) => ({ division: d, count: ids.length, ids }))
      .sort((a, b) => a.division.localeCompare(b.division)),
    errors,
  };
}
