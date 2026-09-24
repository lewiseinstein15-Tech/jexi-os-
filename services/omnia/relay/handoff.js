/**
 * JEXI OS — Phase 15 Scope B — handoff write / read / resume.
 *
 * Handoffs live on disk at <relayDir>/handoffs/<handoffId>.json.
 * Ids are a monotonic counter (handoff-seq.txt) — no clocks, so the
 * same operation sequence is byte-identical. State is stored as
 * parsed JSON: write -> read -> write is lossless.
 *   unknown id            -> E_UNKNOWN_HANDOFF
 *   resume twice          -> E_ALREADY_RESUMED
 *   unregistered agent    -> E_UNKNOWN_AGENT
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail, assertNonEmptyString } from '../../semantica/_internal.js';

const handoffsDir = (dir) => path.join(dir, 'handoffs');
const seqFile = (dir, name) => path.join(dir, name + '-seq.txt');

export function nextSeq(dir, name) {
  let seq = 0;
  try { seq = parseInt(fs.readFileSync(seqFile(dir, name), 'utf8'), 10) || 0; } catch { seq = 0; }
  seq += 1;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(seqFile(dir, name), String(seq));
  return seq;
}

const fileOf = (dir, handoffId) => path.join(handoffsDir(dir), handoffId + '.json');

export function writeHandoff(dir, isRegistered, spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw fail('E_INVALID_HANDOFF', 'handoff spec must be a plain object');
  }
  assertNonEmptyString(spec.from, 'handoff from', 'E_INVALID_HANDOFF');
  if (!isRegistered(spec.from)) {
    throw fail('E_UNKNOWN_AGENT', 'no adapter registered as ' + JSON.stringify(spec.from));
  }
  assertNonEmptyString(spec.task, 'handoff task', 'E_INVALID_HANDOFF');
  if (spec.state === undefined || spec.state === null || typeof spec.state !== 'object' || Array.isArray(spec.state)) {
    throw fail('E_INVALID_HANDOFF', 'handoff state must be a plain object');
  }
  let state = null;
  try { state = JSON.parse(JSON.stringify(spec.state)); }
  catch (e) { throw fail('E_INVALID_HANDOFF', 'handoff state is not JSON-serializable: ' + e.message); }
  const handoffId = 'handoff-' + String(nextSeq(dir, 'handoff')).padStart(3, '0');
  const record = { handoffId, from: spec.from, task: spec.task, state, resumedBy: null, resumedAt: null };
  fs.mkdirSync(handoffsDir(dir), { recursive: true });
  fs.writeFileSync(fileOf(dir, handoffId), JSON.stringify(record, null, 2) + '\n');
  return { handoffId };
}

export function readHandoff(dir, handoffId) {
  const p = fileOf(dir, handoffId);
  if (typeof handoffId !== 'string' || !fs.existsSync(p)) {
    throw fail('E_UNKNOWN_HANDOFF', 'unknown handoffId: ' + JSON.stringify(handoffId));
  }
  const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  const out = { handoffId: rec.handoffId, from: rec.from, task: rec.task, state: rec.state };
  if (rec.resumedBy) out.resumedBy = rec.resumedBy;
  return out;
}

export function resumeHandoff(dir, isRegistered, nextOp, handoffId, by) {
  assertNonEmptyString(by, 'resume by', 'E_INVALID_ARGUMENT');
  if (!isRegistered(by)) {
    throw fail('E_UNKNOWN_AGENT', 'no adapter registered as ' + JSON.stringify(by));
  }
  const p = fileOf(dir, handoffId);
  if (!fs.existsSync(p)) {
    throw fail('E_UNKNOWN_HANDOFF', 'unknown handoffId: ' + JSON.stringify(handoffId));
  }
  const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (rec.resumedBy) {
    throw fail('E_ALREADY_RESUMED', 'handoff ' + handoffId + ' already resumed by ' + rec.resumedBy);
  }
  const at = nextOp();
  rec.resumedBy = by;
  rec.resumedAt = at;
  fs.writeFileSync(p, JSON.stringify(rec, null, 2) + '\n');
  return { resumed: true, at };
}
