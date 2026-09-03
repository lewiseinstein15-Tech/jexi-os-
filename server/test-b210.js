#!/usr/bin/env node
/**
 * B210 — EMPLOYEE COMMAND EXECUTION: the last §27 events (COMMAND_* / TEST_*)
 * become real. Employees with EXECUTE permission can run allowlisted
 * commands inside their task workspace — no shell, scrubbed env, bounded —
 * and react to the actual output before delivering.
 *
 * Under test:
 *   command validation (binary/flag/arg allowlists), real execution in the
 *   cwd sandbox, exit codes, output caps, timeouts, env scrubbing, test
 *   classification, ```run block extraction, the bounded command loop
 *   (artifact → run → REAL output → final deliverable), permission denials
 *   (Zola can't execute), no double FILE_CREATED, event chaining, and a
 *   full Director turn with real command execution in it.
 */

import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { Director } from './src/services/director/Director.js';
import { validateCommand, isTestCommand, runEmployeeCommand, taskCommandDir, ALLOWED_BINARIES } from './src/services/director/CommandRunner.js';
import { extractCommandRequests, parseEmployeeOutput, assembleBrief, runEmployeeSession, employeeSystemPrompt } from './src/services/director/EmployeeSession.js';
import { checkToolPermission } from './src/services/director/Permissions.js';
import { getEmployee, employeeHistory } from './src/services/director/Employees.js';
import { DirectorTask } from './src/services/director/TaskState.js';
import { TaskMailbox } from './src/services/director/AgentMail.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const NL = String.fromCharCode(10);

/* ────────────────────────── fake infrastructure ────────────────────────── */

class FakeLlm {
  constructor() { this.interpretScript = null; this.employeeScript = null; this.verifyScript = null; this.reportScript = null; this.calls = { interpret: 0, employee: 0, verify: 0, report: 0 }; this.employeeCalls = []; }
  async interpret() { this.calls.interpret++; return this.interpretScript; }
  async employee(a) {
    this.calls.employee++;
    this.employeeCalls.push({ user: a.user });
    const r = typeof this.employeeScript === 'function' ? this.employeeScript({ ...a, n: this.calls.employee }) : this.employeeScript;
    if (r instanceof Error) throw r;
    if (a.onToken && typeof r === 'string') { for (const p of r.match(/[\s\S]{1,60}/g) || []) a.onToken(p); }
    return r;
  }
  async verify() { this.calls.verify++; return this.verifyScript; }
  async report() { this.calls.report++; return this.reportScript; }
  async review() { return { redirect: false, reason: '', instruction: '' }; }
}

const CODE_REFINEMENT = {
  understood: 'compute and verify', refinedObjective: 'Write a small JS analysis script, run it, and deliver its real output.',
  userLine: 'On it.', assumptions: [], ambiguity: 'low', clarifyingQuestion: '', risky: false,
  taskType: 'code', complexity: 'standard', constraints: [], successCriteria: ['script runs', 'output is real'],
  formatHint: 'code', needsVerification: false,
  subtasks: [{ title: 'Build and run the analysis', details: 'Write analysis.js, execute it, report the real output.', capability: 'code', requirements: ['code'], dependsOn: [], expectedOutput: 'the result', priority: 'normal' }],
};

function harness({ refinement = CODE_REFINEMENT, employeeScript, verifyScript } = {}) {
  const llm = new FakeLlm();
  llm.interpretScript = refinement;
  llm.employeeScript = employeeScript;
  llm.verifyScript = verifyScript ?? JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'ok' });
  llm.reportScript = 'Done. Forge built and ran the analysis — the real sum is 102, verified by execution.';
  const events = [];
  const sendEvent = (type, data) => { if (type === 'team') events.push(data.event || data); };
  const director = new Director({ llm, tools: { search: async () => 'source' }, departments: {} });
  return { llm, director, events, sendEvent };
}

const runTurn = async (h, over = {}) => h.director.runTurn({
  raw: over.raw || 'write a script that computes 6*7 and run it',
  effectiveQuery: over.effectiveQuery || over.raw || 'write a script that computes 6*7 and run it',
  contextBlock: '',
  convId: over.convId || `b210-${Math.random().toString(36).slice(2, 8)}`,
  sendEvent: h.sendEvent,
  memoryContext: '',
  activeTaskId: null,
});

/* ═══════════════════════ 1. command validation ═══════════════════════════ */
console.log('\n[1] Command validation — allowlists are real');
{
  check('node analysis.js allowed', validateCommand('node analysis.js').ok === true);
  check('ls allowed', validateCommand('ls').ok === true);
  check('flag -c is NOT allowed (flag allowlist)', validateCommand('grep -c foo out.txt').ok === false);
  check('node --test allowed (test runner flag)', validateCommand('node --test calc.test.js').ok === true);
  check('python3 -m pytest allowed', validateCommand('python3 -m pytest tests').ok === true);
  check('rm is blocked', validateCommand('rm -rf /').ok === false && /allowlist/.test(validateCommand('rm -rf /').reason));
  check('curl is blocked (no network tools)', validateCommand('curl http://evil.example').ok === false);
  check('npm is blocked (no package managers)', validateCommand('npm install left-pad').ok === false);
  check('sudo is blocked', validateCommand('sudo node x.js').ok === false);
  check('eval flag is blocked', validateCommand('node -e code()').ok === false);
  check('empty command rejected', validateCommand('   ').ok === false);
  const many = `node a.js ${'x'.repeat(10)}`.split(' ').concat(Array.from({ length: 9 }, (_, i) => `arg${i}`)).join(' ');
  check('too many args rejected', validateCommand(many).ok === false);
  check('shell metachars are inert args, not executed (no shell exists)', validateCommand('echo hello; rm -rf /').ok === false || validateCommand('echo hello; rm -rf /').parts[2] === ';');
}
/* ═══════════════════════ 2. real execution ═══════════════════════════════ */
console.log('\n[2] Real execution — sandbox, bounds, scrubbing');
{
  const taskId = `cmdtest-${Date.now()}`;
  const dir = taskCommandDir(taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'analysis.js'), 'console.log("6*7 =", 6*7);');
  const r = await runEmployeeCommand({ taskId, command: 'node analysis.js' });
  check('command executes and captures real output', r.ok === true && r.exitCode === 0 && /6\*7 = 42/.test(r.output));
  check('duration is measured', r.ms >= 0 && typeof r.ms === 'number');

  fs.writeFileSync(path.join(dir, 'fails.js'), 'process.exit(3);');
  const r2 = await runEmployeeCommand({ taskId, command: 'node fails.js' });
  check('non-zero exit code is reported honestly', r2.ok === false && r2.exitCode === 3);

  fs.writeFileSync(path.join(dir, 'noisy.js'), `console.log(${JSON.stringify('x'.repeat(100000))});`);
  const r3 = await runEmployeeCommand({ taskId, command: 'node noisy.js' });
  check('output is capped (protects model context)', r3.output.length <= 17000 && /truncated/.test(r3.output));

  fs.writeFileSync(path.join(dir, 'hang.js'), 'while(true) {}');
  const r4 = await runEmployeeCommand({ taskId, command: 'node hang.js', timeoutMs: 600 });
  check('runaway command is killed at the timeout', r4.timedOut === true && r4.ok === false);

  fs.writeFileSync(path.join(dir, 'marker.txt'), 'only-task-files');
  const r5 = await runEmployeeCommand({ taskId, command: 'ls' });
  check('cwd is the TASK workspace (ls sees the task files)', /marker\.txt/.test(r5.output) && /analysis\.js/.test(r5.output));

  const secretBefore = process.env.B210_FAKE_API_KEY;
  process.env.B210_FAKE_API_KEY = 'sk-b210secretsecretsecret1234';
  fs.writeFileSync(path.join(dir, 'envcheck.js'), 'console.log("KEY=" + (typeof process.env.B210_FAKE_API_KEY));');
  const r6 = await runEmployeeCommand({ taskId, command: 'node envcheck.js' });
  check('secrets are scrubbed from the child environment', /KEY=undefined/.test(r6.output));
  if (secretBefore === undefined) delete process.env.B210_FAKE_API_KEY; else process.env.B210_FAKE_API_KEY = secretBefore;

  check('test classification: node --test', isTestCommand('node --test calc.test.js') === true);
  check('test classification: plain node is not a test', isTestCommand('node analysis.js') === false);
  check('test classification: pytest via -m', isTestCommand('python3 -m pytest tests') === true);
  check('blocked binaries never spawn (validate-first)', runEmployeeCommand({ taskId: 'cmdtest-x', command: 'rm -rf /' }).blocked === true || (await runEmployeeCommand({ taskId: 'cmdtest-x', command: 'rm -rf /' })).blocked === true);
}
/* ═══════════════════ 3. run-block extraction ═════════════════════════════ */
console.log('\n[3] ```run block extraction');
{
  const out = ['## DELIVERABLE', 'analysis below', '', '```js analysis.js', 'console.log(1);', '```', '', '```run', 'node analysis.js', '```', '', '```run', 'ls', '```', '## CONFIDENCE', 'high'].join(NL);
  const reqs = extractCommandRequests(out);
  check('run blocks extracted', reqs.length === 2 && reqs[0] === 'node analysis.js' && reqs[1] === 'ls');
  check('artifact blocks are NOT commands', extractCommandRequests(['```md notes.md', 'hi', '```'].join(NL)).length === 0);
  const multi = extractCommandRequests(['```run', 'node a.js', 'node b.js', '```'].join(NL));
  check('multi-line run block becomes one command', multi.length === 1 && multi[0] === 'node a.js node b.js');
}
/* ═══════════════════ 4. the command loop (session) ═══════════════════════ */
console.log('\n[4] The command loop — artifact lands, command runs, output returns');
{
  const forge = getEmployee('forge');
  check('forge is staffed + permitted for run-command', forge.supportedTools.includes('run-command') && checkToolPermission(forge, 'run-command').allowed === true);
  const prompt = employeeSystemPrompt(forge, assembleBrief({ task: new DirectorTask({ conversationId: 'c', rawQuery: 'q', objective: 'o', successCriteria: [] }), subtask: { id: 'st1', title: 't', capability: 'code' }, employee: forge, dependencies: [] }));
  check('command briefing appears in the system prompt', /EXECUTE COMMANDS/.test(prompt) && /```run/.test(prompt));
  const zolaPrompt = employeeSystemPrompt(getEmployee('zola'), assembleBrief({ task: new DirectorTask({ conversationId: 'c', rawQuery: 'q', objective: 'o', successCriteria: [] }), subtask: { id: 'st1', title: 't', capability: 'research' }, employee: getEmployee('zola'), dependencies: [] }));
  check('no command briefing for non-execute employees', !/EXECUTE COMMANDS/.test(zolaPrompt));

  // round 1: artifact + run request; round 2: final deliverable using the output
  const round1 = ['## REPORT', 'Writing and running the script.', '', '## DELIVERABLE', 'See execution.', '', '```js analysis.js', 'const rows = [3, 41, 38, 20];', 'console.log("SUM =", rows.reduce((a,b)=>a+b,0));', '```', '', '```run', 'node analysis.js', '```', '', '## CONFIDENCE', 'medium'].join(NL);
  let round2 = null;
  const h = harness({
    employeeScript: ({ n }) => {
      if (n === 1) return round1;
      round2 = '## REPORT' + NL + 'Ran the script — real output received.' + NL + NL + '## DELIVERABLE' + NL + 'The sum of the dataset is 102 (verified by executing analysis.js: exit 0).' + NL + NL + '## CONFIDENCE' + NL + 'high';
      return round2;
    },
  });
  const result = await runTurn(h);
  check('the turn completes', result.success === true);
  check('two generations ran (request → react)', h.llm.calls.employee === 2);
  check('round-2 prompt carries the REAL command output', /COMMAND RESULTS/.test(h.llm.employeeCalls[1].user) && /SUM = 102/.test(h.llm.employeeCalls[1].user));
  const started = h.events.filter((e) => e.type === 'COMMAND_STARTED');
  const completed = h.events.filter((e) => e.type === 'COMMAND_COMPLETED');
  check('COMMAND_STARTED + COMMAND_COMPLETED were evented with real data', started.length === 1 && completed.length === 1 && completed[0].data?.exitCode === 0 && completed[0].data?.command === 'node analysis.js');
  check('the final answer uses the REAL result', /102/.test(result.summary || ''));
  const fileCreated = h.events.filter((e) => e.type === 'FILE_CREATED');
  check('the script was persisted exactly once (no double FILE_CREATED)', fileCreated.length === 1 && fileCreated[0].data?.file === 'analysis.js');
  check('command events chain via parentEventId', h.events.every((e, i) => (i === 0 ? e.parentEventId === null : e.parentEventId === h.events[i - 1].id)));

  // bounded rounds: employee requests commands EVERY round
  const alwaysRun = ['## REPORT', 'r', '', '## DELIVERABLE', 'd', '', '```run', 'ls', '```', '', '## CONFIDENCE', 'low'].join(NL);
  const h2 = harness({ employeeScript: () => alwaysRun });
  const r2 = await runTurn(h2);
  check('command rounds are bounded (≤ MAX_COMMAND_ROUNDS executions)', h2.llm.calls.employee <= 3 && h2.events.filter((e) => e.type === 'COMMAND_STARTED').length <= 2);
  check('bounded loop still delivers a final answer', r2.success === true);
}
/* ═══════════════════ 5. TEST_* events + permissions ══════════════════════ */
console.log('\n[5] TEST_* events and permission denials');
{
  // a real node --test run: write a passing test file, run it as an employee
  const testFile = ['const test = require(\'node:test\');', 'const assert = require(\'node:assert\');', 'test(\'sums\', () => { assert.equal(6*7, 42); });'].join(NL);
  const round1 = ['## REPORT', 'Testing the calc module.', '', '## DELIVERABLE', 'Tests below.', '', '```js calc.test.js', ...testFile.split(NL), '```', '', '```run', 'node --test calc.test.js', '```', '', '## CONFIDENCE', 'medium'].join(NL);
  const h = harness({
    employeeScript: ({ n }) => (n === 1 ? round1 : ['## REPORT', 'Tests ran green.', '', '## DELIVERABLE', '1 test passed (node --test exit 0).', '', '## CONFIDENCE', 'high'].join(NL)),
  });
  await runTurn(h, { raw: 'test that 6*7 is 42 using node --test' });
  check('TEST_STARTED was evented for node --test', h.events.some((e) => e.type === 'TEST_STARTED' && e.data?.command === 'node --test calc.test.js'));
  const testDone = h.events.find((e) => e.type === 'TEST_COMPLETED' || e.type === 'TEST_FAILED');
  check('TEST_COMPLETED with the real exit code', testDone?.type === 'TEST_COMPLETED' && testDone?.data?.exitCode === 0);

  // failing test → TEST_FAILED
  const badTest = ['const test = require(\'node:test\');', 'const assert = require(\'node:assert\');', 'test(\'fails\', () => { assert.equal(1, 2); });'].join(NL);
  const round1b = ['## REPORT', 'Testing.', '', '## DELIVERABLE', 't', '', '```js calc.test.js', ...badTest.split(NL), '```', '', '```run', 'node --test calc.test.js', '```', '', '## CONFIDENCE', 'low'].join(NL);
  const h2 = harness({
    employeeScript: ({ n }) => (n === 1 ? round1b : ['## REPORT', 'One test failed — reported honestly.', '', '## DELIVERABLE', '1/1 tests FAILED (exit 1).', '', '## CONFIDENCE', 'high'].join(NL)),
  });
  await runTurn(h2, { raw: 'run the failing test' });
  const failed = h2.events.find((e) => e.type === 'TEST_FAILED');
  check('TEST_FAILED with the real failing exit code', failed?.data?.exitCode !== 0 && failed?.data?.exitCode !== undefined);

  // Zola (no EXECUTE) requesting a command → denied, never executed
  const zolaRun = ['## REPORT', 'Trying to run something.', '', '## DELIVERABLE', 'd', '', '```run', 'node analysis.js', '```', '', '## CONFIDENCE', 'low'].join(NL);
  const researchRefinement = {
    ...CODE_REFINEMENT,
    subtasks: [{ title: 'Research it', details: 'd', capability: 'research', requirements: ['research'], dependsOn: [], priority: 'normal' }],
  };
  const h3 = harness({
    refinement: researchRefinement,
    employeeScript: ({ n }) => (n === 1 ? zolaRun : ['## REPORT', 'ok', '', '## DELIVERABLE', 'done', '', '## CONFIDENCE', 'medium'].join(NL)),
  });
  const r3 = await runTurn(h3, { raw: 'research the thing' });
  check('unpermitted command request → PERMISSION_DENIED', h3.events.some((e) => e.type === 'PERMISSION_DENIED' && /run-command|Command/.test(e.summary || '')));
  check('the command NEVER executed (no COMMAND_STARTED)', h3.events.every((e) => e.type !== 'COMMAND_STARTED'));
  check('the turn still completes (denial is not a crash)', r3.success === true);

  // history records the command-using assignment
  check('forge history recorded the assignment', employeeHistory('forge', 10).length >= 1);
}
/* ═══════════════════ 6. full director turn sanity ════════════════════════ */
console.log('\n[6] Regression — supervised generation still covers command rounds');
{
  // a refusal inside a COMMAND round is still caught by the supervisor
  const h = harness({
    employeeScript: ({ n }) => {
      if (n === 1) return ['## REPORT', 'I looked but as an AI I can\'t run this, I can\'t run this, I can\'t run this.'].join(NL);
      return ['## REPORT', 'Fine — ran it.', '', '## DELIVERABLE', 'SUM = 102', '', '## CONFIDENCE', 'high'].join(NL);
    },
  });
  const r = await runTurn(h);
  check('supervision redirect still works in the command-loop world', h.events.some((e) => e.type === 'SUPERVISION_REDIRECT'));
  check('post-redirect rerun can still use commands', r.success === true);
}

/* ═══════════════ 7. execution honesty (found in the live E2E) ════════════ */
console.log('\n[7] Execution honesty — no fabricated results');
{
  // the exact production failure shape: a non-executor "verified" with
  // invented timings. The gate must flag claims without real command events.
  const { verifyDeliverable } = await import('./src/services/director/Verifier.js');
  const task = new DirectorTask({ conversationId: 'honesty-1', rawQuery: 'q', objective: 'compute primes and run it', successCriteria: ['correct primes'] });
  task.events.push({ id: 'e1', type: 'OBJECTIVE_RECEIVED' }); // events exist, but no COMMAND_*
  const fabricated = 'The script executed successfully. Execution Time: 0.04ms. Node.js v20.12.2. Tests passed. Output: [2,3,5,7,11,13,17,19,23,29]';
  const v = await verifyDeliverable({
    task, deliverable: fabricated, criteria: ['correct primes'],
    verifierEmployee: getEmployee('vera'),
    llm: async () => JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'looks fine' }),
    mailbox: new TaskMailbox('honesty-1'), hooks: {},
  });
  check('fabricated execution claims FAIL verification', v.verdict === 'fail' && v.problems.some((p2) => /no command actually ran/i.test(p2)));

  // same deliverable WITH a real command event → the claim is corroborated
  const task2 = new DirectorTask({ conversationId: 'honesty-2', rawQuery: 'q', objective: 'compute primes and run it', successCriteria: ['correct primes'] });
  task2.events.push({ id: 'e1', type: 'COMMAND_COMPLETED', data: { command: 'node primes.js', exitCode: 0 } });
  const v2 = await verifyDeliverable({
    task: task2, deliverable: fabricated, criteria: ['correct primes'],
    verifierEmployee: getEmployee('vera'),
    llm: async () => JSON.stringify({ pass: true, score: 1.0, problems: [], rationale: 'ok' }),
    mailbox: new TaskMailbox('honesty-2'), hooks: {},
  });
  check('corroborated execution claims pass (real command event present)', v2.verdict !== 'fail' || !v2.problems.some((p2) => /no command actually ran/i.test(p2)));

  // clean code with no execution claims → gate silent
  const task3 = new DirectorTask({ conversationId: 'honesty-3', rawQuery: 'q', objective: 'write a primes function', successCriteria: ['function works'] });
  const v3 = await verifyDeliverable({
    task: task3, deliverable: 'function generatePrimes(count) { return [2, 3, 5]; }', criteria: ['function works'],
    verifierEmployee: getEmployee('vera'),
    llm: async () => JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'ok' }),
    mailbox: new TaskMailbox('honesty-3'), hooks: {},
  });
  check('no execution claims → honesty gate stays silent', !v3.problems.some((p2) => /no command actually ran/i.test(p2)));

  // the interpreter prompt carries the no-split rule
  const { realLlmAdapter } = await import('./src/services/director/RealAdapters.js');
  const fsx = await import('fs');
  const sys = fsx.readFileSync('src/services/director/RealAdapters.js', 'utf-8');
  check('interpreter forbids splitting execution into a non-code subtask', /NEVER split.*run\/execute\/test/s.test(sys));
  // and the employee prompt carries the honesty rule
  const es = fsx.readFileSync('src/services/director/EmployeeSession.js', 'utf-8');
  check('employee prompt: never fabricate execution results', /NEVER claim a command ran/.test(es));
}

/* ─────────────────────────────── verdict ──────────────────────────────── */
console.log(`\nB210: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
