/**
 * JEXI OS — VERIFICATION — immutable source snapshot.
 *
 * A snapshot is a frozen copy of the source files relevant to a node,
 * captured BEFORE work starts. Verifiers read from the snapshot, never the
 * live workspace. Missing snapshot → verification refused (see
 * requireSnapshot). Snapshot records are immutable: once written, the id
 * always resolves to the same bytes.
 */

import { createHash } from 'node:crypto';

/**
 * @typedef {object} SourceSnapshot
 * @property {string} id
 * @property {string} nodeId
 * @property {string} capturedAt
 * @property {Record<string, string>} files   — path → exact source text
 * @property {string} [sha256]                — content fingerprint
 */

/** Capture a frozen snapshot of the given files (path → source). */
export function captureSnapshot({ nodeId, files }) {
  const sorted = Object.keys(files).sort();
  const shard = sorted.map((k) => `${k}\u0000${files[k]}`).join('\u0001');
  return {
    id: `snap-${createHash('sha256').update(shard).digest('hex').slice(0, 16)}`,
    nodeId,
    capturedAt: new Date().toISOString(),
    files: { ...files },
    sha256: createHash('sha256').update(shard).digest('hex'),
  };
}

/** Content-addressed: identical files → identical id. */
export function snapshotId(files) {
  return captureSnapshot({ nodeId: '', files }).id;
}