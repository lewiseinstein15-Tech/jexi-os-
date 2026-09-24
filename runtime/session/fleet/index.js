/**
 * JEXI OS — Phase 27 Scope A — detached session fleet (public surface).
 *
 *   const fleet = createFleet({ dir });
 *   fleet.spawn(cmd, { cwd, env, id }) -> { sessionId, pid }
 *   fleet.list()                       -> [{ sessionId, pid, state, startedAt }]
 *   fleet.logs(sessionId, { follow })  -> file-backed stream (follows appends)
 *   fleet.kill(sessionId)              -> { killed, state }
 *   fleet.attach(sessionId)            -> session handle
 *   fleet.reap()                       -> [{ sessionId, from, to }]
 *
 * On-disk layout under `dir`:
 *   roster/<sessionId>.json   — the roster (survives restart; source of truth)
 *   logs/<sessionId>.log      — session stdout+stderr (real file-backed log)
 *
 * Default dir: $JEXI_FLEET_DIR or <tmpdir>/jexi-fleet.
 *
 * States: running -> exited | failed | killed | stale (terminal, one-way).
 *   exited/failed: observed natural exit (code 0 / non-zero)
 *   killed       : kill() requested on this manager (wins over natural exit)
 *   stale        : process vanished without an observed exit outcome
 *
 * Errors: E_UNKNOWN_SESSION, E_INVALID_TRANSITION, E_INVALID_SESSION_ID,
 *         E_SESSION_EXISTS, E_INVALID_CMD, E_SPAWN_FAILED, E_LOG_UNAVAILABLE.
 */
import os from 'node:os';
import path from 'node:path';
import { Fleet } from './lifecycle.js';

export function createFleet({ dir } = {}) {
  const root = dir || process.env.JEXI_FLEET_DIR || path.join(os.tmpdir(), 'jexi-fleet');
  return new Fleet(root);
}

export { Fleet } from './lifecycle.js';
export { Roster } from './roster.js';
export { StateStore, TERMINAL_STATES, isTerminal } from './state.js';
export { FleetError } from './_internal.js';
