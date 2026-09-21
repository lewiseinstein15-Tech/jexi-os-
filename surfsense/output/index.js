/**
 * JEXI OS — Phase 19 Scope C — surfsense/output entry point.
 *
 * Contract:
 *   output.formats()                        -> [12 format names, canonical order]
 *   output.render(docs, { format, query })  -> rendered string
 *   output.assert(format)                   -> format | throws E_UNKNOWN_FORMAT
 *
 * The 12 formats: summary, bullet-list, qa, timeline, comparison-table,
 * mind-map-outline, podcast-script-stub, faq, executive-brief, deep-dive,
 * chronological, thematic. All are deterministic rule-based transformations
 * of the caller's (typically search-ranked) documents — no LLM, no network.
 * 'podcast-script-stub' is a deliberate stub that Scope D's podcast
 * generator replaces when wired.
 *
 * Errors (SurfError, reused from surfsense/connectors/_internal.js):
 *   E_UNKNOWN_FORMAT — format name not among the 12 (assert throws; render
 *                      dispatches through assert)
 *   E_MISSING_FIELD  — a format-required doc field is absent/unparseable
 *                      (e.g. "date" for timeline/chronological; message
 *                      names the field)
 *   E_INVALID_DOC    — bad document shape (Scope B's public validateDocs,
 *                      reused via surfsense/search/keyword.js)
 *   E_INVALID_QUERY  — query provided but not a non-empty string
 *
 * Empty docs -> '' for every known format (empty input is not an error).
 * Determinism is owned here: renderers use fixed ordering (caller rank
 * order, or date asc / alpha / id-asc tiebreaks). Callers must not re-sort.
 */
import { FORMAT_NAMES, RENDERERS } from './formats.js';
import { render, assert } from './render.js';

/** output.formats() -> fresh array of the 12 format names (canonical order). */
export function formats() {
  return [...FORMAT_NAMES];
}

export { render, assert, FORMAT_NAMES, RENDERERS };

export default { formats, render, assert, FORMAT_NAMES, RENDERERS };
