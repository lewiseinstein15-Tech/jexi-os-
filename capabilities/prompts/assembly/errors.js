// prompt/assembly/errors.js
// Typed errors for the prompt assembly layer (Phase 25).
//
// Every refusal carries a stable machine-readable `code` so callers
// (registry, boundary, probes, tests) branch on behavior, never on
// message text. This module is the single error vocabulary for the
// prompt/** zone; later scopes (B: E_STATIC_AFTER_DYNAMIC, ...) add
// their codes at their call sites but throw through this class.

export class PromptError extends Error {
  /**
   * @param {string} code    - stable error code, e.g. 'E_DUPLICATE_SECTION'
   * @param {string} message - human-readable explanation
   * @param {object} [details] - structured context (ids/orders only, never content)
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PromptError';
    this.code = code;
    this.details = details;
  }
}

/** True when `err` is a PromptError and (optionally) carries `code`. */
export function isPromptError(err, code) {
  return err instanceof PromptError && (code === undefined || err.code === code);
}
