// prompt/constitution/constraints.js
// Absolute-language enforcement for constitution constraints (Phase 25, Scope C).
//
// Constraints are NOT suggestions. Only absolute negation verbs are
// allowed ("won't", "must not", "cannot", "will never"); the listed
// soft words are refused at generation time with E_SOFT_LANGUAGE.
//
// This module is section-2 ("Behavioral Constraints") of the
// five-section constitutional template.

import { PromptError } from '../assembly/errors.js';

export const ALLOWED_NEGATIONS = Object.freeze(["won't", 'must not', 'cannot', 'will never']);

// Order matters for evidence: the FIRST listed pattern is reported.
export const FORBIDDEN_SOFT_WORDS = Object.freeze([
  'should', 'try to', 'prefer not', 'when possible', 'if appropriate', 'where feasible', 'consider',
]);

const SOFT_PATTERNS = [
  { word: 'should', re: /\bshould(?:n['’]t)?\b/i },
  { word: 'try to', re: /\btry(?:ing)?\s+to\b/i },
  { word: 'prefer not', re: /\bprefer(?:s|red|ably)?(?:\s+not)?\b/i },
  { word: 'when possible', re: /\bwhen possible\b/i },
  { word: 'if appropriate', re: /\bif appropriate\b/i },
  { word: 'where feasible', re: /\bwhere feasible\b/i },
  { word: 'consider', re: /\bconsider(?:s|ing|ed|ation(?:s)?)?\b/i },
];

const NEGATION_RE = /\b(?:won['’]t|will\s+never|must\s+not|cannot)\b/i;

/** All forbidden soft-word hits in a text (listed order), [] when clean. */
export function softWordMatches(text) {
  const hits = [];
  if (typeof text !== 'string' || text === '') return hits;
  for (const p of SOFT_PATTERNS) {
    const m = text.match(p.re);
    if (m) hits.push({ word: m[0], listed: p.word, index: m.index });
  }
  return hits;
}

/** True when the text uses one of the allowed absolute negations. */
export function hasAbsoluteNegation(text) {
  return typeof text === 'string' && NEGATION_RE.test(text);
}

/**
 * Validate constraint items. Throws:
 *   E_MISSING_CONSTRAINTS - constraints absent / empty array
 *   E_INVALID_CONSTRAINTS - an item is not a non-empty string
 *   E_SOFT_LANGUAGE       - forbidden soft word, OR an item that uses
 *                           no allowed absolute negation (details.rule
 *                           distinguishes 'forbidden-soft-word' vs
 *                           'missing-absolute-negation')
 */
export function assertConstraintItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PromptError('E_MISSING_CONSTRAINTS', 'spec.constraints must be a non-empty array of absolute constraint statements', { got: Array.isArray(items) ? 'empty array' : typeof items });
  }
  items.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new PromptError('E_INVALID_CONSTRAINTS', `spec.constraints[${index}] must be a non-empty string`, { index });
    }
    const hits = softWordMatches(item);
    if (hits.length > 0) {
      const h = hits[0];
      throw new PromptError('E_SOFT_LANGUAGE', `constraints[${index}] uses forbidden soft language: "${h.word}" (listed as "${h.listed}") — constraints are absolute`, { index, rule: 'forbidden-soft-word', word: h.word, listed: h.listed, forbidden: FORBIDDEN_SOFT_WORDS });
    }
    if (!hasAbsoluteNegation(item)) {
      throw new PromptError('E_SOFT_LANGUAGE', `constraints[${index}] uses no allowed absolute negation (${ALLOWED_NEGATIONS.join(', ')}) — constraints are absolute`, { index, rule: 'missing-absolute-negation', allowed: ALLOWED_NEGATIONS });
    }
  });
  return items;
}

/** Render section-2 body from validated items. */
export function buildSection(items) {
  assertConstraintItems(items);
  return [
    'These constraints are absolute. Each statement uses an absolute negation; soft language is refused at generation time.',
    '',
    ...items.map((item) => `- ${item}`),
  ].join('\n');
}
