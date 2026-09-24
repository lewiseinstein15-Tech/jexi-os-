/**
 * JEXI OS — Phase 28 Scope A — brain repo: page schema (frontmatter + sections).
 *
 * Every page: YAML frontmatter (fixed key order — deterministic serialization)
 * followed by exactly two sections:
 *   ## Compiled Truth  — current best understanding (replaceable)
 *   ## Timeline        — append-only dated entries (never rewritten)
 *
 * Timeline entries serialize as `- <ISO when>: <entry text>` lines, ordered by
 * (when asc, seq asc) — seq is the stable insertion counter, so equal
 * timestamps keep insertion order deterministically.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';

/** Frontmatter keys in canonical serialization order. */
export const FRONTMATTER_KEYS = Object.freeze(['kind', 'slug', 'title', 'tags', 'created_at', 'updated_at']);

export const COMPILED_HEADING = '## Compiled Truth';
export const TIMELINE_HEADING = '## Timeline';

function iso(v, what) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${what} must be an ISO-8601 UTC string (…Z), got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Build a page object (validated, canonical field order). */
export function makePage({ kind, slug, title, tags = [], compiledTruth = '', timeline = [], created_at, updated_at }) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `title must be a non-empty string, got ${JSON.stringify(title)}`);
  }
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'tags must be an array of strings');
  }
  const when = iso(created_at, 'created_at');
  iso(updated_at, 'updated_at');
  const tl = timeline.map((e, i) => ({
    when: iso(e.when, `timeline[${i}].when`),
    entry: String(e.entry),
    seq: Number.isInteger(e.seq) ? e.seq : i,
  }));
  tl.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : a.seq - b.seq));
  return { kind, slug, title, tags: [...tags], compiledTruth: String(compiledTruth), timeline: tl, created_at: when, updated_at };
}

/** Deterministic markdown serialization. */
export function serialize(page) {
  const lines = ['---'];
  lines.push(`kind: ${page.kind}`);
  lines.push(`slug: ${page.slug}`);
  lines.push(`title: ${JSON.stringify(page.title)}`);
  lines.push(`tags: [${page.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
  lines.push(`created_at: ${page.created_at}`);
  lines.push(`updated_at: ${page.updated_at}`);
  lines.push('---', '');
  lines.push(COMPILED_HEADING, '');
  lines.push(page.compiledTruth.trim() === '' ? '(none yet)' : page.compiledTruth.trim(), '');
  lines.push(TIMELINE_HEADING, '');
  if (page.timeline.length === 0) lines.push('(empty)');
  for (const e of page.timeline) lines.push(`- ${e.when}: ${e.entry}`);
  lines.push('');
  return lines.join('\n');
}

/** Parse markdown back into a page object. Round-trips serialize() exactly. */
export function parse(markdown, { expectPath = '' } = {}) {
  if (typeof markdown !== 'string' || !markdown.startsWith('---\n')) {
    throw new SemanticaError('E_INVALID_PAGE', `page${expectPath ? ' ' + expectPath : ''} does not start with frontmatter`);
  }
  const end = markdown.indexOf('\n---\n', 3);
  if (end === -1) throw new SemanticaError('E_INVALID_PAGE', `page${expectPath ? ' ' + expectPath : ''} has unterminated frontmatter`);
  const fm = {};
  for (const line of markdown.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (key === 'tags') {
      fm[key] = val === '[]' ? [] : val.replace(/^\[|\]$/g, '').split(',').map((s) => JSON.parse(s.trim()));
    } else if (key === 'title') {
      fm[key] = JSON.parse(val);
    } else {
      fm[key] = val;
    }
  }
  const body = markdown.slice(end + 5);
  const tIdx = body.indexOf(TIMELINE_HEADING);
  if (tIdx === -1) throw new SemanticaError('E_INVALID_PAGE', `page${expectPath ? ' ' + expectPath : ''} missing "${TIMELINE_HEADING}" section`);
  let compiled = body.slice(0, tIdx).replace(COMPILED_HEADING, '').trim();
  if (compiled === '(none yet)') compiled = '';
  const timeline = [];
  let seq = 0;
  for (const line of body.slice(tIdx + TIMELINE_HEADING.length).split('\n')) {
    const m = line.match(/^- (\d{4}-\d{2}-\d{2}T[\d:.]+Z): (.*)$/);
    if (m) timeline.push({ when: m[1], entry: m[2], seq: seq++ });
  }
  return makePage({ ...fm, compiledTruth: compiled, timeline });
}
