/**
 * JEXI OS — Phase 28 Scope C — typed-edge KG: public surface.
 *
 *   import { extract, inferType, frontmatterEdges, stale, extractStale }
 *     from '../brain/kg/index.js';
 *
 * Pure regex + frontmatter mapping. NO LLM call, no network, no imports
 * outside node builtins + semantica + brain/kg internals (P3 asserts this).
 */
import { createRepo } from '../repo/index.js';
import { extract, validateEdge, pageSentences } from './extractor.js';
import { frontmatterEdges } from './frontmatter.js';
import { VERB_PRECEDENCE, inferType, assertVerb } from './verb-inference.js';
import {
  LINK_EXTRACTOR_VERSION_TS, isStale, stale, readWatermark, writeWatermark,
} from './watermark.js';

/**
 * extractStale(repoPath, { onlyStale = true, version?, now? }) ->
 *   { reextracted: n, skipped: n, pages: [{ kind, slug, stale, links_extracted_at }] }
 * Re-runs extraction on stale pages and writes edges + watermark records.
 * `now` is injectable (no hidden clocks); defaults to the max updated_at seen
 * (deterministic) — extraction itself never needs wall time.
 */
export function extractStale(repoPath, { onlyStale = true, version = LINK_EXTRACTOR_VERSION_TS, now } = {}) {
  const repo = createRepo(repoPath);
  const pages = repo.list();
  const pagesOut = [];
  let reextracted = 0; let skipped = 0;
  for (const page of pages) {
    const wm = readWatermark(repoPath, page.kind, page.slug);
    const isSt = isStale(page, wm, { version });
    if (onlyStale && !isSt) {
      skipped += 1;
      pagesOut.push({ kind: page.kind, slug: page.slug, stale: false, links_extracted_at: wm.links_extracted_at });
      continue;
    }
    const { edges } = extract(page);
    const fmEdges = frontmatterEdges({ slug: page.slug, ...frontmatterOf(page) });
    const extractedAt = now || page.updated_at;
    writeWatermark(repoPath, page.kind, page.slug, { edges, extractedAt, version, frontmatterEdges: fmEdges });
    reextracted += 1;
    pagesOut.push({ kind: page.kind, slug: page.slug, stale: true, links_extracted_at: extractedAt, edge_count: edges.length + fmEdges.length });
  }
  pagesOut.sort((a, b) => (a.kind === b.kind ? (a.slug < b.slug ? -1 : 1) : a.kind < b.kind ? -1 : 1));
  return { reextracted, skipped, pages: pagesOut };
}

/** Frontmatter-ish view of a page for the field mapping (tags/title only carry
 *  the declared fields when the caller put them there via update()); the four
 *  mapped fields ride in page.frontmatterExtras when present. */
function frontmatterOf(page) {
  return page.frontmatterExtras && typeof page.frontmatterExtras === 'object' ? page.frontmatterExtras : {};
}

export {
  extract, validateEdge, pageSentences,
  frontmatterEdges,
  VERB_PRECEDENCE, inferType, assertVerb,
  LINK_EXTRACTOR_VERSION_TS, isStale, stale, readWatermark, writeWatermark,
};
