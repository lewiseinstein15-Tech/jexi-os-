/**
 * JEXI OS — Phase 28 Scope C — typed-edge KG: extraction freshness watermark.
 *
 * gbrain pattern: LINK_EXTRACTOR_VERSION_TS is bumped when extraction logic
 * changes; a page is STALE when
 *   links_extracted_at missing  OR
 *   page.updated_at > links_extracted_at  OR
 *   links_extracted_at < LINK_EXTRACTOR_VERSION_TS.
 * Watermarks live in <root>/.brain/edges/<kind>--<slug>.json (page frontmatter
 * is Scope A's fixed schema and is never touched from here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { SemanticaError } from '../../semantica/_internal.js';

/** Bump this timestamp whenever extraction logic changes. */
export const LINK_EXTRACTOR_VERSION_TS = '2026-09-22T06:00:00Z';

const EDGES_DIR = '.brain/edges';

export function watermarkPath(root, kind, slug) {
  return path.join(root, EDGES_DIR, `${kind}--${slug}.json`);
}

/** Read a stored watermark record; null when absent. */
export function readWatermark(root, kind, slug) {
  const f = watermarkPath(root, kind, slug);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Write the watermark + edges record (deterministic JSON key order). */
export function writeWatermark(root, kind, slug, { edges, extractedAt, version = LINK_EXTRACTOR_VERSION_TS, frontmatterEdges = [] }) {
  const f = watermarkPath(root, kind, slug);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const rec = {
    kind, slug,
    links_extracted_at: extractedAt,
    link_extractor_version: version,
    edge_count: edges.length + frontmatterEdges.length,
    frontmatter_edges: frontmatterEdges,
    edges,
  };
  fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/**
 * isStale(page, watermark?, { version? }) -> boolean  (declared rule above).
 * `watermark` is the stored record (or null). Injection seam `version` lets
 * probes simulate a VERSION_TS bump — same mechanism a real bump uses.
 */
export function isStale(page, watermark, { version = LINK_EXTRACTOR_VERSION_TS } = {}) {
  if (!watermark || typeof watermark.links_extracted_at !== 'string') return true;
  if (page.updated_at > watermark.links_extracted_at) return true;
  if (watermark.links_extracted_at < version) return true;
  return false;
}

/** stale(pages, { root?, version? }) -> pages needing re-extraction. */
export function stale(pages, { root, version = LINK_EXTRACTOR_VERSION_TS } = {}) {
  if (!Array.isArray(pages)) throw new SemanticaError('E_INVALID_ARGUMENT', 'stale(pages): pages must be an array');
  return pages.filter((p) => isStale(p, root ? readWatermark(root, p.kind, p.slug) : null, { version }));
}
