// computer/operators/fake.js
// Phase 29 Scope B — FAKE OPERATOR.
//
// ██████ TEST-ONLY — NOT A REAL OPERATOR ██████
//
// This backend simulates the Operator contract for probes and tests. It
// executes NOTHING in the world: it records the exact structured actions
// it receives and returns acknowledgements. Its screenshot is a synthetic
// marker buffer, never screen data. It exists so probes can assert exact
// call shapes without a display, browser, or device.
//
// Recording discipline (deterministic):
// - journal is append-only; entries are { seq, action } with seq starting
//   at 1 and incrementing per execute() — the seq is the journal identity,
//   everything else is a deep copy of the caller's action object.
// - no clock, no randomness: two fresh fake operators fed the same action
//   sequence produce byte-identical journals.
// - reset() clears the journal and rewinds seq to 0 (declared).

import { ComputerError } from '../errors.js';
import { assertOperator } from './interface.js';

const FAKE_SCREEN = Object.freeze({
  image: 'FAKE-SCREEN-MARKER-4x4-test-only-not-real-image-data',
  width: 4,
  height: 4,
  dpi: 96,
});

export function createFakeOperator() {
  const journal = [];
  let seq = 0;

  const op = {
    name: 'fake',
    testOnly: true, // machine-readable "NOT a real operator" marker
    capabilities: Object.freeze({
      screenshot: true, // synthetic marker only — see FAKE_SCREEN
      mouse: true,
      keyboard: true,
      mobile: false,
      desktop: false,
    }),

    screenshot() {
      return { ...FAKE_SCREEN, image: FAKE_SCREEN.image };
    },

    execute(action) {
      if (!action || typeof action !== 'object' || typeof action.action !== 'string') {
        throw new ComputerError('E_INVALID_ARGUMENT', 'execute expects a parsed action { action, args }', {
          got: action === null ? 'null' : typeof action,
        });
      }
      seq += 1;
      const entry = { seq, action: structuredClone(action) };
      journal.push(entry);
      return { ok: true, result: { recorded: seq, action: structuredClone(action) } };
    },

    /** Probe/test accessor: the recording journal (deep copy). */
    journalSnapshot() {
      return structuredClone(journal);
    },

    /** Probe/test: reset journal + seq (declared). */
    reset() {
      journal.length = 0;
      seq = 0;
      return op;
    },

    assert() {
      return assertOperator(op);
    },
  };
  return op;
}
