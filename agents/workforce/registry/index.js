/**
 * JEXI OS — WORKFORCE REGISTRY — facade (Phase 7 I + J).
 *
 *   node -e "console.log(require('./workforce/registry').loadAgentFile('planner'))"
 *   node -e "console.log(require('./workforce/registry').listDivisions().length)"
 *
 * The canonical agent files (agents/**\/*.agent.md) are the source of truth
 * for the specialist pool; the runtime registry (Phase 2D Director roster)
 * remains the hot path. The division registry (workforce/divisions.json,
 * Phase 7 J) is the committed, CI-validated view of the agents/ tree. This module:
 *
 *   loadAgentFile(id)      — read + parse one canonical agent file by id
 *   list() / divisions()   — the indexed catalog
 *   listDivisions()        — division registry entries (divisions.json)
 *   getDivision(id)        — one division registry entry by id
 *   agentsInDivision(id)   — all canonical agents in that division
 *   resolveTwoStage(query) — runtime-first, canonical-fallback resolution
 *   mergedRoster()         — runtime + canonical in one list
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { buildIndex, parseFrontmatter, indexSummary, mergedRoster, agentFilePaths } from './catalog.js';
import { resolveTwoStage } from './resolve.js';

const REG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(REG_DIR, '../..');

/** Read one canonical agent file by id (searched across all divisions).
 *  Returns { id, name, description, tools, body, ...meta, file } or null. */
export function loadAgentFile(id) {
  const wanted = String(id || '').toLowerCase();
  const paths = agentFilePaths();
  const hit = paths.find((p) => path.basename(p, '.agent.md') === wanted);
  if (!hit) return null;
  const text = fs.readFileSync(hit, 'utf8');
  const { meta, body } = parseFrontmatter(text);
  if (!meta) return null;
  return {
    id: wanted,
    division: path.basename(path.dirname(hit)),
    file: path.relative(REPO_ROOT, hit),
    name: meta.name || '',
    description: meta.description || '',
    tools: Array.isArray(meta.tools) ? meta.tools : [],
    color: meta.color || null,
    emoji: meta.emoji || null,
    vibe: meta.vibe || null,
    services: meta.services || null,
    body,
    bodyLength: body.length,
  };
}

/** All indexed canonical agents (68 entries). */
export function list() {
  return [...buildIndex().byId.values()];
}

/** Division → agent ids map (17 agent divisions; meta holds only the template). */
export function divisions() {
  return buildIndex().divisions;
}

/** Index summary with counts and any parse errors. */
export function catalogSummary() {
  return indexSummary();
}

const DIVISIONS_JSON = path.join(REG_DIR, '..', 'divisions.json');

/** Division registry (Phase 7 J): all entries from workforce/divisions.json —
 *  the committed, CI-validated view of the agents/ tree. Lets the console,
 *  the router, and any tool enumerate divisions without scanning the
 *  filesystem. Returns [{ id, label, icon, color, description, agentCount,
 *  template? }] (empty array if the registry file has not been generated). */
export function listDivisions() {
  let raw;
  try {
    raw = fs.readFileSync(DIVISIONS_JSON, 'utf8');
  } catch {
    return []; // registry not generated yet — tolerant, like the catalog
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.divisions) ? parsed.divisions : [];
  } catch {
    return []; // corrupt registry — never crash callers
  }
}

/** One division registry entry by id (Phase 7 J), or null if unknown. */
export function getDivision(id) {
  const wanted = String(id || '').toLowerCase();
  return listDivisions().find((d) => d && d.id === wanted) || null;
}

/** All canonical agents in a division (Phase 7 J), resolved through the
 *  indexed catalog (Scope I) — same data the registry's agentCount is
 *  computed from. Unknown division → empty array. */
export function agentsInDivision(id) {
  const wanted = String(id || '').toLowerCase();
  const { byId, divisions } = buildIndex();
  const ids = divisions.get(wanted) || [];
  return ids.map((aid) => byId.get(aid)).filter(Boolean);
}

export { resolveTwoStage, mergedRoster, buildIndex, indexSummary, parseFrontmatter };

export default { loadAgentFile, list, divisions, catalogSummary, listDivisions, getDivision, agentsInDivision, resolveTwoStage, mergedRoster, buildIndex, indexSummary, parseFrontmatter };
