/**
 * JEXI OS — Phase 15 Scope E — evomap entry point.
 *
 *   const evomap = createEvomap(dir)
 *   evomap.cycle()            -> { genes, capsule, events, promoted, fitness }
 *   evomap.audit({ from?, to? }) -> events[]
 *   evomap.export(capsuleId)  -> { blob }
 *   evomap.import(blob)       -> { capsuleId, applied }
 *
 * Built entirely on Scope D's public createGEP surface (available as
 * evomap.gep). Reuses SemanticaError/fail from Phase 14 (read-only).
 */
import fs from 'node:fs';
import { fail } from '../semantica/_internal.js';
import { createGEP } from './gep/index.js';
import { runCycle, DEFAULT_GENE, DEFAULT_DELTA } from './evolver.js';
import { auditEvents } from './audit.js';
import { exportCapsule, importCapsule } from './network.js';

export function createEvomap(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'evomap dir must be a non-empty string');
  }
  fs.mkdirSync(dir, { recursive: true });
  const gep = createGEP(dir);
  return {
    path: dir,
    gep,
    DEFAULT_GENE,
    DEFAULT_DELTA,
    cycle: (spec) => runCycle(dir, gep, spec),
    audit: (range) => auditEvents(dir, range),
    export: (capsuleId) => exportCapsule(dir, capsuleId),
    import: (blob) => importCapsule(dir, blob),
  };
}

export { runCycle, DEFAULT_GENE, DEFAULT_DELTA } from './evolver.js';
export { auditEvents } from './audit.js';
export { exportCapsule, importCapsule } from './network.js';
export { createGEP } from './gep/index.js';
export { SemanticaError } from '../semantica/_internal.js';
