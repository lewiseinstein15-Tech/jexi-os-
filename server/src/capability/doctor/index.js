/**
 * JEXI OS — PHASE 31 SCOPE 5 — W29 doctor barrel: the server-side capability
 * doctor consumer. Exposes the Ralph pre-flight checks (preflight.js) in the
 * shipped Phase 11 doctor's output shape. The shipped repo-root doctor
 * (capability/doctor/index.js) stays READ-ONLY and keeps its own scope; the
 * two compose at the consumer level, never by editing one to match the other.
 */

export { runPreflight, default } from './preflight.js';
