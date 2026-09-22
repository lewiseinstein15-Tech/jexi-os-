// computer/errors.js
// Phase 29 — shared error type for the computer agent module.
//
// Every failure surfaced by computer/** is a ComputerError carrying a
// stable machine-readable `code` (E_*). Codes are declared per scope and
// never invented at call sites ad hoc. No other error class may cross the
// computer/** boundary.

export class ComputerError extends Error {
  /**
   * @param {string} code    stable E_* identifier, e.g. 'E_UNKNOWN_ACTION'
   * @param {string} message human-readable description
   * @param {object} [details] structured context (arg names, input echo, ...)
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'ComputerError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function isComputerError(e) {
  return e instanceof ComputerError;
}
