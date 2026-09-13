/**
 * JEXI OS — WORK GRAPH — failure classification.
 *
 * transient  → retry with backoff, up to a retryCount limit
 * permanent  → mark failed, spawn a RecoveryNode
 * logical    → mark failed, replan from nearest ancestor
 *
 * Classification is deterministic given a failure descriptor. `transient` is
 * the default so a timeout/network blip is retried rather than escalated.
 */

/** retryable classes (network-ish errors). */
const TRANSIENT = new Set(['timeout', 'network', 'rate_limited', 'oom', 'crashed']);
/** provider/account-level classes → permanent. */
const PERMANENT = new Set(['unauthorized', 'invalid_config', 'missing_dependency', 'unsupported']);

/**
 * @param {object} f
 * @param {string} f.class   — timeout|network|rate_limited|oom|crashed|unauthorized|invalid_config|missing_dependency|unsupported|logical_contradiction|...
 * @returns {'transient'|'permanent'|'logical'}
 */
export function classifyFailure({ class: cls = 'transient', reason } = {}) {
  if (cls === 'logical_contradiction') return 'logical';
  if (PERMANENT.has(cls)) return 'permanent';
  if (TRANSIENT.has(cls)) return 'transient';
  // unknown class defaults to transient; a reason hinting at logic wins
  if (/contradict|impossible|inconsistent/i.test(reason ?? '')) return 'logical';
  if (/auth|forbidden|not.?found|missing pos|misconfig/i.test(reason ?? '')) return 'permanent';
  return 'transient';
}

/** Exponential backoff for a retry (deterministic, capped). */
export function backoffMs(attempt, baseMs = 1_000, capMs = 30_000) {
  return Math.min(baseMs * 2 ** attempt, capMs);
}

/** Given a node + failure, is another retry allowed? */
export function canRetry(node, maxRetries = 3) {
  return node.retryCount < maxRetries;
}