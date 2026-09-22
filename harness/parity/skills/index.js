/** JEXI OS — Phase 30 Scope B — public skill tool-scoping surface. */
import { parse, matches, allowed } from './scoping.js';
import { assert, auditPhase12 } from './enforcement.js';

export const scoping = Object.freeze({ parse, matches, allowed });
export const enforcement = Object.freeze({ assert, auditPhase12 });
export const skills = Object.freeze({ scoping, enforcement });

export default skills;
export { parse, matches, allowed, assert, auditPhase12 };
