/**
 * JEXI OS — Phase 28 Scope A — brain repo: MECE directory layout + page kinds.
 *
 * gbrain pattern: the markdown repo is the source of truth; every page kind
 * owns exactly one directory (MECE — mutually exclusive, collectively
 * exhaustive). Kind determines directory; unknown kinds are refused
 * E_UNKNOWN_KIND (never auto-created).
 */
import { SemanticaError } from '../../semantica/_internal.js';

/** Declared page kinds -> directory names. Frozen; additions are a schema change. */
export const KIND_DIRS = Object.freeze({
  people: 'people',
  companies: 'companies',
  concepts: 'concepts',
  meetings: 'meetings',
  'voice-notes': 'voice-notes',
  originals: 'originals',
});

export const KINDS = Object.freeze(Object.keys(KIND_DIRS));

/** Directory for a kind; E_UNKNOWN_KIND otherwise. */
export function kindDir(kind) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_DIRS, kind)) {
    throw new SemanticaError('E_UNKNOWN_KIND', `unknown page kind ${JSON.stringify(kind)}; known: ${KINDS.join(', ')}`);
  }
  return KIND_DIRS[kind];
}

/** Slug sanity: non-empty, no whitespace, no path separators or traversal. */
export function assertSlug(slug) {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `slug must be a non-empty string, got ${JSON.stringify(slug)}`);
  }
  if (/[\s/\\]|\.\./.test(slug)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `slug must not contain whitespace, path separators or "..", got ${JSON.stringify(slug)}`);
  }
  return slug;
}

/** File path (relative to the brain root) for a kind+slug. */
export function pagePath(kind, slug) {
  return `${kindDir(kind)}/${assertSlug(slug)}.md`;
}
