/**
 * JEXI OS — Phase 28 Scope C — typed-edge KG: precedence-ordered verb inference.
 *
 * gbrain inferLinkType() pattern, DECLARED precedence (enforced, highest wins
 * on the same sentence):
 *   founded > invested_in > advises > works_at > mentions
 * (research note also lists a role-prior tier; the declared v1 set is the
 * five above — mentions is the catch-all.)
 *
 * Pure regex over text. NO LLM call. Ever.
 */
import { SemanticaError } from '../../semantica/_internal.js';

export const VERB_PRECEDENCE = Object.freeze(['founded', 'invested_in', 'advises', 'works_at', 'mentions']);

/** Regex per verb — ordered by the declared precedence. */
const PATTERNS = Object.freeze([
  ['founded', /\b(?:founded|co-?founded|founder of|started)\b/i],
  ['invested_in', /\b(?:invested in|investor in|backed|led the (?:seed|series [a-z]) (?:round|investment)(?: for| in)?|angel in)\b/i],
  ['advises', /\b(?:advises|advised|advisor to|board member of|sits on the board of)\b/i],
  ['works_at', /\b(?:works at|works for|employed (?:at|by)|(?:chief|head) of|(?:ceo|cto|coo|cfo) of|engineer at|researcher at)\b/i],
  ['mentions', /[\s\S]/], // catch-all: any text with a candidate pair
]);

/**
 * inferType(text, context?) -> { verb }
 * Highest-precedence verb whose pattern matches wins; ties impossible (each
 * pattern is tested in precedence order, first match returns).
 */
export function inferType(text, _context = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `inferType(text): text must be a non-empty string, got ${JSON.stringify(text)}`);
  }
  for (const [verb, re] of PATTERNS) {
    if (re.test(text)) return { verb };
  }
  return { verb: 'mentions' };
}

/** Validate a verb against the declared set. Unknown -> E_UNKNOWN_EDGE_KIND. */
export function assertVerb(verb) {
  if (!VERB_PRECEDENCE.includes(verb)) {
    throw new SemanticaError('E_UNKNOWN_EDGE_KIND', `unknown edge verb ${JSON.stringify(verb)}; declared set: ${VERB_PRECEDENCE.join(' > ')}`);
  }
  return verb;
}
