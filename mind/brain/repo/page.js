/**
 * JEXI OS — Phase 28 Scope A — brain repo: page create / read / update / append
 * against a declared brain root on disk. Markdown files are the source of
 * truth; this module is the only writer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { kindDir, pagePath } from './layout.js';
import { makePage, serialize, parse } from './schema.js';
import { appendEntry } from './timeline.js';
import { withCompiledTruth } from './compiled-truth.js';

function abs(root, rel) { return path.join(root, rel); }

/** Create a page file. Refuses to overwrite (E_PAGE_EXISTS). */
export function createPage(root, kind, slug, { title, compiledTruth = '', tags = [], now }) {
  if (typeof now !== 'string') throw new SemanticaError('E_INVALID_ARGUMENT', 'now (ISO UTC) is required — no hidden clocks');
  const rel = pagePath(kind, slug);
  const file = abs(root, rel);
  if (fs.existsSync(file)) {
    throw new SemanticaError('E_PAGE_EXISTS', `page ${kind}/${slug} already exists at ${rel}`);
  }
  const page = makePage({ kind, slug, title, tags, compiledTruth, timeline: [], created_at: now, updated_at: now });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serialize(page));
  return page;
}

/** Read + parse a page. Missing file -> E_UNKNOWN_PAGE. */
export function readPage(root, kind, slug) {
  const rel = pagePath(kind, slug);
  const file = abs(root, rel);
  if (!fs.existsSync(file)) {
    throw new SemanticaError('E_UNKNOWN_PAGE', `no page ${kind}/${slug} at ${rel}`);
  }
  return parse(fs.readFileSync(file, 'utf8'), { expectPath: rel });
}

/** Append a timeline entry (append-only). updated_at advances to `when`. */
export function appendToPage(root, kind, slug, { entry, when }) {
  const page = readPage(root, kind, slug);
  const timeline = appendEntry(page.timeline, { entry, when });
  const updated_at = when > page.updated_at ? when : page.updated_at;
  const next = { ...page, timeline, updated_at };
  fs.writeFileSync(abs(root, pagePath(kind, slug)), serialize(next));
  return next;
}

/** Replace the compiled truth (timeline untouched). */
export function updatePage(root, kind, slug, { compiledTruth, title, tags, now }) {
  const page = readPage(root, kind, slug);
  let next = page;
  if (compiledTruth !== undefined) next = withCompiledTruth(next, compiledTruth, { now });
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim() === '') throw new SemanticaError('E_INVALID_ARGUMENT', 'title must be a non-empty string');
    next = { ...next, title, updated_at: now };
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) throw new SemanticaError('E_INVALID_ARGUMENT', 'tags must be an array of strings');
    next = { ...next, tags: [...tags], updated_at: now };
  }
  fs.writeFileSync(abs(root, pagePath(kind, slug)), serialize(next));
  return next;
}

/** List pages (all kinds or one). Sorted by (kind, slug) — deterministic. */
export function listPages(root, { kind } = {}) {
  const kinds = kind === undefined ? Object.keys(kindDirMap) : [kind];   // FIX(B): KIND_DIRS is an object, not a function
  const out = [];
  for (const k of kinds) {
    const dir = abs(root, kindDir(k));
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      out.push(parse(fs.readFileSync(path.join(dir, f), 'utf8'), { expectPath: `${kindDir(k)}/${f}` }));
    }
  }
  out.sort((a, b) => (a.kind === b.kind ? (a.slug < b.slug ? -1 : 1) : a.kind < b.kind ? -1 : 1));
  return out;
}

// local alias so listPages does not import the map twice
import { KIND_DIRS as kindDirMap } from './layout.js';
