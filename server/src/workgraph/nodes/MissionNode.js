/**
 * JEXI OS — WORK GRAPH — MissionNode.
 *
 * Root of the graph: the mission itself. One per work graph.
 */

/** @typedef {import('./WorkNode.js').WorkNode} WorkNode */

/**
 * Create a mission node.
 * @param {object} args
 * @param {string} args.id
 * @param {string} args.objective
 * @returns {WorkNode}
 */
export function createMissionNode({ id, objective }) {
  return {
    id,
    type: 'mission',
    objective,
    ownerAcbId: undefined,
    status: 'pending',
    dependencies: [],
    evidence: [],
    artifacts: [],
    checkpoint: undefined,
    retryCount: 0,
    leaseExpiry: undefined,
  };
}