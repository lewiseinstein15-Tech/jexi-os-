/**
 * JEXI OS — Phase 28 Scope B — vector index: deterministic page chunker.
 *
 * gbrain pattern: pages are chunked for embedding with a CHUNKER_VERSION
 * timestamp; when chunking logic changes the version is bumped and stale
 * chunks are re-chunked lazily. Chunk boundaries here are STRUCTURAL (not
 * windowed): one chunk for the compiled truth, one per timeline entry —
 * deterministic by construction (same page -> same chunks, byte for byte).
 *
 * Tokenizer parity: reuses Phase 19 B's tokenizer (read-only consumption of
 * the surfsense public API) so keyword and vector paths agree on terms.
 */
import { tokenize } from '../../../services/surfsense/connectors/local-search.js';

/** Bump this timestamp whenever chunking logic changes. */
export const CHUNKER_VERSION = '2026-09-22T05:00:00Z';

/**
 * chunk(page) -> chunks[]
 * chunk = { chunkId, pageId, section, seq, text, chunkerVersion }
 * pageId = "<kind>/<slug>"; chunkId = "<pageId>#<section>:<seq>".
 */
export function chunk(page, { chunkerVersion = CHUNKER_VERSION } = {}) {
  if (!page || typeof page !== 'object' || typeof page.kind !== 'string' || typeof page.slug !== 'string') {
    throw new TypeError('chunk(page): page must carry kind + slug (a brain/repo page object)');
  }
  const pageId = `${page.kind}/${page.slug}`;
  const chunks = [];
  const compiled = (page.compiledTruth || '').trim();
  chunks.push({
    chunkId: `${pageId}#compiled:0`,
    pageId, section: 'compiled', seq: 0,
    text: `${page.title}\n${compiled}`.trim(),
    chunkerVersion,
  });
  const timeline = [...(page.timeline || [])].sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.seq - b.seq));
  timeline.forEach((e, i) => {
    chunks.push({
      chunkId: `${pageId}#timeline:${i}`,
      pageId, section: 'timeline', seq: i,
      text: `${page.title}\n${e.when}: ${e.entry}`.trim(),
      chunkerVersion,
    });
  });
  return chunks;
}

export { tokenize };
