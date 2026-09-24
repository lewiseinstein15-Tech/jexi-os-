/**
 * JEXI OS — Phase 28 Scope B — zero-config in-process vector store.
 *
 * PGLite-analog: an embedded, zero-config engine so the index works with no
 * Postgres server. Records: { chunkId, vector, meta }. Search is EXACT
 * brute-force cosine (declared; the pluggable seam is `searchImpl` — an HNSW
 * implementation can replace it without touching callers). Snapshot/load are
 * deterministic (chunkId-sorted JSON) so a store survives serialization
 * byte-identically.
 */
import { SemanticaError } from '../../semantica/_internal.js';

/** Real cosine similarity over two equal-length vectors. */
export function cosine(a, b) {
  if (a.length !== b.length) {
    throw new SemanticaError('E_DIM_MISMATCH', `cosine: vector dims differ (${a.length} vs ${b.length})`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function createStore({ dim, searchImpl = cosine } = {}) {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `dim must be a positive integer, got ${JSON.stringify(dim)}`);
  }
  const records = new Map(); // chunkId -> { chunkId, vector, meta }

  return {
    dim,
    /** Insert or replace one record. */
    put(chunkId, vector, meta = {}) {
      if (typeof chunkId !== 'string' || chunkId === '') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'chunkId must be a non-empty string');
      }
      if (!Array.isArray(vector) || vector.length !== dim) {
        throw new SemanticaError('E_DIM_MISMATCH', `vector for ${chunkId} must have dim ${dim}, got ${Array.isArray(vector) ? vector.length : typeof vector}`);
      }
      records.set(chunkId, { chunkId, vector, meta });
      return { indexed: records.size };
    },
    /** Exact topK cosine search. Ties broken by chunkId asc (deterministic). */
    search(queryVector, { topK = 10 } = {}) {
      if (!Array.isArray(queryVector) || queryVector.length !== dim) {
        throw new SemanticaError('E_DIM_MISMATCH', `query vector must have dim ${dim}`);
      }
      const scored = [...records.values()].map((r) => ({ chunkId: r.chunkId, score: searchImpl(queryVector, r.vector), meta: r.meta }));
      scored.sort((a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
      return scored.slice(0, topK);
    },
    get size() { return records.size; },
    has(chunkId) { return records.has(chunkId); },
    /** Deterministic snapshot: chunkId-sorted. */
    snapshot() {
      const out = [...records.values()].sort((a, b) => (a.chunkId < b.chunkId ? -1 : 1));
      return { dim, records: out };
    },
    /** Load a snapshot (replaces contents). */
    load(snap) {
      if (!snap || snap.dim !== dim) throw new SemanticaError('E_DIM_MISMATCH', 'snapshot dim mismatch');
      records.clear();
      for (const r of snap.records) records.set(r.chunkId, { chunkId: r.chunkId, vector: r.vector, meta: r.meta || {} });
      return { indexed: records.size };
    },
  };
}
