/**
 * AGI Phase 9 — plan simulation contracts. Keyless, deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { scorePlan, simulateAlternatives } = await import('../../src/services/director/PlanSimulator.js');

const reversible = {
  name: 'safe-incremental',
  steps: [
    { tool: 'native:web-search', note: 'gather options' },
    { tool: 'native:code-run', note: 'prototype in a scratch dir' },
    { tool: 'native:code-run', note: 'verify prototype output' },
  ],
};
const riskyFast = {
  name: 'big-bang',
  steps: [
    { tool: 'native:code-run', risky: true, irreversible: true, note: 'drop and recreate the database' },
    { tool: 'native:code-run', note: 'deploy immediately' },
  ],
};
const riskyReversible = {
  name: 'risky-but-undoable',
  steps: [
    { tool: 'native:code-run', risky: true, note: 'experimental build flag' },
    { tool: 'native:code-run', note: 'verify' },
  ],
};

test('plans are scored on success, cost, risk, and reversibility', () => {
  const s = scorePlan(reversible);
  assert.equal(s.steps, 3);
  assert.equal(s.risk, 'low');
  assert.equal(s.reversibility, 'reversible');
  assert.equal(s.estimatedModelCalls, 3);
  assert.ok(s.expectedSuccess > 0.8);

  const b = scorePlan(riskyFast);
  assert.equal(b.risk, 'medium');
  assert.equal(b.reversibility, 'irreversible');
  assert.ok(b.expectedSuccess < s.expectedSuccess);
});

test('every prediction is a PREDICTED claim — never an observation', () => {
  const sim = simulateAlternatives([reversible, riskyFast]);
  assert.equal(sim.allPredictions.length, 2);
  for (const p of sim.allPredictions) {
    assert.equal(p.prediction, true);
    assert.equal(p.source, 'PREDICTED');
    assert.equal(p.epistemic, 'UNCERTAIN');
  }
});

test('the reversible plan wins on ties (reversible-action preference)', () => {
  // same expected-success band, same cost → reversibility decides
  const a = { name: 'a-undoable', steps: [{ tool: 'x', irreversible: true, note: 'deletes the old data' }, { tool: 'x' }, { tool: 'x' }] };
  const b = { name: 'b-reversible', steps: [{ tool: 'x' }, { tool: 'x' }, { tool: 'x' }] };
  const sim = simulateAlternatives([a, b]);
  assert.equal(sim.recommended.name, 'b-reversible');
});

test('clearly higher expected success beats reversibility', () => {
  const sim = simulateAlternatives([riskyFast, reversible]);
  // safe-incremental: 3 steps 0 risky → 0.94; big-bang: 1 risky → 0.78 → safe wins
  assert.equal(sim.recommended.name, 'safe-incremental');
  const sim2 = simulateAlternatives([riskyFast, riskyReversible, reversible]);
  assert.equal(sim2.ranking[0], 'safe-incremental');
  // among the two risky plans, the reversible one ranks first
  assert.ok(sim2.ranking.indexOf('risky-but-undoable') < sim2.ranking.indexOf('big-bang'));
});

test('the ranking is a total order over the given plans', () => {
  const sim = simulateAlternatives([reversible, riskyFast, riskyReversible]);
  assert.equal(new Set(sim.ranking).size, 3);
  assert.equal(sim.ranking.length, 3);
});

test('empty input is handled honestly (no fake recommendation)', () => {
  const sim = simulateAlternatives([]);
  assert.equal(sim.recommended, null);
  assert.deepEqual(sim.ranking, []);
});
