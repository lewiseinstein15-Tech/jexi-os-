// prompt/versioning/rollback.js
// Phase 25 — Scope K: revert the active prompt to a prior snapshot.
//
// rollback(versionId) loads the immutable record and restores its EXACT
// rendered text (RULE 1: byte-identical — the probe re-hashes the returned
// text to prove it). The active-version pointer (.jexi/prompt-versions/
// current.json) is the only thing that moves.
//
// RULE 3: rollback does NOT delete intermediate snapshots. Nothing in this
// module ever removes a record file; diffing/rolling back to any later
// version keeps working (the probe asserts v2 still resolves after a
// rollback to v1).

import fs from 'node:fs';
import path from 'node:path';
import { loadSnapshot, versioningRoot, writeJsonAtomic } from './snapshot.js';

export function currentPath() {
  return path.join(versioningRoot(), 'current.json');
}

/** Read the active-version pointer: { active, previous } | { active: null }. */
export function readActive() {
  try {
    return JSON.parse(fs.readFileSync(currentPath(), 'utf8'));
  } catch {
    return { active: null, previous: null };
  }
}

/**
 * versioning.rollback(versionId) ->
 *   { restored: true, restoredSha256, versionId, text, sections }
 *
 * restoredSha256 equals the target snapshot's sha256; sha256(text) recomputed
 * by any caller matches byte for byte. The previous active version (if any)
 * is preserved in the pointer as `previous` — history is never destroyed.
 */
export function rollback(versionId) {
  if (typeof versionId !== 'string' || versionId.trim() === '') {
    const err = new Error('rollback requires a versionId string');
    err.code = 'E_INVALID_DIFF_INPUT';
    throw err;
  }
  const record = loadSnapshot(versionId.trim());
  const prev = readActive();
  writeJsonAtomic(currentPath(), {
    active: record.versionId,
    previous: prev.active ?? null,
  });
  return {
    restored: true,
    restoredSha256: record.sha256,
    versionId: record.versionId,
    text: record.text,
    sections: record.sections,
  };
}
