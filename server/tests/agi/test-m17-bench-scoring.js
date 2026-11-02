/**
 * M17 — D3: a timed-out (or errored) benchmark task must NOT be scored a pass.
 *
 * Defect (M16): bench4 HumanEval/3 was recorded `pass=True` alongside
 * `agentError="agent loop timed out after 300000ms"` — the grader read the
 * leftover solution.py and ignored that the agent never finished.
 *
 * These tests exercise the real scoring module the full run and the slice
 * driver share, including the exact false-positive shape from the report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreTask, summarise, isTimeoutError } from '../../../benchmarks/humaneval-live/lib/score.mjs';

test('M17/D3: the exact bench4 false positive — green file + timeout — is NOT a pass', () => {
  const s = scoreTask({ graded: { passed: true, exitCode: 0 }, agentError: 'agent loop timed out after 300000ms' });
  assert.equal(s.pass, false, 'a timed-out task must not be scored a pass');
  assert.equal(s.gradedPass, true, 'the grader really did see a green file — record it');
  assert.equal(s.agentTimedOut, true);
  assert.match(s.reason, /timeout/);
});

test('M17/D3: a green file with a NON-timeout agent error is also not a pass', () => {
  const s = scoreTask({ graded: { passed: true }, agentError: 'boom' });
  assert.equal(s.pass, false);
  assert.equal(s.agentTimedOut, false);
  assert.match(s.reason, /agent error/);
});

test('M17/D3: a grader failure is never a pass, even with no agent error', () => {
  const s = scoreTask({ graded: { passed: false, error: 'python3: not found' } });
  assert.equal(s.pass, false);
  assert.match(s.reason, /grader error/);
});

test('M17/D3: a clean green run with no error IS a pass', () => {
  const s = scoreTask({ graded: { passed: true, exitCode: 0 }, agentError: null });
  assert.equal(s.pass, true);
  assert.equal(s.reason, null);
});

test('M17/D3: a clean red run is a plain failure (not a timeout)', () => {
  const s = scoreTask({ graded: { passed: false, exitCode: 1 }, agentError: null });
  assert.equal(s.pass, false);
  assert.match(s.reason, /did not pass/);
  assert.equal(s.agentTimedOut, false);
});

test('M17/D3: timeout detection covers the harness message', () => {
  assert.equal(isTimeoutError('agent loop timed out after 300000ms'), true);
  assert.equal(isTimeoutError('ETIMEDOUT'), true);
  assert.equal(isTimeoutError('spawn timeout'), true);
  assert.equal(isTimeoutError('assertion failed'), false);
  assert.equal(isTimeoutError(null), false);
});

test('M17/D3: the summary separates resolved from green-but-unresolved', () => {
  const rows = [
    { pass: true, gradedPass: true, agentTimedOut: false, agentError: null, resolveReason: null },
    { pass: false, gradedPass: true, agentTimedOut: true, agentError: 'agent loop timed out after 300000ms', resolveReason: 'timeout: agent loop timed out after 300000ms' },
    { pass: false, gradedPass: false, agentTimedOut: false, agentError: null, resolveReason: 'grader: solution did not pass' },
    { pass: false, gradedPass: true, agentTimedOut: false, agentError: null, resolveReason: 'grader error: python3 missing' },
  ];
  const m = summarise(rows);
  assert.equal(m.total, 4);
  assert.equal(m.resolved, 1);
  assert.equal(m.gradedGreen, 3);
  assert.equal(m.timeouts, 1);
  assert.equal(m.graderErrors, 1);
  // The headline number must equal the resolved count, NOT the green count.
  assert.equal(m.resolved, 1);
  assert.notEqual(m.resolved, m.gradedGreen, 'resolved must not silently track gradedGreen');
  assert.equal(m.unresolvedGreen, 2);
});

test('M17/D3: an empty run reports zero, not NaN', () => {
  const m = summarise([]);
  assert.equal(m.total, 0);
  assert.equal(m.resolvedRate, 0);
  assert.equal(m.gradedGreenRate, 0);
});
