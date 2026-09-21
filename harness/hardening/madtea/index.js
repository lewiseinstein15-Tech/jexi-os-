/**
 * JEXI OS — Phase 23 Scope A — madtea: atomic finish for work branches.
 *
 *   import { finish, dryRun, runGates, resolveCredentials, createSecretGuard }
 *     from '../harness/hardening/madtea/index.js';
 *
 * One command finishes a work branch: commit -> push -> PR -> gates -> merge,
 * with credential injection (env or keyRef, never inline) and no token leaks
 * in any output. See atomic-finish.js for the sequence, sandbox policy and
 * result contract; gates.js for the gate runner; credentials.js for the
 * keyRef discipline and the leak guard.
 */

export { finish, dryRun, STEP_NAMES, NETWORK_STEPS } from './atomic-finish.js';
export { runGates, GATE_OUTPUT_MAX_BYTES } from './gates.js';
export {
  resolveCredentials,
  createSecretGuard,
  nullGuard,
  findInlineKeys,
  INLINE_KEY_FIELD_RE,
  ENV_REF_RE,
  KEYRING_REF_RE,
} from './credentials.js';
