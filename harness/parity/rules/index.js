/** JEXI OS — Phase 30 Scope D — public path-scoped rules surface. */
import { load, scope, match, validate } from './rules.js';
import { inject } from './injection.js';

export const rules = Object.freeze({ load, scope, match, inject, validate });

export default rules;
export { load, scope, match, inject, validate };
export { globMatch, globRegex } from './scope.js';
export { DEFAULT_TOKEN_BUDGET, estimateTokens } from './rules.js';
