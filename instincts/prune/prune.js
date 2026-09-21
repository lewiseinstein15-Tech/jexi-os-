/**
 * JEXI OS — Phase 26 Scope F — /prune entry point.
 *
 *   run(projectId, { ttl?, minConfidence? })     -> { pruned, ids }
 *   dryRun(projectId, { ttl?, minConfidence? })  -> { would, ids }
 *
 * Reads go through Scope C's readAll (which scope-checks every
 * record: a record whose projectId disagrees with the directory
 * throws E_SCOPE_MISMATCH). Removal deletes the record file inside
 * the project's own instincts dir — no other project is ever read
 * or written. Unknown project (no directory) -> empty result
 * (DECLARED: empty, consistent with Scope A drain semantics).
 * Prune is idempotent; ids are returned ascending.
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, assertProjectId } from '../observe/scope.js';
import { currentOp } from '../observe/queue.js';
import { readAll } from '../store/query.js';
import { resolveOpts, isStale } from './ttl.js';

const instinctsDir = (root, projectId) => path.join(projectDir(root, projectId), 'instincts');

function candidates(root, projectId, opts) {
  assertProjectId(projectId);
  const { ttl, minConfidence } = resolveOpts(opts);
  const current = currentOp(root);
  const out = [];
  for (const rec of readAll(root, projectId)) { // scope-checked read (Scope C)
    const { stale, age } = isStale(current, rec, { ttl, minConfidence });
    if (stale) out.push({ id: rec.id, age, confidence: rec.confidence });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function dryRun(root, projectId, opts) {
  const list = candidates(root, projectId, opts);
  return { would: list.length, ids: list.map((c) => c.id), details: list };
}

export function run(root, projectId, opts) {
  const list = candidates(root, projectId, opts);
  const dir = instinctsDir(root, projectId);
  for (const c of list) {
    fs.rmSync(path.join(dir, c.id + '.json'));
  }
  return { pruned: list.length, ids: list.map((c) => c.id) };
}
