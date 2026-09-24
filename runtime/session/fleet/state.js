/**
 * JEXI OS — Phase 27 Scope A — terminal-state store.
 *
 * Legal transitions (exactly one direction, no exits from terminal states):
 *
 *   running -> exited | failed | killed | stale
 *
 *   exited : process observed exit with code 0
 *   failed : process observed exit with non-zero code
 *   killed : kill() was requested on this manager before the exit event
 *            (killed takes precedence over a natural exit result)
 *   stale  : the process disappeared without an observed exit outcome
 *            (vanished / destroyed by a signal we did not request)
 *
 * Any backward or sideways transition (e.g. exited -> running, killed ->
 * stale) -> E_INVALID_TRANSITION. Re-observing an unchanged terminal state
 * is an idempotent no-op (changed: false). Unknown session ->
 * E_UNKNOWN_SESSION.
 */
import { FleetError, readJson, writeJsonAtomic, path } from './_internal.js';

export const TERMINAL_STATES = ['exited', 'failed', 'killed', 'stale'].sort();
export const RUNNING = 'running';

export function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

export class StateStore {
  /**
   * @param {string} rosterDir directory holding `<sessionId>.json` files
   */
  constructor(rosterDir) {
    this.rosterDir = rosterDir;
  }

  load(sessionId) {
    const record = readJson(path.join(this.rosterDir, `${sessionId}.json`));
    if (!record) {
      throw new FleetError('E_UNKNOWN_SESSION', `unknown session "${sessionId}"`);
    }
    return record;
  }

  /**
   * Attempt a state transition and persist it. Returns
   * `{ sessionId, from, to, changed, record }`.
   */
  transition(sessionId, to, details = {}) {
    if (!TERMINAL_STATES.includes(to)) {
      throw new FleetError('E_INVALID_TRANSITION', `illegal target state "${String(to)}"; terminal states: ${TERMINAL_STATES.join(', ')}`);
    }
    const record = this.load(sessionId);
    const from = record.state;
    if (from === to) {
      return { sessionId, from, to, changed: false, record };
    }
    if (from !== RUNNING) {
      throw new FleetError('E_INVALID_TRANSITION', `illegal transition ${from} -> ${to} for session "${sessionId}" (terminal state "${from}" has no outgoing transitions)`);
    }
    const next = {
      ...record,
      state: to,
      exitCode: details.exitCode ?? null,
      signal: details.signal ?? null,
      endedAt: details.endedAt ?? new Date().toISOString(),
    };
    writeJsonAtomic(path.join(this.rosterDir, `${sessionId}.json`), next);
    return { sessionId, from, to, changed: true, record: next };
  }
}
