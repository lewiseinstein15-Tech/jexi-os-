/**
 * JEXI OS — Phase 28 Scope G — deterministic session boundary runtime.
 * session-start injects a warm context pack; pre-compaction banks standing
 * entities for the next start/rehydration. No clocks or model calls.
 */
import { SemanticaError } from '../../../../services/semantica/_internal.js';

export const MAX_STANDING_ENTITIES = 8;

function normalizeEntities(entities) {
  const out = [];
  for (const entity of Array.isArray(entities) ? entities : []) {
    const value = typeof entity === 'string' ? entity.trim() : String(entity?.slug ?? entity?.name ?? '').trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out.slice(0, MAX_STANDING_ENTITIES);
}

export function createBoundary({ pack }) {
  if (typeof pack !== 'function') throw new SemanticaError('E_INVALID_ARGUMENT', 'boundary requires pack function');
  const bankedBySession = new Map();

  return {
    boundary(sessionId, { phase, entities, budgetTokens, includePrivate = false } = {}) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'ambient.boundary requires non-empty sessionId');
      }
      if (phase === 'pre-compaction') {
        const banked = normalizeEntities(entities);
        bankedBySession.set(sessionId, banked);
        return { warmContext: { banked } };
      }
      if (phase === 'session-start') {
        const standing = entities === undefined ? (bankedBySession.get(sessionId) ?? []) : normalizeEntities(entities);
        return {
          warmContext: {
            entities: [...standing],
            pack: pack({ entities: standing, budgetTokens, includePrivate }),
          },
        };
      }
      throw new SemanticaError('E_INVALID_ARGUMENT', 'boundary phase must be session-start or pre-compaction');
    },

    banked(sessionId) { return [...(bankedBySession.get(sessionId) ?? [])]; },
  };
}
