/**
 * JEXI OS — Phase 8 Scope D — ROE VALIDATOR.
 *
 * Before any security action executes, the validator checks:
 *   1. Target is in scope.targets (not in scope.forbidden)
 *      — forbidden wins first, and in-scope CIDR networks are honored
 *   2. Action is NOT in roe.forbiddenActions   (hard denial — checked
 *      before the allow list so the refusal cites the most specific rule)
 *   3. Action is in roe.allowedActions
 *   4. Current time is in roe.timeWindows      (empty list = unrestricted)
 *   5. If action requires approval, it's been granted
 *        (engagement.approvals rows, plus any `approvals` argument)
 *
 * If any check fails → the action is REFUSED with the specific violated
 * rule. The pipeline HALTS — it does not continue.
 *
 * This module is also the pipeline's gate face:
 *   - gatePhase(ctx, action)  — `yield*` at the top of a phase's run():
 *     no-op without an engagement, audit event on pass, violation event +
 *     EngagementViolationError on refusal.
 *   - validateEngagementLiveness(engagement, {at, target}) — the workflow
 *     transition check (scope + time window still valid).
 */

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

export function normalizeTarget(t) {
  let s = t === null || t === undefined ? '' : String(t).trim().toLowerCase();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s) || s.includes('/')) {
    try { s = new URL(s).hostname; } catch { /* fall through: bare host */ }
  }
  // strip a trailing :port on bare hosts (URL parse already handled URLs)
  s = s.replace(/^([a-z0-9._-]+):\d+$/, '$1');
  return s;
}

export function isIpv4(s) {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s);
}

/** True when the IPv4 literal `ip` falls inside `cidr` (a.b.c.d/p). */
export function cidrMatch(ip, cidr) {
  if (!isIpv4(ip) || typeof cidr !== 'string' || !cidr.includes('/')) return false;
  const [net, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32 || !isIpv4(net)) return false;
  const toInt = (dotted) => dotted.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(net) & mask) >>> 0);
}

function checkList() {
  const checks = [];
  return {
    checks,
    pass: (check, detail) => { checks.push({ check, pass: true, detail: detail ?? null }); },
    fail: (check, detail) => { checks.push({ check, pass: false, detail: detail ?? null }); return detail; },
  };
}

function windowCovers(windows, at) {
  const t = at.getTime();
  return (windows || []).some((w) => {
    const start = w && w.start ? new Date(w.start).getTime() : -Infinity;
    const end = w && w.end ? new Date(w.end).getTime() : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return t >= start && t <= end;
  });
}

function targetRefusals(engagement, target, cl) {
  const forbidden = (engagement.scope.forbidden || []).map(normalizeTarget);
  if (target && forbidden.includes(target)) {
    cl.fail('target-not-forbidden', 'target in forbidden list');
    return { rule: 'FORBIDDEN_TARGET', reason: 'target in forbidden list' };
  }
  cl.pass('target-not-forbidden', `forbidden=[${forbidden.join(', ') || '-'}]`);
  const targets = (engagement.scope.targets || []).map(normalizeTarget);
  if (!target || !targets.includes(target)) {
    cl.fail('target-in-scope', targets.length ? `targets=[${targets.join(', ')}]` : 'scope.targets empty');
    return { rule: 'TARGET_NOT_IN_SCOPE', reason: 'target not in scope' };
  }
  cl.pass('target-in-scope', `targets=[${targets.join(', ')}]`);
  const networks = engagement.scope.networks || [];
  if (networks.length && target && isIpv4(target)) {
    const matched = networks.filter((n) => cidrMatch(target, n.cidr));
    if (matched.some((n) => !n.allowed)) {
      cl.fail('target-network-allowed', `target ${target} inside disallowed cidr`);
      return { rule: 'FORBIDDEN_NETWORK', reason: 'target in forbidden network' };
    }
    if (!matched.some((n) => n.allowed)) {
      cl.fail('target-network-allowed', `target ${target} matches no allowed cidr`);
      return { rule: 'NETWORK_NOT_IN_SCOPE', reason: 'target outside allowed networks' };
    }
    cl.pass('target-network-allowed', `target ${target} inside an allowed cidr`);
  }
  return null;
}

function timeRefusal(engagement, at, cl) {
  const windows = engagement.roe.timeWindows || [];
  if (!windows.length) {
    cl.pass('in-time-window', 'no time windows declared — unrestricted');
    return null;
  }
  if (!windowCovers(windows, at)) {
    cl.fail('in-time-window', `at=${at.toISOString()} outside [${windows.map((w) => `${w.start}..${w.end}`).join(', ')}]`);
    return { rule: 'OUT_OF_TIME_WINDOW', reason: 'outside time window' };
  }
  cl.pass('in-time-window', `at=${at.toISOString()} inside a declared window`);
  return null;
}

/**
 * Full RoE validation of one action against one target.
 * Returns { allowed, reason, rule, checks } — reason strings are probe
 * contract: 'in scope, in RoE, in time window' / 'target in forbidden list'
 * / 'action in forbidden list' / 'outside time window' / …
 */
export function validateRoE(engagement, { action, target, at = null, approvals = [] } = {}) {
  const cl = checkList();
  if (!engagement || typeof engagement !== 'object') {
    return { allowed: false, reason: 'no engagement loaded', rule: 'ENGAGEMENT_MISSING', checks: [] };
  }
  const t = normalizeTarget(target);
  const act = String(action ?? '').trim().toLowerCase();
  const atDate = at instanceof Date ? at : new Date(at || Date.now());

  const tRef = targetRefusals(engagement, t, cl);
  if (tRef) return { allowed: false, ...tRef, checks: cl.checks };

  const roe = engagement.roe || {};
  const forbiddenActions = (roe.forbiddenActions || []).map((a) => String(a).toLowerCase());
  if (forbiddenActions.includes(act)) {
    cl.fail('action-not-forbidden', `forbiddenActions=[${forbiddenActions.join(', ')}]`);
    return { allowed: false, reason: 'action in forbidden list', rule: 'FORBIDDEN_ACTION', checks: cl.checks };
  }
  cl.pass('action-not-forbidden', `forbiddenActions=[${forbiddenActions.join(', ') || '-'}]`);

  const allowedActions = (roe.allowedActions || []).map((a) => String(a).toLowerCase());
  if (!allowedActions.includes(act)) {
    cl.fail('action-allowed', `allowedActions=[${allowedActions.join(', ')}]`);
    return { allowed: false, reason: 'action not in allowed actions', rule: 'ACTION_NOT_ALLOWED', checks: cl.checks };
  }
  cl.pass('action-allowed', `allowedActions=[${allowedActions.join(', ')}]`);

  const timeRef = timeRefusal(engagement, atDate, cl);
  if (timeRef) return { allowed: false, ...timeRef, checks: cl.checks };

  const requires = (roe.requiresApproval || []).map((a) => String(a).toLowerCase());
  if (requires.includes(act)) {
    const grants = [...(engagement.approvals || []), ...approvals]
      .filter((g) => g && String(g.action || '').toLowerCase() === act);
    if (!grants.length) {
      cl.fail('approval-granted', `action "${act}" is in requiresApproval and no grant exists`);
      return { allowed: false, reason: 'approval required but not granted', rule: 'APPROVAL_REQUIRED', checks: cl.checks };
    }
    cl.pass('approval-granted', `granted by: ${grants.map((g) => g.grantedBy || 'unspecified').join(', ')}`);
  } else {
    cl.pass('approval-granted', `action "${act}" does not require approval`);
  }

  return { allowed: true, reason: 'in scope, in RoE, in time window', rule: null, checks: cl.checks };
}

/**
 * Workflow transition check — is the engagement STILL valid (scope, time
 * window) right now? Action-level checks belong to validateRoE.
 */
export function validateEngagementLiveness(engagement, { target, at = null } = {}) {
  const cl = checkList();
  if (!engagement || typeof engagement !== 'object') {
    return { allowed: false, reason: 'no engagement loaded', rule: 'ENGAGEMENT_MISSING', checks: [] };
  }
  const t = normalizeTarget(target);
  const atDate = at instanceof Date ? at : new Date(at || Date.now());
  const tRef = targetRefusals(engagement, t, cl);
  if (tRef) return { allowed: false, ...tRef, checks: cl.checks };
  const timeRef = timeRefusal(engagement, atDate, cl);
  if (timeRef) return { allowed: false, ...timeRef, checks: cl.checks };
  return { allowed: true, reason: 'engagement valid — target in scope, inside time window', rule: null, checks: cl.checks };
}

/** Thrown by the pipeline gate on refusal — HALTS the phase/workflow. */
export class EngagementViolationError extends Error {
  constructor(verdict, { action = null, target = null, phaseId = null } = {}) {
    super(`engagement violation [${verdict.rule}]: ${verdict.reason}`
      + `${action ? ` (action=${action})` : ''}${target ? ` (target=${target})` : ''}${phaseId ? ` (phase=${phaseId})` : ''}`);
    this.name = 'EngagementViolationError';
    this.code = 'E_ENGAGEMENT_VIOLATION';
    this.rule = verdict.rule;
    this.reason = verdict.reason;
    this.action = action;
    this.target = target;
    this.phaseId = phaseId;
  }
}

/**
 * The per-phase validation gate (Step 2 integration point).
 * Usage at the top of a phase's run():  yield* gatePhase(ctx, 'scan');
 *  - no engagement in ctx → no-op (pipeline runs ungated, backward compatible)
 *  - allowed → engagement.audit event (+ durable audit row via ctx.engagementStore)
 *  - refused → engagement.violation event, then EngagementViolationError HALTS the phase
 */
export async function* gatePhase(ctx, action) {
  if (!ctx || !ctx.engagement) return;
  const target = normalizeTarget(ctx.baseUrl || '');
  const verdict = validateRoE(ctx.engagement, { action, target, at: new Date() });
  const store = ctx.engagementStore || null;
  if (store && ctx.engagementId) {
    store.audit(ctx.engagementId, {
      kind: 'action-validate', action, target,
      allowed: verdict.allowed, rule: verdict.rule, reason: verdict.reason,
    });
  }
  if (verdict.allowed) {
    yield {
      type: 'engagement.audit',
      data: { message: `roegate: ${action} on ${target} allowed — ${verdict.reason}`, action, target, rule: null, reason: verdict.reason },
    };
    return;
  }
  yield {
    type: 'engagement.violation',
    data: { message: `roegate REFUSED: ${action} on ${target} — ${verdict.reason}`, action, target, rule: verdict.rule, reason: verdict.reason },
  };
  throw new EngagementViolationError(verdict, { action, target });
}

export const ROE_SEVERITIES = SEVERITIES;
