/**
 * JEXI OS — WORK GRAPH — RecoveryNode.
 *
 * Spawned on a permanent or logical failure. Carries `recoveryType`
 * (permanent/logical) and the id of the node it recovers (`recoversNodeId`).
 */

/** @returns {import('./WorkNode.js').WorkNode} */
export function createRecoveryNode({ id, objective, dependencies = [], ownerAcbId, recoveryType, recoversNodeId }) {
  return {
    id,
    type: 'recovery',
    objective,
    ownerAcbId,
    status: 'pending',
    dependencies,
    evidence: [],
    artifacts: [],
    checkpoint: undefined,
    retryCount: 0,
    leaseExpiry: undefined,
    recoveryType,
    recoversNodeId,
  };
}