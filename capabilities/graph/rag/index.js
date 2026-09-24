/**
 * JEXI OS — Phase 22 Scope C — capability/rag entry point.
 *
 * Graph-based retrieval-augmented generation (LightRAG pattern). Standalone:
 * no memory/** or server/** wiring.
 *
 *   import { graphRag } from './capability/rag/index.js';
 *   graphRag.index(documents);            // -> { entities, relationships, docCount }
 *   graphRag.query('…', { topK, depth }); // -> { results, graphPath }
 *
 * A module-level singleton is exported for convenience; construct a fresh
 * GraphRag per isolated corpus when you need more than one graph at a time.
 */
export {
  GraphRag,
  RagError,
  ENTITY_TYPES,
  EXTRACTION_MODE,
  LLM_EXTRACTION_LABEL,
  validateDocuments,
  snapshotDir,
  normalizeName,
  entityKey,
} from './graph-rag.js';

import { GraphRag } from './graph-rag.js';

/** Process-wide default graph. */
export const graphRag = new GraphRag();

/**
 * Load the on-disk snapshot into the default graph if one exists, so a fresh
 * process can query without re-indexing. Returns true when a snapshot loaded.
 */
export function loadSnapshot() {
  return graphRag.load();
}

export default graphRag;