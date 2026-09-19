/**
 * JEXI OS — Phase 8 Scope G — POC VERIFIER (proof-of-concept validation).
 *
 * Validates a PoC ATTEMPT SET before any verdict may rest on it. Two jobs:
 *
 *   1. STRUCTURE + OBSERVATION — a method claim is only evidence if it
 *      names the attempt, carries the request, and records an OBSERVED
 *      response excerpt. "success: true" with no observation is not
 *      evidence; it is a claim.
 *   2. INDEPENDENCE — the >=2-methods bar for CRITICAL/HIGH counts only
 *      DISTINCT attempts: different request surfaces. Two rows differing
 *      only in method name (same request, same payload) are one method
 *      wearing two hats — the classic way a sloppy agent double-counts.
 *
 * The verifier (exploit.verifier.js) runs this BOTH on the doer's claimed
 * PoC (before deciding the claim is even worth re-executing) and on its
 * own re-run results (before issuing a verdict). Same bar, both sides.
 */

/**
 * A method attempt: { name, request, success, responseExcerpt }.
 * `responseExcerpt` is the observed response (any evidence string the
 * executor captured). Marker-style executors may also attach
 * `observed` (boolean: the expected marker was seen verbatim).
 */
export function validatePoc({ methods, severity, requiredMarker = null } = {}) {
  const reasons = [];
  const list = Array.isArray(methods) ? methods : [];
  if (!list.length) reasons.push('no PoC attempts recorded');

  for (const [i, m] of list.entries()) {
    const tag = `method[${i}]`;
    if (!m || typeof m !== 'object') { reasons.push(`${tag}: not an object`); continue; }
    if (typeof m.name !== 'string' || !m.name.trim()) reasons.push(`${tag}: missing attempt name`);
    if (typeof m.request !== 'string' || !m.request.trim()) reasons.push(`${tag}: missing request — an attempt without a request is not reproducible`);
    if (typeof m.success !== 'boolean') reasons.push(`${tag}: "success" must be a boolean`);
    if (m.success) {
      const obs = typeof m.responseExcerpt === 'string' && m.responseExcerpt.trim().length > 0;
      if (!obs && m.observed !== true) reasons.push(`${tag}: claims success with NO observed response — a claim, not evidence`);
      if (requiredMarker && typeof m.responseExcerpt === 'string' && !m.responseExcerpt.includes(requiredMarker) && m.observed !== true) {
        reasons.push(`${tag}: claimed success but the expected marker "${requiredMarker}" is absent from the observation`);
      }
    }
  }

  const independent = independentMethods(list);
  const needed = requiredCount(severity);
  if (independent.length < needed) {
    reasons.push(`independence gate: ${independent.length} distinct successful attempt(s) < ${needed} required for severity "${severity || 'unknown'}"`);
  }

  return {
    valid: reasons.length === 0,
    reasons,
    independentCount: independent.length,
    requiredCount: needed,
    successfulCount: list.filter((m) => m && m.success === true).length,
  };
}

/**
 * REQUIRED independent methods by severity — the Scope G contract:
 * CRITICAL/HIGH demand >= 2; everything else >= 1.
 */
export function requiredCount(severity) {
  const s = String(severity || '').toLowerCase();
  return s === 'critical' || s === 'high' ? 2 : 1;
}

/**
 * Distinct successful attempts. Distinctness = (request, normalized
 * observation intent) pairs — the same HTTP request twice under two names
 * collapses to one method. Ordering-independent; deterministic.
 */
export function independentMethods(methods) {
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(methods) ? methods : []) {
    if (!m || typeof m !== 'object' || m.success !== true) continue;
    const key = `${String(m.request || '').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Pre-flight on the DOER's claimed PoC: is the claim internally coherent
 * enough to be worth the verifier's re-execution? (A claim that fails this
 * is rejected on paperwork alone — the verifier still re-executes when it
 * can, but the paperwork verdict is recorded.)
 */
export function auditClaim({ record, finding }) {
  const severity = (record && record.severity) || (finding && finding.severity);
  const v = validatePoc({ methods: (record && record.methods) || [], severity });
  return {
    claimCoherent: v.valid,
    claimReasons: v.reasons,
    claimedIndependent: v.independentCount,
    required: v.requiredCount,
  };
}

export default { validatePoc, requiredCount, independentMethods, auditClaim };
