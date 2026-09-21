/**
 * JEXI OS — Phase 15 Scope E — evolver: full GEP cycles.
 *
 * cycle() runs one complete Genome Evolution Protocol cycle through
 * Scope D's PUBLIC gep API: define (once) -> mutate -> select ->
 * promote (only when selection says promoted). Nothing here edits
 * Scope D; it only calls createGEP's surface.
 */
import { readEvents } from './gep/events.js';

export const DEFAULT_GENE = { id: 'cycle-gene', name: 'Cycle gene', value: 0, schema: { type: 'number', min: 0, max: 1000 } };
export const DEFAULT_DELTA = { add: 100 };

export function runCycle(dir, gep, spec) {
  const geneSpec = (spec && spec.gene) || DEFAULT_GENE;
  const delta = (spec && spec.delta) || DEFAULT_DELTA;
  const before = readEvents(dir).length;

  let gene = null;
  try {
    gene = gep.defineGene(geneSpec);
  } catch (e) {
    if (!e || e.code !== 'E_DUPLICATE_GENE') throw e;
    gene = gep.gene(geneSpec.id); // subsequent cycles reuse the live gene
  }

  const m = gep.mutate(gene.id, { delta });
  const sel = gep.select(m.capsuleId);
  let promoted = false;
  if (sel.promoted) {
    gep.promote(m.capsuleId);
    promoted = true;
  }
  const events = readEvents(dir).slice(before);
  return {
    genes: gep.genome().genes.map((g) => ({ ...g })),
    capsule: gep.capsule(m.capsuleId),
    events,
    promoted,
    fitness: sel.fitness,
  };
}
