/**
 * JEXI OS — Phase 28 Scope D — hybrid retrieval: full pipeline.
 *
 * Declared order:
 *   BM25 + vector cosine -> RRF(k=60) -> normalize ->
 *   compiled-truth boost(2.0, normalized RRF component only) ->
 *   cosine re-score (0.7*boosted-RRF + 0.3*cosine) ->
 *   graph adjacency(1.05)/cross-source(1.10)/MMR-lite(0.95) ->
 *   hyperbolic recency -> source tier -> 4-layer dedup -> token budget.
 *
 * Every returned result carries a per-stage reasons[] audit list.
 * Deterministic: same query + same index/repo/config -> byte-identical.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { keywordRank } from './keyword.js';
import { vectorRank } from './vector.js';
import { rrfFuse, normalize, RRF_K } from './rrf.js';
import { applyCompiledTruthBoost, applyGraphSignals, applySourceTier } from './boosts.js';
import { applyRecency, DEFAULT_RECENCY } from './recency-decay.js';
import { applyMMRLite } from './mmr.js';
import { dedup } from './dedup.js';

export const COSINE_BLEND = Object.freeze({ rrf: 0.7, cosine: 0.3 });
const byScoreThenChunk = (a, b) => (b.score - a.score) || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0);

/** Declared dependency-free token estimate: ceil(chars / 4). */
export function estimateTokens(text) { return Math.ceil(String(text).length / 4); }

/**
 * createHybridSearch({ index, repo, edges?, recency?, tiersByPage?, now })
 * -> { hybrid(query, { topK, budgetTokens }) }
 *
 * index/repo are Scope B/A public objects. `now` is injected (no hidden
 * clock). `sessionByPage` is an optional pageId->session id seam for sources
 * whose slug itself is not session-shaped.
 */
export function createHybridSearch({
  index,
  repo,
  edges = [],
  recency = DEFAULT_RECENCY,
  tiersByPage = {},
  sessionByPage = {},
  sourceByPage = {},
  now,
  candidateK = 50,
} = {}) {
  if (!index || typeof index.store?.snapshot !== 'function' || typeof index.embed !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'createHybridSearch({ index }): expected a brain/index createIndex() result');
  }
  if (!repo || typeof repo.list !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'createHybridSearch({ repo }): expected a brain/repo createRepo() result');
  }
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'createHybridSearch: now must be a valid ISO timestamp — no hidden clocks');
  }

  /** Build chunk documents strictly through Scope A/B public APIs. */
  function chunkDocs() {
    const docs = new Map();
    for (const page of repo.list()) {
      for (const c of index.chunk(page)) {
        docs.set(c.chunkId, {
          chunkId: c.chunkId,
          text: c.text,
          pageId: c.pageId,
          section: c.section,
          type: page.kind,
          updated_at: page.updated_at,
          sessionId: sessionByPage[c.pageId],
          sourceId: sourceByPage[c.pageId],
        });
      }
    }
    return docs;
  }

  return {
    async hybrid(query, { topK = 10, budgetTokens = Infinity } = {}) {
      if (typeof query !== 'string' || query.trim() === '') {
        throw new SemanticaError('E_INVALID_QUERY', 'query must be a non-empty string');
      }
      if (!Number.isInteger(topK) || topK < 0 || !(budgetTokens >= 0)) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'topK must be a non-negative integer and budgetTokens must be >= 0');
      }

      const docs = chunkDocs();

      // 1. Independent lexical and semantic recall arms.
      const keyword = keywordRank(query, [...docs.values()]);
      const { ranked: vector, cosineByChunk } = await vectorRank(query, index);

      // 2. REAL reciprocal-rank fusion and per-query normalization.
      const { fused } = rrfFuse([
        { name: 'keyword', ranked: keyword },
        { name: 'vector', ranked: vector },
      ]);
      const normalized = normalize(new Map(fused.map((f) => [f.chunkId, f.score])));

      // candidateK is an overfetch floor, never a cap below the caller's topK.
      const poolSize = Math.max(candidateK, topK);
      let candidates = fused.slice(0, poolSize).map((f) => {
        const meta = docs.get(f.chunkId) || {
          pageId: f.chunkId.split('#')[0],
          section: f.chunkId.includes('#compiled') ? 'compiled' : 'timeline',
          type: f.chunkId.split('/')[0],
          text: f.chunkId,
          updated_at: now,
        };
        const rrfScore = normalized.get(f.chunkId);
        return {
          ...meta,
          chunkId: f.chunkId,
          score: rrfScore,
          cosine: cosineByChunk.get(f.chunkId) ?? 0,
          reasons: [
            `rrf(k=${RRF_K}): ${f.contributions.map((c) => `${c.list} rank ${c.rank} (+${c.term.toFixed(6)})`).join(', ')} = ${f.score.toFixed(6)}`,
            `rrf-normalize: ${rrfScore.toFixed(4)}`,
          ],
        };
      });

      // 3. Boost ONLY normalized RRF, then blend with untouched cosine.
      candidates = applyCompiledTruthBoost(candidates);
      candidates = candidates.map((c) => {
        const blended = COSINE_BLEND.rrf * c.score + COSINE_BLEND.cosine * c.cosine;
        return {
          ...c,
          score: blended,
          reasons: [...c.reasons, `cosine-blend: ${COSINE_BLEND.rrf}*${c.score.toFixed(4)} + ${COSINE_BLEND.cosine}*${c.cosine.toFixed(4)} = ${blended.toFixed(6)}`],
        };
      }).sort(byScoreThenChunk);

      // 4. Post-fusion graph signals, in researched order.
      candidates = applyGraphSignals(candidates, edges, { topK }).sort(byScoreThenChunk);
      candidates = applyMMRLite(candidates, { topK });

      // 5. Hyperbolic recency and source tier.
      candidates = applyRecency(candidates, { config: recency, now });
      candidates = applySourceTier(candidates, tiersByPage).sort(byScoreThenChunk);

      // 6. Four-layer dedup + compiled-truth guarantee.
      const { results: deduped } = dedup(candidates);
      const ranked = deduped.sort(byScoreThenChunk).slice(0, topK);

      // 7. Budget admission: compiled pages first, then timeline facts;
      // within each class highest-ranked first. Anything not admitted is a
      // token-budget drop. Final presentation returns score rank.
      const priority = [...ranked].sort((a, b) => {
        const classA = a.section === 'compiled' ? 0 : 1;
        const classB = b.section === 'compiled' ? 0 : 1;
        return (classA - classB) || byScoreThenChunk(a, b);
      });
      let budgetUsed = 0;
      const kept = [];
      let droppedCount = 0;
      for (const c of priority) {
        const tokens = estimateTokens(c.text);
        if (budgetUsed + tokens <= budgetTokens) {
          budgetUsed += tokens;
          kept.push({
            ...c,
            reasons: [...c.reasons, `token-budget: kept ${tokens} tokens (${c.section === 'compiled' ? 'page-first' : 'fact-second'})`],
          });
        } else droppedCount += 1;
      }
      kept.sort(byScoreThenChunk);

      return {
        results: kept.map((c) => ({ pageId: c.pageId, chunkId: c.chunkId, score: c.score, reasons: c.reasons })),
        budgetUsed,
        droppedCount,
      };
    },
  };
}
