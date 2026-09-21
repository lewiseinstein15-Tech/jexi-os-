/**
 * JEXI OS — Phase 19 Scope B — rule-based vector similarity.
 *
 * SurfSense research note: SurfSense's hybrid retrieval scores chunks with
 * embedding vectors alongside BM25. Embedding models are NOT available in
 * this sandbox, so this module implements the deterministic rule-based
 * substitute the phase spec allows:
 *
 *   LABEL: "rule-based — embedding model NOT VERIFIED"
 *
 * Cosine-style score over token SETS (binary indicator vectors):
 *
 *   sim(q, d) = |q ∩ d| / sqrt(|q| * |d|)
 *
 * where |q| = number of unique query tokens, |d| = number of unique document
 * tokens (title + text), and the intersection is the shared unique tokens.
 * This is genuine cosine similarity of the two binary token vectors — no
 * randomness, no network, no embedding model. Repetition is ignored (sets);
 * BM25 in keyword.js is what rewards term frequency.
 *
 * Determinism: pure function of (query, docs). Ties broken by id ascending.
 */
import { SurfError } from '../connectors/_internal.js';
import { tokenize } from '../connectors/local-search.js';
import { validateDocs, validateQuery, byScoreThenId } from './keyword.js';

export const VECTOR_LABEL = 'rule-based — embedding model NOT VERIFIED';

/**
 * search.vector(query, docs) -> ranked[]
 * ranked[] = docs (spread) with a cosine-style `score` in [0, 1], best first.
 */
export function vector(query, docs) {
  validateQuery(query);
  validateDocs(docs);

  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) {
    return docs.map((doc) => ({ ...doc, score: 0 })).sort(byScoreThenId((e) => e.score));
  }

  const qSet = new Set(qTokens);
  return docs
    .map((doc) => {
      const dTokens = [...new Set(tokenize(`${doc.title ? `${doc.title} ` : ''}${doc.text}`))];
      let shared = 0;
      for (const t of dTokens) if (qSet.has(t)) shared += 1;
      const score = shared / Math.sqrt(qTokens.length * dTokens.length);
      return { ...doc, score };
    })
    .sort(byScoreThenId((e) => e.score));
}

export default { vector, VECTOR_LABEL };
