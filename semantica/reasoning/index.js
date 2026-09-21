/**
 * JEXI OS — Phase 14 Scope E — reasoning entry point.
 *
 *   import { reasoning } from './semantica/reasoning/index.js';
 *   reasoning.causal(graph, from, { depth })
 *   reasoning.temporal(graph, { before, after, window })
 *   reasoning.infer(graph, rules)
 */
import { causal } from './causal.js';
import { temporal } from './temporal.js';
import { infer } from './reasoner.js';

export const reasoning = { causal, temporal, infer };
export { causal, temporal, infer };
export { SemanticaError } from '../_internal.js';
