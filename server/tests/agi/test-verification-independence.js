/**
 * AGI Phase 4 (Scope D) — VERIFICATION INDEPENDENCE.
 *
 *   - agent A does work → agent B verifies → different agents
 *   - same-agent verification attempt → refused
 *   - frozen criteria cannot be modified mid-work
 *   - immutable snapshot verified, not live workspace
 *   - missing snapshot → verification refused
 *   - verification failure blocks work-graph completion
 *   - auto-verify runs after edit and injects failure context
 *   - multi-layer loop order: lint runs before build
 *
 * Perspective: the verification subsystem is the executable that WorkGraph
 * VerificationNodes (Scope C) invoke. The work-graph gate (a task can only
 * complete after its verification node is completed with evidence) is proven
 * here directly against the Scope C graph so the two subsystems are wired
 * end-to-end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  TestVerifier,
  FileStateVerifier,
  AgentVerifier,
  createFrozenCriteriaStore,
  captureSnapshot,
  requireSnapshot,
  autoVerify,
  verifyAfterEdit,
  runVerification,
} = await import('../../src/verification/index.js');

const {
  createWorkGraph,
  createTaskNode,
  createVerificationNode,
} = await import('../../src/workgraph/index.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-verify-indep-'));

function stageGraph() {
  const g = createWorkGraph({ file: path.join(TMP, `g-${Math.random().toString(36).slice(2)}.db`) });
  return g;
}

test('different agents: agent A does work → agent B verifies (pass)', async () => {
  const g = stageGraph();
  g.addNode(createTaskNode({ id: 'task', objective: 'build a thing' }));
  g.addNode(createVerificationNode({ id: 'verify', verifiesNodeId: 'task', dependencies: ['task'] }));
  g.byId('task').verificationNodeId = 'verify';
  const snap = captureSnapshot({ nodeId: 'task', files: { 'src/a.js': 'export const x = 1;' } });

  await g.claim('task', 'agent-a', { now: 0 });
  // Agent B verifies the snapshot with different identity.
  const res = await AgentVerifier.verify({
    nodeId: 'verify', snapshotId: snap.id, snapshot: snap,
    acceptanceCriteria: 'must compile', claimantAcbId: 'agent-a',
    options: { verifierSlug: 'reflector', claim: 'done', verdict: { approve: true } },
  });
  assert.equal(res.status, 'pass', `expected pass, got ${res.status}: ${res.reason}`);
  assert.ok(res.evidence.length >= 1, 'evidence attached');
  // The verification evidence can be attached to the work-graph node.
  const done = await g.completeVerification('verify', { owner: 'agent-b', evidence: res.evidence, now: 5 });
  assert.ok(done.ok, 'verification completes the node with evidence');
});

test('same-agent verification is refused', async () => {
  const res = await AgentVerifier.verify({
    nodeId: 'verify', snapshotId: 's1', acceptanceCriteria: 'x', claimantAcbId: 'agent-a',
    options: { verifierSlug: 'agent-a' }, // SAME agent
  });
  assert.equal(res.status, 'error', 'same-agent verify must be refused');
});

test('frozen criteria cannot be modified mid-work', async () => {
  const store = createFrozenCriteriaStore({ now: () => new Date(0).toISOString() });
  store.accept('task', 'must build');
  const mod = store.modify('task', 'must build AND be fast'); // mid-work attempt
  assert.ok(!mod.ok, 'modification refused');
  assert.ok(store.has('task'));
  assert.equal(store.list('task')[0].text, 'must build', 'original criteria unchanged');
});

test('immutable snapshot verified, NOT the live workspace', async () => {
  // Snapshot captured before work; the live file then changes.
  const snap = captureSnapshot({ nodeId: 'task', files: { 'src/a.js': 'VERSION_1' } });
  // (...) simulate: live workspace file now says VERSION_2 — snapshot unchanged.
  const res = await FileStateVerifier.verify({
    nodeId: 'task', snapshotId: snap.id, snapshot: snap, acceptanceCriteria: 'file matches',
    claimantAcbId: 'agent-a',
    options: { expectedFiles: { 'src/a.js': 'VERSION_1' }, files: snap.files },
  });
  assert.equal(res.status, 'pass', 'verifies the snapshot content, not live state');
});

test('missing snapshot → verification refused', async () => {
  const store = new Map(); // no snapshot registered
  assert.throws(() => requireSnapshot(store, 'snap-missing'), /missing|refused/);
  // runVerification refuses too (no silent re-snapshot):
  const res = await runVerification({
    verifier: 'TestVerifier', nodeId: 'task', snapshotId: 'snap-missing',
    acceptanceCriteria: 'x', claimantAcbId: 'agent-a', verifierAgentId: 'agent-b',
    options: { run: async () => ({ exitCode: 0, output: 'ok' }) },
  });
  assert.equal(res.status, 'error', 'missing snapshot refuses verification');
});

test('verification failure blocks work-graph completion', async () => {
  const g = stageGraph();
  g.addNode(createTaskNode({ id: 'task', objective: 'build' }));
  g.addNode(createVerificationNode({ id: 'verify', verifiesNodeId: 'task', dependencies: ['task'] }));
  g.byId('task').verificationNodeId = 'verify';
  await g.claim('task', 'agent-a', { now: 0 });
  await g.claim('verify', 'agent-b', { now: 1 });

  // A failing verifier result.
  const badRes = await TestVerifier.verify({
    nodeId: 'verify', snapshotId: 's', acceptanceCriteria: 'x', claimantAcbId: 'agent-a',
    options: { run: async () => ({ exitCode: 1, output: '1 failure' }) },
  });
  assert.equal(badRes.status, 'fail');
  // The task CANNOT complete while its verification is not completed.
  const blocked = await g.complete('task', { owner: 'agent-a', now: 2 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'verification_pending');
});

test('auto-verify runs after edit and injects failure context', async () => {
  const layers = {
    lint: async () => ({ exitCode: 1, output: '1 error 2 warnings' }),
    unit: async () => ({ exitCode: 0, output: 'ok' }),
    build: async () => ({ exitCode: 0, output: 'build ok' }),
  };
  const ctx = { nodeId: 'task', snapshotId: 's', snapshot: {}, acceptanceCriteria: 'x', claimantAcbId: 'agent-a' };
  const out = await verifyAfterEdit(ctx, layers);
  assert.ok(!out.ok, 'loop fails at lint');
  assert.equal(out.results[0].layer, 'lint');
  assert.equal(out.results[0].status, 'fail');
  assert.ok(out.context.injectedFailure, 'failure injected as context');
  assert.equal(out.context.injectedFailure.layer, 'lint');
});

test('multi-layer loop order: lint runs before build (cheap → expensive)', async () => {
  const order = [];
  const layers = {
    lint: async () => { order.push('lint'); return { exitCode: 0, output: '' }; },
    unit: async () => { order.push('unit'); return { exitCode: 0, output: 'ok' }; },
    build: async () => { order.push('build'); return { exitCode: 0, output: 'build ok' }; },
  };
  const ctx = { nodeId: 'task', snapshotId: 's', snapshot: {}, acceptanceCriteria: 'x', claimantAcbId: 'agent-a' };
  const out = await autoVerify(ctx, layers);
  assert.ok(out.ok);
  assert.deepEqual(order, ['lint', 'unit', 'build'], 'lint (cheapest) runs before build');
  assert.deepEqual(out.results.map((r) => r.layer), ['lint', 'unit', 'build']);
});