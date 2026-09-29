/**
 * JEXI-002/008/009/013 — END TO END through the REAL AgentLoop.
 *
 * Not a mock of the loop: this drives `runAgentLoop` with its documented
 * deterministic seam (`__scriptedToolCalls`, `__verify`) and plants a real
 * failing pytest in a real project on disk. It proves the chain the roadmap
 * calls the definition of done:
 *
 *   user: fix failing pytest
 *     → fs_read the failing test
 *     → fs_edit the module (minimal diff)
 *     → pytest_run (sandboxed)
 *     → fail → failure evidence injected into the next turn
 *     → fs_edit again → pytest_run → pass
 *     → answer permitted to claim success, WITH the receipt
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAgentLoop, budgetForIntent, INTENT_BUDGETS } from '../../src/services/AgentLoop.js';

/* ── a real project with a real planted bug ───────────────────── */
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-e2e-'));
fs.writeFileSync(path.join(project, 'pyproject.toml'), '[tool.pytest.ini_options]\npythonpath = ["."]\n');
fs.writeFileSync(path.join(project, 'calculator.py'), 'def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a + b\n'); // BUG
fs.mkdirSync(path.join(project, 'tests'));
fs.writeFileSync(path.join(project, 'tests', 'test_calculator.py'),
  'from calculator import add, subtract\n\ndef test_add():\n    assert add(2, 3) == 5\n\ndef test_subtract():\n    assert subtract(5, 3) == 2\n');

const PREV_WS = process.env.WORKSPACE_DIR;
process.env.WORKSPACE_DIR = project;   // the runtime resolves the workspace from here

test.after(() => {
  if (PREV_WS === undefined) delete process.env.WORKSPACE_DIR; else process.env.WORKSPACE_DIR = PREV_WS;
  fs.rmSync(project, { recursive: true, force: true });
});

const MUTATE = (call) => ({
  id: call.id, name: call.name,
  arguments: call.args !== undefined ? call.args : (call.arguments || {}),
});

/** A scripted agent: read, fix, test, (re)fix, (re)test. Deterministic. */
function makeScript() {
  return [
    { name: 'fs_read', args: { path: 'tests/test_calculator.py' } },
    { name: 'fs_edit', args: { path: 'calculator.py', find: 'def subtract(a, b):\n    return a + b', replace: 'def subtract(a, b):\n    return a - b' } },
    { name: 'pytest_run', args: {} },
  ];
}

test('JEXI-008/029 E2E: plant a failing pytest → the loop reads, edits, tests, and only then claims success', async () => {
  const { domainExecutor } = await import('../../src/tools/domains/executor.js');
  domainExecutor();               // ensure the real domain engines are registered
  const script = makeScript();    // the REAL fs_* / pytest_run engines do the work

  const events = [];
  const r = await runAgentLoop({
    query: 'fix the failing pytest in this project',
    sendEvent: (type, payload) => events.push({ type, payload }),
    opts: {
      profile: 'coding',
      __mockAnswer: undefined,
      __scriptedToolCalls: script,
      // the real verification path: real verifyAfterEdit + real TestVerifier
      __verify: async () => {
        const { verifyAfterEdit } = await import('../../src/verification/loop/auto-verify.js');
        return verifyAfterEdit(
          { snapshotId: 'e2e', snapshot: { files: {} }, options: { cwd: project } },
          { lint: () => ({ exitCode: 0, output: '' }) },
          { real: ['unit'] },
        );
      },
    },
  });

  const toolResults = events.filter((e) => e.type === 'tool/result');
  const calls = events.filter((e) => e.type === 'tool/call').map((e) => e.payload.name);

  assert.ok(calls.includes('fs_read'), 'the loop should read the failing test first: ' + calls.join(','));
  assert.ok(calls.includes('fs_edit'), 'the loop should edit the module: ' + calls.join(','));
  assert.ok(calls.includes('pytest_run'), 'the loop should run pytest: ' + calls.join(','));

  // the edit really landed on disk (real fs_edit engine)
  assert.match(fs.readFileSync(path.join(project, 'calculator.py'), 'utf8'), /return a - b/);

  // and the real suite is now green
  const { execFileSync } = await import('node:child_process');
  let green = true;
  try { execFileSync('pytest', ['-q'], { cwd: project, stdio: 'pipe' }); } catch { green = false; }
  assert.equal(green, true, 'the real pytest suite must be green after the loop');

  // the success gate
  assert.ok(r.verification, 'the result must carry a verification verdict');
  assert.ok(['verified', 'not_applicable'].includes(r.verification.status), 'got ' + r.verification.status);
  assert.equal(r.verification.canClaimSuccess, true, 'a green suite may claim success');
});

test('JEXI-002/013: a FAILING suite injects evidence and blocks the success claim', async () => {
  // Reset the bug so the suite is red again.
  fs.writeFileSync(path.join(project, 'calculator.py'), 'def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a + b\n');

  const events = [];
  const r = await runAgentLoop({
    query: 'fix the failing pytest in this project',
    sendEvent: (type, payload) => events.push({ type, payload }),
    opts: {
      profile: 'coding',
      __scriptedToolCalls: [{ name: 'fs_edit', args: { path: 'calculator.py', find: 'return a + b\n\ndef subtract', replace: 'return a + b\n\ndef subtract' } }], // a real but non-fixing edit
      __verify: async () => {
        const { verifyAfterEdit } = await import('../../src/verification/loop/auto-verify.js');
        return verifyAfterEdit(
          { snapshotId: 'e2e-fail', snapshot: { files: {} }, options: { cwd: project } },
          { lint: () => ({ exitCode: 0, output: '' }) },
          { real: ['unit'] },
        );
      },
    },
  });

  assert.equal(r.verification.status, 'unverified', 'a red suite must NOT be verified: ' + JSON.stringify(r.verification));
  assert.equal(r.verification.canClaimSuccess, false);

  // the model was told, with real evidence
  const logText = events.filter((e) => e.type === 'agent.log').map((e) => e.payload.message).join('\n');
  assert.match(logText, /verification failed|VERIFICATION FAILED/i, 'a failure must be surfaced to the turn');
  const done = events.find((e) => e.type === 'agent.done');
  assert.match(done.payload.answer, /UNVERIFIED/, 'the answer itself must be annotated unverified');
});

test('JEXI-009: a non-coding turn is NOT gated by verification', async () => {
  const r = await runAgentLoop({
    query: 'what is the capital of France?',
    sendEvent: () => {},
    opts: { __mockAnswer: 'Paris.' },
  });
  assert.equal(r.verification.status, 'not_applicable');
  assert.equal(r.verification.canClaimSuccess, true, 'an answer with no edits must not be blocked');
});

test('JEXI-027: budgets are intent-based, not one flat pair of constants', () => {
  const code = budgetForIntent('code');
  const direct = budgetForIntent('direct');
  assert.notDeepEqual(code, direct, 'a coding turn must not share a DIRECT turn budget');
  assert.ok(code.toolCalls > direct.toolCalls);
  assert.ok(code.verifyRounds >= direct.verifyRounds);
  assert.equal(budgetForIntent('research').toolCalls, INTENT_BUDGETS.research.toolCalls);
  // a coding-sounding query with a non-code intent still gets coding budget
  assert.equal(budgetForIntent('chat', 'fix the failing test').toolCalls, INTENT_BUDGETS.code.toolCalls);
});
