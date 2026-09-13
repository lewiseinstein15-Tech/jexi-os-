/**
 * JEXI OS — WORK GRAPH — TaskNode.
 *
 * A unit of executable work. Cannot reach 'completed' without its paired
 * VerificationNode returning 'completed' with evidence (enforced by the
 * graph in index.js).
 */

/** @returns {import('./WorkNode.js').WorkNode} */
export function createTaskNode({ id, objective, dependencies = [], ownerAcbId }) {
  return {
    id,
    type: 'task',
    objective,
    ownerAcbId,
    status: 'pending',
    dependencies,
    evidence: [],
    artifacts: [],
    checkpoint: undefined,
    retryCount: 0,
    leaseExpiry: undefined,
    /** id of the verification node that MUST gate this task */
    verificationNodeId: undefined,
  };
}