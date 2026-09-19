/**
 * JEXI OS — Phase 17 Scope D — MEMORY / HYBRID SEARCH (enhancement layer).
 *
 * Retrieval over Phase 4 `MemoryEntry` objects, merging two INDEPENDENT
 * rankings with Reciprocal Rank Fusion:
 *
 *   • BM25 keyword score   — real Okapi BM25 (k1=1.5, b=0.75,
 *                            idf = ln(1 + (N − df + 0.5)/(df + 0.5)));
 *                            scores live on a ~0..10+ scale.
 *   • Vector similarity    — cosine ∈ [−1, 1] over entry embeddings. The
 *                            embedder is INJECTABLE (`options.embed`); the
 *                            built-in default is a deterministic feature-
 *                            hashing embedder (unigrams+bigrams, L2-
 *                            normalised) LABELED: `hash-embedding (deterministic
 *                            bag-of-ngrams) — all-MiniLM-L6-v2 semantic
 *                            embeddings NOT VERIFIED in this runtime`.
 *                            When a local embedding model is available,
 *                            pass it and everything else stays identical.
 *
 * WHY RRF (and not a weighted average): BM25 and cosine scores are on
 * INCOMMENSURABLE scales; any weighted average needs score normalisation
 * whose constants silently control the trade-off. RRF uses only RANKS —
 * rrf(d) = Σ_methods 1/(k + rank_d) — so it is scale-free by construction.
 * `k` (default 60) dampens the head of each ranking; configurable.
 *
 * LIFECYCLE INTEGRATION: entries whose lifecycle state is ARCHIVED are
 * excluded from indexing/retrieval (memory/lifecycle.js `isArchived`) but are
 * NOT deleted — the JSONL store below keeps them on disk verbatim.
 */

import fs from 'node:fs';
import { isArchived } from './lifecycle.js';

export const HYBRID_DEFAULTS = Object.freeze({ k: 60, topK: 5, k1: 1.5, b: 0.75, dims: 256, matchFloor: 0.3 });

/* ──────────────────────────── embedder (default) ────────────────────────── */

export const HASH_EMBEDDER_LABEL = 'hash-embedding (deterministic bag-of-ngrams) — all-MiniLM-L6-v2 semantic embeddings NOT VERIFIED in this runtime';

export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9_]+/g) || [];
}

/** Deterministic feature-hashing embedding of unigrams + bigrams, L2-normalised. */
export function hashEmbed(text, { dims = HYBRID_DEFAULTS.dims } = {}) {
  const v = new Float64Array(dims);
  const toks = tokenize(text);
  const add = (term) => {
    let h = 2166136261;
    for (let i = 0; i < term.length; i++) { h ^= term.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[(h >>> 0) % dims] += 1;
  };
  for (let i = 0; i < toks.length; i++) {
    add(toks[i]);
    if (i + 1 < toks.length) add(`${toks[i]}_${toks[i + 1]}`);
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}

/** Wrap any async text→vector model as the index embedder. */
export function modelEmbedder(fn, label) {
  return { label: label || 'injected-embedding-model', dims: null, embed: async (text) => fn(text) };
}

export const hashEmbedder = { label: HASH_EMBEDDER_LABEL, dims: HYBRID_DEFAULTS.dims, embed: async (text, o) => hashEmbed(text, o) };

/* ──────────────────────────────── similarity ────────────────────────────── */

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/* ──────────────────────────────── the index ─────────────────────────────── */

/**
 * Build a hybrid index over entries.
 * @param {Array<object>} entries   MemoryEntry[]
 * @param {object} [o]              { embed, k, k1, b, dims, now }
 */
export async function createHybridIndex(entries, o = {}) {
  const cfg = { ...HYBRID_DEFAULTS, ...o };
  const embed = o.embed || hashEmbedder.embed;
  // Label: explicit option wins; then the embedder object's own label; then a
  // neutral name for a bare injected function (never the hash label by
  // mistake — a bare function is NOT the hash embedder).
  const embedLabel = o.embedLabel || (typeof o.embed === 'object' ? o.embed?.label : null)
    || (o.embed ? 'injected embedder (caller-provided)' : hashEmbedder.label);
  /**
   * Vector MATCH FLOOR: real semantic embeddings give (small) positive cosine
   * to every text, so "some similarity" is not "a match". A vector hit only
   * counts toward retrieval when cosine ≥ matchFloor (default 0.30 — below
   * typical cross-domain MiniLM similarity, above true topical matches).
   * BM25 hits (score > 0) always count. If NO method matches → E_NO_RESULTS.
   */
  const matchFloor = o.matchFloor ?? 0.3;

  const excluded = [];
  const docs = [];
  for (const e of entries || []) {
    if (isArchived(e)) { excluded.push({ id: e.id, state: e.metadata?.lifecycleState || 'ARCHIVED' }); continue; }
    docs.push({
      entry: e,
      id: e.id,
      tokens: tokenize(e.content),
      vector: await embed(e.content, { dims: cfg.dims }),
    });
  }

  // BM25 corpus statistics.
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const totalLen = docs.reduce((s, d) => s + d.tokens.length, 0);
  const avgdl = docs.length ? totalLen / docs.length : 0;

  function bm25Scores(query) {
    const q = [...new Set(tokenize(query))];
    const scores = [];
    for (const d of docs) {
      const tf = new Map();
      for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
      let s = 0;
      for (const term of q) {
        const f = tf.get(term) || 0;
        if (!f) continue;
        const n = df.get(term) || 0;
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        s += idf * ((f * (cfg.k1 + 1)) / (f + cfg.k1 * (1 - cfg.b + cfg.b * (d.tokens.length / (avgdl || 1)))));
      }
      if (s > 0) scores.push({ doc: d, score: s });
    }
    return scores;
  }

  async function vectorScores(query) {
    const qv = await embed(query, { dims: cfg.dims });
    const scores = [];
    for (const d of docs) {
      const s = cosine(qv, d.vector);
      if (s > 0) scores.push({ doc: d, score: s });
    }
    return scores;
  }

  const rankOf = (list, id) => {
    const i = list.findIndex((x) => x.doc.id === id);
    return i === -1 ? null : { rank: i + 1, score: list[i].score, doc: list[i].doc };
  };

  /**
   * Hybrid search.
   * @returns {Promise<{results: Array, reason?: string, embedder: string, k: number,
   *                    methods: {bm25: Array, vector: Array}}>}
   *   results: [{ entry, rrf, methods: { bm25: {score, rank}|null, vector: {score, rank}|null } }]
   *   reason 'E_NO_RESULTS' when nothing matched in either method.
   */
  async function search(query, { topK = cfg.topK, k = cfg.k } = {}) {
    const bm25 = bm25Scores(query).sort((a, b) => b.score - a.score);
    const vec = (await vectorScores(query)).filter((x) => x.score >= matchFloor).sort((a, b) => b.score - a.score);
    if (!bm25.length && !vec.length) {
      return { results: [], reason: 'E_NO_RESULTS', query, embedder: embedLabel, k, methods: { bm25: [], vector: [] } };
    }
    const ids = new Set([...bm25.map((x) => x.doc.id), ...vec.map((x) => x.doc.id)]);
    const results = [];
    for (const id of ids) {
      const b = rankOf(bm25, id), v = rankOf(vec, id);
      let rrf = 0;
      if (b) rrf += 1 / (k + b.rank);
      if (v) rrf += 1 / (k + v.rank);
      const doc = (b ? b.doc : v.doc);
      results.push({
        entry: doc.entry,
        rrf,
        methods: {
          bm25: b ? { score: b.score, rank: b.rank } : null,
          vector: v ? { score: v.score, rank: v.rank } : null,
        },
      });
    }
    results.sort((x, y) => y.rrf - x.rrf || String(x.entry.id).localeCompare(String(y.entry.id)));
    return { results: results.slice(0, topK), embedder: embedLabel, k, methods: { bm25: bm25.length, vector: vec.length } };
  }

  return {
    docs: docs.map((d) => d.id),
    excludedArchived: excluded,
    embedder: embedLabel,
    search,
    bm25Only: (query) => bm25Scores(query).sort((a, b) => b.score - a.score).map((x) => ({ id: x.doc.id, score: x.score })),
    vectorOnly: async (query) => (await vectorScores(query)).sort((a, b) => b.score - a.score).map((x) => ({ id: x.doc.id, score: x.score })),
  };
}

/* ─────────────────────────── JSONL store (shim) ─────────────────────────── */

/**
 * Local JSONL persistence for the enhancement layer — the "still on disk"
 * guarantee for ARCHIVED entries. Phase 4's SQLite backend remains the system
 * of record for the tiers; this store exists so lifecycle/search behaviour is
 * testable standalone. One JSON object per line; ARCHIVED entries are written
 * with their state and never dropped.
 */
export class JsonlMemoryStore {
  constructor(file) {
    this.file = file;
    this.byKey = new Map();
  }
  load() {
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        this.byKey.set(e.id, e);
      }
    }
    return this;
  }
  /** Add/replace in memory AND write through to disk (append or rewrite). */
  put(entry) {
    this.byKey.set(entry.id, entry);
    if (this.byKey.size === 1 || !fs.existsSync(this.file)) this.save();
    else fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return entry;
  }
  save() {
    fs.mkdirSync(fs.dirname ? fs.dirname(this.file) : this.file.split('/').slice(0, -1).join('/'), { recursive: true });
    fs.writeFileSync(this.file, [...this.byKey.values()].map((e) => JSON.stringify(e)).join('\n') + '\n');
    return this;
  }
  entries() { return [...this.byKey.values()]; }
  get(id) { return this.byKey.get(id) || null; }
  count() { return this.byKey.size; }
}

export default { HYBRID_DEFAULTS, tokenize, hashEmbed, hashEmbedder, modelEmbedder, cosine, createHybridIndex, JsonlMemoryStore, HASH_EMBEDDER_LABEL };
