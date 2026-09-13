/**
 * JEXI OS — WORK GRAPH — time-bounded leases.
 *
 * Pi failure-mode fix: an agent that is SIGKILLed mid-task must not own the
 * node forever. An agent claims a node → gets a lease with an expiration
 * (default 5 minutes, configurable per node type). The holder extends via
 * heartbeat. When a lease expires the node becomes reclaimable by another
 * agent.
 *
 * Leases are pure — all deadlines use `now` injected by the caller so the
 * tests are deterministic.
 */

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

/** Lease durations per node type (ms). */
export const NODE_LEASE_MS = Object.freeze({
  mission: 30 * 60 * 1000,
  strategy: 15 * 60 * 1000,
  task: DEFAULT_LEASE_MS,
  verification: DEFAULT_LEASE_MS,
  recovery: DEFAULT_LEASE_MS,
});

/**
 * Claim a node: sets owner + leaseExpiry. Returns true on success.
 * @param {import('../nodes/WorkNode.js').WorkNode} node
 */
export function acquireLease(node, owner, { now = Date.now(), ms = NODE_LEASE_MS[node.type] ?? DEFAULT_LEASE_MS } = {}) {
  node.ownerAcbId = owner;
  node.leaseExpiry = now + ms;
  return true;
}

/**
 * Heartbeat from the current holder: extend the lease.
 * Fails (returns false) if someone else already holds a live lease.
 */
export function extendLease(node, owner, { now = Date.now(), ms = NODE_LEASE_MS[node.type] ?? DEFAULT_LEASE_MS } = {}) {
  if (node.leaseExpiry != null && node.leaseExpiry > now && node.ownerAcbId !== owner) return false;
  node.ownerAcbId = owner;
  node.leaseExpiry = now + ms;
  return true;
}

/** Is this node currently claimed by a live (unexpired) lease? */
export function hasLiveLease(node, now = Date.now()) {
  return node.leaseExpiry != null && node.leaseExpiry > now;
}

/** Has the lease expired (crash / timeout)? Then the node is reclaimable. */
export function isLeaseExpired(node, now = Date.now()) {
  return node.leaseExpiry != null && node.leaseExpiry <= now;
}

/** Release the claim (done / cancelled / explicit). */
export function releaseLease(node) {
  node.leaseExpiry = undefined;
  node.ownerAcbId = undefined;
  return node;
}