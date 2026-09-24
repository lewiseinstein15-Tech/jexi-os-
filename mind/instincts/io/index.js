/**
 * JEXI OS — Phase 26 Scope E — import/export entry point.
 *
 *   const io = createIo(root)
 *   io.export(projectId)                -> { blob, count }
 *   io.import(blob, { targetProjectId, mode }) -> { imported }
 *   io.import(blob)                     -> E_TARGET_REQUIRED
 *
 * Explicit opt-in only: there is no default target, ever. Built on
 * Scope C save()/readAll() and Scope A op-seq — nothing reimplemented.
 */
import fs from 'node:fs';
import { fail } from '../../../services/semantica/_internal.js';
import { exportProject, BLOB_KIND, BLOB_VERSION } from './export.js';
import { importBlob, decodeBlob } from './import.js';

export function createIo(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'root must be a non-empty string');
  }
  fs.mkdirSync(root, { recursive: true });
  return {
    path: root,
    BLOB_KIND,
    BLOB_VERSION,
    export: (projectId) => exportProject(root, projectId),
    import: (blob, opts) => importBlob(root, blob, opts),
    decodeBlob,
  };
}

export { exportProject, BLOB_KIND, BLOB_VERSION } from './export.js';
export { importBlob, decodeBlob } from './import.js';
export { SemanticaError } from '../../../services/semantica/_internal.js';
