/**
 * JEXI OS — Phase 28 Scope C — typed-edge KG: regex link extraction.
 *
 * On every page, sentences from the compiled truth + timeline are scanned for
 * capitalized entity surface forms; the page subject links to each entity with
 * the highest-precedence verb the sentence supports. Every edge carries its
 * evidence sentence verbatim. Deterministic: sentence order = document order,
 * entity order = position, final edge list sorted + deduplicated.
 *
 * Pure regex. NO LLM call. Ever.
 */
import { inferType, assertVerb } from './verb-inference.js';
import { SemanticaError } from '../../semantica/_internal.js';

/** Capitalized surface-form entities (1-3 tokens), deterministic scan. */
const ENTITY_RE = /\b([A-Z][a-zA-Z0-9'’.-]*(?:\s+[A-Z][a-zA-Z0-9'’.-]*){0,2})\b/g;
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/** Sentences of a page: compiled truth first, then timeline in order. */
export function pageSentences(page) {
  const out = [];
  const compiled = (page.compiledTruth || '').trim();
  if (compiled) out.push(...compiled.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean));
  const timeline = [...(page.timeline || [])].sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.seq - b.seq));
  for (const e of timeline) out.push(...String(e.entry).split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean));
  return out;
}

/** Validate an externally supplied edge. Unknown verb -> E_UNKNOWN_EDGE_KIND. */
export function validateEdge(edge) {
  if (!edge || typeof edge !== 'object' || typeof edge.from !== 'string' || typeof edge.to !== 'string' || typeof edge.evidence !== 'string') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'edge must be { from, to, verb, evidence } with string fields');
  }
  assertVerb(edge.verb);
  return edge;
}

/** Capitalized sentence-start pronouns/adverbs that are NOT entities. */
const STOP_ENTITIES = Object.freeze(new Set([
  'She', 'He', 'They', 'It', 'I', 'We', 'You', 'Later', 'Then', 'There', 'Here',
  'This', 'That', 'These', 'Those', 'Also', 'However', 'After', 'Before', 'Soon',
]));

function entityFilter(page) {
  const titleWords = new Set(String(page.title || '').toLowerCase().split(/[^a-z0-9'’.-]+/).filter(Boolean));
  return (name) => {
    const t = name.trim();
    if (t.length < 2) return false;
    if (STOP_ENTITIES.has(t)) return false;
    const first = t.split(/\s+/)[0].toLowerCase();
    return !titleWords.has(first) && !titleWords.has(t.toLowerCase());
  };
}

/**
 * extract(page) -> { edges: [{ from, to, verb, evidence }] }
 * from = page slug (subject); to = entity surface form; verb = precedence
 * winner for the sentence; evidence = the sentence verbatim.
 */
export function extract(page) {
  if (!page || typeof page.kind !== 'string' || typeof page.slug !== 'string') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'extract(page): page must be a brain/repo page object (kind + slug)');
  }
  const keep = entityFilter(page);
  const edges = [];
  for (const sentence of pageSentences(page)) {
    const names = [];
    let m;
    ENTITY_RE.lastIndex = 0;
    while ((m = ENTITY_RE.exec(sentence)) !== null) {
      const name = m[1].replace(/[.,;:]$/, '');
      if (keep(name)) names.push(name);
    }
    if (names.length === 0) continue;
    const { verb } = inferType(sentence, { pageSlug: page.slug });
    for (const name of names) {
      edges.push({ from: page.slug, to: name, verb, evidence: sentence });
    }
  }
  // deterministic: dedupe + sort by (from, to, verb, evidence)
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    const k = `${e.from}\u0000${e.to}\u0000${e.verb}\u0000${e.evidence}`;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  out.sort((a, b) =>
    (a.from < b.from ? -1 : a.from > b.from ? 1 :
     a.to < b.to ? -1 : a.to > b.to ? 1 :
     VERBCMP(a.verb, b.verb) || (a.evidence < b.evidence ? -1 : a.evidence > b.evidence ? 1 : 0)));
  return { edges: out };
}

import { VERB_PRECEDENCE } from './verb-inference.js';
function VERBCMP(a, b) { return VERB_PRECEDENCE.indexOf(a) - VERB_PRECEDENCE.indexOf(b); }
