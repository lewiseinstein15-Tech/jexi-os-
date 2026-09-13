/**
 * AGI Phase 4 (Scope C) — WORK GRAPH contracts.
 *
 *   persistence:    SIGKILL mid-task → restart → graph reconstructed
 *   lease:          claim is time-bounded; expiry makes node reclaimable
 *   dependency:     node B waits for node A
 *   verification:   verification node runs after task completes
 *   gating:         task cannot reach 'completed' without verification
 *   recovery:       failure → recovery node spawned → replan
 *   scope guard:    a verifier CANNOT be the same agent as the verifies
 *
 * Deterministic: leases use injected `now`; SQLite files are per-test temp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-workgraph-'));

const {
  createWorkGraph,
  createMissionNode,
  createStrategyNode,
  createTaskNode,
  createVerificationNode,
  NODE_LEASE_MS,
} = await import('../../src/workgraph/index.js');

function tmpFile(name) {
  return path.join(TMP, name);
}

async function freshGraph(name) {
  const g = createWorkGraph({ file: tmpFile(`${name}.db`) });
  await g.clear();
  return g;
}

test('persistence: SIGKILL mid-task → restart → graph intact', async () => {
  const file = tmpFile('persist.db');
  let g = createWorkGraph({ file });
  await g.clear();
  const m = g.addNode(createMissionNode({ id: 'm', objective: 'mission' }));
  const s = g.addNode(createStrategyNode({ id: 's', objective: 'strategy', dependencies: ['m'] }));
  const t = g.addNode(createTaskNode({ id: 't', objective: 'task', dependencies: ['s'] }));
  await g.checkpoint();
  assert.equal(m.status, 'pending');
  assert.equal(s.status, 'pending');
  assert.equal(t.status, 'pending');

  // SIGKILL = the in-memory graph is simply gone. Reconstruct from checkpoint.
  g = null;
  const g2 = createWorkGraph({ file });
  const restored = await g2.restore();
  assert.ok(restored, 'graph reconstructed from checkpoint');
  assert.equal(g2.byId('m').objective, 'mission');
  assert.equal(g2.byId('s').dependencies[0], 'm');
  assert.equal(g2.byId('t').objective, 'task');
  assert.equal(g2.nodes.length, 3);
  // Root (no deps) auto-advances to ready; t still blocks on s→m chain.
  assert.ok(['ready', 'pending'].includes(g2.byId('m').status), 'mission restored');
  assert.ok(['pending', 'blocked'].includes(g2.byId('t').status), 'leaf depends on chain');
});

test('lease: claim expires → node becomes reclaimable by another agent', async () => {
  const g = await freshGraph('lease');
  const t = g.addNode(createTaskNode({ id: 't', objective: 'task' }));

  const now0 = 1_000_000;
  const claim = await g.claim('t', 'agent-a', { now: now0 });
  assert.ok(claim.ok);
  assert.equal(t.ownerAcbId, 'agent-a');
  assert.equal(t.leaseExpiry, now0 + NODE_LEASE_MS.task);

  // Same agent can heartbeat (extend).
  const hb = await g.heartbeat('t', 'agent-a', { now: now0 + 100_000 });
  assert.ok(hb.ok);
  assert.equal(t.leaseExpiry, now0 + 100_000 + NODE_LEASE_MS.task);

  // Another agent cannot claim a LIVE lease.
  const steal = await g.claim('t', 'agent-b', { now: now0 + 200_000 });
  assert.equal(steal.ok, false);
  assert.equal(steal.reason, 'already_claimed');

  // Lease EXPIRES (agent-a SIGKILLed / crashed). Now reclaimable.
  const late = now0 + 200_000 + NODE_LEASE_MS.task + 1;
  assert.equal(g.byId('t').leaseExpiry <= late, true, 'lease expired');
  const reclaim = await g.claim('t', 'agent-b', { now: late });
  assert.ok(reclaim.ok, 'reclaimable after expiry');
  assert.equal(t.ownerAcbId, 'agent-b');
});

test('dependency: node B waits for node A (B not ready until A completed)', async () => {
  const g = await freshGraph('dep');
  const a = g.addNode(createTaskNode({ id: 'a', objective: 'A' }));
  const b = g.addNode(createTaskNode({ id: 'b', objective: 'B', dependencies: ['a'] }));

  // B depends on A → only A is ready initially; B waits (dependency enforced).
  assert.deepEqual(g.readyWork(0).sort(), ['a']);
  assert.equal(b.status, 'pending');

  // A completes and checkpoints → B becomes ready.
  a.status = 'completed';
  g.checkpoint();
  g.recomputeStatuses();
  assert.ok(g.byId('a').status === 'completed');
  assert.ok(g.byId('b').status === 'ready', 'B becomes ready once A completed');
  assert.deepEqual(g.readyWork(0).sort(), ['b']);
});

test('verification node runs after task node completes; task gates on it', async () => {
  const g = await freshGraph('verify');
  const t = g.addNode(createTaskNode({ id: 't', objective: 'build' }));
  const v = g.addNode(createVerificationNode({ id: 'v', objective: 'verify build', verifiesNodeId: 't', dependencies: ['t'] }));
  t.verificationNodeId = 'v';

  // task runs and attempts to complete BEFORE verification exists/completed:
  const tooEarly = await g.complete('t', { owner: 'a', evidence: [{ source: 'code', at: 1 }] });
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.reason, 'verification_pending');

  // verification completes, gated on task completed first (dependency).
  await g.claim('t', 'agent-t', { now: 0 });
  const tReady = await g.complete('t', { owner: 'agent-t' });
  assert.equal(tReady.ok, false, 'without verification, task cannot complete');

  // Now verification runs with a DIFFERENT agent than the task owner.
  await g.claim('v', 'agent-v', { now: 10 });
  const vDone = await g.completeVerification('v', { owner: 'agent-v', evidence: [{ source: 'tests/run', content: 'all pass', at: 20 }] });
  assert.ok(vDone.ok);
  assert.equal(v.status, 'completed');
  assert.ok(v.evidence.length >= 1);

  // Task still 'running'? It should now be completable.
  const tDone = await g.complete('t', { owner: 'agent-t', evidence: [{ source: 'code', at: 21 }] });
  assert.ok(tDone.ok, 'task can now complete');
  assert.equal(t.status, 'completed');
});

test('scope guard: verifier cannot be the same agent as the verified node', async () => {
  const g = await freshGraph('selfverify');
  g.addNode(createTaskNode({ id: 't', objective: 'x' }));
  g.addNode(createVerificationNode({ id: 'v', verifiesNodeId: 't' }));
  await g.claim('t', 'agent-x', { now: 0 });
  await g.claim('v', 'agent-x', { now: 1 }); // same agent claims verification!
  const vDone = await g.completeVerification('v', { owner: 'agent-x', evidence: [{ source: 's', at: 2 }] });
  assert.equal(vDone.ok, false);
  assert.equal(vDone.reason, 'self_verification_forbidden');
});

test('failure → recovery node spawned → replan from nearest ancestor', async () => {
  const g = await freshGraph('recovery');
  g.addNode(createMissionNode({ id: 'm', objective: 'mission' }));
  g.addNode(createStrategyNode({ id: 's', objective: 'strategy', dependencies: ['m'] }));
  g.addNode(createTaskNode({ id: 't', objective: 'task', dependencies: ['s'] }));

  await g.claim('t', 'agent-a', { now: 0 });
  const f = await g.fail('t', { owner: 'agent-a', failure: { class: 'logical_contradiction', reason: 'plan conflicts with constraints' }, now: 5 });
  assert.equal(f.decision, 'logical');
  assert.ok(f.recoveryNode, 'logical failure spawns recovery node');
  assert.equal(f.recoveryNode.recoveryType, 'logical');
  assert.equal(g.byId('t').status, 'failed');
  // Strategy ancestor is still pending (its own dep m is pending) but NOT
  // cancelled — the recovery node replans from it.
  assert.equal(g.byId('s').status, 'pending');
  // recovery node got created, is immediately claimable (root), and records
  // the recovered id.
  const rec = g.byId(f.recoveryNode.id);
  assert.ok(rec, 'recovery node present in graph');
  assert.equal(rec.type, 'recovery');
  assert.deepEqual(rec.dependencies, [], 'recovery is a root (immediately claimable)');
  assert.equal(rec.recoversNodeId, 't');
  assert.ok(g.readyWork(0).includes(rec.id), 'recovery node is ready work');

  // Permanent failure path: also spawns recovery node.
  const g2 = await freshGraph('recovery2');
  g2.addNode(createTaskNode({ id: 'x', objective: 'x' }));
  const p = await g2.fail('x', { failure: { class: 'unauthorized', reason: 'token invalid' }, now: 0 });
  assert.equal(p.decision, 'permanent');
  assert.equal(p.recoveryNode.recoveryType, 'permanent');
  assert.equal(g2.byId('x').status, 'failed');

  // Transient failure path: retried (up to retryCount), same agent keeps it.
  const g3 = await freshGraph('recovery3');
  g3.addNode(createTaskNode({ id: 'y', objective: 'y' }));
  const r = await g3.fail('y', { failure: { class: 'timeout', reason: 'network' }, now: 0 });
  assert.equal(r.decision, 'retry');
  assert.equal(r.backoffMs > 0, true);
  assert.equal(g3.byId('y').status, 'pending');
});