/**
 * JEXI OS — Phase 26 Scope C — persistent instinct store.
 *
 * Persistence is Scope B's layout — <root>/projects/<projectId>/
 * instincts/<id>.json — read/written through Scope B's public
 * loadInstinct/saveInstinct (NOT reimplemented). Project scoping via
 * Scope A's projectDir.
 *
 * get(instinctId, { projectId }):
 *   found in the requesting project            -> instinct
 *   id lives in ANOTHER project                -> E_SCOPE_MISMATCH
 *   id lives nowhere                           -> E_UNKNOWN_INSTINCT
 *
 * save(instinct): idempotent merge — confidence is RECOMPUTED from
 * the declared formula, the higher-confidence version wins, evidence
 * arrays are unioned with dedup by (text, at).
 *
 * prune(projectId, { olderThanOpSeq }): removes instincts with
 *   lastSeenAt < (currentOp - olderThanOpSeq)  AND
 *   confidence < PRUNE_CONFIDENCE_CEILING (0.5, declared below)
 * op-seq deltas only — no wall clocks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../../services/semantica/_internal.js';
import { projectDir, assertProjectId } from '../observe/scope.js';
import { nextOp, currentOp } from '../observe/queue.js';
import { validate } from '../core/schema.js';
import { computeConfidence, loadInstinct, saveInstinct } from '../core/confidence.js';

export const PRUNE_CONFIDENCE_CEILING = 0.5; // declared prune threshold

const instinctsDir = (root, projectId) => path.join(projectDir(root, projectId), 'instincts');

const evidenceKey = (e) => JSON.stringify([e && e.text !== undefined ? e.text : null, e && e.at !== undefined ? e.at : null]);

function unionEvidence(a, b) {
  const seen = new Set();
  const out = [];
  for (const e of [...a, ...b]) {
    const k = evidenceKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function allProjectIds(root) {
  const pdir = path.join(root, 'projects');
  if (!fs.existsSync(pdir)) return [];
  return fs.readdirSync(pdir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

export function save(root, instinct) {
  const v = validate(instinct);
  if (!v.valid) {
    throw fail('E_INVALID_INSTINCT', 'save rejected, invalid fields: ' + v.errors.map((e) => e.field).join(', '));
  }
  assertProjectId(instinct.projectId);
  const incoming = { ...instinct, confidence: computeConfidence(instinct) }; // recomputed, never trusted blindly
  let existing = null;
  try { existing = loadInstinct(root, instinct.projectId, incoming.id); } catch { existing = null; }
  let record = incoming;
  if (existing) {
    const winner = incoming.confidence >= existing.confidence ? incoming : existing; // higher confidence wins (tie -> newer)
    record = { ...winner, evidence: unionEvidence(existing.evidence || [], incoming.evidence || []) };
  }
  saveInstinct(root, record.projectId, record);
  return { saved: true, id: record.id, confidence: record.confidence };
}

export function get(root, instinctId, { projectId } = {}) {
  const requesting = assertProjectId(projectId);
  const f = path.join(instinctsDir(root, requesting), instinctId + '.json');
  if (fs.existsSync(f)) {
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (rec.projectId !== requesting) {
      throw fail('E_SCOPE_MISMATCH', 'instinct ' + instinctId + ' belongs to project ' + JSON.stringify(rec.projectId));
    }
    return rec;
  }
  for (const pid of allProjectIds(root)) {
    if (pid === requesting) continue;
    const other = path.join(instinctsDir(root, pid), instinctId + '.json');
    if (fs.existsSync(other)) {
      throw fail('E_SCOPE_MISMATCH', 'instinct ' + JSON.stringify(instinctId) + ' lives in project ' + JSON.stringify(pid) + ', not the requesting project ' + JSON.stringify(requesting));
    }
  }
  throw fail('E_UNKNOWN_INSTINCT', 'unknown instinctId: ' + JSON.stringify(instinctId));
}

export function prune(root, projectId, { olderThanOpSeq } = {}) {
  assertProjectId(projectId);
  if (typeof olderThanOpSeq !== 'number' || !Number.isInteger(olderThanOpSeq) || olderThanOpSeq < 0) {
    throw fail('E_INVALID_THRESHOLD', 'olderThanOpSeq must be an integer >= 0');
  }
  const threshold = currentOp(root) - olderThanOpSeq;
  const dir = instinctsDir(root, projectId);
  if (!fs.existsSync(dir)) return { pruned: 0, ids: [] };
  const ids = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (rec.lastSeenAt < threshold && rec.confidence < PRUNE_CONFIDENCE_CEILING) {
      fs.rmSync(path.join(dir, file));
      ids.push(rec.id);
    }
  }
  ids.sort();
  return { pruned: ids.length, ids };
}

export { nextOp };
