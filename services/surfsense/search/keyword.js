/**
 * JEXI OS — Phase 19 Scope B — BM25 keyword scoring.
 *
 * SurfSense research note: SurfSense's retrieval layer combines BM25-style
 * lexical scoring with vector/embedding relevance (hybrid search). This
 * module is the lexical half: real BM25 (term frequency x inverse document
 * frequency x length normalization) over the documents the caller passes.
 *
 * Consistency with Scope A: same k1 = 1.5 / b = 0.75 and the same tokenizer
 * (imported from the public API of surfsense/connectors/local-search.js —
 * the search layer reuses the connector layer's public surface instead of
 * duplicating it). The corpus statistics here are computed per call over the
 * CALLER'S documents (local-search computes them over its own shipped index,
 * so the two share the math, not the state).
 *
 * Determinism: pure function of (query, docs). Same inputs -> byte-identical
 * ranked output. Ties broken by document id ascending.
 */
import { SurfError } from '../connectors/_internal.js';
import { tokenize } from '../connectors/local-search.js';

export const K1 = 1.5;
export const B = 0.75;

/**
 * Validate the caller's document set. Shape: array of objects, each with a
 * non-empty string id and a non-empty string text (title optional). Unknown
 * shape -> E_INVALID_DOC. Ids must be unique: the deterministic tiebreak is
 * by document id, and duplicated ids would make ordering ambiguous.
 */
export function validateDocs(docs) {
  if (!Array.isArray(docs)) {
    throw new SurfError('E_INVALID_DOC', `docs must be an array, received ${typeof docs}`);
  }
  const seen = new Set();
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new SurfError('E_INVALID_DOC', `docs[${i}] must be an object`);
    }
    if (typeof doc.id !== 'string' || doc.id.length === 0) {
      throw new SurfError('E_INVALID_DOC', `docs[${i}] is missing non-empty string "id"`);
    }
    if (typeof doc.text !== 'string' || doc.text.length === 0) {
      throw new SurfError('E_INVALID_DOC', `docs[${i}] ("${doc.id}") is missing non-empty string "text"`);
    }
    if (doc.title !== undefined && (typeof doc.title !== 'string' || doc.title.length === 0)) {
      throw new SurfError('E_INVALID_DOC', `docs[${i}] ("${doc.id}") has non-string "title"`);
    }
    if (seen.has(doc.id)) {
      throw new SurfError('E_INVALID_DOC', `duplicate document id "${doc.id}"`);
    }
    seen.add(doc.id);
  }
  return docs;
}

/** Validate query: non-empty string. */
export function validateQuery(query) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new SurfError('E_INVALID_QUERY', 'query must be a non-empty string');
  }
  return query;
}

/**
 * BM25 scores for one query over one document set.
 * Returns Map<id, score> — real tf/idf/length-normalized scores, not faked.
 */
export function bm25Scores(query, docs) {
  validateQuery(query);
  validateDocs(docs);

  const terms = tokenize(query);
  const docTokens = docs.map((doc) => ({
    doc,
    tokens: tokenize(`${doc.title ? `${doc.title} ` : ''}${doc.text}`),
  }));

  const N = docTokens.length;
  if (N === 0 || terms.length === 0) return new Map();

  const avgLen = docTokens.reduce((sum, d) => sum + d.tokens.length, 0) / N;
  const docFreq = new Map();
  for (const { tokens } of docTokens) {
    for (const term of new Set(tokens)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const scores = new Map();
  for (const { doc, tokens } of docTokens) {
    const counts = new Map();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      score += (idf * (tf * (K1 + 1))) / (tf + K1 * (1 - B + (B * tokens.length) / avgLen));
    }
    scores.set(doc.id, score);
  }
  return scores;
}

/** Order helper: score desc, id asc — THE deterministic tiebreak. */
export function byScoreThenId(getScore) {
  return (a, b) => {
    const sa = getScore(a);
    const sb = getScore(b);
    if (sa !== sb) return sb - sa;
    const ia = String(a.id ?? '');
    const ib = String(b.id ?? '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };
}

/**
 * Normalize scores into [0, 1] by dividing by the max positive score
 * (per-query normalization — deterministic). All-zero input stays all-zero.
 */
export function normalizeScores(scores) {
  let max = 0;
  for (const v of scores.values()) if (v > max) max = v;
  if (max <= 0) return new Map([...scores.keys()].map((id) => [id, 0]));
  return new Map([...scores.entries()].map(([id, v]) => [id, v / max]));
}

/**
 * search.keyword(query, docs) -> ranked[]
 * ranked[] = docs (spread) with a real BM25 `score`, best first.
 */
export function keyword(query, docs) {
  validateQuery(query);
  validateDocs(docs);
  const scores = bm25Scores(query, docs);
  return docs
    .map((doc) => ({ ...doc, score: scores.get(doc.id) ?? 0 }))
    .sort(byScoreThenId((entry) => entry.score));
}

export default { keyword, bm25Scores, validateDocs, validateQuery, normalizeScores, K1, B };
