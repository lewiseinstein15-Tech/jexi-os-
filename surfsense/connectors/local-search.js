/**
 * JEXI OS — Phase 19 Scope A — local-search connector.
 *
 * The one registry connector that is genuinely live in this sandbox:
 * capabilities.live is TRUE because fetch() really retrieves documents right
 * now, without credentials and without network, by running real BM25 ranking
 * over a real shipped local index (see _local-index.js). Provenance is real:
 * every returned document carries the canonical URL of the indexed source.
 *
 * SurfSense research note: SurfSense's retrieval layer scores chunks with
 * BM25-style lexical relevance alongside embeddings; local-search applies the
 * same ranking idea to a local corpus. Deterministic: same query -> same
 * ranking, ties broken by document id.
 */
import { createConnector } from './_connector.js';
import { LOCAL_INDEX } from './_local-index.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what',
  'when', 'where', 'which', 'who', 'will', 'with',
]);

/** Tokenize: lowercase, split on non-alphanumerics, drop stopwords + 1-char. */
export function tokenize(input) {
  return String(input)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Precompute corpus statistics once at module load (deterministic).
const DOCS = LOCAL_INDEX.map((doc) => ({ ...doc, tokens: tokenize(`${doc.title} ${doc.text}`) }));
const N = DOCS.length;
const AVG_LEN = DOCS.reduce((sum, d) => sum + d.tokens.length, 0) / N;
const DOC_FREQ = new Map();
for (const doc of DOCS) {
  const seen = new Set(doc.tokens);
  for (const term of seen) DOC_FREQ.set(term, (DOC_FREQ.get(term) ?? 0) + 1);
}

/** BM25 (k1=1.5, b=0.75) score of one document for one token list. */
export function bm25Score(doc, queryTerms, k1 = 1.5, b = 0.75) {
  let score = 0;
  const counts = new Map();
  for (const t of doc.tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const term of queryTerms) {
    const tf = counts.get(term) ?? 0;
    if (tf === 0) continue;
    const df = DOC_FREQ.get(term) ?? 0;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    score +=
      (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * doc.tokens.length) / AVG_LEN));
  }
  return score;
}

/** Rank the local index for a query. Deterministic: score desc, id asc. */
export function searchLocalIndex(query, limit = 5) {
  const terms = tokenize(query);
  const scored = DOCS.map((doc) => ({ doc, score: bm25Score(doc, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.doc.id < b.doc.id ? -1 : 1))
    .slice(0, limit);
  return scored;
}

async function fetchLocal(query, opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5;
  const hits = searchLocalIndex(query, limit);
  const fetchedAt = new Date().toISOString();
  return {
    documents: hits.map(({ doc, score }) => ({
      source: 'local-search',
      url: doc.url,
      fetchedAt,
      score: Math.round(score * 1000) / 1000,
      title: doc.title,
      text: doc.text,
    })),
  };
}

export default createConnector({
  name: 'local-search',
  capabilities: { live: true, auth: 'none' },
  fetch: fetchLocal,
});
