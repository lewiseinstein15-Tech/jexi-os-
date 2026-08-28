/**
 * B165 — STR REPLACE EDITOR (DeepSeek Harness
 * `packages/fs/tool-str-replace-editor` mirror).
 *
 * The dsh coding tool: view / create / str_replace / insert over the
 * workspace, one-based line numbers, views are LITERAL replacement input
 * (tabs preserved), mutations never touch text outside the requested edit.
 *
 *   view(path)            → numbered file (1-based) or 2-level dir listing
 *   create(path, text)    → new file (refuses if it exists)
 *   strReplace(path, old, new) → ONE unique literal match required
 *   insert(path, line, text)   → insert at the zero-based boundary (dsh:
 *                          insert AFTER line N; no implicit trailing newline)
 * Absence is recorded before FS_NOT_FOUND so a later create can recover.
 */

import fs from 'fs';
import path from 'path';
import { WORKSPACE_DIR } from '../config.js';

export const MAX_OUTPUT_CHARS = 16000; // dsh default
const CLIP_NOTICE = '<response clipped><NOTE>Output exceeds the configured limit; only the prefix is shown.</NOTE>';

const absence = new Set(); // absolute paths CONFIRMED absent by view/replace/insert

const OUT = { ok: false, code: 'FS_OUT_OF_WORKSPACE', error: 'only workspace-relative paths are editable' };

function abs(p) {
  const clean = String(p || '').replace(/^\/+/, '');
  if (clean.split('/').includes('..')) return null; // traversal refused
  const full = path.resolve(WORKSPACE_DIR, clean);
  if (!full.startsWith(path.resolve(WORKSPACE_DIR))) return null;
  return full;
}

function clip(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + CLIP_NOTICE;
}

function fileView(full) {
  const raw = fs.readFileSync(full, 'utf-8');
  const lines = raw.split('\n');
  const body = lines.map((l, i) => `${String(i + 1).padStart(5)}→${l}`).join('\n');
  return clip(body);
}

function dirView(full, depth = 2, prefix = '') {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'coverage']);
  let out = '';
  let entries = [];
  try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch { return ''; }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') || skip.has(e.name)) continue;
    out += `${prefix}${e.name}${e.isDirectory() ? '/' : ''}\n`;
    if (e.isDirectory() && depth > 1) out += dirView(path.join(full, e.name), depth - 1, `${prefix}  `);
  }
  return out;
}

/** view — file (numbered, 1-based) or directory (2 levels, dsh filters). */
export function view(p) {
  const full = abs(p);

  if (!full) return { ...OUT };
  if (!fs.existsSync(full)) { absence.add(full); return { ok: false, code: 'FS_NOT_FOUND', error: `${p} does not exist` }; }
  absence.delete(full);
  const stat = fs.statSync(full);
  if (stat.isDirectory()) return { ok: true, kind: 'dir', text: clip(dirView(full)) || '(empty directory)' };
  if (stat.size > 512 * 1024) return { ok: false, code: 'FS_TOO_LARGE', error: `${p} is ${(stat.size / 1024).toFixed(0)} KB — edit targeted chunks instead of viewing whole` };
  return { ok: true, kind: 'file', text: fileView(full) };
}

/** create — refuses an existing path (dsh guarded-create). */
export function create(p, text = '') {
  const full = abs(p);

  if (!full) return { ...OUT };
  if (fs.existsSync(full)) return { ok: false, code: 'FS_EXISTS', error: `${p} already exists — use str_replace or insert to edit it` };
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, String(text ?? ''), 'utf-8');
  absence.delete(full);
  return { ok: true, created: p, bytes: Buffer.byteLength(String(text ?? '')) };
}

/** str_replace — exactly ONE unique literal match (dsh invariant). */
export function strReplace(p, oldStr, newStr) {
  const full = abs(p);

  if (!full) return { ...OUT };
  if (!fs.existsSync(full)) { absence.add(full); return { ok: false, code: 'FS_NOT_FOUND', error: `${p} does not exist` }; }
  const raw = fs.readFileSync(full, 'utf-8');
  const first = raw.indexOf(oldStr);
  if (first < 0) {
    return { ok: false, code: 'FS_NO_MATCH', error: `old_str not found in ${p} — view the file (line numbers are display-only; use the literal text)` };
  }
  if (raw.indexOf(oldStr, first + 1) >= 0) {
    return { ok: false, code: 'FS_NOT_UNIQUE', error: `old_str matches ${raw.split(oldStr).length - 1} places in ${p} — include surrounding lines to make it unique` };
  }
  fs.writeFileSync(full, raw.slice(0, first) + newStr + raw.slice(first + oldStr.length), 'utf-8');
  absence.delete(full);
  return { ok: true, file: p, replacedBytes: Buffer.byteLength(oldStr) };
}

/** insert — dsh semantics: text lands AFTER the given line number; 0 = top. */
export function insert(p, line, text) {
  const full = abs(p);

  if (!full) return { ...OUT };
  if (!fs.existsSync(full)) { absence.add(full); return { ok: false, code: 'FS_NOT_FOUND', error: `${p} does not exist (create it first)` }; }
  const raw = fs.readFileSync(full, 'utf-8');
  const lines = raw.split('\n');
  const at = Math.max(0, Math.min(Number(line) || 0, lines.length));
  lines.splice(at, 0, String(text ?? ''));
  fs.writeFileSync(full, lines.join('\n'), 'utf-8');
  absence.delete(full);
  return { ok: true, file: p, insertedAfterLine: at };
}

/** Confirmed-absence probe (dsh: "a metadata miss records confirmed absence"). */
export function isConfirmedAbsent(p) {
  try { return absence.has(abs(p)); } catch { return false; }
}
