/**
 * JEXI OS — Phase 15 Scope D — genome lifecycle.
 *
 * mutation -> selection -> promotion -> rollback. State persists to
 * <gepDir>/genome.json after every action; ids are monotonic
 * counters (no clocks).
 *   schema-invalid mutation        -> E_SCHEMA_VIOLATION
 *   promote an already-promoted    -> E_ALREADY_PROMOTED
 *   rollback a non-promoted        -> E_NOT_PROMOTED
 *   rollback an already-rolled-back-> E_ALREADY_ROLLED_BACK
 *   unknown gene / capsule         -> E_UNKNOWN_GENE / E_UNKNOWN_CAPSULE
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../../semantica/_internal.js';
import { makeGene, applyDelta, validate } from './genes.js';
import { makeCapsule } from './capsules.js';
import { appendEvent } from './events.js';
import { computeFitness } from './selection.js';

const stateFile = (dir) => path.join(dir, 'genome.json');

function load(dir) {
  if (!fs.existsSync(stateFile(dir))) return { genes: [], capsules: [], geneSeq: 0, capsuleSeq: 0 };
  return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
}

function save(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile(dir), JSON.stringify(state, null, 2) + '\n');
  return state;
}

const findGene = (state, geneId) => {
  const g = state.genes.find((x) => x.id === geneId);
  if (!g) throw fail('E_UNKNOWN_GENE', 'unknown geneId: ' + JSON.stringify(geneId));
  return g;
};

const findCapsule = (state, capsuleId) => {
  const c = state.capsules.find((x) => x.capsuleId === capsuleId);
  if (!c) throw fail('E_UNKNOWN_CAPSULE', 'unknown capsuleId: ' + JSON.stringify(capsuleId));
  return c;
};

export function defineGene(dir, spec) {
  const gene = makeGene(spec);
  const state = load(dir);
  if (state.genes.some((g) => g.id === gene.id)) {
    throw fail('E_DUPLICATE_GENE', 'gene ' + gene.id + ' already defined');
  }
  state.genes.push(gene);
  save(dir, state);
  appendEvent(dir, { action: 'define', geneId: gene.id });
  return { ...gene };
}

export function mutate(dir, geneId, { delta }) {
  const state = load(dir);
  const gene = findGene(state, geneId);
  const to = applyDelta(gene.value, delta);
  const v = validate(gene.schema, to);
  if (!v.ok) {
    throw fail('E_SCHEMA_VIOLATION', 'mutation of ' + geneId + ' violates schema: ' + v.why);
  }
  state.capsuleSeq += 1;
  const capsule = makeCapsule({
    capsuleId: 'capsule-' + String(state.capsuleSeq).padStart(3, '0'),
    geneId,
    from: gene.value,
    to,
    delta,
  });
  state.capsules.push(capsule);
  save(dir, state); // packaged, NOT applied — live gene untouched
  appendEvent(dir, { action: 'mutate', geneId, capsuleId: capsule.capsuleId });
  return { capsuleId: capsule.capsuleId, from: capsule.from, to: capsule.to };
}

export function select(dir, capsuleId) {
  const state = load(dir);
  const capsule = findCapsule(state, capsuleId);
  const gene = findGene(state, capsule.geneId);
  const fitness = computeFitness(gene, capsule);
  capsule.fitness = fitness;
  save(dir, state);
  appendEvent(dir, { action: 'select', geneId: capsule.geneId, capsuleId });
  return { promoted: fitness.promoted, fitness };
}

export function promote(dir, capsuleId) {
  const state = load(dir);
  const capsule = findCapsule(state, capsuleId);
  if (capsule.status === 'promoted') {
    throw fail('E_ALREADY_PROMOTED', 'capsule ' + capsuleId + ' already promoted');
  }
  if (capsule.status === 'rolled-back') {
    throw fail('E_ALREADY_ROLLED_BACK', 'capsule ' + capsuleId + ' was rolled back and cannot be promoted');
  }
  const gene = findGene(state, capsule.geneId);
  gene.value = capsule.to;
  gene.version += 1;
  capsule.status = 'promoted';
  save(dir, state);
  appendEvent(dir, { action: 'promote', geneId: gene.id, capsuleId });
  return { promoted: true, geneId: gene.id, from: capsule.from, to: capsule.to };
}

export function rollback(dir, capsuleId) {
  const state = load(dir);
  const capsule = findCapsule(state, capsuleId);
  if (capsule.status === 'rolled-back') {
    throw fail('E_ALREADY_ROLLED_BACK', 'capsule ' + capsuleId + ' already rolled back');
  }
  if (capsule.status !== 'promoted') {
    throw fail('E_NOT_PROMOTED', 'capsule ' + capsuleId + ' was never promoted (status: ' + capsule.status + ')');
  }
  const gene = findGene(state, capsule.geneId);
  gene.value = capsule.from;
  gene.version += 1;
  capsule.status = 'rolled-back';
  save(dir, state);
  const ev = appendEvent(dir, { action: 'rollback', geneId: gene.id, capsuleId });
  return { restored: true, geneId: gene.id, value: gene.value, at: ev.at };
}

export { load as loadGenome };
