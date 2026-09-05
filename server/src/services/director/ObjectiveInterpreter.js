/**
 * B215 — OBJECTIVE INTERPRETER: the structured objective state (spec Part 4).
 *
 * The Director's interpret step (RealAdapters → INTERPRET_SYSTEM) produces the
 * refinement JSON. This module turns that refinement into an EXPLICIT
 * structured objective state where every requirement carries its PROVENANCE:
 *
 *   USER_STATED — the words trace back to the user's verbatim message
 *   INFERRED    — the interpreter reconstructed it (professional judgment)
 *   ASSUMED     — an assumption made to proceed (recoverable guess)
 *   UNKNOWN     — a genuinely open question that could change the result
 *
 * Rules (deterministic, auditable — no new LLM calls):
 *   - constraints/successCriteria: USER_STATED when ≥60% of the entry's
 *     significant tokens appear in the raw user message, else INFERRED.
 *   - assumptions[] → ASSUMED (verbatim from the interpreter).
 *   - unknowns[] → UNKNOWN (verbatim; NEVER fabricated — a lane that returns
 *     none gets an honest empty list, not invented doubts).
 *   - requiredCapabilities: derived from the subtasks the plan actually
 *     calls for (capability + requirements + department).
 *   - desiredOutcome / requiredArtifacts: passed through when the lane
 *     provides them (B215 schema), else derived honestly:
 *     desiredOutcome falls back to refinedObjective (tagged INFERRED),
 *     requiredArtifacts falls back to [] (never guessed).
 *
 * Downstream honesty: a reconnecting browser, the mission planner and the
 * verifier can all ask "what did the user ACTUALLY ask for?" and get an
 * answer tagged with where each line came from.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'without', 'to', 'of', 'in', 'on',
  'at', 'by', 'as', 'is', 'are', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'my', 'your', 'our', 'their', 'me', 'you', 'us', 'them', 'i', 'we', 'they',
  'should', 'must', 'will', 'would', 'can', 'could', 'do', 'does', 'did', 'not', 'no',
  'yes', 'so', 'if', 'then', 'than', 'from', 'into', 'about', 'please', 'want', 'need',
  'make', 'made', 'using', 'use', 'like',
]);

/** lowercase, strip punctuation, drop stopwords + short words → significant tokens */
export function significantTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Does this entry trace back to the user's verbatim words?
 * USER_STATED when ≥60% of the entry's significant tokens appear in the
 * user's message tokens (or the user message contains the entry nearly
 * verbatim). Deterministic; conservative (defaults to INFERRED).
 */
export function provenanceOf(entry, userTokens) {
  const tokens = significantTokens(entry);
  if (!tokens.length || !userTokens.size) return 'INFERRED';
  const hits = tokens.filter((t) => userTokens.has(t)).length;
  return hits / tokens.length >= 0.6 ? 'USER_STATED' : 'INFERRED';
}

const asStrings = (v, cap = 12) =>
  (Array.isArray(v) ? v : []).map((s) => String(s).slice(0, 300)).filter(Boolean).slice(0, cap);

/**
 * Build the structured objective state from a refinement + the raw user
 * message. Pure: no persistence, no LLM, no side effects.
 */
export function structureObjective(refinement, rawUserMessage) {
  const r = refinement || {};
  const userTokens = new Set(significantTokens(rawUserMessage));

  const tagList = (items) =>
    asStrings(items).map((text) => ({ text, provenance: provenanceOf(text, userTokens) }));

  const constraints = tagList(r.constraints);
  const successCriteria = tagList(r.successCriteria);

  const requirements = {
    userStated: [
      ...constraints.filter((c) => c.provenance === 'USER_STATED').map((c) => c.text),
      ...successCriteria.filter((c) => c.provenance === 'USER_STATED').map((c) => c.text),
    ],
    inferred: [
      ...constraints.filter((c) => c.provenance === 'INFERRED').map((c) => c.text),
      ...successCriteria.filter((c) => c.provenance === 'INFERRED').map((c) => c.text),
    ],
  };

  const assumptions = asStrings(r.assumptions).map((text) => ({ text, provenance: 'ASSUMED', epistemic: 'UNCERTAIN' }));
  const unknowns = asStrings(r.unknowns).map((text) => ({ text, provenance: 'UNKNOWN', epistemic: 'UNKNOWN' }));

  // desiredOutcome: the lane's own words when provided; else the refined
  // objective IS the interpreted outcome (tagged INFERRED, never USER_STATED
  // — the refined objective is by definition the interpreter's reconstruction).
  const desiredOutcome = r.desiredOutcome
    ? { text: String(r.desiredOutcome).slice(0, 400), provenance: provenanceOf(r.desiredOutcome, userTokens) }
    : { text: String(r.refinedObjective || '').slice(0, 400), provenance: 'INFERRED' };

  // capabilities the plan actually calls for (derived, not declared)
  const subtasks = Array.isArray(r.subtasks) ? r.subtasks : [];
  const capSet = new Set();
  for (const st of subtasks) {
    if (st.capability) capSet.add(String(st.capability).toLowerCase());
    for (const req of Array.isArray(st.requirements) ? st.requirements : []) capSet.add(String(req).toLowerCase());
    if (st.department) capSet.add(`dept:${String(st.department).toLowerCase()}`);
  }
  const requiredCapabilities = [...capSet].filter(Boolean).slice(0, 16);

  const requiredArtifacts = asStrings(r.requiredArtifacts, 8); // honest [] when the lane gives none

  const provided = {
    desiredOutcome: Boolean(r.desiredOutcome),
    unknowns: Array.isArray(r.unknowns) && r.unknowns.length > 0,
    requiredArtifacts: Array.isArray(r.requiredArtifacts) && r.requiredArtifacts.length > 0,
  };

  return {
    objective: String(r.refinedObjective || '').slice(0, 800),
    desiredOutcome,
    taskType: r.taskType || null,
    complexity: r.complexity || null,
    risk: {
      flagged: Boolean(r.risky),
      ambiguity: r.ambiguity || null,
    },
    constraints,
    successCriteria,
    requirements,
    assumptions,
    unknowns,
    requiredCapabilities,
    requiredArtifacts,
    provenanceCounts: {
      USER_STATED: requirements.userStated.length,
      INFERRED: requirements.inferred.length,
      ASSUMED: assumptions.length,
      UNKNOWN: unknowns.length,
    },
    epistemics: {
      // Phase B: the same objective, stated in terms of how well it is known.
      // Inferences stay LIKELY until observed or verified — repetition of an
      // inference NEVER promotes it (see director/Epistemics.js hard rules).
      outcome: desiredOutcome.provenance === 'USER_STATED' || desiredOutcome.provenance === 'OBSERVED'
        ? 'KNOWN'
        : desiredOutcome.provenance === 'UNKNOWN' ? 'UNKNOWN' : 'LIKELY',
      assumptions: assumptions.length ? 'UNCERTAIN' : null,
      unknowns: unknowns.length ? 'UNKNOWN' : null,
    },
    laneProvided: provided, // honesty: which B215 fields the lane itself returned vs derived
  };
}

/** One compact human-readable line per structured objective (for events/UI). */
export function objectiveProvenanceSummary(so) {
  if (!so) return '';
  const p = so.provenanceCounts || {};
  return `${p.USER_STATED || 0} user-stated · ${p.INFERRED || 0} inferred · ${p.ASSUMED || 0} assumed · ${p.UNKNOWN || 0} unknown`;
}
