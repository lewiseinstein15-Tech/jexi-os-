/**
 * JEXI OS — AGENT — verification configuration for a coding turn.
 *
 * M22 — the coding loop's verify path used a fixed layer list. That is right
 * for a repo JEXI can auto-detect, but a caller that KNOWS the project shape
 * (the HumanEval harness: flat sandbox, `solution.py`, exec-style test file)
 * needs to say how the project is verified instead of leaving it to a
 * heuristic that guesses `pytest` and then reports `unverifiable`.
 *
 * This module is deliberately tiny and pure:
 *   - `parseVerifyLayers` reads a comma-separated layer list (the CODE_VERIFY
 *     env seam) into canonical layer names, or null when unset/empty;
 *   - `extractEntryPoint` reads the function name a task asks to define, so the
 *     syntax layer can check the target function exists and is not a stub.
 *
 * Neither can weaken a gate: they only choose WHICH real verifiers run and what
 * the structural reader looks for.
 */

import { VERIFY_LAYER_ORDER } from '../../verification/layers.js';

const KNOWN = new Set(VERIFY_LAYER_ORDER);

/**
 * Parse a verification layer list.
 * @param {string|string[]|null|undefined} spec
 * @returns {string[]|null} canonical layers in VERIFY_LAYER_ORDER order, or null
 */
export function parseVerifyLayers(spec) {
  if (spec == null) return null;
  const raw = Array.isArray(spec) ? spec : String(spec).split(',');
  const wanted = new Set(
    raw.map((s) => String(s || '').trim().toLowerCase()).filter((s) => KNOWN.has(s)),
  );
  if (!wanted.size) return null;
  return VERIFY_LAYER_ORDER.filter((l) => wanted.has(l));
}

/**
 * The function name a coding task asks to define. The HumanEval query names it
 * ("Keep the exact function name (has_close_elements) and signature"), and the
 * prose variants name it the same way, so one pattern covers them.
 * @param {string} text
 * @returns {string|null}
 */
export function extractEntryPoint(text) {
  const s = String(text ?? '');
  const m = s.match(/function\s+name\s*\(?\s*([A-Za-z_]\w{1,60})\s*\)?/i)
    || s.match(/\bdef\s+([A-Za-z_]\w{1,60})\s*\(/);
  return m ? m[1] : null;
}
