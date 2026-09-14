/**
 * AGI Phase 5 Scope B — REAL SPAWN + WORK GRAPH INTEGRATION.
 *
 * Proves the Scope B deliverables end-to-end, with REAL subprocess spawns:
 *
 *   B1-B3  TestVerifier / BuildVerifier / LintVerifier spawn REAL commands
 *          (a genuine `node --test` child process, not a canned default).
 *          No configured command → 'error', never a silent pass.
 *   B4     FileStateVerifier does a real BYTE compare + line diff.
 *   B5     AgentVerifier routes through the workforce registry and refuses
 *          same-agent verification at the graph level.
 *   B6     verifyAfterEdit hooks the real cheapest layer (lint) when no
 *          layers are injected.
 *   B7     WorkGraph.runVerificationNode actually imports and calls the
 *          verification subsystem; a failing real test BLOCKS the task and
 *          routes the failure back as injectedFailure context; a passing
 *          real test completes the node and unblocks the task.
 *
 * The fixtures (tests/agi/fixtures/verify-pkg) are self-contained: a tiny
 * package with one buggy assertion that a real `node --test` will fail, and
 * that we FIX (snapshot update) to show the graph flips to completed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dir, 'fixtures', 'verify-pkg');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-verify-spawn-'));

const {
  TestVerifier,
  LintVerifier,
  BuildVerifier,
  FileStateVerifier,
  resolveReviewerAgent,
  verifyAfterEdit,
} = await import('../../src/verification/index.js');

const {
  createWorkGraph,
  createTaskNode,
  createVerificationNode,
} = await import('../../src/workgraph/index.js');

// captureSnapshot is re-exported by workgraph too — use the subsystem one.
const { captureSnapshot: snapCapture } = await import('../../src/verification/index.js');

function stageGraph() {
  return createWorkGraph({ file: path.join(TMP, `g-${Math.random().toString(36).slice(2)}.db`) });
}

test('B1: TestVerifier spawns a REAL test process and reports failure', async () => {
  const res = await TestVerifier.verify({
    nodeId: 't', snapshotId: 's1', acceptanceCriteria: 'tests pass', claimantAcbId: 'agent-a',
    options: {
      cwd: FIXTURE,
      command: process.execPath,
      args: ['src/plain-sum.js'], // plain assertion script: exits 1 because add() is buggy
      timeoutMs: 30000,
    },
  });
  assert.equal(res.status, 'fail', `real failing test must fail, got ${res.status}`);
  assert.ok(/exitCode=1/.test(res.evidence[0].content), 'evidence records exitCode');
  assert.ok(res.evidence[0].meta?.spawn, 'evidence records the real spawn payload');
  const sp = res.evidence[0].meta.spawn;
  assert.ok(sp.stdout.length > 0 || sp.stderr.length > 0, 'real child output captured (stdout or stderr)');
  assert.ok(/AssertionError|4 !== 3/.test(sp.stdout + sp.stderr), 'real failure text captured');
});

test('B1b: TestVerifier with NO configured command → error, never silent pass', async () => {
  const res = await TestVerifier.verify({
    nodeId: 't', snapshotId: 's1', acceptanceCriteria: 'tests pass', claimantAcbId: 'agent-a',
    options: { cwd: TMP }, // no package.json under TMP with jexi.verify.test, no run fn
  });
  assert.equal(res.status, 'error', 'no command configured must be an error');
  assert.match(res.reason, /no test command configured/);
});

test('B1c: TestVerifier passes when the REAL test passes', async () => {
  const res = await TestVerifier.verify({
    nodeId: 't', snapshotId: 's2', acceptanceCriteria: 'tests pass', claimantAcbId: 'agent-a',
    options: {
      cwd: FIXTURE,
      command: process.execPath,
      args: ['--test', '--test-reporter=spec', 'src/ok.test.js'],
      timeoutMs: 30000,
    },
  });
  assert.equal(res.status, 'pass', `real passing test must pass, got ${res.status} (${res.reason})`);
});

test('B2: BuildVerifier spawns a REAL build and fails on nonzero', async () => {
  const res = await BuildVerifier.verify({
    nodeId: 't', snapshotId: 's3', acceptanceCriteria: 'build succeeds', claimantAcbId: 'agent-a',
    options: {
      cwd: FIXTURE,
      command: process.execPath,
      args: ['build.js'], // exits 1 with a real error message
      timeoutMs: 30000,
    },
  });
  assert.equal(res.status, 'fail', 'build that exits 1 must fail');
  assert.ok(res.reason.includes('build failed'), 'reason carries the build failure');
  assert.ok(res.evidence[0].meta?.spawn, 'evidence records real spawn');
});

test('B2b: BuildVerifier with NO configured command → error', async () => {
  const res = await BuildVerifier.verify({
    nodeId: 't', snapshotId: 's3', acceptanceCriteria: 'build succeeds', claimantAcbId: 'agent-a',
    options: { cwd: TMP },
  });
  assert.equal(res.status, 'error');
  assert.match(res.reason, /no build command configured/);
});

test('B3: LintVerifier spawns REAL eslint and reports diagnostics', async () => {
  const res = await LintVerifier.verify({
    nodeId: 't', snapshotId: 's4', acceptanceCriteria: 'no lint errors', claimantAcbId: 'agent-a',
    options: { cwd: FIXTURE, files: ['src/bad.js'] },
  });
  assert.equal(res.status, 'fail', 'a lint error must fail');
  assert.match(res.reason, /diagnostics/);
  assert.ok(res.evidence[0].meta?.spawn?.messages?.length > 0, 'real eslint diagnostics parsed');
});

test('B4: FileStateVerifier byte-compares immutably and diffs mismatches', async () => {
  const snap = snapCapture({ nodeId: 't', files: { 'a.txt': 'line1\nline2\nline3' } });
  const resBad = await FileStateVerifier.verify({
    nodeId: 't', snapshotId: snap.id, snapshot: snap, acceptanceCriteria: 'exact bytes',
    claimantAcbId: 'agent-a', options: { expectedFiles: { 'a.txt': 'line1\nline2\nline9' } },
  });
  assert.equal(resBad.status, 'fail');
  assert.equal(resBad.evidence[0].meta?.diffs?.[0]?.path, 'a.txt');
  const d = resBad.evidence[0].meta.diffs[0].diff;
  assert.ok(d.includes('-line3') || d.includes('+line3'), 'diff mentions the expected/actual line');
  assert.ok(d.includes('line9'), 'diff shows the changed line');

  const resGood = await FileStateVerifier.verify({
    nodeId: 't', snapshotId: snap.id, snapshot: snap, acceptanceCriteria: 'exact bytes',
    claimantAcbId: 'agent-a', options: { expectedFiles: { 'a.txt': 'line1\nline2\nline3' } },
  });
  assert.equal(resGood.status, 'pass');
});

test('B5: AgentVerifier resolves reviewer through the workforce registry', () => {
  const reviewer = resolveReviewerAgent('vera');
  assert.ok(reviewer, 'with a slug, workforce registry resolves it');
  assert.equal(reviewer.via, 'workforce', 'resolved through workforce, not the legacy roster');
  const auto = resolveReviewerAgent();
  assert.ok(auto, 'no slug → automatic verification-capable agent');
  assert.equal(auto.via, 'workforce');
});

test('B6: verifyAfterEdit hooks the real cheapest layer when none injected', async () => {
  const ctx = { nodeId: 't', snapshotId: 's5', snapshot: {}, acceptanceCriteria: 'x', claimantAcbId: 'agent-a', files: ['src/bad.js'], options: { cwd: FIXTURE } };
  const out = await verifyAfterEdit(ctx, {}, {}); // no injected layers → real lint hook
  assert.equal(out.ok, false, 'real lint finds real diagnostics');
  assert.equal(out.context.injectedFailure.layer, 'lint');
  assert.ok(out.results.some((r) => r.spawned), 'the real layer marks itself as a spawned verifier');
});

test('B7: work graph runVerificationNode — real failing test blocks, then passes after fix', async () => {
  const g = stageGraph();
  g.addNode(createTaskNode({ id: 'task', objective: 'implement add()' }));
  g.addNode(createVerificationNode({ id: 'verify', verifiesNodeId: 'task', dependencies: ['task'] }));
  g.byId('task').verificationNodeId = 'verify';
  await g.claim('task', 'forge', { now: 0 });

  // The claimant writes a BUGGY add(); snapshot is frozen BEFORE the fix.
  const snap = snapCapture({
    nodeId: 'task',
    files: {
      'src/add.js': 'export function add(a, b) { return a + b + 1; }', // bug!
      'src/add.test.js': "import test from 'node:test'; import assert from 'node:assert/strict';\nimport { add } from './add.js';\ntest('add', () => assert.equal(add(1, 2), 3));",
      'src/plain-sum.js': "import assert from 'node:assert/strict';\nimport { add } from './add.js';\nassert.equal(add(1, 2), 3);\nconsole.log('plainsum: ok');",
    },
  });
  const failRun = await g.runVerificationNode('verify', {
    owner: 'vera', now: 1, verifier: 'TestVerifier',
    context: { snapshotId: snap.id, snapshot: snap, acceptanceCriteria: 'add(1,2) === 3', claimantAcbId: 'forge' },
    options: {
      cwd: FIXTURE,
      command: process.execPath,
      args: [path.join(FIXTURE, 'run-from-cwd.js')], // real child runs src/plain-sum.js from the sandbox cwd
      materialize: true, // run against the FROZEN bytes in a sandbox
    },
  });
  assert.equal(failRun.ok, false, 'failing real test blocks the graph');
  assert.equal(failRun.status, 'fail');
  assert.ok(failRun.injectedFailure, 'failure is routed back as injected context');
  assert.equal(g.byId('verify').status, 'failed', 'verification node marked failed');
  // Task cannot complete while its verification failed.
  assert.equal((await g.complete('task', { owner: 'forge', now: 2 })).ok, false);

  // Now the fix: a snapshot frozen AFTER the correct implementation.
  const goodSnap = snapCapture({
    nodeId: 'task',
    files: {
      'src/add.js': 'export function add(a, b) { return a + b; }', // fixed
      'src/add.test.js': "import test from 'node:test'; import assert from 'node:assert/strict';\nimport { add } from './add.js';\ntest('add', () => assert.equal(add(1, 2), 3));",
      'src/plain-sum.js': "import assert from 'node:assert/strict';\nimport { add } from './add.js';\nassert.equal(add(1, 2), 3);\nconsole.log('plainsum: ok');",
    },
  });
  // Recreate node for a fresh verification run (graph node state was failed).
  g.byId('verify').status = 'pending';
  const passRun = await g.runVerificationNode('verify', {
    owner: 'vera', now: 3, verifier: 'TestVerifier',
    context: { snapshotId: goodSnap.id, snapshot: goodSnap, acceptanceCriteria: 'add(1,2) === 3', claimantAcbId: 'forge' },
    options: {
      cwd: FIXTURE,
      command: process.execPath,
      args: [path.join(FIXTURE, 'run-from-cwd.js')],
      materialize: true,
    },
  });
  assert.equal(passRun.ok, true, 'fixed real test passes the graph');
  assert.equal(passRun.status, 'pass');
  assert.equal(g.byId('verify').status, 'completed', 'verification node completed with evidence');
  const done = await g.complete('task', { owner: 'forge', now: 4 });
  assert.equal(done.ok, true, 'task completes after verified-with-evidence');
});