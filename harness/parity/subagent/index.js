/** JEXI OS — Phase 30 Scope C — public extended subagent surface. */
import { extendSpec, validate } from './contract.js';
import { enforce } from './enforcement.js';

export const subagent = Object.freeze({ extendSpec, validate, enforce });

export default subagent;
export { extendSpec, validate, enforce };
export { DEFAULTS, PERMISSION_MODES, ISOLATION_MODES, MEMORY_MODES } from './contract.js';
