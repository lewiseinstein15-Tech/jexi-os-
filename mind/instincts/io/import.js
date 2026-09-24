/**
 * JEXI OS — Phase 26 Scope E — explicit, scope-checked import.
 *
 * DECLARED MERGE RULE (on same-instinctId conflict):
 *   - confidence is RECOMPUTED on both records (declared formula);
 *   - the HIGHER-confidence record wins WHOLESALE on all counters
 *     (reinforceCount / contradictCount / timestamps) — import NEVER
 *     overwrites a higher-confidence existing instinct;
 *   - evidence arrays are UNIONED with dedup by (text, at), regardless
 *     of who wins;
 *   - ties go to the incoming record (newer intent).
 *
 * Scope rules:
 *   no targetProjectId                          -> E_TARGET_REQUIRED
 *   target === source project, mode !== 'merge' -> E_TARGET_MODE_REQUIRED
 *   target !== source project, mode !== 'migrate' -> E_TARGET_MODE_REQUIRED
 *   blob not decodable/parseable/missing fields -> E_INVALID_BLOB
 *   well-formed blob with version !== 1         -> E_BLOB_VERSION
 *
 * On migrate, every WINNING migrated record carries provenance
 * { migratedFrom: <sourceProjectId>, migratedAt: <op-seq> } — one
 * op-seq for the whole import (deterministic). Merge mode never adds
 * provenance. Persistence goes through Scope C's save() — no
 * reimplementation.
 */
import { fail } from '../../../services/semantica/_internal.js';
import { assertProjectId } from '../observe/scope.js';
import { nextOp } from '../observe/queue.js';
import { save, get } from '../store/store.js';
import { BLOB_KIND, BLOB_VERSION } from './export.js';

export function decodeBlob(blob) {
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(String(blob), 'base64').toString('utf8'));
  } catch {
    throw fail('E_INVALID_BLOB', 'blob is not valid base64-encoded JSON');
  }
  if (!payload || typeof payload !== 'object' || payload.kind !== BLOB_KIND ||
      typeof payload.projectId !== 'string' || !Array.isArray(payload.instincts)) {
    throw fail('E_INVALID_BLOB', 'blob missing required fields (kind/projectId/instincts)');
  }
  if (payload.version !== BLOB_VERSION) {
    throw fail('E_BLOB_VERSION', 'blob version ' + JSON.stringify(payload.version) + ', this build speaks version ' + BLOB_VERSION);
  }
  return payload;
}

export function importBlob(root, blob, opts = {}) {
  const { targetProjectId, mode } = opts;
  if (targetProjectId === undefined || targetProjectId === null || targetProjectId === '') {
    throw fail('E_TARGET_REQUIRED', 'import requires an explicit targetProjectId — never defaults, not even to the source project');
  }
  assertProjectId(targetProjectId);
  const payload = decodeBlob(blob);
  const sameProject = payload.projectId === targetProjectId;
  if (sameProject && mode !== 'merge') {
    throw fail('E_TARGET_MODE_REQUIRED', 'import into the SAME project (' + targetProjectId + ") requires mode: 'merge'");
  }
  if (!sameProject && mode !== 'migrate') {
    throw fail('E_TARGET_MODE_REQUIRED', 'import into a DIFFERENT project (' + payload.projectId + ' -> ' + targetProjectId + ") requires mode: 'migrate'");
  }
  const migratedAt = mode === 'migrate' ? nextOp(root) : null; // one op-seq per import
  let imported = 0;
  const ordered = [...payload.instincts].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const instinct of ordered) {
    const rec = { ...instinct, projectId: targetProjectId };
    if (mode === 'migrate') rec.provenance = { migratedFrom: payload.projectId, migratedAt };
    save(root, rec); // Scope C merge semantics: higher confidence wins, evidence unioned
    imported += 1;
  }
  return { imported };
}

export { get };
