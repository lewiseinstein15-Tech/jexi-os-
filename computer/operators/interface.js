// computer/operators/interface.js
// Phase 29 Scope B — the Operator contract (TARS Operator interface port).
//
// An Operator is the ONLY way the GUI agent loop (Scope F) touches the
// world. Two methods + two declarations:
//
//   operator.name                -> string
//   operator.capabilities        -> { screenshot, mouse, keyboard, mobile, desktop }
//   operator.screenshot()        -> { image, width, height, dpi }
//   operator.execute(action)     -> { ok: true, result } |
//                                  { ok: false, error: { code, message } }
//   operator.assert()            -> throws ComputerError('E_OPERATOR_INCOMPLETE')
//
// Declared error semantics:
// - Environment failures at runtime (no display, no browser, ...) are
//   RETURNED as { ok: false, error } — the loop records them as one failed
//   step and continues. They are never thrown, never faked as success.
// - Misuse (malformed action input, unknown operator name, incomplete
//   operator object) THROWS ComputerError — programmer error, fail fast.
//
// capabilities are static DECLARATIONS of what the backend is designed to
// do (e.g. the desktop operator declares mouse/keyboard/screenshot because
// nut-js does, when a display exists). Availability (display present,
// permissions granted) is checked at call time and surfaced as errors —
// never by lying in capabilities.

import { ComputerError } from '../errors.js';

export const OPERATOR_CODES = Object.freeze([
  'E_UNKNOWN_OPERATOR',          // registry.get/select with an unregistered name
  'E_OPERATOR_INCOMPLETE',       // assert(): object does not satisfy the contract
  'E_NO_DISPLAY',                // desktop operator without a display server
  'E_DESKTOP_BACKEND_UNAVAILABLE', // display present but no backend attached
  'E_INVALID_ARGUMENT',          // malformed action input to execute()
]);

export const OPERATOR_CAPABILITY_KEYS = Object.freeze([
  'screenshot',
  'mouse',
  'keyboard',
  'mobile',
  'desktop',
]);

/** Structural check: does this object satisfy the Operator contract? */
export function assertOperator(op) {
  const fail = (field) => {
    throw new ComputerError('E_OPERATOR_INCOMPLETE', `operator does not satisfy the contract: ${field}`, {
      field,
      got: op && typeof op === 'object' ? Object.keys(op) : typeof op,
    });
  };
  if (!op || typeof op !== 'object') fail('not an object');
  if (typeof op.name !== 'string' || op.name.length === 0) fail('name');
  if (!op.capabilities || typeof op.capabilities !== 'object') fail('capabilities');
  for (const key of OPERATOR_CAPABILITY_KEYS) {
    if (typeof op.capabilities[key] !== 'boolean') fail(`capabilities.${key}`);
  }
  if (typeof op.screenshot !== 'function') fail('screenshot()');
  if (typeof op.execute !== 'function') fail('execute()');
  if (typeof op.assert !== 'function') fail('assert()');
  return true;
}
