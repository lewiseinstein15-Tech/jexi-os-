/** JEXI OS — Phase 30 Scope A — 30-hook catalog public surface. */
import { list, get, count, validate, mapped, stubs } from './registry.js';

export const hooks = Object.freeze({ list, get, count, validate, mapped, stubs });

export default hooks;
export { list, get, count, validate, mapped, stubs };
export { HOOK_CATALOG, HOOK_EVENT_COUNT } from './catalog.js';
export { HOOK_LIFECYCLES, HOOK_RETURNS, NOOP_CONTRACT, validateHookSpec } from './contract.js';
