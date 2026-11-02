/**
 * M17 — D1: the completion gate must read TYPED execution facts.
 *
 * Defect (M16): AgentLoop's gate read `r.result.status === 'pass'`, but
 * ToolRuntime returns `result` as a FORMATTED STRING. The branch was dead
 * code, so a genuinely green `test_run` could never verify a turn.
 *
 * The fix attaches a typed `meta` object to every executeTool result and the
 * gate reads that. These tests exercise the REAL path — the real tool runtime
 * (real pytest child processes) and the real AgentLoop gate through the
 * scripted tool-call seam — not a hand-built result object.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerAllDomains } from '../../src/tools/domains/index.js';
import { domainExecutor } from '../../src/tools/domains/executor.js';
import { classifyExecution, isPassingTestMeta, isFailingTestMeta } from '../../src/services/agent/exec-meta.js';

registerAllDomains();
domainExecutor(); // publishes the domain probe resolveToolDef/buildNativeSchemas read

const hasPytest = (() => { try { return /pytest/.test(String(execFileSync('pytest', ['--version'], { encoding: 'utf8' }))); } catch { return false; } })();

/** A temp project the real test_run can detect and run. */
function makeProject({ test = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm17-d1-'));
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
  fs.writeFileSync(path.join(dir, 'solution.py'), 'def add(a, b):\n    return a + b\n');
  if (test !== null) fs.writeFileSync(path.join(dir, 'test_add.py'), test);
  return dir;
}
const GREEN = 'from solution import add\n\ndef test_add():\n    assert add(1, 2) == 3\n';
const RED = 'from solution import add\n\ndef test_add():\n    assert add(1, 2) == 99\n';

async function execTool(slug, args, dir) {
  const { executeTool } = await import('../../src/services/ToolRuntime.js');
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = dir;
  try { return await executeTool({ slug, args, profile: 'full' }); }
  finally { if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev; }
}

/* ── the typed classifier (pure, no spawn) ─────────────────────────────── */

test('M17/D1: a green engine payload classifies as a passing test', () => {
  const meta = classifyExecution('test_run', { ok: true }, { status: 'pass', exitCode: 0, tests: 3, passed: 3, failed: 0, framework: 'pytest' });
  assert.equal(meta.kind, 'test');
  assert.equal(meta.status, 'pass');
  assert.equal(isPassingTestMeta(meta), true);
});

test('M17/D1: a red engine payload classifies as a failing test', () => {
  const meta = classifyExecution('test_run', { ok: true }, { status: 'fail', exitCode: 1, tests: 3, passed: 2, failed: 1 });
  assert.equal(meta.status, 'fail');
  assert.equal(isFailingTestMeta(meta), true);
  assert.equal(isPassingTestMeta(meta), false);
});

test('M17/D1: a green suite that executed ZERO tests is not a pass', () => {
  const meta = classifyExecution('test_run', { ok: true }, { status: 'pass', exitCode: 0, tests: 0, passed: 0, failed: 0 });
  assert.equal(meta.status, 'error');
  assert.match(meta.reason, /0 tests/);
});

test('M17/D1: a killed run (exitCode -1, no output) is a timeout, never a pass', () => {
  const meta = classifyExecution('test_run', { ok: true }, { status: 'error', exitCode: -1, tests: 0, output: '' });
  assert.equal(meta.status, 'timeout');
  assert.equal(meta.timedOut, true);
  assert.equal(isPassingTestMeta(meta), false);
});

test('M17/D1: a transport timeout / block / denial is never a pass', () => {
  assert.equal(classifyExecution('test_run', { ok: false, code: 'TOOL_TIMEOUT' }).status, 'timeout');
  assert.equal(classifyExecution('test_run', { ok: false, blocked: true }).status, 'blocked');
  assert.equal(classifyExecution('test_run', { ok: false, declined: true }).status, 'denied');
  assert.equal(classifyExecution('test_run', { ok: false, paused: true }).status, 'not_run');
});

test('M17/D1: the classifier unwraps the domain envelope and JSON strings', () => {
  const meta = classifyExecution('test_run', { ok: true }, JSON.stringify({ ok: true, domain: 'test_run', result: { status: 'pass', exitCode: 0, tests: 1, passed: 1 } }));
  assert.equal(meta.status, 'pass');
});

test('M17/D1: a test tool that returns ok:true with no verdict is not a pass', () => {
  const meta = classifyExecution('test_run', { ok: true }, { ok: true });
  assert.equal(meta.status, 'error');
  assert.match(meta.reason, /no verdict/);
});

/* ── the real tool runtime attaches typed meta ─────────────────────────── */

test('M17/D1: the real test_run returns formatted text AND typed meta', { skip: !hasPytest }, async () => {
  const dir = makeProject({ test: GREEN });
  try {
    const r = await execTool('test_run', {}, dir);
    assert.equal(typeof r.result, 'string', 'the model still gets a formatted string');
    assert.equal(typeof r.meta, 'object', 'the gate gets a typed meta object');
    assert.equal(r.meta.kind, 'test');
    assert.equal(r.meta.status, 'pass');
    assert.equal(isPassingTestMeta(r.meta), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M17/D1: a red real test_run carries a failing meta', { skip: !hasPytest }, async () => {
  const dir = makeProject({ test: RED });
  try {
    const r = await execTool('test_run', {}, dir);
    assert.equal(typeof r.result, 'string');
    assert.equal(r.meta.status, 'fail');
    assert.equal(isFailingTestMeta(r.meta), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M17/D1: a real timed-out pytest_run is typed as a timeout', { skip: !hasPytest }, async () => {
  const dir = makeProject({ test: 'import time\n\ndef test_slow():\n    time.sleep(8)\n' });
  try {
    const r = await execTool('pytest_run', { timeoutMs: 700 }, dir);
    assert.equal(r.meta.timedOut, true);
    assert.equal(isPassingTestMeta(r.meta), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M17/D1: every non-happy return path still carries typed meta', async () => {
  const r = await execTool('definitely_not_a_real_tool_slug', {}, process.cwd());
  assert.equal(r.ok, false);
  assert.ok(r.meta && typeof r.meta.status === 'string', 'unknown tool still gets meta');
});

/* ── the real gate, driven through the real AgentLoop ──────────────────── */

async function runTurn(dir, { test = null, verifyOk = false } = {}) {
  if (test !== null) fs.writeFileSync(path.join(dir, 'test_add.py'), test);
  const { runAgentLoop } = await import('../../src/services/AgentLoop.js');
  const calls = [
    { name: 'fs_write', args: { path: 'solution.py', content: 'def add(a, b):\n    return a + b\n' } },
    { name: 'test_run', args: {} },
  ];
  // The benchmark pins the tool workspace to the task sandbox the same way;
  // without it test_run would run whatever suite lives in the repo cwd.
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = dir;
  try {
    return await runAgentLoop({
      query: 'fix the failing test in test_add.py so the whole suite passes',
      sendEvent: () => {},
      opts: {
        root: dir,
        profile: 'full',
        __scriptedToolCalls: calls,
        // The verify seam is deliberately made to FAIL, so the ONLY thing that
        // can verify this turn is the green test_run itself.
        __verify: async () => (verifyOk
          ? { ok: true, results: [{ layer: 'unit', status: 'pass' }] }
          : { ok: false, context: { verified: false, injectedFailure: { layer: 'unit', reason: 'planted failure' } }, results: [{ layer: 'unit', status: 'fail' }] }),
      },
    });
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
  }
}

test('M17/D1: a GREEN test_run verifies the turn (the defect)', { skip: !hasPytest }, async () => {
  const dir = makeProject();
  try {
    const info = await runTurn(dir, { test: GREEN, verifyOk: false });
    assert.equal(info.verification.status, 'verified');
    assert.equal(info.verification.canClaimSuccess, true);
    assert.ok(!/\[UNVERIFIED\]/.test(info.answer), 'a verified turn must not be annotated unverified');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M17/D1: a RED test_run leaves the turn unverified', { skip: !hasPytest }, async () => {
  const dir = makeProject();
  try {
    const info = await runTurn(dir, { test: RED, verifyOk: true });
    assert.equal(info.verification.status, 'unverified');
    assert.equal(info.verification.canClaimSuccess, false);
    assert.match(info.answer, /\[UNVERIFIED\]/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M17/D1: a turn that produced NO evidence is unverified', async () => {
  const dir = makeProject();
  const prev = process.env.WORKSPACE_DIR;
  process.env.WORKSPACE_DIR = dir;
  try {
    const { runAgentLoop } = await import('../../src/services/AgentLoop.js');
    const info = await runAgentLoop({
      query: 'fix the failing test in test_add.py',
      sendEvent: () => {},
      opts: { root: dir, profile: 'full', __scriptedToolCalls: [{ name: 'fs_read', args: { path: 'no-such-file.py' } }] },
    });
    assert.equal(info.verification.status, 'unverified');
    assert.equal(info.verification.canClaimSuccess, false);
  } finally {
    if (prev === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M17/D1: the legacy structured-result path still works (backward compatible)', async () => {
  // A caller that still hands CodingLoop the raw engine object (no meta)
  // keeps working — the fallback reader is unchanged.
  const { CodingLoop } = await import('../../src/services/agent/CodingLoop.js');
  const loop = new CodingLoop({ runVerify: async () => ({ ok: true }) });
  loop.noteToolCall('fs_edit', true);
  loop.noteTestResult('test_run', { status: 'fail', exitCode: 1, failed: 2 });
  assert.equal(loop.successGate().canClaimSuccess, false, 'legacy red still blocks');
  loop.noteTestResult('test_run', { status: 'pass', exitCode: 0 });
  assert.equal(loop.failingTest, null, 'legacy green still clears');
});
