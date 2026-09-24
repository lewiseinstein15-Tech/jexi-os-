/**
 * JEXI OS — Phase 26 Scope E — lossless project export.
 *
 * exportProject(root, projectId) -> { blob, count }
 *   payload = { version: 1, kind: 'jexi-instincts', projectId, instincts }
 *   blob    = base64(JSON(payload))  (opaque, transport-safe)
 * Lossless: the payload embeds the FULL instinct records exactly as
 * stored (Scope C readAll), so import can restore them byte-for-byte.
 */
import { assertProjectId } from '../observe/scope.js';
import { readAll } from '../store/query.js';

export const BLOB_KIND = 'jexi-instincts';
export const BLOB_VERSION = 1;

export function exportProject(root, projectId) {
  assertProjectId(projectId);
  const instincts = readAll(root, projectId); // sorted by file order (id asc)
  const payload = { version: BLOB_VERSION, kind: BLOB_KIND, projectId, instincts };
  return { blob: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'), count: instincts.length };
}
