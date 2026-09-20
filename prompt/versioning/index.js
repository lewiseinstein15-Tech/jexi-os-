// prompt/versioning/index.js
// Phase 25 — Scope K: public surface of prompt versioning.
//
// Contract spellings:
//   versioning.snapshot(builtPrompt) -> { versionId, sha256, sectionHashes,
//                                         createdAt }
//     builtPrompt = string | [{id, content}, ...] | { sections: [...] }
//   versioning.diff(v1, v2)          -> { sections: [{ id, changed, delta? }] }
//     v1/v2 = versionId strings or snapshot records; delta is line-level
//     (added/removed with 1-based line numbers) and present only on changed
//     sections.
//   versioning.rollback(versionId)   -> { restored: true, restoredSha256,
//                                         versionId, text, sections }
//     Restores the EXACT prior build (byte-identical); never deletes
//     intermediate snapshots.
//
// Additive surface (same store, same guarantees):
//   versioning.load(id)    -> full snapshot record (throws E_NO_SUCH_VERSION)
//   versioning.list()      -> all stored records, sorted by versionId
//   versioning.active()    -> { active, previous } rollback pointer
//   versioning.sha256Text  -> sha256 helper (probes re-hash to prove
//                             byte-identity)
//
// Storage: .jexi/prompt-versions/ — REAL JSON files on real disk, immutable
// (RULE 1), append-only store (RULE 3), covered by the existing `.jexi/`
// gitignore rule (RULE 6). Override with env JEXI_PROMPT_VERSIONS_ROOT for
// probes/tests (read at call time).
//
// Zone discipline: prompt/assembly, prompt/constitution, prompt/tools,
// prompt/memory-fs, prompt/incidents are NOT modified. No LLM calls.

import * as snapshotMod from './snapshot.js';
import * as diffMod from './diff.js';
import * as rollbackMod from './rollback.js';

export { snapshotMod, diffMod, rollbackMod };

export const VERSIONING_CODES = snapshotMod.VERSIONING_CODES;

export const versioning = {
  snapshot: snapshotMod.snapshot,
  diff: diffMod.diff,
  rollback: rollbackMod.rollback,
  load: snapshotMod.loadSnapshot,
  list: snapshotMod.listVersions,
  active: rollbackMod.readActive,
  sha256Text: snapshotMod.sha256Text,
  versioningRoot: snapshotMod.versioningRoot,
};

export default versioning;
