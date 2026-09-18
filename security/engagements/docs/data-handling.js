/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 5/8: DATA HANDLING.
 *
 * Decepticon Soundwave: "Data handling: collection, storage, retention."
 * Where collected material lives, how long it is kept, and its
 * classification ceiling. `storage` is a REAL filesystem path — the
 * cleanup document (and eng.runCleanup) removes exactly this footprint.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngagementValidationError } from '../store.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DOC_ID = 'data-handling';
export const DOC_TITLE = 'Data Handling';

export const CLASSIFICATIONS = ['public', 'internal', 'confidential'];

export function defaultStorage(name) {
  const slug = String(name || 'engagement').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'engagement';
  // MODULE_DIR is docs/ → engagements root is one level up
  return path.join(MODULE_DIR, '..', '.data', 'collection', slug);
}

export function build(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new EngagementValidationError('draft', `${DOC_ID}: expected a plan draft object`);
  }
  const dh = draft.dataHandling || {};
  const collected = dh.collected || ['findings', 'evidence excerpts', 'pipeline artifacts'];
  if (!Array.isArray(collected) || collected.some((c) => typeof c !== 'string')) {
    throw new EngagementValidationError('collected', `${DOC_ID}: collected must be an array of strings`);
  }
  if (dh.storage !== undefined && (typeof dh.storage !== 'string' || !dh.storage.trim())) {
    throw new EngagementValidationError('storage', `${DOC_ID}: storage must be a non-empty string path when provided`);
  }
  const retention = dh.retention === undefined ? 30 : dh.retention;
  if (!Number.isFinite(Number(retention)) || Number(retention) < 0) {
    throw new EngagementValidationError('retention', `${DOC_ID}: retention must be a non-negative number of days — got ${JSON.stringify(retention)}`);
  }
  const classification = dh.classification || 'confidential';
  if (!CLASSIFICATIONS.includes(classification)) {
    throw new EngagementValidationError('classification', `${DOC_ID}: classification must be one of ${CLASSIFICATIONS.join('|')} — got ${JSON.stringify(classification)}`);
  }
  return {
    dataHandling: {
      collected: [...collected],
      storage: dh.storage ? path.resolve(dh.storage) : defaultStorage(draft.name),
      retention: Number(retention),
      classification,
    },
  };
}

export default { DOC_ID, DOC_TITLE, build };
