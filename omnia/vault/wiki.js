/**
 * JEXI OS — Phase 15 Scope A — wiki note store (Obsidian-style).
 *
 * Notes live on disk under <vault>/notes/<id>.md with a small
 * frontmatter block (id / title / tags). Bodies carry [[wikilinks]]
 * which are parsed into backlinks. Unknown note id -> E_UNKNOWN_NOTE.
 * Reuses SemanticaError from Phase 14 (read-only import).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fail, assertNonEmptyString } from '../../semantica/_internal.js';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const notesDir = (vault) => path.join(vault, 'notes');

export function notePath(vault, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw fail('E_BAD_NOTE_ID', 'note id must match ' + ID_RE + ', got ' + JSON.stringify(id));
  }
  return path.join(notesDir(vault), id + '.md');
}

export const parseLinks = (body) => {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m = null;
  while ((m = re.exec(String(body))) !== null) {
    const target = m[1].trim();
    if (target && !out.includes(target)) out.push(target);
  }
  return out.sort();
};

export function serializeNote({ id, title, body, tags }) {
  return '---\n' +
    'id: ' + id + '\n' +
    'title: ' + title + '\n' +
    'tags: ' + JSON.stringify(tags || []) + '\n' +
    '---\n\n' +
    String(body || '') + '\n';
}

export function parseNote(id, content) {
  const m = String(content).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw fail('E_BAD_NOTE', 'note ' + id + ' has no frontmatter block');
  const head = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(': ');
    if (i > 0) head[line.slice(0, i)] = line.slice(i + 2);
  }
  let tags = [];
  try { tags = JSON.parse(head.tags || '[]'); } catch { tags = []; }
  const body = m[2].replace(/\n$/, '');
  return { id, title: head.title || id, tags, body, links: parseLinks(body) };
}

export function saveNote(vault, { id, title, body = '', tags = [] }) {
  assertNonEmptyString(id, 'note id', 'E_BAD_NOTE_ID');
  assertNonEmptyString(title, 'note title', 'E_BAD_NOTE_TITLE');
  if (!Array.isArray(tags)) throw fail('E_BAD_NOTE_TAGS', 'tags must be an array');
  fs.mkdirSync(notesDir(vault), { recursive: true });
  fs.writeFileSync(notePath(vault, id), serializeNote({ id, title, body, tags }));
  return loadNote(vault, id);
}

export function loadNote(vault, id) {
  const p = notePath(vault, id);
  if (!fs.existsSync(p)) {
    throw fail('E_UNKNOWN_NOTE', 'unknown note id: ' + JSON.stringify(id));
  }
  return parseNote(id, fs.readFileSync(p, 'utf8'));
}

export function allNotes(vault) {
  const dir = notesDir(vault);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => loadNote(vault, f.slice(0, -3)));
}

export function backlinksOf(vault, id) {
  return allNotes(vault).filter((n) => n.links.includes(id)).map((n) => n.id).sort();
}
