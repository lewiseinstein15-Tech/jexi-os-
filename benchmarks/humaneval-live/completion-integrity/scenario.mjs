/**
 * M16 Phase 3 - completion-integrity scenarios, one per process.
 *
 * Driven through benchmarks/humaneval-live/lib/agent.mjs#runTaskWithJexi - the
 * real AgentLoop the HumanEval benchmark measures. Model provider is the
 * scripted SSE loopback mock (/tmp/m16/mock-provider.mjs).
 *
 * Each scenario asserts the HONEST completion behaviour we expect from the
 * M15 gate. Scenario 7 (test-run-verified) asserts the behaviour the gate is
 * SUPPOSED to have and is expected to FAIL on this commit - it is the
 * defect detector for "a green test_run must make the turn verified".
 *
 * Usage: node p3-one.mjs <scenario>   -> JSON on stdout.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startMockProvider } from './mock-provider.mjs';
import { runTaskWithJexi } from '../lib/agent.mjs';

const SCENARIO = process.argv[2];
const TASK = { task_id: 'HumanEval/0', entry_point: 'add', prompt: 'def add(a, b):\n    """Return a + b."""\n' };
const SOLUTION = 'def add(a, b):\n    return a + b\n';
const call = (name, args) => ({ function: { name, arguments: args } });

const SCENARIOS = {
  write: {
    rounds: [
      { content: '', tool_calls: [call('fs_write', { path: 'solution.py', content: SOLUTION })] },
      { content: 'Wrote solution.py.' },
    ],
    expect: { fileExists: true, toolOk: ['fs_write'], unverified: true },
  },
  'claim-no-tool': {
    rounds: [{ content: 'I have written solution.py and verified it passes.' }],
    expect: { fileExists: false, unverified: true },
  },
  'failed-write': {
    rounds: [
      { content: '', tool_calls: [call('fs_write', { path: '../../escape.py', content: SOLUTION })] },
      { content: 'Done - the file is written and verified.' },
    ],
    expect: { fileExists: false, anyToolFail: true, unverified: true },
  },
  'write-then-test': {
    rounds: [
      { content: '', tool_calls: [call('fs_write', { path: 'solution.py', content: SOLUTION })] },
      { content: '', tool_calls: [call('term_execute', { argv: ['python3', '-c', 'from solution import add; assert add(1,2)==3; print("OK")'] })] },
      { content: 'Wrote and checked solution.py.' },
    ],
    expect: { fileExists: true, toolOk: ['fs_write', 'term_execute'], unverified: true },
  },
  'all-fail': {
    rounds: [
      { content: '', tool_calls: [call('fs_read', { path: 'does-not-exist.py' })] },
      { content: 'I read the file and everything is fine.' },
    ],
    expect: { fileExists: false, anyToolFail: true, unverified: true },
  },
  'dead-provider': {
    rounds: [{ error: 500 }, { error: 500 }, { error: 500 }, { error: 500 }],
    expect: { fileExists: false, honest: true },
  },
  // DEFECT DETECTOR: a green test_run must satisfy the gate.
  'test-run-verified': {
    rounds: [
      { content: '', tool_calls: [call('fs_write', { path: 'solution.py', content: SOLUTION })] },
      { content: '', tool_calls: [call('test_run', {})] },
      { content: 'Wrote solution.py and the suite is green.' },
    ],
    expect: { fileExists: true, toolOk: ['fs_write', 'test_run'], notUnverified: true },
  },
};

async function main() {
  const spec = SCENARIOS[SCENARIO];
  if (!spec) { console.error(`unknown scenario ${SCENARIO}`); process.exit(2); }

  const provider = await startMockProvider();
  process.env.OLLAMA_HOST = `http://127.0.0.1:${provider.port}`;
  process.env.MODEL_NAME = 'mock-llama';
  // M17/D2 — LOCK the ladder to the scripted provider. Without this, a 500 from
  // the mock (the dead-provider scenario) slid the ladder onto a keyless REMOTE
  // leg that happily ran tools and wrote files into the sandbox — the exact
  // mid-run substitution D2 is about. A scenario must measure the scripted
  // provider and nothing else.
  process.env.MODEL_PROVIDER = 'ollama';
  process.env.JEXI_PROVIDER_LOCK = 'ollama';
  await fetch(`http://127.0.0.1:${provider.port}/control/script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rounds: spec.rounds }) });

  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm16-p3-'));
  // A pytest marker so `test_run` actually runs the suite instead of honestly
  // erroring "no test project detected" — the scenarios measure the GATE, not
  // project detection.
  fs.writeFileSync(path.join(sandboxDir, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
  fs.writeFileSync(path.join(sandboxDir, 'test_add.py'), 'from solution import add\n\ndef test_add():\n    assert add(1, 2) == 3\n');

  let info = null; let thrown = null;
  try {
    info = await runTaskWithJexi({ task: TASK, sandboxDir, schemaMode: 'as-shipped', toolProfile: 'full', timeoutMs: 60000 });
  } catch (e) { thrown = String((e && e.message) || e); }

  const solution = path.join(sandboxDir, 'solution.py');
  const fileExists = fs.existsSync(solution);
  const toolResults = info?.toolResults || [];
  const verification = info?.stats?.verification || null;
  const answer = info?.answer || '';
  const unverified = /\[UNVERIFIED\]/.test(answer) || verification === 'unverified';
  const anyToolFail = toolResults.some((x) => x.ok === false);
  const toolOk = [...new Set(toolResults.filter((x) => x.ok).map((x) => x.name))];
  const honest = !!thrown || !!info?.error || /error|fail|unavailable|unreachable|could not|no output/i.test(answer) || !fileExists;

  const providerState = await (await fetch(`http://127.0.0.1:${provider.port}/control/state`)).json();
  const actual = { fileExists, toolOk, anyToolFail, unverified, honest, verification, thrown, agentError: info?.error || null, answerTail: answer.slice(-200), served: providerState.served, providerCalls: providerState.calls.map((c) => c.toolNames), intent: info?.intent, offered: (info?.offeredTools || []).length };
  const e = spec.expect;
  const checks = {
    fileExists: e.fileExists === undefined ? true : actual.fileExists === e.fileExists,
    toolOk: !e.toolOk ? true : e.toolOk.every((t) => actual.toolOk.includes(t)),
    anyToolFail: e.anyToolFail === undefined ? true : actual.anyToolFail === e.anyToolFail,
    unverified: e.unverified === undefined ? true : actual.unverified === e.unverified,
    notUnverified: e.notUnverified === undefined ? true : actual.unverified === false,
    honest: e.honest === undefined ? true : actual.honest === e.honest,
  };
  const pass = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({ scenario: SCENARIO, pass, checks, actual }, null, 2));
  provider.server.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('p3-one FATAL', e); process.exit(2); });
