/**
 * JEXI OS — Phase 7 Scope C: CONTINUOUS LEARNING — instinct model.
 *
 * An instinct is an atomic, evidence-backed pattern the system noticed while
 * working, with a confidence score. ECC continuous-learning-v2 reference:
 * instincts are small, verifiable, and accumulated — never hand-written.
 *
 * Instinct contract:
 *   {
 *     id:          unique string            — deterministic hash of type+pattern
 *     pattern:     short description of the pattern
 *     type:        'error_resolution' | 'user_corrections' | 'workarounds' |
 *                  'debugging_techniques' | 'project_specific'
 *     confidence:  number (0.0 – 1.0)
 *     evidence:    [{ turn, tool, result }]
 *     scope:       'project' | 'global'
 *     createdAt:   timestamp
 *     lastSeen:    timestamp
 *   }
 */

import { createHash } from 'node:crypto';

export const INSTINCT_TYPES = Object.freeze([
  'error_resolution',
  'user_corrections',
  'workarounds',
  'debugging_techniques',
  'project_specific',
]);

export const INSTINCT_SCOPES = Object.freeze(['project', 'global']);

/** Hard cap on stored evidence entries per instinct (append-only store keeps lines small). */
export const MAX_EVIDENCE = 50;

/** One day in ms — "how recent it was" window for confidence scoring. */
const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Confidence scoring (deterministic, spec factors):
 *   base 0.3
 *   + 0.1 per sighting beyond the first (capped at +0.4 — "how many times seen")
 *   + 0.2 if the pattern's resolution succeeded ("whether it succeeded")
 *   + 0.1 if seen recently ("how recent it was" — within RECENCY_WINDOW_MS)
 *   − 0.15 if the same pattern failed on a previous sighting ("failed before")
 *   clamped to [0.05, 0.95] — nothing is ever certain, nothing is discarded.
 */
export function computeConfidence({ sightings = 1, succeeded = true, recent = true, failedBefore = false } = {}) {
  const seen = Math.max(1, Math.floor(Number(sightings) || 1));
  const seenBonus = Math.min(0.4, 0.1 * (seen - 1));
  let c = 0.3
    + seenBonus
    + (succeeded ? 0.2 : 0)
    + (recent ? 0.1 : 0)
    + (failedBefore ? -0.15 : 0);
  c = Math.min(0.95, Math.max(0.05, c));
  return Math.round(c * 100) / 100;
}

/** Deterministic id: same pattern+type across sessions folds into ONE instinct. */
export function instinctId(type, pattern) {
  const norm = String(pattern).toLowerCase().replace(/\s+/g, ' ').trim();
  return 'inst-' + createHash('sha1').update(`${type}|${norm}`).digest('hex').slice(0, 12);
}

export function normalizePattern(pattern) {
  return String(pattern).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function distinctSessions(evidence = []) {
  const ids = new Set();
  for (const e of evidence) if (e && e.sessionId) ids.add(e.sessionId);
  return [...ids];
}

/**
 * Build a fresh instinct from an analyzer candidate.
 * candidate: { pattern, type, evidence:[{turn,tool,result,sessionId}], succeeded, sightings }
 */
export function createInstinct(candidate, { scope = 'project', now = new Date().toISOString() } = {}) {
  const pattern = normalizePattern(candidate?.pattern);
  if (!pattern) throw new Error('instinct needs a pattern');
  if (!INSTINCT_TYPES.includes(candidate?.type)) {
    throw new Error(`instinct type "${candidate?.type}" is not one of ${INSTINCT_TYPES.join(' | ')}`);
  }
  const evidence = (Array.isArray(candidate?.evidence) ? candidate.evidence : [])
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE)
    .map((e) => ({ turn: e.turn ?? null, tool: e.tool ?? null, result: String(e.result ?? ''), sessionId: e.sessionId ?? null }));
  const succeeded = candidate?.succeeded !== false;
  const sightings = Math.max(1, Math.floor(Number(candidate?.sightings) || 1));
  return {
    id: instinctId(candidate.type, pattern),
    pattern,
    type: candidate.type,
    confidence: computeConfidence({ sightings, succeeded, recent: true, failedBefore: false }),
    evidence,
    scope,
    sightings,
    sessionIds: distinctSessions(evidence),
    lastOutcome: succeeded ? 'succeeded' : 'failed',
    createdAt: now,
    lastSeen: now,
    promoted: false,
  };
}

/**
 * Fold a new sighting into an existing instinct — returns a NEW snapshot
 * (the store is append-only; the snapshot is what gets appended as a line).
 */
export function sightInstinct(existing, candidate, { now = new Date().toISOString() } = {}) {
  const evidence = [...(existing.evidence || []), ...(candidate?.evidence || [])]
    .filter(Boolean)
    .map((e) => ({ turn: e.turn ?? null, tool: e.tool ?? null, result: String(e.result ?? ''), sessionId: e.sessionId ?? null }))
    .filter((e, i, arr) => arr.findIndex((o) => JSON.stringify(o) === JSON.stringify(e)) === i)
    .slice(-MAX_EVIDENCE);
  const sessionIds = [...new Set([...(existing.sessionIds || []), ...distinctSessions(candidate?.evidence || [])])];
  const sightings = Math.max(1, (existing.sightings || 1) + Math.max(1, Math.floor(Number(candidate?.sightings) || 1)));
  const succeeded = candidate?.succeeded !== false;
  const prevSeen = existing.lastSeen ? Date.parse(existing.lastSeen) : NaN;
  const recent = Number.isFinite(prevSeen) ? (Date.now() - prevSeen) < RECENCY_WINDOW_MS : true;
  const failedBefore = existing.lastOutcome === 'failed';
  return {
    ...existing,
    evidence,
    sessionIds,
    sightings,
    confidence: computeConfidence({ sightings, succeeded, recent, failedBefore }),
    lastOutcome: succeeded ? 'succeeded' : 'failed',
    lastSeen: now,
    promoted: Boolean(existing.promoted),
  };
}

/** Validate the contract — throws with a precise reason when violated. */
export function validateInstinct(obj) {
  const problems = [];
  if (!obj || typeof obj !== 'object') problems.push('not an object');
  if (typeof obj.id !== 'string' || !obj.id) problems.push('id missing');
  if (typeof obj.pattern !== 'string' || !obj.pattern) problems.push('pattern missing');
  if (!INSTINCT_TYPES.includes(obj.type)) problems.push(`bad type "${obj.type}"`);
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) problems.push('confidence out of [0,1]');
  if (!Array.isArray(obj.evidence)) problems.push('evidence not an array');
  if (!INSTINCT_SCOPES.includes(obj.scope)) problems.push(`bad scope "${obj.scope}"`);
  if (!obj.createdAt || !obj.lastSeen) problems.push('createdAt/lastSeen missing');
  if (problems.length) throw new Error(`invalid instinct: ${problems.join('; ')}`);
  return true;
}

/** Compact an evidence entry — journal entries are verbose, evidence is not. */
export function evidenceEntry({ turn, tool, result, sessionId }) {
  const r = String(result ?? '');
  return {
    turn: turn ?? null,
    tool: tool ?? null,
    result: (r.startsWith('error:') ? r : (r === 'ok' ? 'ok' : `error: ${r}`)).slice(0, 140),
    sessionId: sessionId ?? null,
  };
}
