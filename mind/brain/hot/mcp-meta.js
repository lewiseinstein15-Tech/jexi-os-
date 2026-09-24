/**
 * JEXI OS — Phase 28 Scope F — MCP `_meta.brain_hot_memory` injection.
 *
 * Cache identity is EXACTLY (sourceId, sessionId, hash(sorted allowList)).
 * The allow-list affects cache identity, matching the upstream safety seam;
 * source isolation is enforced by the recall function. No clock/TTL: writes
 * explicitly invalidate matching source/session entries.
 */
import { createHash } from 'node:crypto';
import { SemanticaError } from '../../../services/semantica/_internal.js';

export const HOT_META_CACHE_CAP = 100;

export function allowListHash(allowList = []) {
  if (!Array.isArray(allowList) || allowList.some((item) => typeof item !== 'string')) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'allowList must be an array of strings');
  }
  return createHash('sha256').update(JSON.stringify([...allowList].sort()), 'utf8').digest('hex').slice(0, 16);
}

const encode = (value) => encodeURIComponent(value);
const copyEnvelope = (value) => JSON.parse(JSON.stringify(value));

export function createMcpMeta({ recall, topK = 10, cacheCap = HOT_META_CACHE_CAP }) {
  const cache = new Map();

  function key(sourceId, sessionId, allowList) {
    return `${encode(sourceId)}::${encode(sessionId)}::${allowListHash(allowList)}`;
  }

  function cacheSet(cacheKey, value) {
    if (!cache.has(cacheKey) && cache.size >= cacheCap) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, value);
  }

  return {
    get({ sessionId, sourceId = 'default', allowList = [] } = {}) {
      if (typeof sessionId !== 'string' || sessionId === '' || typeof sourceId !== 'string' || sourceId === '') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'hot.meta requires non-empty sessionId and sourceId');
      }
      const cacheKey = key(sourceId, sessionId, allowList);
      if (cache.has(cacheKey)) return copyEnvelope(cache.get(cacheKey));

      let facts = recall({ sourceId, sessionId }).filter((fact) => fact.superseded_by === null);
      // Cross-session fallback: same source only, never another source.
      if (facts.length === 0) facts = recall({ sourceId }).filter((fact) => fact.superseded_by === null);
      facts = facts.slice(-topK);
      const envelope = { brain_hot_memory: { facts } };
      cacheSet(cacheKey, envelope);
      return copyEnvelope(envelope);
    },

    invalidate(sourceId, _sessionId) {
      // Entries for another session may contain this source's cross-session
      // fallback. With no clock/TTL, safely over-invalidate the whole source.
      const prefix = `${encode(sourceId)}::`;
      for (const cacheKey of cache.keys()) if (cacheKey.startsWith(prefix)) cache.delete(cacheKey);
    },

    size() { return cache.size; },
  };
}
