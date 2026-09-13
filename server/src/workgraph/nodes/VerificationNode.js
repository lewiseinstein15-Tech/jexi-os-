/**
 * JEXI OS — WORK GRAPH — VerificationNode.
 *
 * First-class node type. The work graph enforces that the owner of a
 * VerificationNode MUST be a DIFFERENT agent (ownerAcbId) than the node it
 * verifies — no self-verification. Only a completed VerificationNode with
 * evidence lets its TaskNode reach 'completed'.
 */

/** @returns {import('./WorkNode.js').WorkNode} */
export function createVerificationNode({ id, objective, dependencies = [], ownerAcbId, verifiesNodeId }) {
  return {
    id,
    type: 'verification',
    objective,
    ownerAcbId,
    status: 'pending',
    dependencies,
    evidence: [],
    artifacts: [],
    checkpoint: undefined,
    retryCount: 0,
    leaseExpiry: undefined,
    /** id of the node this verifies */
    verifiesNodeId,
  };
}