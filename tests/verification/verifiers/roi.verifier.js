/**
 * JEXI OS — Phase 8 Scope G — ROI VERIFIER (Rules of Engagement check).
 *
 * The verification layer is ITSELF a security actor: it re-executes
 * exploits. Before the verifier touches the target for ANY finding, this
 * module re-validates the attempted action against the engagement's RoE
 * (Phase 8D). An out-of-scope finding — however real it looks — is never
 * re-exploited. Refusals cite the specific rule, exactly like the
 * pipeline's own gates.
 *
 * This is a thin, deliberately independent face over
 * security/engagements/validator.js validateRoE: same rule engine the
 * phases use, different call site. The verifier does NOT inherit the
 * phase's gate decision — it re-checks (defense in depth: a finding that
 * slipped through a stale gate is still caught here).
 */

import { validateRoE } from '../../../security/engagements/validator.js';

/**
 * Pure check — never throws. Returns the raw verdict so callers can log it:
 *   { allowed, reason, rule, checks }
 * `engagement` is the assembled engagement bundle (Phase 8D). A null
 * engagement means the pipeline is in its UNGATED legacy mode (the same
 * additive convention as the Scope D gatePhase: no engagement → no scope
 * to violate). RoE enforcement applies whenever an engagement IS loaded:
 * then the re-execution must sit inside scope, allowed actions, and time
 * windows — otherwise REFUSED with the exact rule.
 */
export function checkRoE({ engagement, action = 'verify', target, at = null, approvals = [] } = {}) {
  if (!engagement) {
    return {
      allowed: true,
      reason: 'no engagement loaded — pipeline ungated legacy mode (RoE not applicable; Scope D additive convention)',
      rule: null,
      checks: [],
    };
  }
  return validateRoE(engagement, { action, target, at: at ? new Date(at) : new Date(), approvals });
}

/**
 * Throwing variant used inside the verifier pipeline. The refusal is
 * auditable and carries the exact RoE rule (e.g. FORBIDDEN_TARGET,
 * TARGET_NOT_IN_SCOPE, FORBIDDEN_ACTION, OUT_OF_TIME_WINDOW,
 * APPROVAL_REQUIRED).
 */
export function assertInRoE(opts) {
  const verdict = checkRoE(opts);
  if (!verdict.allowed) {
    const err = new Error(`roi.verifier: re-execution REFUSED [${verdict.rule}]: ${verdict.reason} (action=${opts.action}, target=${opts.target})`);
    err.name = 'RoiViolationError';
    err.code = 'E_ROI_VIOLATION';
    err.rule = verdict.rule;
    err.reason = verdict.reason;
    err.checks = verdict.checks;
    throw err;
  }
  return verdict;
}

/**
 * Convenience: does this verifier run have authority over this target at
 * all? Used by the phase to pre-sort findings into verifiable vs refused
 * without attempting execution.
 */
export function roeGate(engagement, { target, action = 'verify', at = null } = {}) {
  const verdict = checkRoE({ engagement, action, target, at });
  return { allowed: verdict.allowed, rule: verdict.rule, reason: verdict.reason };
}

export default { checkRoE, assertInRoE, roeGate };
