/**
 * JEXI OS — Phase 19 Scope C — the 12 output format renderers.
 *
 * SurfSense research note: SurfSense renders one research result into many
 * consumption shapes (report types, artifact exports, podcast transcripts).
 * This module is the rendering half of that pattern for surfsense: 12 real,
 * deterministic transformations over the ranked documents the caller passes
 * in (typically the output of surfsense/search — Scope B's public API).
 *
 * Truthfulness: every renderer is rule-based text transformation over the
 * caller's documents (sentence extraction, tf-based keyword/topic extraction,
 * date normalization, dedupe, grouping). No LLM, no network, no embedding.
 * The 'podcast-script-stub' renderer is a DELIBERATE short transcript stub —
 * Scope D's full podcast generator replaces it when wired.
 *
 * Determinism: pure functions of (docs, query). Same inputs -> byte-identical
 * strings. Ordering inside each renderer is fixed: either caller rank order
 * (documents arrive pre-ranked; renderers never re-rank by relevance), or an
 * explicit deterministic order (date asc + id asc tiebreak, alpha topics,
 * id-asc group members). Renderers never mutate the input array.
 *
 * Per-format required fields: 'timeline' and 'chronological' require a
 * parseable "date" on every doc -> SurfError E_MISSING_FIELD naming the field
 * when absent/unparseable. Optional date consumers ('comparison-table') show
 * '-' when absent but still surface E_MISSING_FIELD when a date is present
 * yet unparseable (surfacing bad data beats masking it).
 */
import { SurfError } from '../connectors/_internal.js';
import { tokenize } from '../connectors/local-search.js';

/* ------------------------------------------------------------------ *
 * Shared deterministic text helpers (exported for reuse/testing).
 * ------------------------------------------------------------------ */

/** Split text into sentences on [.!?] + whitespace boundaries. */
export function sentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** First sentence of a text (falls back to the trimmed whole text). */
export function leadSentence(text) {
  const list = sentences(text);
  return list.length > 0 ? list[0] : String(text).trim();
}

/** Append a full stop unless the string already ends with sentence punctuation. */
export function endStop(s) {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** ASCII-safe clip: max n chars, '...' suffix when truncated. */
export function clip(s, n) {
  const t = String(s);
  return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 3))}...`;
}

/**
 * Top-k tokens by term frequency (desc), alphabetical ascending tiebreak.
 * Uses the Scope A public tokenizer (surfsense/connectors/local-search.js) —
 * reuse, not duplication. Deterministic.
 */
export function topTokens(text, k = 3) {
  const counts = new Map();
  for (const t of tokenize(String(text))) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, k)
    .map(([t]) => t);
}

/** Rule-based doc topic: highest-tf token (alpha tiebreak); 'general' if none. */
export function docTopic(doc) {
  const top = topTokens(doc.text, 1);
  return top.length > 0 ? top[0] : 'general';
}

/** id-ascending comparator — THE deterministic tiebreak (Scope B convention). */
export function byIdAsc(a, b) {
  const ia = String(a.id ?? '');
  const ib = String(b.id ?? '');
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** Parse doc.date -> epoch ms. Accepts ISO-8601 strings, Date, epoch-ms number. */
function toEpoch(raw) {
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) return Date.parse(raw);
  return NaN;
}

/**
 * Required-date resolver for date-mandatory formats: absent or unparseable
 * date -> E_MISSING_FIELD (message names the field: "date").
 */
export function requireDate(doc, format) {
  const epoch = toEpoch(doc.date);
  if (!Number.isFinite(epoch)) {
    throw new SurfError(
      'E_MISSING_FIELD',
      `doc "${doc.id}" is missing required field "date" for format "${format}"`
    );
  }
  return epoch;
}

/** Optional-date resolver: absent -> null; present-but-unparseable -> E_MISSING_FIELD. */
export function optionalDate(doc, format) {
  if (doc.date === undefined) return null;
  return requireDate(doc, format);
}

/** Epoch ms -> YYYY-MM-DD (UTC) — deterministic rendering of a date. */
export function fmtDate(epoch) {
  return new Date(epoch).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * The 12 renderers. Each: (docs, query) -> string.
 * docs is pre-validated (non-empty) by render.js; query may be undefined.
 * ------------------------------------------------------------------ */

/** 1. summary — paragraph synthesis from the top-ranked docs. */
export function renderSummary(docs, query) {
  const leads = docs.map((d) => endStop(leadSentence(d.text)));
  const head = `Across ${docs.length} document${docs.length === 1 ? '' : 's'}${
    query ? ` on "${query}"` : ''
  }:`;
  return `${head} ${leads.join(' ')}`;
}

/** 2. bullet-list — one bullet per doc, rank order preserved. */
export function renderBulletList(docs) {
  return docs.map((d) => `- ${d.title ?? d.id}: ${endStop(leadSentence(d.text))}`).join('\n');
}

/** 3. qa — one {question, answer} pair per doc, derived from title/id + lead. */
export function renderQa(docs) {
  return docs
    .map((d) => {
      const question = d.title ? `What does "${d.title}" cover?` : `What does ${d.id} cover?`;
      return `Q: ${question}\nA: ${endStop(leadSentence(d.text))}`;
    })
    .join('\n\n');
}

/** 4. timeline — chronologically ordered dated entries (date REQUIRED). */
export function renderTimeline(docs) {
  return docs
    .map((d) => ({ d, epoch: requireDate(d, 'timeline') }))
    .sort((a, b) => (a.epoch !== b.epoch ? a.epoch - b.epoch : byIdAsc(a.d, b.d)))
    .map(({ d, epoch }) => `${fmtDate(epoch)} | ${d.title ?? d.id} — ${endStop(leadSentence(d.text))}`)
    .join('\n');
}

/** 5. comparison-table — rows = docs, cols = extracted facets (date optional). */
export function renderComparisonTable(docs) {
  const headers = ['Doc', 'Date', 'Keywords', 'Lead'];
  const rows = docs.map((d) => {
    const epoch = optionalDate(d, 'comparison-table');
    return [
      clip(d.title ?? d.id, 24),
      epoch === null ? '-' : fmtDate(epoch),
      topTokens(d.text, 3).join(', ') || '-',
      clip(endStop(leadSentence(d.text)), 40),
    ];
  });
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join(' | ');
  const sep = widths.map((w) => '-'.repeat(w)).join(' | ');
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

/** 6. mind-map-outline — root = query, level 1 = docs, level 2 = keywords. */
export function renderMindMap(docs, query) {
  const lines = [query ?? 'Research Corpus'];
  for (const d of docs) {
    lines.push(`  ${d.title ?? d.id}`);
    const kws = topTokens(d.text, 3);
    if (kws.length > 0) lines.push(`    ${kws.join(', ')}`);
  }
  return lines.join('\n');
}

/** 7. podcast-script-stub — short two-host transcript (Scope D replaces). */
export function renderPodcastScriptStub(docs, query) {
  const d0 = docs[0];
  return [
    '[STUB — Scope D podcast generator replaces this short transcript]',
    `HOST A: Welcome back. On the desk: ${docs.length} document${
      docs.length === 1 ? '' : 's'
    }${query ? ` on "${query}"` : ''}.`,
    `HOST B: Lead source: ${d0.title ?? d0.id} — ${endStop(leadSentence(d0.text))}`,
    "HOST A: Full episode generation is Scope D's feature, not this stub's.",
  ].join('\n');
}

/**
 * 8. faq — question/answer pairs DEDUPED by normalized question
 * ("What is <topic>?" per doc; same-topic docs merge answers).
 */
export function renderFaq(docs) {
  const merged = new Map();
  for (const d of docs) {
    const question = `What is ${docTopic(d)}?`;
    const key = question.toLowerCase();
    if (!merged.has(key)) merged.set(key, { question, answers: [] });
    const entry = merged.get(key);
    const answer = endStop(leadSentence(d.text));
    if (!entry.answers.includes(answer)) entry.answers.push(answer);
  }
  return [...merged.values()]
    .map((e) => `Q: ${e.question}\nA: ${e.answers.join(' ')}`)
    .join('\n\n');
}

/** 9. executive-brief — exactly 3 paragraphs. */
export function renderExecutiveBrief(docs, query) {
  const topic = query ?? docTopic(docs[0]);
  const p1 = `Briefing on "${topic}": ${docs.length} document${
    docs.length === 1 ? '' : 's'
  } reviewed, opening with "${docs[0].title ?? docs[0].id}".`;
  const p2 = `Key points: ${docs
    .slice(0, 3)
    .map((d) => endStop(leadSentence(d.text)))
    .join(' ')}`;
  const last = docs[docs.length - 1];
  const p3 = `Bottom line: ${endStop(leadSentence(last.text))} ${docs.length} source${
    docs.length === 1 ? '' : 's'
  } on file.`;
  return [p1, p2, p3].join('\n\n');
}

/** 10. deep-dive — long-form sectioned output. */
export function renderDeepDive(docs, query) {
  const head = query ? `# Deep Dive: ${query}` : '# Deep Dive';
  const topics = [...new Set(docs.map(docTopic))].sort().join(', ');
  const overview = `## Overview\n${docs.length} documents reviewed. Topics covered: ${topics}.`;
  const sections = docs.map((d) => `## ${d.title ?? d.id}\n${endStop(String(d.text).trim())}`);
  const sources = `## Sources\n${docs
    .map((d) => `- ${d.id}${d.title ? ` — ${d.title}` : ''}`)
    .join('\n')}`;
  return [head, overview, ...sections, sources].join('\n\n');
}

/** 11. chronological — date-ordered narrative (date REQUIRED). */
export function renderChronological(docs) {
  const ordered = docs
    .map((d) => ({ d, epoch: requireDate(d, 'chronological') }))
    .sort((a, b) => (a.epoch !== b.epoch ? a.epoch - b.epoch : byIdAsc(a.d, b.d)));
  const parts = ordered.map(({ d, epoch }, i) => {
    const phrase = `${fmtDate(epoch)} — "${d.title ?? d.id}": ${endStop(leadSentence(d.text))}`;
    return i === 0 ? `The record opens on ${phrase}` : `It continues on ${phrase}`;
  });
  parts.push(`That closes the ${ordered.length}-document record.`);
  return parts.join(' ');
}

/** 12. thematic — grouped by extracted topic; groups alpha, members id-asc. */
export function renderThematic(docs) {
  const groups = new Map();
  for (const d of docs) {
    const topic = docTopic(d);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(d);
  }
  return [...groups.keys()]
    .sort()
    .map((topic) =>
      [
        `topic: ${topic}`,
        ...[...groups.get(topic)]
          .sort(byIdAsc)
          .map((d) => `  - ${d.id}: ${clip(endStop(leadSentence(d.text)), 60)}`),
      ].join('\n')
    )
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Format registry — canonical order, one entry per format name.
 * ------------------------------------------------------------------ */
export const FORMAT_NAMES = [
  'summary',
  'bullet-list',
  'qa',
  'timeline',
  'comparison-table',
  'mind-map-outline',
  'podcast-script-stub',
  'faq',
  'executive-brief',
  'deep-dive',
  'chronological',
  'thematic',
];

export const RENDERERS = {
  summary: renderSummary,
  'bullet-list': renderBulletList,
  qa: renderQa,
  timeline: renderTimeline,
  'comparison-table': renderComparisonTable,
  'mind-map-outline': renderMindMap,
  'podcast-script-stub': renderPodcastScriptStub,
  faq: renderFaq,
  'executive-brief': renderExecutiveBrief,
  'deep-dive': renderDeepDive,
  chronological: renderChronological,
  thematic: renderThematic,
};
