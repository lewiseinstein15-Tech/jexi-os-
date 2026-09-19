/**
 * JEXI OS — Phase 17 Scope D — MEMORY / CONFIDENCE (enhancement layer).
 *
 * Deterministic, documented confidence scoring for memory entries that follow
 * the Phase 4 `MemoryEntry` contract (server/src/memory/interface/
 * MemoryProvider.js:21-30): { id, missionId, tier, content, embedding?,
 * metadata?, createdAt (epoch ms), expiresAt? }. Extension data lives in
 * `metadata` so no Phase 4 column changes are needed:
 *
 *   metadata.sourceReliability   number 0..1   (default 0.5)
 *   metadata.retrievalCount      number          (bookkeeping ONLY — see below)
 *   metadata.reinforcements      number|number[] explicit reinforcement events
 *   metadata.contradictions      number          contradicted count
 *
 * FACTORS (weights sum to 1.0 over the positive three):
 *   source reliability  w=0.35  — who/what produced the entry.
 *   recency             w=0.40  — exponential decay, half-life 30 days:
 *                                 recency = 0.5 ** (ageDays / 30). DECAY IS
 *                                 DOCUMENTED BEHAVIOUR: confidence falls as
 *                                 `now` moves away from `createdAt`, with a
 *                                 fixed half-life, deterministically.
 *   reinforcement       w=0.25  — explicit reinforcement only:
 *                                 factor = 1 − 0.8^reinfCount (asymptotic cap 1).
 *   contradictions      penalty −0.20 each, capped at 3 (−0.60 max), then
 *                       clamped to [0, 1].
 *
 * DETERMINISM: same entry + same `now` ⇒ bit-identical score. No randomness,
 * no wall clock unless the caller omits `now`.
 *
 * RETRIEVAL IS NOT REINFORCEMENT: `retrievalCount` is deliberately given ZERO
 * weight here. Reading a memory must never make it more confident — only
 * `reinforce()` (an explicit human/agent act) raises the score. The count is
 * still carried for the lifecycle module's access-pattern rules.
 */

/** Default scoring constants — all documented, all overridable. */
export const CONFIDENCE_DEFAULTS = Object.freeze({
  halfLifeDays: 30,
  weights: Object.freeze({ source: 0.35, recency: 0.4, reinforcement: 0.25 }),
  contradictionPenalty: 0.2,
  maxCountedContradictions: 3,
  reinforcementDamping: 0.8, // factor = 1 − damping^count
  defaultSourceReliability: 0.5,
  msPerDay: 86_400_000,
});

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function metaOf(entry) {
  return (entry && entry.metadata) || {};
}

/** Explicit reinforcement count from metadata (array of timestamps or number). */
export function reinforcementCount(entry) {
  const r = metaOf(entry).reinforcements;
  if (Array.isArray(r)) return r.length;
  return typeof r === 'number' && r > 0 ? r : 0;
}

/**
 * Score a memory entry: confidence ∈ [0, 1]. Deterministic in
 * (entry, now). Accepts `now` as epoch ms or a Date.
 */
export function confidenceScore(entry, { now = Date.now(), options = {} } = {}) {
  const cfg = { ...CONFIDENCE_DEFAULTS, ...options };
  const t = now instanceof Date ? now.getTime() : now;
  const m = metaOf(entry);
  const createdAt = Number(entry.createdAt) || t;

  const source = clamp01(Number(m.sourceReliability ?? cfg.defaultSourceReliability));
  const ageDays = Math.max(0, (t - createdAt) / cfg.msPerDay);
  const recency = Math.pow(0.5, ageDays / cfg.halfLifeDays);
  const reinforcement = 1 - Math.pow(cfg.reinforcementDamping, reinforcementCount(entry));
  const contradictions = Math.min(Number(m.contradictions) || 0, cfg.maxCountedContradictions);

  const raw = cfg.weights.source * source
    + cfg.weights.recency * recency
    + cfg.weights.reinforcement * reinforcement
    - cfg.contradictionPenalty * contradictions;

  return clamp01(raw);
}

/**
 * Score + full factor breakdown (for probes, HUD, and audits).
 * `retrievalCount` is reported INFORMATIONALLY with weight 0 — proof that
 * mere retrieval does not move the score.
 */
export function confidenceBreakdown(entry, { now = Date.now(), options = {} } = {}) {
  const cfg = { ...CONFIDENCE_DEFAULTS, ...options };
  const t = now instanceof Date ? now.getTime() : now;
  const m = metaOf(entry);
  const createdAt = Number(entry.createdAt) || t;
  const ageDays = Math.max(0, (t - createdAt) / cfg.msPerDay);
  const source = clamp01(Number(m.sourceReliability ?? cfg.defaultSourceReliability));
  const recency = Math.pow(0.5, ageDays / cfg.halfLifeDays);
  const reinforcement = 1 - Math.pow(cfg.reinforcementDamping, reinforcementCount(entry));
  const contradictionPenalty = cfg.contradictionPenalty * Math.min(Number(m.contradictions) || 0, cfg.maxCountedContradictions);
  return {
    score: confidenceScore(entry, { now: t, options }),
    factors: {
      sourceReliability: source,
      recencyFactor: recency,
      ageDays,
      reinforcementFactor: reinforcement,
      reinforcementCount: reinforcementCount(entry),
      contradictionPenalty,
      retrievalCount: Number(m.retrievalCount) || 0,
      retrievalWeight: 0, // retrieval must never raise confidence
    },
    weights: { ...cfg.weights },
    halfLifeDays: cfg.halfLifeDays,
  };
}

/**
 * EXPLICIT reinforcement — the only operation that raises confidence.
 * Returns a NEW entry (immutable style) with metadata.reinforcements appended.
 */
export function reinforce(entry, { now = Date.now() } = {}) {
  const t = now instanceof Date ? now.getTime() : now;
  const m = metaOf(entry);
  const list = Array.isArray(m.reinforcements) ? [...m.reinforcements] : reinforcementCount(entry) > 0
    ? Array.from({ length: reinforcementCount(entry) }, () => t)
    : [];
  list.push(t);
  return { ...entry, metadata: { ...m, reinforcements: list } };
}

/**
 * Register that this entry was contradicted (by `byId`, if given). Lowers the
 * score on the next computation. Returns a NEW entry.
 */
export function registerContradiction(entry, { byId = null } = {}) {
  const m = metaOf(entry);
  const contradictedBy = Array.isArray(m.contradictedBy) ? [...m.contradictedBy] : [];
  if (byId) contradictedBy.push(byId);
  return {
    ...entry,
    metadata: {
      ...m,
      contradictions: (Number(m.contradictions) || 0) + 1,
      contradictedBy,
    },
  };
}

/**
 * Retrieval bookkeeping — updates access counters WITHOUT touching any scored
 * factor. Lifecycle uses these fields; the score does not.
 */
export function noteRetrieval(entry, { now = Date.now() } = {}) {
  const t = now instanceof Date ? now.getTime() : now;
  const m = metaOf(entry);
  return {
    ...entry,
    metadata: {
      ...m,
      retrievalCount: (Number(m.retrievalCount) || 0) + 1,
      lastRetrievedAt: t,
    },
  };
}

export default { CONFIDENCE_DEFAULTS, confidenceScore, confidenceBreakdown, reinforce, registerContradiction, noteRetrieval, reinforcementCount };
