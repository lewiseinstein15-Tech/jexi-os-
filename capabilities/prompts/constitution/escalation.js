// prompt/constitution/escalation.js
// Escalation triggers for the constitutional template (Phase 25, Scope C).
//
// Section 4 ("Escalation Triggers"). Every trigger is a NAMED
// condition — never "when appropriate". Three outcomes:
//   refuse   → immediate no (explicit policy violations only)
//   ask      → pause for user input
//   escalate → hand to human
// DEFAULT for unclear cases → ask (never refuse, never proceed).
//
// The trigger registry is append-only and shared with the rendered
// section: renderSection() lists exactly the triggers check()
// honors. Scope I (later) extends this module with more named
// triggers via registerNamedTriggers().

import { PromptError } from '../assembly/errors.js';

export const OUTCOMES = Object.freeze(['refuse', 'ask', 'escalate']);

// Vague phrases that may NEVER appear in a trigger or its reason.
export const VAGUE_TRIGGER_PHRASES = Object.freeze([
  'when appropriate', 'if needed', 'as appropriate', 'when needed', 'if applicable', 'as needed',
]);

/** A rendered trigger line must match this exactly. */
export const TRIGGER_LINE_RE = /^- (REFUSE|ASK|ESCALATE) — [a-z0-9-]+: .+$/;

function predicateFor(kind) {
  return (ctx) => (typeof ctx === 'object' && ctx !== null ? ctx.kind === kind : false);
}

function freezeTrigger(t) {
  return Object.freeze({ name: t.name, outcome: t.outcome, reason: t.reason, when: t.when });
}

export const BUILT_IN_TRIGGERS = Object.freeze([
  freezeTrigger({ name: 'policy-violation', outcome: 'refuse', reason: 'explicit policy violation', when: predicateFor('policy-violation') }),
  freezeTrigger({ name: 'secret-exfiltration', outcome: 'refuse', reason: 'credentials, tokens, or secrets requested', when: predicateFor('secret-exfiltration') }),
  freezeTrigger({ name: 'human-authority-required', outcome: 'escalate', reason: 'decision reserved for a human owner', when: predicateFor('human-authority-required') }),
  freezeTrigger({ name: 'irreversible-destructive-action', outcome: 'escalate', reason: 'destructive action that cannot be undone', when: predicateFor('irreversible-destructive-action') }),
  freezeTrigger({ name: 'missing-required-input', outcome: 'ask', reason: 'required input is absent', when: predicateFor('missing-required-input') }),
  freezeTrigger({ name: 'ambiguous-scope', outcome: 'ask', reason: 'request does not fit a valid topic cleanly', when: predicateFor('ambiguous-scope') }),
]);

// Append-only trigger registry (name -> frozen trigger).
const registeredTriggers = new Map();
for (const t of BUILT_IN_TRIGGERS) registeredTriggers.set(t.name, t);

function assertNoVaguePhrases(text, where) {
  const lower = String(text).toLowerCase();
  for (const phrase of VAGUE_TRIGGER_PHRASES) {
    if (lower.includes(phrase)) {
      throw new PromptError('E_INVALID_ESCALATION', `${where} contains vague trigger language: "${phrase}" — triggers must be named conditions`, { where, phrase });
    }
  }
}

// Load-time self-check: built-ins must already satisfy the discipline.
for (const t of BUILT_IN_TRIGGERS) assertNoVaguePhrases(t.reason, `built-in trigger "${t.name}" reason`);

/**
 * Pure validation of a trigger list (no registration). Throws
 * E_INVALID_ESCALATION on: non-object trigger, malformed name
 * (^[a-z0-9-]+$), unknown outcome, empty reason, non-function when,
 * vague language in reason, or a name already registered with a
 * DIFFERENT definition (append-only registry; identical
 * re-declaration is an idempotent no-op).
 */
export function assertTriggers(triggers) {
  if (!Array.isArray(triggers)) {
    throw new PromptError('E_INVALID_ESCALATION', 'spec.escalation must be an array of named triggers', { got: typeof triggers });
  }
  triggers.forEach((t, index) => {
    const bad = (message, details) => new PromptError('E_INVALID_ESCALATION', `spec.escalation[${index}]: ${message}`, { index, ...details });
    if (typeof t !== 'object' || t === null || Array.isArray(t)) throw bad('trigger must be an object', {});
    if (typeof t.name !== 'string' || !/^[a-z0-9-]+$/.test(t.name)) throw bad('name must match ^[a-z0-9-]+$', { name: String(t.name ?? '') });
    if (!OUTCOMES.includes(t.outcome)) throw bad(`outcome must be one of ${OUTCOMES.join(', ')}`, { outcome: String(t.outcome ?? '') });
    if (typeof t.reason !== 'string' || t.reason.trim() === '') throw bad('reason must be a non-empty string', {});
    if (typeof t.when !== 'function') throw bad('when must be a predicate function (ctx) => boolean', {});
    assertNoVaguePhrases(t.reason, `trigger "${t.name}" reason`);
    const existing = registeredTriggers.get(t.name);
    if (existing && (existing.outcome !== t.outcome || existing.reason !== t.reason || existing.when !== t.when)) {
      throw bad(`trigger name "${t.name}" is already registered with a different definition — the registry is append-only`, { name: t.name });
    }
  });
  return triggers;
}

/** Validate + register named triggers. Idempotent for identical re-declaration. */
export function registerNamedTriggers(triggers) {
  assertTriggers(triggers);
  for (const t of triggers) {
    if (!registeredTriggers.has(t.name)) registeredTriggers.set(t.name, freezeTrigger(t));
  }
  return listTriggers();
}

export function listTriggers() {
  return [...registeredTriggers.values()];
}

/**
 * escalation.check(context) -> { action, trigger, reason }
 * Evaluation priority: refuse triggers > escalate > ask > default.
 * A crashing predicate counts as a non-match (never a match).
 *   - first matching trigger wins → its outcome + name
 *   - no match + context.clear === true  → proceed ('explicit-clear')
 *   - no match otherwise                 → ask ('default-unclear')
 * Never throws for unreadable contexts — unreadable is unclear,
 * and unclear defaults to ask.
 */
export function check(context) {
  const ctx = typeof context === 'object' && context !== null ? context : {};
  const all = listTriggers();
  for (const outcome of ['refuse', 'escalate', 'ask']) {
    for (const t of all) {
      if (t.outcome !== outcome) continue;
      let matched = false;
      try {
        matched = Boolean(t.when(ctx));
      } catch {
        matched = false;
      }
      if (matched) return { action: outcome, trigger: t.name, reason: t.reason };
    }
  }
  if (ctx.clear === true) {
    return { action: 'proceed', trigger: 'explicit-clear', reason: 'context marked clear and no trigger matched' };
  }
  return { action: 'ask', trigger: 'default-unclear', reason: 'no trigger matched and the context is not marked clear; the default is ask, not refuse' };
}

/** Render section-4 body: exactly the triggers check() honors. */
export function renderSection() {
  const label = { refuse: 'REFUSE', escalate: 'ESCALATE', ask: 'ASK' };
  const lines = [];
  for (const outcome of ['refuse', 'escalate', 'ask']) {
    for (const t of listTriggers()) {
      if (t.outcome === outcome) lines.push(`- ${label[outcome]} — ${t.name}: ${t.reason}.`);
    }
  }
  lines.push('Default: no trigger matched and the context is not marked clear → ASK (never refuse by default, never proceed silently). Refuse is reserved for explicit policy violations.');
  return lines.join('\n');
}

export const escalation = Object.freeze({
  check,
  registerNamedTriggers,
  assertTriggers,
  listTriggers,
  renderSection,
  BUILT_IN_TRIGGERS,
  VAGUE_TRIGGER_PHRASES,
  OUTCOMES,
});
