/**
 * JEXI OS — WORKFORCE REGISTRY — facade (Phase 7 I).
 *
 *   node -e "console.log(require('./workforce/registry').loadAgentFile('planner'))"
 *
 * The canonical agent files (agents/**\/*.agent.md) are the source of truth
 * for the specialist pool; the runtime registry (Phase 2D Director roster)
 * remains the hot path. This module:
 *
 *   loadAgentFile(id)      — read + parse one canonical agent file by id
 *   list() / divisions()   — the indexed catalog
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

export { resolveTwoStage, mergedRoster, buildIndex, indexSummary, parseFrontmatter };

export default { loadAgentFile, list, divisions, catalogSummary, resolveTwoStage, mergedRoster, buildIndex, indexSummary, parseFrontmatter };
