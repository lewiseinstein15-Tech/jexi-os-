/**
 * JEXI OS — benchmarks/osworld/observation.js
 *
 * osw.observe(rawState) -> { screenshot, instruction, cwd, screenSize, appFocus }
 *
 * `rawState` is one VM-state capture as delivered by the runner side
 * (Phase 29 capture source in the real run; fixture JSON in the sandbox):
 *   { screenshot: string,                    // opaque capture reference
 *     instruction: string,                   // the task goal, echoed by the harness
 *     cwd?: string | null,                   // VM working directory (shell-visible)
 *     screenSize?: { width, height } | null, // VM screen resolution in px
 *     appFocus?: string | null }             // frontmost application
 *
 * Normalization contract (frozen):
 * - the output has EXACTLY the five OSWorld observation keys — screenshot,
 *   instruction, cwd, screenSize, appFocus — extra snapshot keys (window
 *   title, pid, wall-clock, ...) are dropped so downstream consumers see
 *   one shape;
 * - screenshot is an OPAQUE non-empty string: base64 PNG, a data URI, or a
 *   capture token — the Phase 29 capture source owns the format; this layer
 *   never inspects or transforms the payload;
 * - cwd and appFocus default to null (unknown is honest); when present they
 *   must be non-empty strings;
 * - screenSize defaults to null; when present it must carry positive
 *   integer width and height;
 * - instruction is required (the observation IS the instruction carrier);
 *   missing/blank -> E_INVALID_OBSERVATION.
 *
 * Misuse (non-object snapshot, missing screenshot/instruction, ill-typed
 * fields) throws E_INVALID_OBSERVATION rather than silently coercing.
 *
 * Deterministic: pure validation + shape projection, no wall-clock,
 * no randomness.
 */

function invalidObservation(reason) {
  const err = new Error(`E_INVALID_OBSERVATION — ${reason}`);
  err.code = 'E_INVALID_OBSERVATION';
  return err;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function observe(rawState) {
  if (!isPlainObject(rawState)) {
    throw invalidObservation('raw VM state must be an object { screenshot, instruction, cwd?, screenSize?, appFocus? }');
  }
  if (typeof rawState.screenshot !== 'string' || rawState.screenshot === '') {
    throw invalidObservation('screenshot must be a non-empty string (opaque capture reference: base64 PNG, data URI, or token)');
  }
  if (typeof rawState.instruction !== 'string' || rawState.instruction.trim() === '') {
    throw invalidObservation('instruction must be a non-empty string');
  }
  let cwd = rawState.cwd === undefined ? null : rawState.cwd;
  if (cwd !== null && (typeof cwd !== 'string' || cwd === '')) {
    throw invalidObservation('cwd must be a non-empty string or null');
  }
  let screenSize = rawState.screenSize === undefined ? null : rawState.screenSize;
  if (screenSize !== null) {
    if (!isPlainObject(screenSize)) {
      throw invalidObservation('screenSize must be null or an object { width, height }');
    }
    if (!Number.isInteger(screenSize.width) || screenSize.width <= 0) {
      throw invalidObservation('screenSize.width must be a positive integer');
    }
    if (!Number.isInteger(screenSize.height) || screenSize.height <= 0) {
      throw invalidObservation('screenSize.height must be a positive integer');
    }
  }
  let appFocus = rawState.appFocus === undefined ? null : rawState.appFocus;
  if (appFocus !== null && (typeof appFocus !== 'string' || appFocus === '')) {
    throw invalidObservation('appFocus must be a non-empty string or null');
  }
  return {
    screenshot: rawState.screenshot,
    instruction: rawState.instruction,
    cwd,
    screenSize,
    appFocus,
  };
}
