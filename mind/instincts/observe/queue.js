/**
 * JEXI OS — Phase 26 Scope A — observation queue (append-only).
 *
 * Per-project append-only JSONL at
 *   <root>/projects/<projectId>/observations.jsonl
 * Entry shape: { id, projectId, sessionId, kind, payload, at }
 *   at = monotonic op-seq from <root>/op-seq.txt (no clocks)
 *   id = 'obs-NNN', sequential per project (line count + 1)
 * Entries are never rewritten or removed by this module.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertNonEmptyString, fail } from '../../../services/semantica/_internal.js';
import { projectDir, assertScope } from './scope.js';

const queueFile = (root, projectId) => path.join(projectDir(root, projectId), 'observations.jsonl');
const seqFile = (root) => path.join(root, 'op-seq.txt');

export function nextOp(root) {
  let seq = 0;
  try { seq = parseInt(fs.readFileSync(seqFile(root), 'utf8'), 10) || 0; } catch { seq = 0; }
  seq += 1;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(seqFile(root), String(seq));
  return seq;
}

export function currentOp(root) {
  try { return parseInt(fs.readFileSync(seqFile(root), 'utf8'), 10) || 0; } catch { return 0; }
}

export function pushObservation(root, { projectId, sessionId, kind, payload }) {
  assertNonEmptyString(sessionId, 'observation sessionId', 'E_INVALID_OBSERVATION');
  assertNonEmptyString(kind, 'observation kind', 'E_INVALID_OBSERVATION');
  if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) {
    throw fail('E_INVALID_OBSERVATION', 'payload must be a plain object');
  }
  const pdir = projectDir(root, projectId);
  fs.mkdirSync(pdir, { recursive: true });
  const f = queueFile(root, projectId);
  let count = 0;
  if (fs.existsSync(f)) {
    count = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  }
  const entry = {
    id: 'obs-' + String(count + 1).padStart(3, '0'),
    projectId,
    sessionId,
    kind,
    payload: payload === undefined ? {} : payload,
    at: nextOp(root),
  };
  fs.appendFileSync(f, JSON.stringify(entry) + '\n');
  return entry;
}

/** drain reads the project's queue in order; every entry is scope-checked. */
export function drainObservations(root, projectId) {
  const f = queueFile(root, projectId);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l))
    .map((entry) => assertScope(entry, projectId));
}
