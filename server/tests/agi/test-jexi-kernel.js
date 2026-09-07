/**
 * ARENA REBUILD PHASE 1 — Executive Kernel contracts (spec Part 2/3/4).
 * The kernel gate is deterministic and free; the fast path makes exactly ONE
 * small model call; real work NEVER gets intercepted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = './data/test-agi-kernel';

const kern = await import('../../src/services/JexiKernel.js');
const { kernelGate, kernelTurn, runFastPath, startMeter, meterStage, meterReport } = kern;

/* ═══ 1. the gate: deterministic, conservative, free ═══════════════════════ */

test('small talk is caught by the gate (greetings, thanks, bye, identity, how-are-you)', () => {
  const caught = [
    'hello', 'hi', 'hey JEXI', 'good morning', "what's up", 'niaje',
    'thanks', 'thanks boss', 'thank you', 'asante', 'got it', 'sounds good',
    'bye', 'see you later bro', 'good night',
    'who are you?', 'who built you?', "what's your name?",
    'how are you?', "how's it going today", 'how are you doing today',
  ];
  for (const q of caught) {
    const g = kernelGate(q);
    assert.ok(g && g.kind === 'smalltalk', `"${q}" should be caught`);
  }
});

test('REAL work is never intercepted — it flows to the lanes', () => {
  const work = [
    'build me a website', 'what is the weather in Kericho', 'research quantum computing for me',
    'fix the login bug in my app', 'write a report about Kenya tea exports', 'solve x^2 - 4 = 0',
    'hello, can you build me a dashboard?', // greeting + real work → NOT small talk
    'can you help me research quantum computing',
    'analyze this data and make a chart', 'open github.com',
  ];
  for (const q of work) {
    assert.equal(kernelGate(q), null, `"${q}" must reach the full lanes`);
  }
});

test('an active mission owns the turn — the kernel stands down', () => {
  assert.equal(kernelGate('hello', { activeMission: true }), null);
  assert.equal(kernelGate('thanks', { activeMission: true }), null);
});

test('long or empty messages are never small talk', () => {
  assert.equal(kernelGate(''), null);
  assert.equal(kernelGate('x'.repeat(300)), null);
});

/* ═══ 2. the fast path: ONE small call, real personality ═══════════════════ */

test('fast path answers with ZERO model calls, instantly, even when every provider is dead', { timeout: 90_000 }, async () => {
  // Live lesson (Sept 7 2026): on a day Gemini 503'd and Groq misbehaved, a
  // "hello" slid the provider ladder for a minute. Pure small talk is now a
  // deterministic pool answer — no provider can ever slow it down.
  const t0 = Date.now();
  const r = await runFastPath({ query: 'hello', sub: 'greeting', sendEvent: () => {} });
  const ms = Date.now() - t0;
  assert.equal(r.handled, true);
  assert.ok(r.answer.length > 0 && r.answer.length < 500, 'short conversational answer');
  assert.equal(r.stats.fastPath, true);
  assert.equal(r.stats.modelCalls, 0, 'ZERO model calls — deterministic, provider-independent');
  assert.equal(r.stats.deterministic, true);
  assert.ok(ms < 100, `answers instantly (got ${ms}ms)`);
  // every category has a real pool (variety without a model)
  for (const sub of ['greeting', 'ack', 'bye', 'identity', 'howareyou']) {
    const a = await runFastPath({ query: 'x', sub, sendEvent: () => {} });
    assert.ok(a.answer.length > 0, `pool for "${sub}" must answer`);
    assert.ok(a.stats.modelCalls === 0);
  }
});

test('fast path NEVER says the banned openers', { timeout: 90_000 }, async () => {
  const banned = [/^sure[! .]/i, /^absolutely[! .]/i, /how can i help/i];
  for (const q of ['hello', 'thanks boss', 'see you later']) {
    const r = await runFastPath({ query: q, sub: 'ack', sendEvent: () => {} });
    for (const b of banned) assert.ok(!b.test(r.answer), `"${q}" answer must not match ${b}`);
  }
});

test('kernelTurn returns null for real work (no model call spent)', async () => {
  const r = await kernelTurn({ raw: 'build me a website', sendEvent: () => {} });
  assert.equal(r, null);
});

/* ═══ 3. request meter (spec Part 3: measure, don't guess) ═════════════════ */

test('the meter records stages, model calls and total latency', () => {
  const id = startMeter('test-turn');
  meterStage(id, 'kernel', 5, 1);
  meterStage(id, 'intent', 30, 1);
  meterStage(id, 'execution', 900, 4);
  const rep = meterReport(id);
  assert.equal(rep.modelCalls, 6);
  assert.deepEqual(rep.modelCallStages, ['kernel', 'intent', 'execution', 'execution', 'execution', 'execution']);
  assert.equal(rep.stages.execution, 900);
  assert.ok(rep.totalMs >= 0);
  assert.equal(meterReport('no-such-meter'), null);
});
