/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: post-fusion boosts.
 *
 * Declared constants:
 *   COMPILED_TRUTH_BOOST = 2.0   on the normalized RRF component
 *   ADJACENCY_HUB_BOOST  = 1.05  >=2 distinct in-set inbound pages
 *   CROSS_SOURCE_HUB     = 1.10  inbound edges from >=2 distinct sources
 *   SOURCE_TIER: curated 1.0 > bulk 0.75 (declared) > extract 0.3
 * Every decision appends an auditable reason.
 */
export const COMPILED_TRUTH_BOOST = 2.0;
export const ADJACENCY_HUB_BOOST = 1.05;
export const CROSS_SOURCE_HUB_BOOST = 1.10;
export const SOURCE_TIER_FACTORS = Object.freeze({ curated: 1.0, bulk: 0.75, extract: 0.3 });

/** x2.0 on the normalized RRF score of compiled-truth chunks. */
export function applyCompiledTruthBoost(cands) {
  return cands.map((c) => (c.section === 'compiled'
    ? { ...c, score: c.score * COMPILED_TRUTH_BOOST, reasons: [...c.reasons, `compiled-truth-boost x${COMPILED_TRUTH_BOOST}`] }
    : { ...c, reasons: [...c.reasons, 'compiled-truth-boost n/a (fact chunk)'] }));
}

const canonical = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const slugOf = (pageId) => String(pageId).split('/').slice(1).join('/') || String(pageId);

/**
 * Graph signals within the score-ranked top-K candidate set.
 * edges: Scope C { from, to, verb, evidence } plus optional source_id/sourceId.
 *
 * Surface names and slugs are matched canonically ("Analytical Engine" ==
 * "analytical-engine"). An inbound edge counts only when BOTH its source and
 * target are represented by top-K pages, so this is real in-set adjacency.
 */
export function applyGraphSignals(cands, edges, { topK = 20 } = {}) {
  const topPages = [];
  const seenPages = new Set();
  for (const c of cands.slice(0, topK)) {
    if (!seenPages.has(c.pageId)) { seenPages.add(c.pageId); topPages.push(c.pageId); }
  }

  const aliasToPage = new Map();
  for (const pageId of topPages) {
    aliasToPage.set(canonical(pageId), pageId);
    aliasToPage.set(canonical(slugOf(pageId)), pageId);
  }

  const inboundPages = new Map();
  const inboundSources = new Map();
  for (const edge of edges) {
    const sourcePage = aliasToPage.get(canonical(edge.from));
    const targetPage = aliasToPage.get(canonical(edge.to));
    if (!sourcePage || !targetPage || sourcePage === targetPage) continue;
    if (!inboundPages.has(targetPage)) {
      inboundPages.set(targetPage, new Set());
      inboundSources.set(targetPage, new Set());
    }
    inboundPages.get(targetPage).add(sourcePage);
    const sourceId = edge.source_id ?? edge.sourceId;
    if (typeof sourceId === 'string' && sourceId !== '') inboundSources.get(targetPage).add(sourceId);
  }

  return cands.map((cand, index) => {
    if (index >= topK) {
      return { ...cand, reasons: [...cand.reasons, 'graph-signals: outside top-K signal window'] };
    }
    let out = cand;
    const inbound = inboundPages.get(cand.pageId);
    const sources = inboundSources.get(cand.pageId);
    let fired = false;
    if (inbound && inbound.size >= 2) {
      fired = true;
      out = {
        ...out,
        score: out.score * ADJACENCY_HUB_BOOST,
        reasons: [...out.reasons, `graph:adjacency-hub x${ADJACENCY_HUB_BOOST} (${inbound.size} distinct in-set inbound pages)`],
      };
    }
    if (sources && sources.size >= 2) {
      fired = true;
      out = {
        ...out,
        score: out.score * CROSS_SOURCE_HUB_BOOST,
        reasons: [...out.reasons, `graph:cross-source-hub x${CROSS_SOURCE_HUB_BOOST} (${sources.size} distinct sources)`],
      };
    }
    return fired ? out : { ...out, reasons: [...out.reasons, 'graph-signals: no qualifying hub boost'] };
  });
}

/** Source-tier factor per page (config: pageId -> tier; default curated). */
export function applySourceTier(cands, tiersByPage = {}) {
  return cands.map((c) => {
    const tier = tiersByPage[c.pageId] || 'curated';
    const factor = SOURCE_TIER_FACTORS[tier];
    if (factor === undefined) {
      return { ...c, reasons: [...c.reasons, `source-tier unknown "${tier}" — treated as curated x1.0`] };
    }
    return {
      ...c,
      score: c.score * factor,
      reasons: [...c.reasons, factor === 1 ? `source-tier ${tier} (baseline x1.0)` : `source-tier ${tier} x${factor}`],
    };
  });
}
