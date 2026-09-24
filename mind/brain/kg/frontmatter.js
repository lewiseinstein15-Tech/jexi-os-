/**
 * JEXI OS — Phase 28 Scope C — typed-edge KG: frontmatter -> edge candidates.
 *
 * Declared field -> verb mapping (pure data, no inference):
 *   key_people: [names]  -> person  works_at     page
 *   investors:  [names]  -> investor invested_in page
 *   attendees:  [names]  -> attendee mentions    page   (v1 mapping, declared)
 *   founded:    "Name"   -> founder  founded     page
 * Evidence is the frontmatter field itself. Deterministic order:
 * field order founded, investors, key_people, attendees; names sorted.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { assertVerb } from './verb-inference.js';

const FIELD_MAP = Object.freeze([
  ['founded', 'founded', false],        // scalar name
  ['investors', 'invested_in', true],   // list
  ['key_people', 'works_at', true],
  ['attendees', 'mentions', true],
]);

function names(v) {
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  return [];
}

/** frontmatterEdges(frontmatter) -> edges[] ({ from, to, verb, evidence }). */
export function frontmatterEdges(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `frontmatterEdges(frontmatter): expected an object, got ${frontmatter === null ? 'null' : typeof frontmatter}`);
  }
  const slug = frontmatter.slug;
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'frontmatterEdges: frontmatter.slug (the page) is required');
  }
  const edges = [];
  for (const [field, verb, isList] of FIELD_MAP) {
    if (!(field in frontmatter)) continue;
    assertVerb(verb);
    const list = isList ? names(frontmatter[field]) : names(frontmatter[field]);
    for (const name of [...list].sort()) {
      edges.push({ from: name, to: slug, verb, evidence: `frontmatter:${field}` });
    }
  }
  return edges;
}
