// computer/vlm/context.js
// Phase 29 Scope E — sliding-window conversation history.
//
// TARS keeps a sliding window of prior turns so multi-step grounding sees
// recent context without unbounded token growth. JEXI declares:
//
//   - Window holds at most maxTurns instruction/prediction pairs.
//     DEFAULT_MAX_TURNS = 10 (declared default; TARS-style small window —
//     large enough for multi-step tasks, small enough to bound tokens).
//   - Drops OLDEST first on overflow. Deterministic: same push sequence
//     -> same window, same audit, every time.
//   - Turns are deep-copied on the way in and on the way out (no aliasing;
//     Scope B journal discipline). A turn is exactly
//     { instruction: string, prediction: string }, both non-empty.
//   - Dropped turns are recorded in an audit log (reason
//     'window-overflow') so the loop and the probe can show exactly what
//     left the window.
//   - windowTurns(turns, maxTurns) is the pure form used to window an
//     explicitly injected history override (same validation, same rule).
//
// Errors (ComputerError codes):
//   E_INVALID_ARGUMENT — maxTurns not a positive integer; turn shape invalid;
//                        windowTurns given a non-array

import { ComputerError } from '../errors.js';

export const DEFAULT_MAX_TURNS = 10;

function validTurn(t) {
  return (
    !!t &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    typeof t.instruction === 'string' &&
    t.instruction.length > 0 &&
    typeof t.prediction === 'string' &&
    t.prediction.length > 0
  );
}

function copyTurn(t) {
  return { instruction: t.instruction, prediction: t.prediction };
}

function requireMaxTurns(maxTurns) {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `context: maxTurns must be a positive integer, got ${JSON.stringify(maxTurns)}`,
      { got: maxTurns }
    );
  }
  return maxTurns;
}

export function createHistory({ maxTurns = DEFAULT_MAX_TURNS } = {}) {
  requireMaxTurns(maxTurns);
  let kept = [];
  const dropped = [];

  return {
    maxTurns,
    push(turn) {
      if (!validTurn(turn)) {
        throw new ComputerError(
          'E_INVALID_ARGUMENT',
          'context: turn must be { instruction: string, prediction: string }, both non-empty',
          { got: turn === null || turn === undefined ? typeof turn : Object.keys(turn ?? {}).join(',') }
        );
      }
      kept.push(copyTurn(turn));
      const droppedNow = [];
      while (kept.length > maxTurns) {
        const evicted = kept.shift();
        dropped.push({ turn: evicted, reason: 'window-overflow' });
        droppedNow.push(evicted);
      }
      return { accepted: true, droppedNow };
    },
    turns() {
      return kept.map(copyTurn);
    },
    droppedTurns() {
      return dropped.map((d) => ({ turn: copyTurn(d.turn), reason: d.reason }));
    },
    size() {
      return kept.length;
    },
    reset() {
      const cleared = kept.length;
      kept = [];
      dropped.length = 0;
      return { cleared };
    },
  };
}

// Pure windowing for explicit history overrides: validate every turn, keep
// the last maxTurns, report the overflow. No shared references.
export function windowTurns(turns, maxTurns) {
  requireMaxTurns(maxTurns);
  if (!Array.isArray(turns)) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'context: history must be an array of turns', {
      got: typeof turns,
    });
  }
  for (const t of turns) {
    if (!validTurn(t)) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        'context: history turns must be { instruction: string, prediction: string }, both non-empty',
        {}
      );
    }
  }
  const cut = Math.max(0, turns.length - maxTurns);
  return {
    kept: turns.slice(cut).map(copyTurn),
    dropped: turns.slice(0, cut).map(copyTurn),
  };
}
