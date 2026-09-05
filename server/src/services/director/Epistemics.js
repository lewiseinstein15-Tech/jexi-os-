/**
 * JEXI OS — EPISTEMIC STATUS VOCABULARY (AGI Phase B).
 *
 * One shared language for "how do I know this?" across every subsystem.
 * A claim's epistemic state is a FIRST-CLASS property — the same sentence of
 * knowledge is different depending on whether JEXI observed it, the user said
 * it, a model inferred it, or it was merely assumed to make progress.
 *
 * States (strongest → weakest):
 *   KNOWN        — directly observed or verified against reality.
 *   LIKELY       — inferred by a model; plausible, unverified.
 *   UNCERTAIN    — assumed or predicted; adopted, not established.
 *   UNKNOWN      — no information. Always representable, never guessed over.
 *   CONTRADICTED — established evidence disagrees; the claim is in conflict.
 *
 * Sources and what they can establish:
 *   OBSERVED / VERIFIED  → KNOWN
 *   USER_STATED          → KNOWN (about the user's intent/word)
 *   INFERRED             → LIKELY at best
 *   ASSUMED / PREDICTED  → UNCERTAIN
 *
 * HARD RULES (tested in tests/agi/test-epistemics.js):
 *   1. An inference NEVER becomes KNOWN by repetition, confidence, or
 *      re-inference. Only observation or verification promotes to KNOWN.
 *   2. A PREDICTION (simulation output) can never be stored as an observation.
 *      It stays a prediction until reality is actually checked.
 *   3. Conflicting established claims (same key, different values) are marked
 *      CONTRADICTED — never silently overwritten with the newest.
 *   4. Confidence is carried separately and clamped to [0,1]; it never
 *      substitutes for evidence.
 */

export const EPISTEMIC_STATES = ['KNOWN', 'LIKELY', 'UNCERTAIN', 'UNKNOWN', 'CONTRADICTED'];

/* What each source class is allowed to establish. */
const SOURCE_MAX = {
  OBSERVED: 'KNOWN',
  VERIFIED: 'KNOWN',
  USER_STATED: 'KNOWN',
  INFERRED: 'LIKELY',
  ASSUMED: 'UNCERTAIN',
  PREDICTED: 'UNCERTAIN',
  NONE: 'UNKNOWN',
};

const RANK = { UNKNOWN: 0, CONTRADICTED: 0, UNCERTAIN: 1, LIKELY: 2, KNOWN: 3 };

export function isEpistemicState(s) {
  return EPISTEMIC_STATES.includes(s);
}

/**
 * Map a provenance label (ObjectiveInterpreter vocabulary) to an epistemic
 * state — the bridge between the B215 provenance tags and this vocabulary.
 */
export function epistemicStateOfProvenance(provenance) {
  switch (provenance) {
    case 'USER_STATED': return 'KNOWN';
    case 'OBSERVED':
    case 'VERIFIED': return 'KNOWN';
    case 'INFERRED': return 'LIKELY';
    case 'ASSUMED':
    case 'PREDICTED': return 'UNCERTAIN';
    default: return 'UNKNOWN';
  }
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

/**
 * Create a normalized claim record.
 * @param {object} p
 *   key    — canonical subject this claim is about (for contradiction detection)
 *   value  — what is claimed about the key (string/number/boolean)
 *   source — OBSERVED|VERIFIED|USER_STATED|INFERRED|ASSUMED|PREDICTED
 *   confidence — 0..1 (carried, never a substitute for evidence)
 *   evidence   — short human string or array: WHY this source says so
 */
export function makeClaim({ key, value, source = 'INFERRED', confidence = 0.5, evidence = null, at = null }) {
  const src = source && SOURCE_MAX[source] ? source : 'NONE';
  const prediction = src === 'PREDICTED';
  return {
    key: key !== undefined && key !== null ? String(key).slice(0, 200) : null,
    value: value === undefined ? null : value,
    source: src,
    epistemic: SOURCE_MAX[src],
    prediction, // simulation output — can never be promoted except by observation
    confidence: clamp01(confidence),
    evidence: Array.isArray(evidence) ? evidence.map((e) => String(e).slice(0, 300)).slice(0, 8)
      : evidence ? [String(evidence).slice(0, 300)] : [],
    at: at || new Date().toISOString(),
    history: [{ source: src, at: at || new Date().toISOString() }],
  };
}

/**
 * Merge an incoming claim into an existing one (same key).
 * - Stronger evidence can raise the state; weaker evidence can NEVER lower it.
 * - Only OBSERVED/VERIFIED promote to KNOWN. Repeated inference adds nothing.
 * - Established claims with DIFFERENT values → CONTRADICTED (both kept).
 */
export function mergeClaims(existing, incoming) {
  if (!existing || !incoming) return existing || incoming || null;

  const sameKey = existing.key !== null && existing.key === incoming.key;

  // Contradiction requires COMPARABLE strength: two independently established
  // claims (both KNOWN — observed/verified/user-stated) that disagree. A weak
  // source disagreeing with a strong one is not a contradiction; the strong
  // evidence simply stands.
  if (sameKey && existing.epistemic === 'KNOWN' && incoming.epistemic === 'KNOWN' && existing.value !== incoming.value) {
    return {
      ...existing,
      epistemic: 'CONTRADICTED',
      confidence: Math.min(clamp01(existing.confidence), clamp01(incoming.confidence), 0.5),
      value: undefined,
      conflict: [existing, incoming],
      history: [...(existing.history || []), ...(incoming.history || [])],
    };
  }

  // Promotion: only observation/verification reaches KNOWN.
  const canPromote = (inc) => inc.source === 'OBSERVED' || inc.source === 'VERIFIED';
  const incomingRank = RANK[incoming.epistemic] || 0;
  const existingRank = RANK[existing.epistemic] || 0;
  const nextRank = Math.max(existingRank, canPromote(incoming) ? 3 : incomingRank);
  const nextState = nextRank === 3 ? 'KNOWN' : nextRank === 2 ? 'LIKELY' : nextRank === 1 ? 'UNCERTAIN' : 'UNKNOWN';

  // A prediction can only stop being a prediction via observation.
  const stillPrediction = existing.prediction && !canPromote(incoming);

  // The value follows the STRONGER evidence; weaker evidence never overwrites.
  const strongerIncoming = canPromote(incoming) || incomingRank > existingRank;

  return {
    ...existing,
    epistemic: nextState,
    prediction: stillPrediction,
    value: strongerIncoming ? incoming.value : existing.value,
    confidence: clamp01(Math.max(existing.confidence, incoming.confidence)),
    evidence: [...(existing.evidence || []), ...(incoming.evidence || [])].slice(-8),
    history: [...(existing.history || []), ...(incoming.history || [])].slice(-16),
  };
}

/**
 * Try to promote a claim with new evidence. Enforces the hard rules:
 * returns { ok, claim, reason } — promotion to KNOWN requires observation or
 * verification; a prediction without observation stays a prediction.
 */
export function upgradeClaim(claim, { source, evidence = null, confidence } = {}) {
  if (!claim) return { ok: false, claim, reason: 'no claim' };
  if (!SOURCE_MAX[source]) return { ok: false, claim, reason: `unknown source '${source}'` };
  if (claim.epistemic === 'CONTRADICTED') {
    return { ok: false, claim, reason: 'contradicted claims need resolution before promotion' };
  }
  if (claim.prediction && source !== 'OBSERVED' && source !== 'VERIFIED') {
    return { ok: false, claim, reason: 'a prediction can only be settled by observation or verification' };
  }
  if (source !== 'OBSERVED' && source !== 'VERIFIED' && claim.epistemic !== 'KNOWN') {
    // Inference/assumption can nudge within its ceiling but never to KNOWN.
    const merged = mergeClaims(claim, makeClaim({ key: claim.key, value: claim.value, source, confidence, evidence }));
    return { ok: merged.epistemic !== 'KNOWN', claim: merged, reason: merged.epistemic === 'KNOWN' ? 'promotion to KNOWN requires observation' : null };
  }
  const merged = mergeClaims(claim, makeClaim({ key: claim.key, value: claim.value, source, confidence, evidence }));
  return { ok: true, claim: merged, reason: null };
}

/**
 * Aggregate view for reporting/UI: counts per state + the weakest link.
 */
export function epistemicSummary(claims = []) {
  const counts = { KNOWN: 0, LIKELY: 0, UNCERTAIN: 0, UNKNOWN: 0, CONTRADICTED: 0 };
  for (const c of claims) {
    const s = isEpistemicState(c && c.epistemic) ? c.epistemic : 'UNKNOWN';
    counts[s] += 1;
  }
  return {
    counts,
    total: claims.length,
    weakest: Object.entries(counts).filter(([, n]) => n > 0).map(([s]) => s)
      .sort((a, b) => (RANK[a] || 0) - (RANK[b] || 0))[0] || null,
  };
}
