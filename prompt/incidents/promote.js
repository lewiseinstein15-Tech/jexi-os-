// prompt/incidents/promote.js
// Phase 25 — Scope H: incident -> proposed prompt rule (promotion).
//
// Promotion is where the immune system decides what is worth learning. For
// this scope the decision is RULE-BASED (PROMOTION HEURISTIC, labeled on
// every rule via RULE_METHOD — "rule-based - LLM promotion NOT VERIFIED"):
//   promotable IFF
//     (a) the trigger is a CONCRETE failure mode (not "general error" /
//         "something went wrong" / bare "failed" — see VAGUE_TRIGGER_PATTERNS)
//   AND (b) the fix NAMES A SPECIFIC ACTION (contains a recognized action
//         verb — see ACTION_VERBS).
//
// Refusals are SPECIFIC and produce NO event and NO rule: the store only
// changes on successful record/promote/revoke, which keeps RULE 7
// determinism intact (same input sequence -> same log).
//
// Scope H rules implemented here:
//   RULE 1  the rule is derived FROM the incident and carries its incidentId;
//           promoting a non-existent incident refuses E_NO_SUCH_INCIDENT.
//   RULE 2  append-only: promotion/revoke append events; nothing is deleted.
//   RULE 3  same trigger key + different fix -> the new promotion event
//           carries supersedes:[olderRuleIds]; replay marks the old rules
//           superseded. BOTH remain in the log.
//   Idempotency: promoting when an identical active rule (same trigger key
//   AND same fix) already exists returns that rule with NO new event.

import * as log from './log.js';

const { INCIDENT_CODES, RULE_METHOD } = log;

/**
 * Vague-trigger detection (rule-based). Each entry: [regex, specific reason].
 * Anchored patterns match a trigger that is ONLY the vague phrase; the two
 * unanchored ones poison any trigger containing the phrase.
 */
const VAGUE_TRIGGER_PATTERNS = [
  [/^general( error| failure| issue| problem)?$/i, 'bare "general error"-style trigger names no failure mode'],
  [/^generic( error| failure)?$/i, 'bare "generic error" names no failure mode'],
  [/^unknown( error)?$/i, '"unknown error" names no failure mode'],
  [/^unexpected( error| behavior| behaviour)?$/i, '"unexpected error" names no failure mode'],
  [/^(error|errors|failed|failure|issue|problem|exception|glitch|bug)$/i, 'bare error-word names no failure mode'],
  [/something went wrong/i, '"something went wrong" names no concrete failure mode'],
  [/went wrong/i, '"went wrong" names no concrete failure mode'],
  [/^(it )?(broke|broken|crashed|failed)( again)?$/i, 'bare "broke/failed/crashed" names no failure mode'],
  [/^(doesn'?t|does not|did not|didn'?t) work$/i, '"doesn\'t work" names no failure mode'],
  [/^(not working|stopped working)$/i, '"not working" names no failure mode'],
  [/^(misc|miscellaneous|other|n\/?a|tbd|none|various|several)$/i, 'placeholder trigger names no failure mode'],
  [/^(weird|strange|odd)( thing| behavior| behaviour| issue)?$|^(acts?|behaves?) (weird|strange|odd)$/i, '"weird/strange" names no failure mode'],
  [/^bad (thing|stuff|result|outcome)$/i, '"bad thing"-style trigger names no failure mode'],
];

/**
 * Action-verb vocabulary for fix specificity (rule-based heuristic). A fix
 * "names a specific action" when it contains at least one of these verbs as a
 * whole word. Deliberately broad — a false positive promotes an extra rule
 * (cheap); a false negative silently discards a lesson (expensive).
 */
const ACTION_VERBS = new Set([
  'add', 'use', 'remove', 'replace', 'set', 'run', 'rerun', 'check',
  'validate', 'verify', 'catch', 'handle', 'log', 'write', 'read', 'retry',
  'quote', 'escape', 'sanitize', 'encode', 'decode', 'parse', 'assert', 'pin',
  'guard', 'wrap', 'call', 'await', 'close', 'flush', 'create', 'import',
  'export', 'install', 'compare', 'hash', 'prefix', 'clamp', 'bound', 'limit',
  'cache', 'memoize', 'throw', 'return', 'include', 'require', 'test',
  'measure', 'record', 'append', 'reject', 'refuse', 'bind', 'freeze',
  'specify', 'convert', 'normalize', 'trim', 'copy', 'move', 'delete',
  'update', 'merge', 'rebase', 'stash', 'commit', 'push', 'pull', 'restart',
  'reload', 'rebuild', 'reindex', 'migrate', 'rollback', 'revert', 'abort',
  'clear', 'coerce', 'filter', 'sort', 'dedupe', 'suspend', 'resume', 'pause',
  'kill', 'stop', 'start', 'enable', 'disable', 'rotate', 'revoke', 'sync',
  'drain', 'debounce', 'throttle', 'batch', 'chunk', 'stream',
  'invalidate', 'skip', 'collapse', 'bump', 'drop', 'rename', 'mkdir',
]);

const ACTION_VERB_RE = new RegExp(`\\b(${[...ACTION_VERBS].join('|')})\\b`, 'i');

function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Heuristic (a): is the trigger a concrete failure mode?
 * -> { concrete:boolean, reason? } — the reason is SPECIFIC (names what is
 * missing) because P3 requires a specific refusal reason.
 */
export function isConcreteTrigger(trigger) {
  const t = oneLine(trigger);
  if (t.length < 4) {
    return { concrete: false, reason: 'trigger is too short to name a failure mode' };
  }
  for (const [re, why] of VAGUE_TRIGGER_PATTERNS) {
    if (re.test(t)) return { concrete: false, reason: why };
  }
  return { concrete: true };
}

/**
 * Heuristic (b): does the fix name a specific action?
 * -> { specific:boolean, verb?, reason? }
 */
export function namesSpecificAction(fix) {
  const f = oneLine(fix);
  if (f.length < 4) {
    return { specific: false, reason: 'fix is too short to name an action' };
  }
  const m = ACTION_VERB_RE.exec(f);
  if (!m) {
    return {
      specific: false,
      reason: 'no recognized action verb found (rule-based heuristic over an action-verb vocabulary)',
    };
  }
  return { specific: true, verb: m[1].toLowerCase() };
}

function refusal(incidentId, errorCode, reason) {
  return { rule: null, active: false, ruleId: null, incidentId, reason, errorCode };
}

/**
 * incidents.promote(incidentId)
 *   -> { rule:{ when, do, because, incidentId }, active:true, ruleId, ... }
 *    | { rule:null, active:false, ruleId:null, reason, errorCode }
 */
export function promote(incidentId) {
  const { events } = log.readEvents();
  const state = log.computeState(events);
  const inc = state.incidents.get(incidentId);
  if (!inc) {
    return refusal(
      incidentId,
      INCIDENT_CODES.NO_SUCH_INCIDENT,
      `no such incident: ${incidentId} — rule NOT produced (RULE 1: rules reference recorded incidents only)`,
    );
  }

  const trig = isConcreteTrigger(inc.trigger);
  if (!trig.concrete) {
    return refusal(
      incidentId,
      INCIDENT_CODES.VAGUE_TRIGGER,
      `trigger "${oneLine(inc.trigger)}" is not a concrete failure mode: ${trig.reason} — rule NOT produced (heuristic: ${RULE_METHOD})`,
    );
  }

  const fix = namesSpecificAction(inc.fix);
  if (!fix.specific) {
    return refusal(
      incidentId,
      INCIDENT_CODES.VAGUE_FIX,
      `fix "${oneLine(inc.fix)}" does not name a specific action: ${fix.reason} — rule NOT produced (heuristic: ${RULE_METHOD})`,
    );
  }

  const whenKey = log.triggerKey(inc.trigger);
  const doText = inc.fix.trim();

  // Idempotent promote: identical active rule (same trigger key, same fix).
  const identical = state.rules.find(
    (r) => log.isActiveRule(r) && log.triggerKey(r.when) === whenKey && r.do === doText,
  );
  if (identical) {
    return {
      rule: {
        when: identical.when,
        do: identical.do,
        because: identical.because,
        incidentId: identical.incidentId,
      },
      active: true,
      ruleId: identical.ruleId,
      reason: 'identical rule already active — no new event appended (idempotent promote)',
    };
  }

  // RULE 3 — supersede every OTHER active rule with the same trigger key
  // (oldest first in the supersedes list — deterministic order).
  const superseded = state.rules
    .filter((r) => log.isActiveRule(r) && log.triggerKey(r.when) === whenKey)
    .map((r) => r.ruleId);

  const rule = {
    when: inc.trigger.trim(),
    do: doText,
    because: inc.failure.trim(),
    incidentId: inc.id,
  };
  const promoted = log.appendEvent({
    type: 'promotion',
    id: `RULE-${String(state.rules.length + 1).padStart(4, '0')}`,
    promotedAt: new Date().toISOString(),
    incidentId: inc.id,
    rule,
    active: true,
    method: RULE_METHOD,
    supersedes: superseded,
  });

  const out = { rule, active: true, ruleId: promoted.id };
  if (superseded.length > 0) out.superseded = superseded;
  return out;
}

/**
 * incidents.revoke(ruleId, reason) — RULE 2: revoking writes an EVENT; the
 * rule stays in the log. Idempotent on an already-revoked rule.
 */
export function revoke(ruleId, reason = '') {
  const { events } = log.readEvents();
  const state = log.computeState(events);
  const rule = state.rules.find((r) => r.ruleId === ruleId);
  if (!rule) {
    return {
      revoked: false,
      ruleId,
      reason: `no such rule: ${ruleId}`,
      errorCode: INCIDENT_CODES.NO_SUCH_RULE,
    };
  }
  if (rule.revoked) {
    return { revoked: true, ruleId, reason: 'already revoked — no new event appended (idempotent revoke)' };
  }
  const at = new Date().toISOString();
  log.appendEvent({ type: 'revoke', at, ruleId, reason: String(reason).trim() || 'unspecified' });
  return { revoked: true, ruleId, at };
}

/** incidents.rules() -> every rule with its derived state (nothing deleted). */
export function listRules() {
  const { events } = log.readEvents();
  const state = log.computeState(events);
  return state.rules.map((r) => ({
    ruleId: r.ruleId,
    incidentId: r.incidentId,
    when: r.when,
    do: r.do,
    because: r.because,
    method: r.method,
    promotedAt: r.promotedAt,
    active: log.isActiveRule(r),
    supersededBy: r.supersededBy,
    revoked: r.revoked,
    revokedAt: r.revokedAt,
    revokedReason: r.revokedReason,
  }));
}
