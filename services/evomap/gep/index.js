/**
 * JEXI OS — Phase 15 Scope D — GEP entry point.
 *
 *   const gep = createGEP(gepDir)
 *   gep.defineGene({ id, name, value, schema }) -> gene
 *   gep.mutate(geneId, { delta })               -> { capsuleId, from, to }
 *   gep.select(capsuleId)                       -> { promoted, fitness }
 *   gep.promote(capsuleId)                      -> { promoted, geneId, from, to }
 *   gep.rollback(capsuleId)                     -> { restored, geneId, value, at }
 *   gep.events()                                -> events[]
 *
 * Reuses SemanticaError/fail from Phase 14 (read-only import).
 */
import fs from 'node:fs';
import { fail } from '../../semantica/_internal.js';
import { defineGene, mutate, select, promote, rollback, loadGenome } from './genome.js';
import { readEvents } from './events.js';
import { FITNESS_RULE, THRESHOLD, computeFitness } from './selection.js';

export function createGEP(gepDir) {
  if (typeof gepDir !== 'string' || gepDir.trim() === '') {
    throw fail('E_INVALID_ARGUMENT', 'gepDir must be a non-empty string');
  }
  fs.mkdirSync(gepDir, { recursive: true });
  return {
    path: gepDir,
    FITNESS_RULE,
    THRESHOLD,
    defineGene: (spec) => defineGene(gepDir, spec),
    mutate: (geneId, spec) => mutate(gepDir, geneId, spec),
    select: (capsuleId) => select(gepDir, capsuleId),
    promote: (capsuleId) => promote(gepDir, capsuleId),
    rollback: (capsuleId) => rollback(gepDir, capsuleId),
    events: () => readEvents(gepDir),
    genome: () => loadGenome(gepDir),
    gene(id) {
      const g = loadGenome(gepDir).genes.find((x) => x.id === id);
      if (!g) throw fail('E_UNKNOWN_GENE', 'unknown geneId: ' + JSON.stringify(id));
      return g;
    },
    capsule(id) {
      const c = loadGenome(gepDir).capsules.find((x) => x.capsuleId === id);
      if (!c) throw fail('E_UNKNOWN_CAPSULE', 'unknown capsuleId: ' + JSON.stringify(id));
      return c;
    },
    computeFitness,
  };
}

export { defineGene, mutate, select, promote, rollback } from './genome.js';
export { makeGene, applyDelta, validate, assertSchema } from './genes.js';
export { makeCapsule, CAPSULE_STATUS } from './capsules.js';
export { appendEvent, readEvents } from './events.js';
export { computeFitness, FITNESS_RULE, THRESHOLD } from './selection.js';
export { SemanticaError } from '../../semantica/_internal.js';
