/**
 * JEXI OS — Phase 28 Scope B — vector index: public surface.
 *
 *   import { createIndex, CHUNKER_VERSION } from '../brain/index/index.js';
 *   const idx = createIndex({ repo, backend });   // repo = brain/repo createRepo()
 *   idx.chunk(page) -> chunks[]
 *   idx.embed(chunks, { backend? }) -> { backend, label, dim, vectors }
 *   idx.store(embeddings) -> { indexed }
 *   idx.search(query, { topK }) -> [{ chunkId, score, meta }]
 *   idx.rebuild() -> { chunks, embeddings }
 *
 * Freshness: the store's meta records the chunkerVersion per chunk. Chunks
 * whose version differs from the active CHUNKER_VERSION are STALE; rebuild()
 * re-chunks stale pages lazily (only those pages are re-embedded). The
 * `chunkerVersion` constructor option is the declared injection seam used to
 * simulate a version bump in probes (same mechanism a real bump uses).
 *
 * Engine: embedded in-process store (PGLite-analog, zero config, exact
 * cosine). Backend default: rule-based, labeled "rule-based — embedding
 * model NOT VERIFIED". Provider unavailable -> E_PROVIDER_UNAVAILABLE (the
 * caller falls back explicitly; nothing is faked).
 */
import { SemanticaError } from '../../semantica/_internal.js';
import { chunk as chunkPage, CHUNKER_VERSION } from './chunker.js';
import { embed as embedChunks, resolveBackend, isProviderAvailable } from './embedder.js';
import { createStore, cosine } from './vector-store.js';
import ruleBased from './backends/rule-based.js';

export function createIndex({ repo, backend = 'rule-based', provider, chunkerVersion = CHUNKER_VERSION } = {}) {
  if (!repo || typeof repo.list !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'createIndex({ repo }): repo must be a brain/repo repository (createRepo())');
  }
  const b = resolveBackend({ backend, provider });
  const store = createStore({ dim: b.dim });

  const api = {
    backend: b.name, label: b.label, dim: b.dim, chunkerVersion, store,
    /** chunk(page) -> chunks[] (structural, deterministic). */
    chunk: (page) => chunkPage(page, { chunkerVersion }),
    /** embed(chunks, { backend? }) -> { backend, label, dim, vectors }. */
    embed: (chunks, opts) => embedChunks(chunks, { backend: opts?.backend ?? b, provider }),
    /** store(embeddings) -> { indexed }. meta carries chunkerVersion. */
    storeEmbeddings: (embeddings, meta = {}) => {
      let indexed = 0;
      for (const { chunkId, vector } of embeddings.vectors) {
        store.put(chunkId, vector, { ...meta, chunkerVersion, backend: embeddings.backend });
        indexed += 1;
      }
      return { indexed };
    },
    /** search(query, { topK }) -> [{ chunkId, score, meta }] — real cosine. */
    search: async (query, { topK = 10 } = {}) => {
      if (typeof query !== 'string' || query.trim() === '') {
        throw new SemanticaError('E_INVALID_QUERY', 'query must be a non-empty string');
      }
      const { vectors } = await embedChunks([{ chunkId: '__query__', text: query }], { backend: b, provider });
      return store.search(vectors[0].vector, { topK });
    },
    /** Chunk ids whose recorded chunkerVersion differs from the active one. */
    staleChunkIds: () => {
      const snap = store.snapshot();
      return snap.records.filter((r) => (r.meta?.chunkerVersion ?? null) !== chunkerVersion).map((r) => r.chunkId);
    },
    /**
     * rebuild() -> { chunks, embeddings } — re-chunk every page (stale pages
     * lazily re-embedded), re-embed, re-store. Deterministic for same repo.
     */
    rebuild: async () => {
      const pages = repo.list();
      const chunks = pages.flatMap((p) => chunkPage(p, { chunkerVersion }));
      const embeddings = await embedChunks(chunks, { backend: b, provider });
      store.load({ dim: b.dim, records: [] }); // clear
      api.storeEmbeddings(embeddings, { rebuiltFrom: pages.length });
      return { chunks, embeddings: { backend: embeddings.backend, label: embeddings.label, dim: embeddings.dim, count: embeddings.vectors.length } };
    },
  };
  // Contract alias: index.store(embeddings) stores; index.store.* delegates to
  // the engine. (Not Object.assign — that would freeze the `size` getter.)
  api.store = (embeddings, meta) => api.storeEmbeddings(embeddings, meta);
  for (const k of ['put', 'search', 'snapshot', 'load', 'has']) api.store[k] = (...a) => store[k](...a);
  Object.defineProperty(api.store, 'size', { get: () => store.size });
  api.store.dim = store.dim;
  return api;
}

export { CHUNKER_VERSION, cosine, isProviderAvailable, ruleBased };
export { chunk } from './chunker.js';
export { embed } from './embedder.js';
export { createStore } from './vector-store.js';
