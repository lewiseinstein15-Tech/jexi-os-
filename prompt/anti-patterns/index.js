// prompt/anti-patterns/index.js
// Phase 25 — Scope L: public surface of the anti-pattern lint subsystem.
//
// Contract spellings:
//   lint.run(prompt)   -> { ok, findings: [{ ruleId, severity, location,
//                                          message, evidence }] }
//     ok === true  <=>  ZERO error-severity findings (RULE 1).
//     location = { section, charOffset } for single-section findings,
//                { sections: [...], charOffset } for duplicate/conflict.
//     evidence = the offending substring (deterministic excerpt for
//                whole-section findings).
//   lint.rules()       -> [{ id, severity, description }]  (9 rules)
//
// The 9 rules and their default severities (see rules.js / catalog.md):
//   AP-GOD-PROMPT       error   one section > 50% of total prompt chars
//   AP-VAGUE            warn    "use appropriate", "when needed", ...
//   AP-BRANCHING-PROSE  warn    "if X then Y", "in the case that", ...
//   AP-HARDCODED        warn    model names, file paths, magic numbers
//   AP-FLATTERY         error   "Great question", "Certainly!", ...
//   AP-SOFT-CONSTRAINT  error   "should try", "prefer to", "consider"
//   AP-NO-TERMINATION   warn    doing-tasks section with no exit condition
//   AP-DUPLICATE        warn    same rule in two sections
//   AP-CONFLICT         error   "always X" vs "never X"
//
// Determinism (RULE 3): same prompt -> same findings in the same order,
// byte for byte, no timestamps. Clean prompts produce ZERO findings
// (RULE 4 — verified by the probe on a balanced, imperative-voiced prompt).
// No LLM calls; pure string work over the built prompt's sections.
//
// Storage: none — this zone is a pure detector (no .jexi/ state needed).
//
// Zone discipline: prompt/assembly, constitution, tools, memory-fs,
// incidents, versioning, testing are NOT modified. prompt/versioning is
// READ-ONLY imported for its built-prompt normalizer (same definition of
// "a prompt" across scopes). server/** and events/** untouched.

import * as rulesMod from './rules.js';
import * as lintMod from './lint.js';

export { rulesMod, lintMod };

export const DEFAULT_SEVERITIES = rulesMod.DEFAULT_SEVERITIES;
export const SEVERITIES = rulesMod.SEVERITIES;
export const ANTI_PATTERN_CODES = rulesMod.ANTI_PATTERN_CODES;
export const RULES = rulesMod.RULES;

export const lint = {
  run: lintMod.run,
  rules: lintMod.rules,
};

export default lint;
