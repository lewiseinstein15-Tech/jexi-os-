// computer/loop/state.js
// Phase 29 Scope F — GUI agent session state: status machine + pause gate.
//
// Status machine (declared):
//   idle --> running --> done
//             |
//             +--> paused --> running (resume) ... --> done
//
// Transition surface:
//   begin()          idle|done -> running    (a second concurrent run is
//                     misuse -> E_INVALID_ARGUMENT; a stale pause request
//                     left over from a finished run is dropped here)
//   markDone()       -> done                  (loop-internal; reached via the
//                     run() finally block on EVERY exit path — finished,
//                     max-loops, error — so state never lies)
//   requestPause()   user-side: arms the pause flag. Only meaningful while
//                     a run is active; refused truthfully otherwise. The
//                     flag is honored at the NEXT loop-top, BEFORE the next
//                     capture — an interrupted step has already completed
//                     and been recorded, so it is never re-run.
//   arrivePaused()   loop-side: running -> paused; opens the gate and
//                     blocks the loop until resume().
//   resume()         user-side: paused -> running, releases the gate; the
//                     loop continues with the NEXT step. Called before the
//                     loop has honored the pending request, it CANCELS the
//                     request instead (declared: no stuck states).
//
// Determinism: no clock, no randomness — every transition is explicit and
// total. Misuse is ComputerError('E_INVALID_ARGUMENT'). This module holds
// no environmental truth; it only gates the loop.

import { ComputerError } from '../errors.js';

export const AGENT_STATUSES = Object.freeze(['idle', 'running', 'paused', 'done']);

export function createAgentState() {
  let status = 'idle';
  let pauseRequested = false;
  let releaseGate = null; // resolver of the currently open pause gate

  return {
    /** Current status: 'idle' | 'running' | 'paused' | 'done'. */
    status() {
      return status;
    },

    /** Full internal snapshot (declared debug surface). */
    snapshot() {
      return { status, pauseRequested };
    },

    /** Loop-side: enter 'running'. Concurrent-run misuse throws. */
    begin() {
      if (status === 'running' || status === 'paused') {
        throw new ComputerError(
          'E_INVALID_ARGUMENT',
          `gui agent: a run is already ${status} — one active run per agent instance`,
          { status }
        );
      }
      pauseRequested = false; // stale request from a finished run is dropped (declared)
      status = 'running';
      return status;
    },

    /** Loop-side: leave the loop on any exit path. */
    markDone() {
      releaseGate = null;
      pauseRequested = false;
      status = 'done';
      return status;
    },

    /** Loop-side: is a pause pending at this loop-top? */
    pauseRequested() {
      return pauseRequested;
    },

    /** Loop-side: honor the pause — open the gate and block until resume(). */
    arrivePaused() {
      status = 'paused';
      return new Promise((resolve) => {
        releaseGate = () => {
          releaseGate = null;
          resolve();
        };
      });
    },

    /** User-side: request a pause at the next loop-top (before next capture). */
    requestPause() {
      if (status !== 'running') {
        return { requested: false, status, reason: `not running (status: ${status})` };
      }
      pauseRequested = true;
      return { requested: true, status };
    },

    /**
     * User-side: resume a paused run. The gate is released and the loop
     * continues with the next step (the interrupted step is NOT re-run).
     * If the pause request has not been honored yet, it is cancelled
     * instead (declared).
     */
    resume() {
      if (status === 'paused' && releaseGate) {
        status = 'running';
        pauseRequested = false;
        const gate = releaseGate;
        gate();
        return { resumed: true, status: 'running' };
      }
      if (status === 'running' && pauseRequested) {
        pauseRequested = false;
        return { resumed: true, status: 'running', cancelledPauseRequest: true };
      }
      return { resumed: false, status };
    },
  };
}
