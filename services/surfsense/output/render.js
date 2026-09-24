/**
 * JEXI OS — Phase 19 Scope C — format dispatch.
 *
 * Contract:
 *   output.assert(format)               -> format (throws E_UNKNOWN_FORMAT)
 *   output.render(docs, { format, query }) -> rendered string
 *
 * Dispatch order (fixed):
 *   1. assert(format)            — unknown/missing format -> E_UNKNOWN_FORMAT
 *   2. validate docs             — Scope B's public validateDocs (reuse, not
 *                                  duplication) -> E_INVALID_DOC on bad shape
 *   3. empty docs -> ''          — empty input renders empty output, NOT an
 *                                  error, for every known format
 *   4. query guard               — optional; when present must be a non-empty
 *                                  string -> E_INVALID_QUERY
 *   5. renderer call             — per-format required-field checks (e.g.
 *                                  "date" for timeline) -> E_MISSING_FIELD
 *
 * Rendered output is a string for every format: uniform contract, directly
 * byte-comparable for determinism probes.
 */
import { SurfError } from '../connectors/_internal.js';
import { validateDocs } from '../search/keyword.js';
import { FORMAT_NAMES, RENDERERS } from './formats.js';

const KNOWN = new Set(FORMAT_NAMES);

/**
 * Assert a format name is one of the 12. Returns the format on success;
 * throws SurfError E_UNKNOWN_FORMAT otherwise (message lists all names).
 */
export function assert(format) {
  if (typeof format !== 'string' || !KNOWN.has(format)) {
    throw new SurfError(
      'E_UNKNOWN_FORMAT',
      `unknown output format ${String(format)} — known formats: ${FORMAT_NAMES.join(', ')}`
    );
  }
  return format;
}

/**
 * output.render(docs, { format, query }) -> rendered string.
 * Deterministic: pure function of (docs, format, query). Never mutates docs.
 */
export function render(docs, { format, query } = {}) {
  assert(format);
  validateDocs(docs);
  if (docs.length === 0) return '';
  if (query !== undefined && (typeof query !== 'string' || query.trim().length === 0)) {
    throw new SurfError('E_INVALID_QUERY', 'query must be a non-empty string when provided');
  }
  return RENDERERS[format](docs, query);
}
