/**
 * JEXI OS — WORK GRAPH — StrategyNode.
 *
 * A plan/approach for a chunk of the mission. Depends on mission node.
 */

/** @returns {import('./WorkNode.js').WorkNode} */
export function createStrategyNode({ id, objective, dependencies = [] }) {
  return {
    id,
    type: 'strategy',
    objective,
    ownerAcbId: undefined,
    status: 'pending',
    dependencies,
    evidence: [],
    artifacts: [],
    checkpoint: undefined,
    retryCount: 0,
    leaseExpiry: undefined,
  };
}