/**
 * JEXI OS — Phase 17 Scope D — MEMORY / LIFECYCLE (enhancement layer).
 *
 * Monotonic lifecycle over Phase 4 `MemoryEntry` objects (state carried in
 * `metadata.lifecycleState`, so no Phase 4 schema change):
 *
 *     FRESH → AGING → STALE → ARCHIVED
 *
 * TRANSITION THRESHOLDS (all documented, all deterministic; evaluated
 * top-down — the first matching rule wins, then monotonicity is applied
 * against the CURRENT stored state):
 *
 *   → ARCHIVED   age ≥ 180 days  OR  confidence < 0.15
 *   → STALE      age ≥  60 days  OR  confidence < 0.30
 *   → AGING      age ≥   7 days  OR  (never retrieved AND age ≥ 3 days)
 *   → FRESH      otherwise
 *
 * MONOTONICITY: `advance()` never returns a state earlier in the chain than
 * the entry already carries. A STALE entry cannot drift back to FRESH by the
 * clock passing — only `reinforced()` (explicit re-reinforcement, a deliberate
 * act, typically paired with confidence.reinforce) resets the state to FRESH
 * AND resets the aging clock (subsequent age is measured from
 * `metadata.lastReinforcedAt`, not the original createdAt).
 *
 * ARCHIVED entries are EXCLUDED FROM RETRIEVAL (enforced in hybrid-search.js,
 * see the ARCHIVED filter) but PRESERVED ON DISK — lifecycle removes them
 * from search, never from storage.
 */

import { confidenceScore } from './confidence.js';

export const LIFECYCLE_STATES = Object.freeze(['FRESH', 'AGING', 'STALE', 'ARCHIVED']);
export const STATE_RANK = Object.freeze({ FRESH: 0, AGING: 1, STALE: 2, ARCHIVED: 3 });

/** Documented thresholds — overridable wholesale. */
export const LIFECYCLE_DEFAULTS = Object.freeze({
  freshMaxAgeDays: 7,
  unaccessedDays: 3,      // never-retrieved entries age faster
  staleAfterDays: 60,
  archiveAfterDays: 180,
  staleBelowConfidence: 0.3,
  archiveBelowConfidence: 0.15,
  msPerDay: 86_400_000,
});

/**
 * Age is measured from the last explicit reinforcement when present
 * (reinforcement resets the aging clock), otherwise from createdAt.
 */
const ageDaysOf = (entry, t, msPerDay) => {
  const origin = Number(entry?.metadata?.lastReinforcedAt) || Number(entry.createdAt) || t;
  return Math.max(0, (t - origin) / msPerDay);
};

function currentState(entry) {
  const s = entry?.metadata?.lifecycleState;
  return STATE_RANK[s] !== undefined ? s : 'FRESH';
}

/**
 * Advance an entry to its new lifecycle state (monotonic, deterministic).
 * @param {object} entry       MemoryEntry (+ metadata.extension fields)
 * @param {object} [o]         { now, confidence (precomputed), options (thresholds) }
 * @returns {'FRESH'|'AGING'|'STALE'|'ARCHIVED'}
 */
export function advance(entry, { now = Date.now(), confidence = null, options = {} } = {}) {
  const cfg = { ...LIFECYCLE_DEFAULTS, ...options };
  const t = now instanceof Date ? now.getTime() : now;
  const age = ageDaysOf(entry, t, cfg.msPerDay);
  const conf = confidence === null || confidence === undefined
    ? confidenceScore(entry, { now: t })
    : confidence;
  const m = entry?.metadata || {};
  const retrievalCount = Number(m.retrievalCount) || 0;

  let rule;
  if (age >= cfg.archiveAfterDays || conf < cfg.archiveBelowConfidence) rule = 'ARCHIVED';
  else if (age >= cfg.staleAfterDays || conf < cfg.staleBelowConfidence) rule = 'STALE';
  else if (age >= cfg.freshMaxAgeDays || (retrievalCount === 0 && age >= cfg.unaccessedDays)) rule = 'AGING';
  else rule = 'FRESH';

  // Monotonicity: never move backwards down the chain.
  return STATE_RANK[rule] >= STATE_RANK[currentState(entry)] ? rule : currentState(entry);
}

/**
 * EXPLICIT re-reinforcement: the ONLY path back up the chain (e.g. STALE →
 * FRESH). Pairs with confidence.reinforce(). Returns a NEW entry.
 */
export function reinforced(entry, { now = Date.now() } = {}) {
  const t = now instanceof Date ? now.getTime() : now;
  const m = entry?.metadata || {};
  return { ...entry, metadata: { ...m, lifecycleState: 'FRESH', lastReinforcedAt: t } };
}

/** Entry with its state advanced (immutable style). */
export function advanceEntry(entry, o = {}) {
  const state = advance(entry, o);
  if (state === currentState(entry)) return entry;
  return { ...entry, metadata: { ...(entry.metadata || {}), lifecycleState: state } };
}

/** Advance a whole list (a sweep). Returns new entries; never mutates. */
export function sweep(entries, o = {}) {
  return (entries || []).map((e) => advanceEntry(e, o));
}

/** ARCHIVED test — the retrieval-exclusion predicate. */
export function isArchived(entry) {
  return currentState(entry) === 'ARCHIVED' || Boolean(entry?.metadata?.archived);
}

export { currentState as stateOf };

export default { LIFECYCLE_STATES, STATE_RANK, LIFECYCLE_DEFAULTS, advance, advanceEntry, reinforced, sweep, isArchived, stateOf: currentState };
