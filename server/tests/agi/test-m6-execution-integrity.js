/**
 * M6 — EXECUTION-INTEGRITY regression suite.
 *
 * Proves the three confirmed execution defects are closed, each with the
 * EXACT failure it was found by:
 *
 *   D1 FILESYSTEM CONFINEMENT — the agentic `file_read` lane resolved ANY
 *      absolute path (`path.resolve(p)`) with no workspace jail, so an
 *      absolute path, a `../` traversal, and a symlink out of the workspace
 *      all returned real file contents. Now every read goes through the one
 *      path authority (`resolveWithin`) and refusals return no bytes.
 *
 *   D2 EXECUTION-RESULT INTEGRITY — `composeReport` told the report model
 *      "Real commands executed this task: NONE" whenever it saw no
 *      COMMAND_COMPLETED, ignoring COMMAND_FAILED. A command that really ran
 *      and exited 3 was reported as "not executed this turn". Now one
 *      authoritative ExecutionRecord (a failed run is still a run) feeds both
 *      the report prompt and the fallback answer.
 *
 *   D3 VERIFICATION CORRECTNESS — a criterion requiring a file be "exactly 5
 *      bytes" passed against a record showing 6 bytes written, because the
 *      verdict came from the rubric model alone. Now machine-checkable exact
 *      values are decided from the task's execution record; a contradiction
 *      fails deterministically and the model cannot override it.
 *
 * Deterministic, headless, ZERO network, ZERO real model calls (the model
 * layers are injected seams). Run:
 *   node --test tests/agi/test-m6-execution-integrity.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { executeCapabilityKeyless } from '../../src/services/AgenticDecision.js';
import { deriveExecutionRecord, executionRecordLines, OUTCOMES } from '../../src/services/director/ExecutionRecord.js';
import { Director } from '../../src/services/director/Director.js';
import { verifyDeliverable, evidenceContradictions, exactByteCountIn } from '../../src/services/director/Verifier.js';
import { getEmployee } from '../../src/services/director/Employees.js';
import { TaskMailbox } from '../../src/services/director/AgentMail.js';

/* ── isolated fixture workspace ─────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m6-'));
const WS = path.join(tmp, 'ws');
fs.mkdirSync(WS, { recursive: true });
fs.writeFileSync(path.join(WS, 'inside.txt'), 'INSIDE-OK-CANARY\n');
fs.writeFileSync(path.join(tmp, 'outside.txt'), 'OUTSIDE-SECRET-CANARY\n');
fs.mkdirSync(path.join(tmp, 'wsx'), { recursive: true });               // sibling: ws vs wsx
fs.writeFileSync(path.join(tmp, 'wsx', 'sibling.txt'), 'SIBLING-SECRET\n');
fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(WS, 'link-out.txt'), 'file');
fs.mkdirSync(path.join(WS, 'sub'), { recursive: true });
fs.writeFileSync(path.join(WS, 'sub', 'deep.txt'), 'DEEP-OK\n');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const read = (p, opts = {}) => executeCapabilityKeyless('file_read', `read the file ${p}`, { workspaceRoot: WS, ...opts });

/* ═══════════════ D1 — FILESYSTEM CONFINEMENT ═══════════════ */

test('D1: a workspace file is read normally', async () => {
  const r = await read(path.join(WS, 'inside.txt'));
  assert.equal(r.ok, true);
  assert.match(r.output, /INSIDE-OK-CANARY/);
});

test('D1: a RELATIVE workspace path resolves inside the workspace', async () => {
  const r = await read('sub/deep.txt');
  assert.equal(r.ok, true);
  assert.match(r.output, /DEEP-OK/);
});

test('D1: an ABSOLUTE path outside the workspace is refused, no bytes returned', async () => {
  const r = await read(path.join(tmp, 'outside.txt'));
  assert.equal(r.ok, false);
  assert.equal(r.output, '', 'a denied read must not return file contents');
  assert.doesNotMatch(r.output, /OUTSIDE-SECRET-CANARY/);
  assert.match(String(r.observation), /refused/i);
});

test('D1: a `../` traversal is refused', async () => {
  const r = await read(path.join(WS, '..', 'outside.txt'));
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.output, /OUTSIDE-SECRET-CANARY/);
});

test('D1: a SIBLING tree (ws vs wsx) is refused — the string-prefix bug class', async () => {
  const r = await read(path.join(tmp, 'wsx', 'sibling.txt'));
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.output, /SIBLING-SECRET/);
});

test('D1: a symlink that steps outside the workspace is refused', async () => {
  const r = await read(path.join(WS, 'link-out.txt'));
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.output, /OUTSIDE-SECRET-CANARY/);
  assert.match(String(r.observation), /symlink|refused/i);
});

test('D1: an absolute system path is refused (never reads /etc/passwd)', async () => {
  const r = await read('/etc/passwd');
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.output, /root:x:0:0/);
});

test('D1: the denial is a truthful tool_use event, not a fabricated success', async () => {
  const events = [];
  await read(path.join(tmp, 'outside.txt'), { sendEvent: (type, data) => events.push({ type, data }) });
  const rows = events.filter((e) => e.type === 'tool_use');
  assert.equal(rows.length, 1, 'exactly one transcript row per read attempt');
  assert.equal(rows[0].data.slug, 'file-read');
  assert.equal(rows[0].data.status, 'error', 'a denied read reports error, never success');
  assert.doesNotMatch(String(rows[0].data.detail), /OUTSIDE-SECRET-CANARY/);
});

test('D1: an allowed read emits a success tool_use event', async () => {
  const events = [];
  await read(path.join(WS, 'inside.txt'), { sendEvent: (type, data) => events.push({ type, data }) });
  const row = events.find((e) => e.type === 'tool_use');
  assert.ok(row, 'a transcript row is emitted');
  assert.equal(row.data.status, 'success');
  assert.equal(row.data.slug, 'file-read');
});

test('D1: the coding-lane editor refuses a workspace symlink that escapes', async () => {
  // StrReplaceEditor confines to WORKSPACE_DIR. The module is already loaded
  // (config resolved at import), so exercise it against the real workspace:
  // stage a folder with a symlink pointing OUT, prove it is refused, clean up.
  const { WORKSPACE_DIR } = await import('../../src/config.js');
  const { view } = await import('../../src/services/StrReplaceEditor.js');
  const dir = path.join(WORKSPACE_DIR, 'm6-confinement-probe');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'inside.txt'), 'OK\n');
    fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(dir, 'link-out.txt'), 'file');
    assert.equal(view('m6-confinement-probe/link-out.txt').ok, false, 'a symlink out of the workspace is refused');
    assert.equal(view('../../etc/passwd').ok, false, 'a traversal is refused');
    assert.equal(view('m6-confinement-probe/inside.txt').ok, true, 'a real workspace file still opens');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ═══════════════ D2 — EXECUTION-RESULT INTEGRITY ═══════════════ */

const ev = (type, data = {}, extra = {}) => ({ type, data, ts: '2026-01-01T00:00:00.000Z', ...extra });

test('D2: a FAILED command is recorded as a real run, not "not executed"', () => {
  const rec = deriveExecutionRecord([
    ev('COMMAND_STARTED', { toolId: 't1', command: 'node fail.js' }),
    ev('COMMAND_FAILED', { toolId: 't1', command: 'node fail.js', exitCode: 3 }),
  ]);
  assert.equal(rec.ran, true);
  assert.equal(rec.commands.length, 1);
  assert.equal(rec.commands[0].outcome, OUTCOMES.FAILED_NONZERO);
  assert.equal(rec.commands[0].exitCode, 3);
  const lines = executionRecordLines(rec);
  assert.ok(lines.some((l) => /exit 3/.test(l) && /failed_nonzero/.test(l)), 'the failed run is named');
  assert.ok(!lines.some((l) => /executed this task: NONE/.test(l)), 'never claims NONE when a command ran');
});

test('D2: a successful command is recorded as succeeded', () => {
  const rec = deriveExecutionRecord([ev('COMMAND_COMPLETED', { command: 'node ok.js', exitCode: 0 })]);
  assert.equal(rec.counts[OUTCOMES.SUCCEEDED], 1);
  assert.equal(rec.ran, true);
});

test('D2: a truly empty record says NONE (no false positive)', () => {
  const rec = deriveExecutionRecord([]);
  assert.equal(rec.ran, false);
  assert.ok(executionRecordLines(rec).some((l) => /executed this task: NONE/.test(l)));
});

test('D2: a blocked command is distinguished from a run', () => {
  const rec = deriveExecutionRecord([ev('PERMISSION_DENIED', { command: 'rm -rf /', reason: 'not allowed' })]);
  assert.equal(rec.ran, false);
  assert.equal(rec.blockedCount, 1);
  const lines = executionRecordLines(rec);
  assert.ok(lines.some((l) => /BLOCKED|blocked/i.test(l)));
});

test('D2: a timed-out command is a run that timed out', () => {
  const rec = deriveExecutionRecord([ev('COMMAND_FAILED', { command: 'sleep 999', timedOut: true, ms: 30000 })]);
  assert.equal(rec.counts[OUTCOMES.TIMED_OUT], 1);
  assert.equal(rec.ran, true);
});

test('D2: a started-but-unfinished command is reported as still running', () => {
  const rec = deriveExecutionRecord([ev('COMMAND_STARTED', { toolId: 't9', command: 'node slow.js' })]);
  assert.equal(rec.startedOnly.length, 1);
  assert.equal(rec.counts[OUTCOMES.RUNNING], 1);
});

test('D2: the REPORT PROMPT carries the failed run (the exact defect)', async () => {
  let captured = null;
  const director = new Director({ llm: { report: async ({ user }) => { captured = user; return 'ok'; } }, tools: {}, departments: {} });
  const task = {
    rawQuery: 'run fail.js', objective: 'Run fail.js and report the exit code.',
    assumptions: [], successCriteria: ['fail.js executed'], recoveries: [],
    plan: { subtasks: [{ id: 'st1' }] },
    events: [
      ev('COMMAND_STARTED', { command: 'node fail.js' }),
      ev('COMMAND_FAILED', { command: 'node fail.js', exitCode: 3 }),
    ],
  };
  await director.composeReport({ task, refinement: { formatHint: 'work-report' }, leadResult: { content: 'deliverable' }, results: new Map(), verification: null, teamRecap: [], emit: () => {} });
  assert.ok(captured, 'the report writer was called');
  assert.match(captured, /node fail\.js/);
  assert.match(captured, /exit 3/);
  assert.doesNotMatch(captured, /executed this task: NONE/, 'the report must not be told nothing ran');
});

test('D2: the report prompt still says NONE when nothing ran', async () => {
  let captured = null;
  const director = new Director({ llm: { report: async ({ user }) => { captured = user; return 'ok'; } }, tools: {}, departments: {} });
  const task = { rawQuery: 'x', objective: 'x', assumptions: [], successCriteria: [], recoveries: [], plan: { subtasks: [] }, events: [] };
  await director.composeReport({ task, refinement: {}, leadResult: { content: 'd' }, results: new Map(), verification: null, teamRecap: [], emit: () => {} });
  assert.match(captured, /executed this task: NONE/);
});

test('D2: the backstop appends the record when a report denies execution that happened', async () => {
  const director = new Director({
    llm: { report: async () => 'I wrote the script for you. It wasn\u2019t executed this turn \u2014 here is the code.' },
    tools: {}, departments: {},
  });
  const task = {
    rawQuery: 'run fail.js', objective: 'Run fail.js.', assumptions: [], successCriteria: [], recoveries: [],
    plan: { subtasks: [] }, events: [ev('COMMAND_FAILED', { command: 'node fail.js', exitCode: 3 })],
  };
  const out = await director.composeReport({ task, refinement: {}, leadResult: { content: 'd' }, results: new Map(), verification: null, teamRecap: [], emit: () => {} });
  assert.match(out, /Execution record \(from the run log\)/);
  assert.match(out, /node fail\.js/);
  assert.match(out, /exit 3/);
});

test('D2: the backstop leaves an honest report untouched', async () => {
  const director = new Director({
    llm: { report: async () => 'I ran `node fail.js` and it exited 3. The fix is below.' },
    tools: {}, departments: {},
  });
  const task = {
    rawQuery: 'run fail.js', objective: 'Run fail.js.', assumptions: [], successCriteria: [], recoveries: [],
    plan: { subtasks: [] }, events: [ev('COMMAND_FAILED', { command: 'node fail.js', exitCode: 3 })],
  };
  const out = await director.composeReport({ task, refinement: {}, leadResult: { content: 'd' }, results: new Map(), verification: null, teamRecap: [], emit: () => {} });
  assert.doesNotMatch(out, /Execution record \(from the run log\)/);
});

/* ═══════════════ D3 — VERIFICATION CORRECTNESS ═══════════════ */

test('D3: exactByteCountIn only fires on an explicit exactness cue', () => {
  assert.equal(exactByteCountIn('exact.txt contains exactly 5 bytes'), 5);
  assert.equal(exactByteCountIn('the file is precisely 12 bytes'), 12);
  assert.equal(exactByteCountIn('the report has 50 lines'), null);
  assert.equal(exactByteCountIn('write a file of 5 bytes'), null);
});

test('D3: a byte-count contradiction is derived from the record', () => {
  const task = { events: [ev('FILE_CREATED', { file: 'exact.txt', bytes: 6 })] };
  const problems = evidenceContradictions('I created exact.txt', task, ['exact.txt contains exactly 5 bytes']);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /exactly 5 bytes/);
  assert.match(problems[0], /6 bytes/);
});

test('D3: a matching byte count produces no contradiction', () => {
  const task = { events: [ev('FILE_CREATED', { file: 'exact.txt', bytes: 5 })] };
  assert.deepEqual(evidenceContradictions('done', task, ['exact.txt contains exactly 5 bytes']), []);
});

test('D3: no record → no deterministic verdict (the rubric still decides)', () => {
  assert.deepEqual(evidenceContradictions('done', { events: [] }, ['exact.txt contains exactly 5 bytes']), []);
});

test('D3: verifyDeliverable FAILS a 6-byte write against a 5-byte criterion even when the rubric passes', async () => {
  const task = {
    id: 'TASK-M6-D3', objective: 'Create exact.txt with exactly 5 bytes.',
    events: [ev('FILE_CREATED', { file: 'exact.txt', bytes: 6 })],
  };
  const passLlm = async () => JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'looks fine' });
  const v = await verifyDeliverable({
    task, deliverable: 'I created exact.txt as requested. It contains HELLO.',
    criteria: ['exact.txt contains exactly 5 bytes (HELLO with no trailing newline)'],
    verifierEmployee: getEmployee('vera'), llm: passLlm, mailbox: new TaskMailbox('TASK-M6-D3'), hooks: { onEvent: () => {} },
  });
  assert.equal(v.verdict, 'fail', 'a deterministic contradiction cannot be overridden by the rubric');
  assert.ok(v.problems.some((p) => /exactly 5 bytes/.test(p)));
});

test('D3: verifyDeliverable PASSES when the record matches the criterion', async () => {
  const task = {
    id: 'TASK-M6-D3b', objective: 'Create exact.txt with exactly 5 bytes.',
    events: [ev('FILE_CREATED', { file: 'exact.txt', bytes: 5 })],
  };
  const passLlm = async () => JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'ok' });
  const v = await verifyDeliverable({
    task, deliverable: 'exact.txt written with the text HELLO and no trailing newline — 5 bytes exactly.',
    criteria: ['exact.txt contains exactly 5 bytes'],
    verifierEmployee: getEmployee('vera'), llm: passLlm, mailbox: new TaskMailbox('TASK-M6-D3b'), hooks: { onEvent: () => {} },
  });
  assert.equal(v.verdict, 'pass');
});

test('D3: the rubric prompt now carries the recorded byte count', async () => {
  const task = { id: 'TASK-M6-D3c', objective: 'o', events: [ev('FILE_CREATED', { file: 'exact.txt', bytes: 6 })] };
  let seen = null;
  const llm = async (a) => { seen = a.user; return JSON.stringify({ pass: true, score: 0.9, problems: [], rationale: 'ok' }); };
  await verifyDeliverable({
    task, deliverable: 'some substantive work product, long enough to clear the length gate comfortably.',
    criteria: ['the artifact exists'], verifierEmployee: getEmployee('vera'), llm, mailbox: new TaskMailbox('TASK-M6-D3c'), hooks: { onEvent: () => {} },
  });
  assert.match(String(seen), /exact\.txt \[6 bytes\]/);
});
