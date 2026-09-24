// prompt/anti-patterns/lint.js
// Phase 25 — Scope L: run every anti-pattern rule against a prompt.
//
// Contract spellings:
//   lint.run(prompt) ->
//     { ok: boolean,
//       findings: [{ ruleId, severity, location, message, evidence }] }
//     ok is true ONLY if there are ZERO error-severity findings (RULE 1);
//     warn/info findings are reported but never block.
//   lint.rules() -> [{ id, severity, description }]  (the full catalog)
//
// Input: the same built-prompt shapes versioning accepts (read-only import
// of the shared normalizer, so lint and snapshots always agree on what a
// prompt is):
//   - a string                          -> one section with id 'prompt'
//   - an array of {id, content}         -> ordered sections
//   - { sections: [...] } envelope      -> the array inside
//
// Determinism (RULE 3): rules run in catalog order; within a rule,
// sections in order, matches left to right; findings carry no timestamps.
// Same prompt -> byte-identical findings, every run.

import { normalizeBuiltPrompt } from '../versioning/snapshot.js';
import { RULES, ANTI_PATTERN_CODES } from './rules.js';

export { ANTI_PATTERN_CODES };

/**
 * lint.run(prompt) -> { ok, findings }
 * Throws (code E_INVALID_PROMPT) if `prompt` is not one of the accepted
 * built-prompt shapes.
 */
export function run(prompt) {
  const norm = normalizeBuiltPrompt(prompt);
  if (norm.error) {
    const err = new Error(`lint refused: ${norm.error}`);
    err.code = ANTI_PATTERN_CODES.INVALID_PROMPT;
    throw err;
  }
  const ctx = {
    sections: norm.sections,
    totalChars: norm.sections.reduce((sum, s) => sum + s.content.length, 0),
  };
  const findings = [];
  for (const rule of RULES) {
    const found = rule.detect(ctx);
    if (Array.isArray(found) && found.length > 0) findings.push(...found);
  }
  const ok = !findings.some((f) => f.severity === 'error');
  return { ok, findings };
}

/** lint.rules() -> [{ id, severity, description }] in catalog order. */
export function rules() {
  return RULES.map((r) => ({ id: r.id, severity: r.severity, description: r.description }));
}
