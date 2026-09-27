/**
 * JEXI OS — CAPABILITY SEMANTIC MATCHER (P10 GAP 5).
 *
 * Layer 2 of the capability gate: the regex evidence cascade (AgenticDecision
 * catalogMatch) stays the deterministic fast path, but novel phrasings fall
 * through it. This module embeds every capability's semantic profile (label +
 * description + seed vocabulary) into a fixed-size vector space at boot/warm
 * and cosine-matches the turn's query against it.
 *
 * Why a local deterministic embedder (not a hosted embedding API): the gate
 * must work KEYLESS (the primary sandbox posture) and deterministic (the
 * simulation suite asserts stable routing 3× back-to-back). Hashed token +
 * character-trigram features give stemming-like tolerance ("searching" ~
 * "search", "reminders" ~ "remember") without any network or model. The
 * semantica ontology graph is a knowledge graph, not a vector space — it does
 * not provide embeddings, so this module is the vector layer.
 *
 * Fail-soft: every accessor is total; an empty index simply routes nothing.
 */

const DIM = 512;

/** FNV-1a 32-bit — stable across processes, no crypto needed. */
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Feature extraction: word tokens + character trigrams (stemming-like). */
function features(text) {
  const words = String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [];
  const out = [];
  for (const w of words) {
    out.push(`w:${w}`);
    if (w.length >= 3) {
      for (let i = 0; i <= w.length - 3; i++) out.push(`g:${w.slice(i, i + 3)}`);
    }
  }
  return out;
}

/** Embed text into a L2-normalized DIM vector (sublinear tf). */
export function embed(text) {
  const v = new Float64Array(DIM);
  const feats = features(text);
  if (!feats.length) return v;
  for (const f of feats) v[hashStr(f) % DIM] += 1;
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    if (v[i] > 0) {
      v[i] = 1 + Math.log(v[i]);
      norm += v[i] * v[i];
    }
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

/** Cosine similarity (both inputs MUST come from embed()). */
export function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < DIM; i++) d += a[i] * b[i];
  return d;
}

/**
 * Seed vocabulary per capability — the capability's own words beyond its
 * description, drawn from its evidence regexes and the real tools it
 * dispatches. Declared data, not magic.
 */
export const CAPABILITY_SEEDS = {
  web_search: 'search web online internet browse browse look up find latest current recent news headline headline article story stories publication publications report reports journal magazine coverage trend happening newest fresh scoop bulletin update updates press media digest read up on check sources',
  file_read: 'read open show display view file contents cat document path load contents disk folder text',
  code_run: 'run execute script program code python node javascript compute programmatically snippet output calculate evaluate',
  memory_write: 'remember note keep store save record memorize forget preference favorite fact persist name my favorite store this',
  memory_read: 'recall remember retrieve stored memory told said mentioned name who am i what did my favorite prefer meeting time',
  direct_answer: 'answer explain define arithmetic calculate compute solve math question knowledge directly theorem formula',
};

const DEFAULT_THRESHOLD = 0.25; // recall-oriented but bounded: L1 guards the common phrasings; novel phrasings score ~0.25-0.4. Below this, diffuse matches (e.g. a how-to query loosely near file_read) must NOT hijack routing — they fall through to the model lanes / skill library.

let __index = null; // [{ id, vector }]
let __df = null;    // feature → document frequency across profiles (down-weights generic trigrams)

/** Corpus-weighted embedding: features present in EVERY profile carry less
 * discrimination, so they are down-weighted by 1/log(1+df). Both the profile
 * vectors and the query vectors use the SAME weighting (df captured at warm). */
function embedWeighted(text, dfMap) {
  const v = new Float64Array(DIM);
  const feats = features(text);
  if (!feats.length) return v;
  const counts = new Map();
  for (const f of feats) counts.set(f, (counts.get(f) || 0) + 1);
  for (const [f, tf] of counts) {
    const df = dfMap ? (dfMap.get(f) || 1) : 1;
    v[hashStr(f) % DIM] += (1 + Math.log(tf)) / Math.log(1 + df);
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

/** Build (or reuse) the semantic index over AgenticDecision's catalog. */
export async function warmSemanticIndex({ refresh = false } = {}) {
  if (__index && !refresh) return __index;
  const { CAPABILITY_CATALOG } = await import('./AgenticDecision.js');
  const texts = (CAPABILITY_CATALOG || []).map((c) => `${c.label || ''}. ${c.description || ''}. ${CAPABILITY_SEEDS[c.id] || ''}`);
  __df = new Map();
  const featSets = texts.map((t) => new Set(features(t)));
  for (const set of featSets) for (const f of set) __df.set(f, (__df.get(f) || 0) + 1);
  __index = (CAPABILITY_CATALOG || []).map((c, i) => ({ id: c.id, vector: embedWeighted(texts[i], __df) }));
  return __index;
}

/**
 * Semantic route: embed the query, cosine-match against every capability
 * profile. Returns { id, score, threshold, via: 'semantic' } above threshold
 * (only the top match), else null — callers fall through to the model lanes.
 */
export async function semanticRoute(query, { threshold = DEFAULT_THRESHOLD } = {}) {
  const index = await warmSemanticIndex();
  if (!index.length) return null;
  const qv = embedWeighted(query, __df);
  let best = null;
  for (const entry of index) {
    const score = cosine(qv, entry.vector);
    if (!best || score > best.score) best = { id: entry.id, score };
  }
  if (!best || best.score < threshold) return null;
  return { id: best.id, score: Number(best.score.toFixed(4)), threshold, via: 'semantic' };
}

/** Diagnostics for tests/boot: every capability's score for a query. */
export async function semanticScores(query) {
  const index = await warmSemanticIndex();
  const qv = embedWeighted(query, __df);
  return index
    .map((e) => ({ id: e.id, score: Number(cosine(qv, e.vector).toFixed(4)) }))
    .sort((a, b) => b.score - a.score);
}

export const SEMANTIC_GATE = { DIM, DEFAULT_THRESHOLD };
