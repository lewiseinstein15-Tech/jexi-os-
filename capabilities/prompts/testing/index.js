// prompt/testing/index.js
// Phase 25 — Scope K: public surface of the prompt test framework.
//
// Contract spellings:
//   testing.register(testSpec) -> { testId }
//     testSpec = { id?, description, prompt, assertions: [...] }
//   testing.run(testId)        -> { passed, failures, durationMs }
//     each failure: { index, kind, expected, actual, message } — the
//     assertion is NAMED, expected vs actual shown, nothing swallowed.
//
// Assertion kinds (see assertions.js for exact shapes):
//   { kind: 'contains',       value: string }
//   { kind: 'not-contains',   value: string }
//   { kind: 'matches-schema', schema: JSONSchema }   (JSON-Schema subset,
//                                                     zero dependencies)
//   { kind: 'within-budget',  maxChars: number }
//
// Additive surface:
//   testing.get(testId)  -> spec | null
//   testing.list()       -> catalog entries in registration order
//   testing.run(testId, { prompt })  — per-run subject override (same test
//                                      against a different prompt)
//
// Namespaces (probe/test access, same layering style as incidents):
//   assertions — the 4 kinds + JSON-Schema subset validator
//   registry   — the test catalog (persisted, deterministic ids)
//   framework  — the runner
//
// Storage: .jexi/prompt-versions/tests/registry.json (RULE 6 — same
// gitignored `.jexi/prompt-versions/` root as snapshots; same env override
// JEXI_PROMPT_VERSIONS_ROOT, read at call time).
// Deterministic (RULE 4): same spec + same prompt -> same verdict, byte
// for byte; only durationMs varies (wall clock — masked in comparisons).
// No LLM calls (RULE 7): everything below runs on plain strings.

import * as assertions from './assertions.js';
import * as registry from './registry.js';
import * as framework from './framework.js';

export { assertions, registry, framework };

export const ASSERTION_KINDS = assertions.ASSERTION_KINDS;
export const TESTING_CODES = assertions.TESTING_CODES;

export const testing = {
  register: registry.register,
  run: framework.run,
  get: registry.get,
  list: registry.list,
};

export default testing;
