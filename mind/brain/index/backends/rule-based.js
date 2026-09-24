/**
 * JEXI OS — Phase 28 Scope B — rule-based embedding backend (honest fallback).
 *
 * Phase 19 B compatible: token-overlap cosine, declared. Deterministic
 * hashed bag-of-words vectors: each token hashes (FNV-1a) to one of DIM
 * buckets, bucket weights are term counts, vector is L2-normalized. Cosine
 * over these vectors IS the token-overlap cosine — real math, no model,
 * labeled accordingly. NOT a fake of a real embedding.
 */
import { tokenize } from '../../../surfsense/connectors/local-search.js';

export const NAME = 'rule-based';
export const LABEL = 'rule-based — embedding model NOT VERIFIED';
export const DIM = 256;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Embed texts -> number[][] (DIM each, L2-normalized, deterministic). */
export function embed(texts) {
  if (!Array.isArray(texts)) throw new TypeError('embed(texts): texts must be an array of strings');
  return texts.map((text) => {
    const vec = new Array(DIM).fill(0);
    for (const tok of tokenize(String(text))) {
      vec[fnv1a(tok) % DIM] += 1;
    }
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    return norm === 0 ? vec : vec.map((v) => v / norm);
  });
}

export default { name: NAME, label: LABEL, dim: DIM, embed, available: () => true };
