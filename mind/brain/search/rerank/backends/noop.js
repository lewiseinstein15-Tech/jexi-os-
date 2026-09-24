/**
 * JEXI OS — Phase 28 Scope E — default no-op reranker.
 * Always available, makes no call, mutates nothing, preserves input order.
 */
export const NAME = 'noop';

export const noop = Object.freeze({
  name: NAME,
  available: () => true,
  rank: async (_query, results) => results,
});

export default noop;
