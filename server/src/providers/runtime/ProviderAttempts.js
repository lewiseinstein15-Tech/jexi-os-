/**
 * JEXI OS — Provider attempt telemetry (M17 / D2).
 *
 * M16's benchmark was not reproducible: the same dataset and the same model
 * produced 8/15, 2/15, 1/15, 9/15, 0/6 across five runs, and the failure
 * signature (tasks that "emitted no tool call and looped until timeout" at a
 * different position each run) pointed at a silent provider substitution.
 * `LLMClient` has a keyless network ladder (Kilo / Pollinations) that engages
 * when the primary provider fails — and the manifest only recorded a coworker
 * NICKNAME, so a mid-run slide was invisible.
 *
 * This module is the missing audit trail: every provider dial records
 * {provider, model, ok, ms, reason}. The benchmark resets it at the start of
 * each task and snapshots it at the end, so the manifest shows exactly which
 * provider served each task — and a run that quietly slid off the locked
 * provider is visible instead of inferred.
 */

const MAX_ATTEMPTS = 200;
const attempts = [];

/** Record one provider dial. Never throws — telemetry must not break a call. */
export function recordAttempt(entry) {
  try {
    if (attempts.length >= MAX_ATTEMPTS) attempts.shift();
    attempts.push({ at: Date.now(), ...entry });
  } catch { /* never break the caller */ }
}

/** Every recorded attempt, oldest first. */
export function providerAttempts() {
  return attempts.map((a) => ({ ...a }));
}

/** Distinct providers that actually returned a result. */
export function providersThatServed() {
  return [...new Set(attempts.filter((a) => a.ok).map((a) => a.provider))];
}

/** Clear the log — call before each benchmark task. */
export function resetProviderAttempts() {
  attempts.length = 0;
}
