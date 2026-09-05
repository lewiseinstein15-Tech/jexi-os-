/**
 * AGI Phase 7 — runtime loop detection (Antidoom-inspired, no training).
 * Keyless, deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { recordAction, recordReasoning, detectLoops, findCircularPlan, similarity, __resetLoops } = await import('../../src/services/director/LoopDetector.js');

test('identical tool calls repeated 3× are flagged as a loop', () => {
  __resetLoops();
  recordAction('run-npm-build', { cmd: 'npm run build' });
  recordAction('run-npm-build', { cmd: 'npm run build' });
  assert.equal(detectLoops().length, 0); // twice is a retry, not a loop
  recordAction('run-npm-build', { cmd: 'npm run build' });
  const loops = detectLoops();
  assert.equal(loops.length, 1);
  assert.equal(loops[0].type, 'repeated-tool-call');
  assert.match(loops[0].advice, /change arguments|strategy/);
});

test('the same failure twice is a doom loop, not a retry queue', () => {
  __resetLoops();
  recordAction('fetch-url', { url: 'https://x.test' }, { ok: false, error: '502' });
  recordAction('fetch-url', { url: 'https://x.test' }, { ok: false, error: '502' });
  const loops = detectLoops();
  assert.equal(loops[0].type, 'repeated-failure');
  assert.match(loops[0].detail, /failed 2×/);
  assert.match(loops[0].advice, /hypothesis/);
});

test('different arguments are NOT a loop (variety is progress)', () => {
  __resetLoops();
  for (const port of [3001, 3002, 3003, 3004]) recordAction('probe-port', { port });
  assert.equal(detectLoops().length, 0);
});

test('near-identical consecutive reasoning outputs are detected', () => {
  __resetLoops();
  const a = 'The build fails because the entry point imports a module that does not exist in the bundle configuration.';
  const b = 'The build fails because the entry point imports a module that does not exist in the bundle configuration.'; // identical
  recordReasoning(a);
  const sim = recordReasoning(b);
  assert.ok(sim >= 0.85);
  const loops = detectLoops();
  assert.ok(loops.some((l) => l.type === 'repeated-reasoning'));
  // and genuinely different reasoning is NOT flagged
  __resetLoops();
  recordReasoning(a);
  const sim2 = recordReasoning('Instead of bundling, we could run the server directly with node and skip the build step entirely.');
  assert.ok(sim2 < 0.5);
  assert.equal(detectLoops().length, 0);
});

test('circular plans are found (A→B→C→A), linear ones are not', () => {
  const linear = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ];
  assert.equal(findCircularPlan(linear), null);
  const circular = [
    { id: 'a', dependsOn: ['c'] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ];
  const cycle = findCircularPlan(circular);
  assert.ok(Array.isArray(cycle) && cycle.length === 3);
  assert.deepEqual([...cycle].sort(), ['a', 'b', 'c']);
});

test('similarity is a sane 0..1 measure', () => {
  assert.equal(similarity('identical words here', 'identical words here'), 1);
  assert.equal(similarity('completely different content', 'totally unrelated stuff everywhere'), 0);
});
