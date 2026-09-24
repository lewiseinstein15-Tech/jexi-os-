/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: researched 4-layer dedup.
 *
 *   L1 by page: keep top 3 chunks per page
 *   L2 text similarity: drop >0.85 Jaccard-similar chunks FROM SAME PAGE
 *   L3 type diversity: no page type exceeds 60% (only heterogeneous pools)
 *   L4 by page: cap at 2 chunks per page
 *   final: guarantee a compiled-truth chunk for each surviving page when one
 *          existed before dedup
 *
 * Every absorbed row is returned in merged[]; a surviving absorber receives
 * an audit reason. Deterministic ties use chunkId ascending.
 */
export const DEDUP_JACCARD_THRESHOLD = 0.85;
export const DEDUP_MAX_TYPE_RATIO = 0.6;
export const DEDUP_MAX_PER_PAGE = 2;

const ranked = (a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0);
const words = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9]+/g) || []);
const pageKey = (c) => `${c.sourceId ?? c.source_id ?? 'default'}:${c.pageId}`;
const typeOf = (c) => c.type || String(c.pageId).split('/')[0] || 'unknown';

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

export function dedup(cands, {
  jaccardThreshold = DEDUP_JACCARD_THRESHOLD,
  maxTypeRatio = DEDUP_MAX_TYPE_RATIO,
  maxPerPage = DEDUP_MAX_PER_PAGE,
} = {}) {
  const merged = [];
  const preDedup = [...cands].map((c) => ({ ...c, reasons: [...c.reasons] })).sort(ranked);

  const absorb = (layer, kept, dropped, detail) => {
    merged.push({ layer, kept: kept?.chunkId ?? null, dropped: dropped.chunkId, detail });
    if (kept) kept.reasons.push(`dedup:${layer} absorbed ${dropped.chunkId}`);
  };

  // L1: top three chunks per composite page key.
  const groups = new Map();
  for (const c of preDedup) {
    const key = pageKey(c);
    const group = groups.get(key) || [];
    group.push(c);
    groups.set(key, group);
  }
  let current = [];
  for (const [key, group] of groups) {
    group.sort(ranked);
    current.push(...group.slice(0, 3));
    for (const dropped of group.slice(3)) absorb('L1-page-top3', group[0], dropped, key);
  }
  current.sort(ranked);

  // L2: >threshold Jaccard only within the same page (never cross-page).
  const keptWords = new Map();
  let next = [];
  for (const c of current) {
    const key = pageKey(c);
    const prior = keptWords.get(key) || [];
    const tokens = words(c.text);
    const duplicate = prior.find((entry) => jaccard(tokens, entry.tokens) > jaccardThreshold);
    if (duplicate) absorb('L2-same-page-jaccard', duplicate.cand, c, `>${jaccardThreshold}`);
    else {
      next.push(c);
      prior.push({ cand: c, tokens });
      keptWords.set(key, prior);
    }
  }
  current = next;

  // L3: cap each type at ceil(N*ratio), but never trim a homogeneous pool.
  const types = new Set(current.map(typeOf));
  if (types.size > 1) {
    const maxPerType = Math.max(1, Math.ceil(current.length * maxTypeRatio));
    const counts = new Map();
    next = [];
    for (const c of current) {
      const type = typeOf(c);
      const count = counts.get(type) || 0;
      if (count < maxPerType) {
        next.push(c);
        counts.set(type, count + 1);
      } else absorb('L3-type-diversity', null, c, `${type} cap=${maxPerType}`);
    }
    current = next;
  }

  // L4: at most N chunks from one page.
  const pageCounts = new Map();
  next = [];
  for (const c of current) {
    const key = pageKey(c);
    const count = pageCounts.get(key) || 0;
    if (count < maxPerPage) {
      next.push(c);
      pageCounts.set(key, count + 1);
    } else {
      const keeper = next.find((k) => pageKey(k) === key);
      absorb('L4-page-cap', keeper, c, `cap=${maxPerPage}`);
    }
  }
  current = next;

  // Final compiled-truth guarantee for every page still represented.
  const survivingKeys = new Set(current.map(pageKey));
  for (const key of survivingKeys) {
    const pageRows = current.filter((c) => pageKey(c) === key);
    if (pageRows.some((c) => c.section === 'compiled')) continue;
    const compiled = preDedup.filter((c) => pageKey(c) === key && c.section === 'compiled').sort(ranked)[0];
    if (!compiled) continue;
    const lowest = [...pageRows].sort((a, b) => ranked(b, a))[0];
    const index = current.findIndex((c) => c.chunkId === lowest.chunkId);
    absorb('compiled-truth-guarantee', compiled, lowest, key);
    compiled.reasons.push(`dedup:compiled-truth-guarantee replaced ${lowest.chunkId}`);
    current[index] = compiled;
  }

  current.sort(ranked);
  current = current.map((c) => ({ ...c, reasons: [...c.reasons, 'dedup: survived 4-layer pipeline'] }));
  return { results: current, merged };
}
