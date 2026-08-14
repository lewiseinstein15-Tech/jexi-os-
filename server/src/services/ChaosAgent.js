/**
 * JEXI OS — Chaos Agent (feature-flagged, test-only).
 *
 * Injects controlled failures (provider timeouts, tool errors, memory
 * pressure) during test runs to harden the Orchestrator and Verification
 * Loop. Everything is gated behind JEXI_CHAOS=1 (or an explicit opts flag) —
 * in normal operation this agent is inert and injects nothing. Every
 * injection is recorded so test runs can assert what was hardened.
 */

const ENABLED = process.env.JEXI_CHAOS === '1' || process.env.JEXI_CHAOS === 'true';
const injections = [];

/** Is chaos injection active right now? */
export function chaosEnabled() {
  return ENABLED;
}

/**
 * Inject a controlled failure. Kinds: 'provider-timeout', 'tool-error',
 * 'memory-pressure'. Returns the injected fault; records it for assertions.
 * When disabled, returns { enabled: false } and injects nothing.
 */
export function injectFailure(kind = 'provider-timeout', opts = {}) {
  if (!ENABLED && !opts.force) {
    return { enabled: false, note: 'chaos is off — set JEXI_CHAOS=1 to enable injection (test-only)' };
  }
  const record = {
    kind: String(kind),
    at: new Date().toISOString(),
    target: String(opts.target || 'orchestrator'),
    delayMs: Number(opts.delayMs) || 0,
  };
  injections.push(record);
  return { enabled: true, injected: record };
}

/** Planned failures the Orchestrator should simulate (drained once). */
export function drainInjections() {
  const batch = injections.splice(0, injections.length);
  return batch;
}

/** All injections recorded so far (test assertion aid). */
export function listInjections() {
  return injections.map((i) => ({ ...i }));
}

/** Reset chaos state (test helper). */
export function resetChaos() {
  injections.length = 0;
}

/** Simulated provider health view for chaos runs (never touches real keys). */
export function chaosHealthOverride(snapshot = []) {
  if (!ENABLED) return snapshot;
  const faults = injections.filter((i) => i.kind === 'provider-timeout');
  if (!faults.length) return snapshot;
  // Mark the first provider as failing while chaos has provider-timeout faults.
  const copy = (Array.isArray(snapshot) ? snapshot : []).map((r, idx) =>
    idx === 0 ? { ...r, ok: false, inCooldown: true } : r
  );
  return copy;
}
