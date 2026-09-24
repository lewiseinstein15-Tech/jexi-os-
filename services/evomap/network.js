/**
 * JEXI OS — Phase 15 Scope E — capsule sharing (network).
 *
 * export(capsuleId) -> { blob }   an opaque base64 string carrying
 *                                 { kind, version, capsule, schema }
 * import(blob)      -> { capsuleId, applied }
 *
 * Import checks, in order:
 *   malformed payload                 -> E_INVALID_BLOB
 *   geneId unknown on this instance   -> E_UNKNOWN_GENE
 *   schema disagrees with local gene  -> E_SCHEMA_MISMATCH
 *   capsule.to violates local schema  -> E_SCHEMA_MISMATCH
 *   capsuleId already present         -> E_ALREADY_IMPORTED
 * On success the capsule lands as `promoted` and the change is
 * applied to the live gene; an `import` event is appended.
 * Scope D state (genome.json) is written in its exact on-disk
 * format; Scope D files are not edited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../semantica/_internal.js';
import { loadGenome } from './gep/genome.js';
import { appendEvent } from './gep/events.js';
import { validate } from './gep/genes.js';

const BLOB_KIND = 'gep-capsule';
const BLOB_VERSION = 1;

export function exportCapsule(dir, capsuleId) {
  const state = loadGenome(dir);
  const capsule = state.capsules.find((c) => c.capsuleId === capsuleId);
  if (!capsule) {
    throw fail('E_UNKNOWN_CAPSULE', 'unknown capsuleId: ' + JSON.stringify(capsuleId));
  }
  const gene = state.genes.find((g) => g.id === capsule.geneId);
  if (!gene) {
    throw fail('E_UNKNOWN_GENE', 'capsule ' + capsuleId + ' references missing gene ' + capsule.geneId);
  }
  const payload = { kind: BLOB_KIND, version: BLOB_VERSION, capsule, schema: gene.schema };
  return { blob: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') };
}

export function importCapsule(dir, blob) {
  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(String(blob), 'base64').toString('utf8'));
  } catch {
    throw fail('E_INVALID_BLOB', 'blob is not valid base64-encoded JSON');
  }
  if (!payload || payload.kind !== BLOB_KIND || payload.version !== BLOB_VERSION || !payload.capsule || !payload.schema) {
    throw fail('E_INVALID_BLOB', 'blob is not a ' + BLOB_KIND + ' v' + BLOB_VERSION + ' payload');
  }
  const capsule = payload.capsule;
  const state = loadGenome(dir);
  const gene = state.genes.find((g) => g.id === capsule.geneId);
  if (!gene) {
    throw fail('E_UNKNOWN_GENE', 'this instance has no gene ' + JSON.stringify(capsule.geneId));
  }
  if (JSON.stringify(gene.schema) !== JSON.stringify(payload.schema)) {
    throw fail('E_SCHEMA_MISMATCH', 'imported schema ' + JSON.stringify(payload.schema) + ' disagrees with local gene schema ' + JSON.stringify(gene.schema));
  }
  if (state.capsules.some((c) => c.capsuleId === capsule.capsuleId)) {
    throw fail('E_ALREADY_IMPORTED', 'capsule ' + capsule.capsuleId + ' already imported on this instance');
  }
  const v = validate(gene.schema, capsule.to);
  if (!v.ok) {
    throw fail('E_SCHEMA_MISMATCH', 'imported capsule value violates local schema: ' + v.why);
  }
  state.capsules.push({ ...capsule, status: 'promoted' });
  const n = parseInt(String(capsule.capsuleId).split('-').pop(), 10) || 0;
  if (n > state.capsuleSeq) state.capsuleSeq = n;
  gene.value = capsule.to;
  gene.version += 1;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'genome.json'), JSON.stringify(state, null, 2) + '\n');
  appendEvent(dir, { action: 'import', geneId: gene.id, capsuleId: capsule.capsuleId });
  return { capsuleId: capsule.capsuleId, applied: true };
}
