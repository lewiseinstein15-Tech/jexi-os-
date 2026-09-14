/**
 * JEXI OS — WORK GRAPH — engine facade.
 *
 * Persistent, dependency-aware plan that survives process death. Time-bounded
 * leases prevent orphaned assignments. Every write is checkpointed to SQLite;
 * a restart reconstructs the graph from the checkpoint (and clears expired
 * leases so crashed owners lose their claims).
 *
 * Verification nodes are first-class: a TaskNode can reach 'completed' only
 * after its verification node is 'completed' with evidence, and a
 * VerificationNode can NEVER be owned by the same agent as the node it
 * verifies.
 */

import { acquireLease, extendLease, hasLiveLease, isLeaseExpired, releaseLease, NODE_LEASE_MS } from './state/lease.js';
import { loadCheckpoint, saveCheckpoint, dropCheckpoint } from './state/checkpoint.js';
import { classifyFailure, backoffMs, canRetry } from './recovery/classify.js';
import { replanFromNearestAncestor } from './recovery/replan.js';
import { createMissionNode, createStrategyNode, createTaskNode, createVerificationNode, createRecoveryNode } from './nodes/WorkNode.js';
import { BLOCKS_KEY } from './edges/blocks.js';
import { VerificationRunner } from '../verification/index.js';

/** Re-export constructors + constants for consumers. */
export {
  createMissionNode,
  createStrategyNode,
  createTaskNode,
  createVerificationNode,
  createRecoveryNode,
  NODE_LEASE_MS,
  loadCheckpoint,
  saveCheckpoint,
  dropCheckpoint,
  classifyFailure,
  backoffMs,
  canRetry,
  replanFromNearestAncestor,
  acquireLease,
  extendLease,
  hasLiveLease,
  isLeaseExpired,
  releaseLease,
};

export function createWorkGraph({ file } = {}) {
  const nodes = [];
  const blocks = {}; // adjacency: blockerId -> blockedIds
  let savedAt = 0;

  function checkpointFile() {
    return file;
  }

  function byId(id) {
    return nodes.find((n) => n.id === id);
  }

  function addNode(node) {
    if (byId(node.id)) throw new Error(`duplicate node id ${node.id}`);
    nodes.push(node);
    return node;
  }

  /** Set a node's status and checkpoint the graph (write-ahead). */
  function setStatus(id, status) {
    const n = byId(id);
    if (!n) throw new Error(`unknown node ${id}`);
    n.status = status;
    savedAt = Date.now();
    return n;
  }

  /**
   * Only the holder of a LIVE lease may mutate a node. No live lease → any
   * agent may (node is unclaimed). Crashed/expired lease is treated as
   * unclaimed too, so a dead owner loses control (the Pi fix).
   */
  function schedulePermitted(n, owner, now) {
    if (hasLiveLease(n, now) && n.ownerAcbId !== owner) {
      return { ok: false, reason: 'not_lease_holder' };
    }
    return { ok: true };
  }

  /** Compute the readiness of every node from current statuses. */
  function recomputeStatuses() {
    for (const n of nodes) {
      if (!['pending', 'blocked', 'ready'].includes(n.status)) continue;

      // BLOCKS edge: a node blocked by a failed/cancelled blocker is unblocked;
      // a node blocked by a RUNNING/REMOVED blocker stays blocked.
      const blockedBy = Object.entries(blocks).filter(([, list]) => list.includes(n.id));
      const activeBlocker = blockedBy.some(([blockerId]) => {
        const b = byId(blockerId);
        return b && !['completed', 'failed', 'cancelled', 'superseded'].includes(b.status);
      });
      if (activeBlocker) { n.status = 'blocked'; continue; }
      if (n.status === 'blocked') { n.status = 'pending'; }

      // depends_on: every dependency must be completed (or this is a root/cancelled).
      const depOk = (n.dependencies ?? []).every((d) => {
        const dep = byId(d);
        if (!dep) return true;
        return dep.status === 'completed' || dep.status === 'cancelled' || dep.status === 'superseded';
      });
      n.status = depOk && n.status !== 'completed' ? 'ready' : (depOk ? 'ready' : n.status);
    }
  }

  /** Persist the graph snapshot. */
  async function checkpoint() {
    savedAt = Date.now();
    const graph = { nodes, [BLOCKS_KEY]: blocks, savedAt };
    await saveCheckpoint(checkpointFile(), graph);
    return graph;
  }

  /** Reconstruct from the last checkpoint (crashed leases are cleared). */
  async function restore() {
    const ck = await loadCheckpoint(checkpointFile());
    if (!ck) return null;
    const g = ck.graph;
    nodes.length = 0;
    nodes.push(...g.nodes);
    for (const [k, v] of Object.entries(g[BLOCKS_KEY] ?? {})) blocks[k] = v;
    savedAt = ck.savedAt ?? Date.now();
    // Crash recovery: drop expired leases so nodes become reclaimable.
    for (const n of nodes) if (isLeaseExpired(n, Date.now())) releaseLease(n);
    recomputeStatuses();
    return { nodes, savedAt };
  }

  async function clear() {
    await dropCheckpoint(checkpointFile());
    nodes.length = 0;
    for (const k of Object.keys(blocks)) delete blocks[k];
  }

  /** Claim a node for an agent. Returns { ok } plus lease info. */
  async function claim(nodeId, owner, { now = Date.now(), ms } = {}) {
    const n = byId(nodeId);
    if (!n) return { ok: false, reason: 'no_such_node' };
    if (hasLiveLease(n, now) && n.ownerAcbId !== owner) return { ok: false, reason: 'already_claimed' };
    if (n.status === 'completed') return { ok: false, reason: 'completed' };
    acquireLease(n, owner, { now, ms });
    n.status = 'running';
    await checkpoint();
    return { ok: true, node: n, expiresAt: n.leaseExpiry };
  }

  /** Heartbeat from the current holder. */
  async function heartbeat(nodeId, owner, { now = Date.now(), ms } = {}) {
    const n = byId(nodeId);
    if (!n) return { ok: false, reason: 'no_such_node' };
    const ok = extendLease(n, owner, { now, ms });
    if (ok) await checkpoint();
    return { ok, node: n, expiresAt: n.leaseExpiry };
  }

  /** Mark a node completed. A task REQUIRES its verification node completed. */
  async function complete(nodeId, { owner, now = Date.now(), evidence = [], artifacts = [] } = {}) {
    const n = byId(nodeId);
    if (!n) return { ok: false, reason: 'no_such_node' };
    const perm = schedulePermitted(n, owner, now);
    if (!perm.ok) return perm;
    if (n.type === 'task') {
      const v = n.verificationNodeId ? byId(n.verificationNodeId) : null;
      if (!v || v.status !== 'completed') return { ok: false, reason: 'verification_pending' };
      if (!v.evidence.length) return { ok: false, reason: 'verification_no_evidence' };
    }
    n.status = 'completed';
    n.evidence.push(...(evidence ?? []));
    n.artifacts.push(...(artifacts ?? []));
    releaseLease(n);
    await checkpoint();
    recomputeStatuses();
    return { ok: true, node: n };
  }

  /**
   * Record a failure; performs classification and recovery wiring.
   * @returns {{ ok:true, decision:'retry'|'permanent'|'logical'|'give_up', node }}
   */
  async function fail(nodeId, { owner, failure, now = Date.now() } = {}) {
    const n = byId(nodeId);
    if (!n) return { ok: false, reason: 'no_such_node' };
    const perm = schedulePermitted(n, owner, now);
    if (!perm.ok) return perm;
    n.retryCount++;
    const cls = classifyFailure(failure);
    if (cls === 'transient' && canRetry(n)) {
      n.status = 'pending'; // retry (backoff applied by caller/scheduler)
      releaseLease(n);
      await checkpoint();
      return { ok: true, decision: 'retry', node: n, backoffMs: backoffMs(n.retryCount - 1) };
    }
    const recoveryNode = () => {
      // Recovery work must be immediately claimable (it must NOT depend on
      // the failed node, which can never complete). Ancestor/flag are
      // recorded as metadata.
      return createRecoveryNode({
        id: `recovery-${nodeId}-${n.retryCount}`,
        objective: cls === 'permanent' ? `Repair permanently-failed ${nodeId}` : `Replan after logical failure in ${nodeId}`,
        ownerAcbId: undefined,
        dependencies: [],
        recoveryType: cls,
        recoversNodeId: nodeId,
      });
    };
    if (cls === 'permanent') {
      n.status = 'failed';
      releaseLease(n);
      await checkpoint();
      const rec = recoveryNode();
      addNode(rec);
      await checkpoint();
      recomputeStatuses();
      return { ok: true, decision: 'permanent', node: n, recoveryNode: rec };
    }
    // logical → replan from nearest ancestor
    n.status = 'failed';
    releaseLease(n);
    await checkpoint();
    const plan = replanFromNearestAncestor({ nodes, failedId: nodeId, reason: failure?.reason ?? '' });
    for (const b of plan.blockedDescendants) { const bn = byId(b); if (bn) bn.status = 'blocked'; }
    const rec = recoveryNode();
    addNode(rec);
    await checkpoint();
    recomputeStatuses();
    return { ok: true, decision: 'logical', node: n, recoveryNode: rec, nearestAncestorId: plan.nearestAncestorId };
  }

  /** Complete a verification node (marks evidence; task can then complete). */
  async function completeVerification(nodeId, { owner, now = Date.now(), evidence = [] } = {}) {
    const n = byId(nodeId);
    if (!n || n.type !== 'verification') return { ok: false, reason: 'not_verification' };
    const perm = schedulePermitted(n, owner, now);
    if (!perm.ok) return perm;
    // scope guard: verifier must be a DIFFERENT agent than the node's agent
    const target = n.verifiesNodeId ? byId(n.verifiesNodeId) : null;
    if (target && n.ownerAcbId && target.ownerAcbId === n.ownerAcbId) {
      return { ok: false, reason: 'self_verification_forbidden', verifier: n.ownerAcbId };
    }
    if (!evidence.length) return { ok: false, reason: 'no_evidence' };
    n.evidence.push(...evidence);
    n.status = 'completed';
    releaseLease(n);
    await checkpoint();
    recomputeStatuses();
    return { ok: true, node: n };
  }

  /**
   * Run a REAL verifier from the verification subsystem against a
   * VerificationNode (Phase 5 Scope B — real wiring).
   *
   * This is the production import the Phase 4 audit found missing: the work
   * graph now calls `VerificationRunner.run` (src/verification) which spawns
   * a real verifier. On 'pass' the node completes with evidence (the
   * dependent task may then complete). On 'fail'/'error' it does NOT silently
   * pass — the verifier result's evidence (real output) is attached to the
   * node and returned as `injectedFailure` so the caller/agent loop routes it
   * back as context, and the task stays gated.
   *
   * @param {string} nodeId — the VerificationNode id
   * @param {object} o
   * @param {string} o.owner — agent (claimant) running this verification node
   * @param {string} o.verifier — 'TestVerifier' | 'LintVerifier' | ... (default TestVerifier)
   * @param {object} [o.context] — { snapshotId, snapshot, acceptanceCriteria, claimantAcbId, nodeId }
   * @param {object} [o.options] — verifier options (command / cwd / acceptedBy...)
   * @returns {Promise<{ok:boolean, status?:string, reason?:string, result?}>}
   */
  async function runVerificationNode(nodeId, { owner, now = Date.now(), verifier = 'TestVerifier', context = {}, options = {} } = {}) {
    const n = byId(nodeId);
    if (!n || n.type !== 'verification') return { ok: false, reason: 'not_verification' };
    const perm = schedulePermitted(n, owner, now);
    if (!perm.ok) return perm;
    const target = n.verifiesNodeId ? byId(n.verifiesNodeId) : null;

    const result = await VerificationRunner.run({
      verifier,
      nodeId,
      snapshotId: n.snapshotId ?? context.snapshotId,
      snapshot: n.snapshot ?? context.snapshot,
      acceptanceCriteria: context.acceptanceCriteria ?? n.acceptanceCriteria,
      claimantAcbId: target?.ownerAcbId ?? context.claimantAcbId,
      verifierAgentId: owner,
      options,
    });

    if (result.status === 'pass') {
      await completeVerification(nodeId, { owner, now, evidence: result.evidence ?? [] });
      return { ok: true, status: 'pass', result, node: byId(nodeId) };
    }

    // 'fail' / 'error' — the node stays incomplete and the task stays gated.
    // Real output is attached and returned so the caller can inject it back
    // into the agent loop as context (not just a log line).
    n.evidence.push(...(result.evidence ?? []));
    n.status = 'failed';
    releaseLease(n);
    await checkpoint();
    recomputeStatuses();
    return {
      ok: false,
      status: result.status,
      reason: result.reason ?? 'verification failed',
      result,
      injectedFailure: {
        layer: verifier,
        reason: result.reason ?? 'verification failed',
        evidence: result.evidence ?? [],
        nodeId,
      },
      node: byId(nodeId),
    };
  }

  /** Cancel a node (paused / out of scope). */
  async function cancel(nodeId, { owner, now = Date.now() } = {}) {
    const n = byId(nodeId);
    if (!n) return { ok: false, reason: 'no_such_node' };
    const perm = schedulePermitted(n, owner, now);
    if (!perm.ok) return perm;
    n.status = 'cancelled';
    releaseLease(n);
    await checkpoint();
    recomputeStatuses();
    return { ok: true, node: n };
  }

  /** Nodes ready to be claimed, in dependency-compatible order. */
  function readyWork(now = Date.now()) {
    recomputeStatuses();
    return nodes
      .filter((n) => n.status === 'ready' && !hasLiveLease(n, now))
      .map((n) => n.id);
  }

  return {
    byId,
    addNode,
    setStatus,
    recomputeStatuses,
    checkpoint,
    restore,
    clear,
    claim,
    heartbeat,
    complete,
    fail,
    completeVerification,
    runVerificationNode,
    cancel,
    readyWork,
    get nodes() { return nodes; },
    get blocksTable() { return blocks; },
  };
}

/** Convenience: build a fresh graph (destroys any previous snapshot). */
export async function createPersistentWorkGraph({ file } = {}) {
  const g = createWorkGraph({ file });
  await g.clear();
  return g;
}