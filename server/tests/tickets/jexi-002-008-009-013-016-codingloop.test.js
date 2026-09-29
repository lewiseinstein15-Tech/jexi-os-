/**
 * JEXI-002 (verification wired into the loop) · JEXI-008 (closed coding
 * loop) · JEXI-009 (success requires evidence) · JEXI-013 (replan on verify
 * fail) · JEXI-014 (truncation keeps the failure) · JEXI-016 (the loop is a
 * module, not a 29KB file).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CodingLoop, isCodingIntent, shapeToolResult, MUTATING_TOOLS, TEST_TOOLS,
} from '../../src/services/agent/CodingLoop.js';
import { verifyAfterEdit } from '../../src/verification/loop/auto-verify.js';
import fs from 'node:fs';

const collected = [];
// Same signature as AgentLoop's emit — the loop must be wired with the real
// one, not a friendlier shape that would silently drop events.
const send = (type, payload) => collected.push({ type, payload });

/* ── JEXI-008: the state machine ──────────────────────────────── */

test('JEXI-008: edit → verify pass → success is allowed', async () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true, results: [{ layer: 'unit', status: 'pass' }] }), send });
  loop.noteToolCall('fs_edit', true);
  const r = await loop.verify('edit');
  assert.equal(r.verified, true);
  assert.equal(loop.successGate().status, 'verified');
  assert.equal(loop.successGate().canClaimSuccess, true);
});

test('JEXI-008: edit → verify fail → replan → verify pass → success', async () => {
  let attempt = 0;
  const loop = new CodingLoop({
    send,
    runVerify: async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, context: { verified: false, injectedFailure: { layer: 'unit', reason: '1 failed', evidence: [{ content: 'assert 8 == 2' }] } }, results: [{ layer: 'unit', status: 'fail', reason: '1 failed' }] };
      return { ok: true, results: [{ layer: 'unit', status: 'pass' }] };
    },
  });

  loop.noteToolCall('fs_edit', true);
  const first = await loop.verify('edit 1');
  assert.equal(first.verified, false);
  assert.equal(loop.successGate().canClaimSuccess, false, 'a failed verify must block a success claim');

  const msg = loop.failureMessage();
  assert.ok(msg.includes('VERIFICATION FAILED'), 'the model must be told the verify failed');
  assert.ok(msg.includes('assert 8 == 2'), 'the real evidence must reach the model');

  const second = await loop.verify('edit 2');
  assert.equal(second.verified, true, 'a second passing round re-opens the success gate');
  assert.equal(loop.successGate().status, 'verified');
  assert.equal(attempt, 2);
});

test('JEXI-008: the loop is bounded — it cannot spin on replan forever', async () => {
  let calls = 0;
  const loop = new CodingLoop({
    maxVerifyRounds: 3,
    send,
    runVerify: async () => { calls += 1; return { ok: false, context: { verified: false, injectedFailure: { layer: 'unit', reason: 'still failing' } }, results: [{ layer: 'unit', status: 'fail' }] }; },
  });
  loop.noteToolCall('fs_edit', true);
  for (let i = 0; i < 10; i++) await loop.verify('spin');
  assert.equal(calls, 3, 'the verifier must stop being called after the budget');
  const gate = loop.successGate();
  assert.equal(gate.status, 'unverified');
  assert.equal(gate.canClaimSuccess, false);
  assert.match(gate.reason, /budget exhausted/);
});

/* ── JEXI-002: a real verify call happens ─────────────────────── */

test('JEXI-002: a mutating tool call is what triggers a real verification layer', async () => {
  let ran = 0;
  const loop = new CodingLoop({ send, runVerify: async () => { ran += 1; return { ok: true, results: [{ layer: 'unit', status: 'pass' }] }; } });

  for (const t of MUTATING_TOOLS) loop.noteToolCall(t, true);
  assert.equal(loop.editSeen, true, 'fs_write/fs_edit/fs_append/fs_delete/fs_patch all count as edits');

  await loop.verify('edit');
  assert.equal(ran, 1, 'a real verify layer must actually run');
});

test('JEXI-002: a FAILED mutating call does not claim an edit happened', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.noteToolCall('fs_edit', false);
  assert.equal(loop.editSeen, false);
  assert.equal(loop.successGate().status, 'not_applicable');
});

test('JEXI-002: a verifier that THROWS is a failure, never a pass', async () => {
  const loop = new CodingLoop({ send, runVerify: async () => { throw new Error('verifier exploded'); } });
  loop.noteToolCall('fs_edit', true);
  const r = await loop.verify();
  assert.equal(r.verified, false);
  assert.match(r.failure.reason, /verifier exploded/);
  assert.equal(loop.successGate().canClaimSuccess, false);
});

test('JEXI-002: this module is wired to the REAL verifyAfterEdit', async () => {
  // Not a mock: the actual verification subsystem, with an injected failing
  // test layer. This is the seam AgentLoop uses.
  const loop = new CodingLoop({
    send,
    runVerify: (ctx) => verifyAfterEdit(
      { snapshotId: 's', snapshot: { files: {} } },
      { lint: () => ({ exitCode: 0, output: '' }), unit: () => ({ exitCode: 1, output: 'FAILED tests/test_calc.py::test_add - assert 3 == 2' }) },
      { real: null },
    ),
  });
  loop.noteToolCall('fs_edit', true);
  const r = await loop.verify();
  assert.equal(r.verified, false);
  assert.equal(r.failure.layer, 'unit');
  assert.ok(loop.failureMessage().includes('test_add'), 'the real failing test id must reach the model');
});

/* ── JEXI-009: the success gate ───────────────────────────────── */

test('JEXI-009: a coding turn with no green verify is reported unverified', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.noteToolCall('fs_edit', true);
  const g = loop.successGate();
  assert.equal(g.status, 'unverified');
  assert.equal(g.canClaimSuccess, false);
  assert.match(g.annotation, /UNVERIFIED/);
});

test('JEXI-009: a turn with no edits is not gated (asking a question is not coding)', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.noteToolCall('web_search', true);
  assert.equal(loop.successGate().status, 'not_applicable');
  assert.equal(loop.successGate().canClaimSuccess, true);
});

test('JEXI-009: intent detection recognises a coding request', () => {
  assert.equal(isCodingIntent({ intent: 'code' }, 'anything'), true);
  assert.equal(isCodingIntent({ intent: 'research' }, 'fix the failing pytest in tests/'), true);
  assert.equal(isCodingIntent({ intent: 'research' }, 'what is the capital of France?'), false);
});

test('JEXI-009: test tools are recognised as verification-capable', () => {
  assert.ok(TEST_TOOLS.has('pytest_run'));
  assert.ok(TEST_TOOLS.has('test_run'));
});

/* ── JEXI-013: injectedFailure is never dropped ───────────────── */

test('JEXI-013: a failed verify injects structured evidence for the next turn', async () => {
  const loop = new CodingLoop({
    send,
    runVerify: async () => ({
      ok: false,
      context: { verified: false, injectedFailure: { layer: 'unit', reason: '2 failed', evidence: [{ source: 'TestVerifier', content: 'E   assert 1 == 2\nE   assert 3 == 4' }] } },
      results: [{ layer: 'unit', status: 'fail' }],
    }),
  });
  await loop.verify();
  const m = loop.failureMessage();
  assert.ok(m.includes('[VERIFICATION FAILED — layer: unit]'));
  assert.ok(m.includes('assert 1 == 2') && m.includes('assert 3 == 4'), 'all evidence must be carried');
  assert.ok(/Do not claim the task is fixed/.test(m), 'the model must be told not to claim success');
  assert.equal(loop.pendingFailure.layer, 'unit', 'the failure is retained, not dropped');
});

test('JEXI-013: a later pass clears the pending failure', async () => {
  let n = 0;
  const loop = new CodingLoop({ send, runVerify: async () => (++n === 1 ? { ok: false, context: { injectedFailure: { layer: 'unit', reason: 'x' } } } : { ok: true, results: [] }) });
  await loop.verify();
  assert.ok(loop.failureMessage());
  await loop.verify();
  assert.equal(loop.failureMessage(), null, 'a pass must clear the stale failure');
});

/* ── JEXI-014: truncation keeps the failure ───────────────────── */

test('JEXI-014: a long test result keeps its failure lines after truncation', () => {
  const noise = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(200)}`).join('\n');
  const raw = `${noise}\n\n=========================== FAILURES ===========================\nFAILED tests/test_calc.py::test_add - assert 3 == 2\nE       assert 3 == 2\n=========================== short test summary info ============================\nFAILED tests/test_calc.py::test_add`;
  const out = shapeToolResult(raw, { maxChars: 4000, isTestResult: true });
  assert.ok(out.length < raw.length, 'output must actually be truncated');
  assert.ok(out.includes('FAILED tests/test_calc.py::test_add'), 'the failing test id must survive');
  assert.ok(out.includes('assert 3 == 2'), 'the assertion must survive');
  assert.ok(out.includes('key lines'), 'and be surfaced prominently');
});

test('JEXI-014: a short result is passed through untouched', () => {
  assert.equal(shapeToolResult('all good', { maxChars: 6000 }), 'all good');
});

test('JEXI-014: non-test truncation keeps head AND tail', () => {
  const raw = `HEAD${'a'.repeat(5000)}TAIL_MARKER`;
  const out = shapeToolResult(raw, { maxChars: 1000 });
  assert.ok(out.includes('HEAD'));
  assert.ok(out.includes('TAIL_MARKER'), 'the tail is where the error usually is');
});

/* ── JEXI-016: the module is real, small and separable ────────── */

test('JEXI-016: CodingLoop is a standalone unit with no AgentLoop import', () => {
  const src = fs.readFileSync(new URL('../../src/services/agent/CodingLoop.js', import.meta.url), 'utf8');
  assert.ok(!/from '.*AgentLoop\.js'/.test(src), 'the extracted module must not import the god-module');
  assert.ok(!/import .*ToolRuntime/.test(src), 'and must not drag the runtime in');
  assert.ok(src.length < 12000, `kept small, got ${src.length} bytes`);
});

/* ── JEXI-002: a RED suite blocks the success claim even with no edit ──
 *
 * The gate used to branch on `editSeen` alone. A turn that ran the tests,
 * watched them fail, edited nothing, and then narrated a fix fell straight
 * through to `not_applicable` with canClaimSuccess=true — an unverified turn
 * reported as a success. The failing verdict is evidence on its own.
 */

test('JEXI-002: a red test run blocks the success claim even when nothing was edited', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: false, results: [] }), send });
  loop.noteTestResult('pytest_run', { status: 'fail', exitCode: 1, passed: 1, failed: 1 });

  const gate = loop.successGate();
  assert.equal(gate.canClaimSuccess, false, 'a red suite must not be claimable as success');
  assert.equal(gate.status, 'unverified');
  assert.match(gate.annotation, /UNVERIFIED/);
  assert.match(gate.reason, /pytest_run/);
});

test('JEXI-002: a red test run with no edit and no verify call is still not success', async () => {
  // No noteToolCall, no verify() — exactly the shape of the old defect.
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true, results: [] }), send });
  assert.equal(loop.editSeen, false, 'precondition: nothing was edited');
  loop.noteTestResult('pytest_run', { status: 'fail', exitCode: 1, passed: 0, failed: 2 });

  assert.equal(loop.successGate().canClaimSuccess, false);
});

test('JEXI-002: an errored test run blocks the success claim too', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true, results: [] }), send });
  loop.noteTestResult('test_run', { status: 'error', exitCode: 2 });
  assert.equal(loop.successGate().canClaimSuccess, false);
});

test('JEXI-002: a PASSING test run clears the red verdict and restores the gate', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true, results: [] }), send });
  loop.noteTestResult('pytest_run', { status: 'fail', exitCode: 1, failed: 1 });
  assert.equal(loop.successGate().canClaimSuccess, false, 'precondition: red blocks');

  loop.noteTestResult('pytest_run', { status: 'pass', exitCode: 0, passed: 2, failed: 0 });
  const gate = loop.successGate();
  assert.equal(gate.canClaimSuccess, true, 'green restores the claim');
  assert.equal(gate.status, 'not_applicable');
});

test('JEXI-002: a green suite followed by an edit and a real pass is a verified success', async () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true, results: [{ layer: 'pytest', status: 'pass' }] }), send });
  loop.noteTestResult('pytest_run', { status: 'fail', exitCode: 1, failed: 1 });
  loop.noteToolCall('fs_edit', true);
  const r = await loop.verify('fs_edit');
  loop.noteTestResult('pytest_run', { status: 'pass', exitCode: 0, passed: 2, failed: 0 });

  assert.equal(r.verified, true);
  const gate = loop.successGate();
  assert.equal(gate.status, 'verified');
  assert.equal(gate.canClaimSuccess, true);
});

test('JEXI-002: a result with no status is not treated as a failure', () => {
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true, results: [] }), send });
  loop.noteTestResult('some_tool', { note: 'no verdict here' });
  assert.equal(loop.failingTest, null);
  assert.equal(loop.successGate().canClaimSuccess, true);
});

test('JEXI-002: AgentLoop records the test verdict before the pass/fail branch', async () => {
  const src = fs.readFileSync(new URL('../../src/services/AgentLoop.js', import.meta.url), 'utf8');
  const at = src.indexOf('noteTestResult');
  assert.ok(at > -1, 'AgentLoop must call noteTestResult');
  assert.ok(src.indexOf('noteTestResult') < src.indexOf('isPassingTest'),
    'the verdict must be recorded BEFORE the pass/fail branch, or a red run never reaches the gate');
});
