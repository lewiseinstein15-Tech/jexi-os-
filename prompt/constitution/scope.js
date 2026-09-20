// prompt/constitution/scope.js
// Scope limitations for the constitutional template (Phase 25, Scope C).
//
// Section 3 ("Scope Limitations"): valid topics + decision
// boundaries. The agent operates ONLY inside the declared topics;
// anything else is out of scope by default.

import { PromptError } from '../assembly/errors.js';

export const DEFAULT_DECISION_BOUNDARIES = Object.freeze([
  'You may choose implementation details inside valid topics.',
  'You may not expand scope beyond valid topics without explicit user instruction.',
]);

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '');
}

/**
 * Validate spec.scope. Throws:
 *   E_MISSING_SCOPE  - scope absent / not an object
 *   E_INVALID_SCOPE  - validTopics not a non-empty string array, or
 *                      outOfScope / decisionBoundaries malformed
 */
export function assertScope(scope) {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) {
    throw new PromptError('E_MISSING_SCOPE', 'spec.scope must be an object with a non-empty validTopics array', { got: typeof scope });
  }
  if (!isStringArray(scope.validTopics) || scope.validTopics.length === 0) {
    throw new PromptError('E_INVALID_SCOPE', 'spec.scope.validTopics must be a non-empty array of non-empty strings', { got: scope.validTopics === undefined ? 'undefined' : 'invalid array' });
  }
  for (const key of ['outOfScope', 'decisionBoundaries']) {
    if (scope[key] !== undefined && !isStringArray(scope[key])) {
      throw new PromptError('E_INVALID_SCOPE', `spec.scope.${key} must be an array of non-empty strings when provided`, { key });
    }
  }
  return scope;
}

/** Render section-3 body from validated scope. */
export function buildSection(scope) {
  assertScope(scope);
  const outOfScope = scope.outOfScope ?? [];
  const boundaries = scope.decisionBoundaries ?? [...DEFAULT_DECISION_BOUNDARIES];
  return [
    'The agent operates only inside the topics listed here; anything else is out of scope by default.',
    '',
    '### Valid topics',
    ...scope.validTopics.map((t) => `- ${t}`),
    '',
    '### Out of scope',
    ...(outOfScope.length > 0 ? outOfScope.map((t) => `- ${t}`) : ['- (nothing explicitly excluded)']),
    '',
    '### Decision boundaries',
    ...boundaries.map((t) => `- ${t}`),
  ].join('\n');
}
