/** JEXI OS — Phase 28 Scope I — dream-cycle public surface. */
export { default } from './cycle.js';
export {
  createDreamCycle, createCycle, cycle, PHASES, DECLARED_PHASE_ORDER,
  DETERMINISTIC_PHASES, LLM_BACKED_PHASES,
} from './cycle.js';
export { DEFAULT_PHASE_BUDGETS, createBudgetCaps, checkPhaseBudget } from './budget.js';
export {
  CONSOLIDATION_THRESHOLD, MIN_CLUSTER_SIZE, cosineSimilarity, clusterFacts,
} from './phases/consolidate.js';
