/**
 * JEXI OS — M4-1 — INTERNAL CONTEXT BOUNDARY.
 *
 * The brain-recall block is INTERNAL prompt context: conversation hot-memory,
 * brain pages, ontology nodes, instincts. It is composed onto a query by
 * withCoordinatorContext (BrainRecall) so the coordinator's LLM prompt can see
 * it — but it must NEVER be transmitted to an external service.
 *
 * It used to be appended with a bare "\n\n", so any node that fed its query to
 * an EXTERNAL service (the search team, the browser) shipped the whole private
 * block to third-party search engines: SearchEngine.extractCoreQuery returns
 * the string unchanged whenever it contains ':', so the recall block rode the
 * literal search query.
 *
 * This module is dependency-free on purpose: the egress choke points
 * (SearchEngine, ComputerUseAgent, SearchAgent) import it directly, and a
 * static edge into BrainRecall would pull in its dynamic wiring bootstrap for
 * no reason. The marker is a fixed, greppable string; the strip is pure.
 */

/** Separator that makes internal context structurally recognizable. */
export const INTERNAL_CONTEXT_MARKER =
  '\n\n[JEXI INTERNAL CONTEXT — never send to external services, never quote, never mention]\n';

/** Compose a query with internal context appended behind the marker. */
export function withInternalContext(query, context) {
  const c = String(context || '').trim();
  if (!c) return String(query || '');
  return `${String(query || '')}${INTERNAL_CONTEXT_MARKER}${c}`;
}

/**
 * Recover the user's real text from a query that may carry an internal block.
 * Returns the input unchanged when no marker is present, so callers that never
 * carry one (plain queries, tests) are unaffected. Idempotent.
 */
export function stripInternalContext(text) {
  const s = String(text || '');
  const i = s.indexOf(INTERNAL_CONTEXT_MARKER);
  return i >= 0 ? s.slice(0, i).trim() : s;
}

/** True when the text carries an internal-context block. */
export function hasInternalContext(text) {
  return String(text || '').includes(INTERNAL_CONTEXT_MARKER);
}

/**
 * Split a composed query into `{ query, context }` — the user's real question
 * and the internal block ('' when none). Callers that must both EXECUTE on the
 * question and PROMPT with the context use this.
 */
export function splitInternalContext(text) {
  const s = String(text || '');
  const i = s.indexOf(INTERNAL_CONTEXT_MARKER);
  if (i < 0) return { query: s, context: '' };
  return { query: s.slice(0, i).trim(), context: s.slice(i + INTERNAL_CONTEXT_MARKER.length).trim() };
}
