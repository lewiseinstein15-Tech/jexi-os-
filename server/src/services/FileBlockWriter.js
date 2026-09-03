/**
 * FileBlockWriter — B199c (Test B): when a pipeline produces a deliverable as
 * FILE BLOCKS inside the chat answer ("**swahili-lessons/lesson-01.md**"
 * followed by a fenced code block), the user asked for FILES — persist them
 * into the workspace so the deliverable actually exists on disk.
 *
 * Used by the terminal done() path in index.js: every pipeline (content
 * creation, docs, coding-in-chat) benefits; answers without file blocks are
 * untouched. Paths are sanitized (never escape WORKSPACE_DIR), capped in
 * count and size, and failures never block the answer.
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const FILENAME_SRC = '[\\w][\\w .-]{0,80}\\.(?:md|txt|js|jsx|py|html|css|json|csv|ts|tsx|sh|yml|yaml|xml|svg)';
const MAX_FILES = 30;
const MAX_BYTES = 200 * 1024;

/** A line that is ONLY a filename declaration: **path/file.md**, path/file.md,
 *  ### path/file.md, "File: path/file.md" — optionally with a trailing colon. */
const NAME_LINE_RE = new RegExp(
  `^\\s*(?:#{1,6}\\s+|(?:file|filename)\\s*:\\s*)?\\**((?:[\\w .-]+\\/)*${FILENAME_SRC})\\**\\s*:?$`,
  'i'
);

/** Find (path, content) pairs declared as file blocks in an answer. */
export function extractFileBlocks(text) {
  const src = String(text || '');
  if (!src || !src.includes('```')) return [];
  const out = [];
  const seen = new Set();
  const lines = src.split('\n');

  const pushBlock = (name, content) => {
    const clean = String(name || '').replace(/\*\*/g, '').trim();
    if (!clean || seen.has(clean)) return;
    if (/(\.\.|^[\\/]|\\\\)/.test(clean)) return; // no traversal, no absolute paths
    if (!new RegExp(`^(?:[\\w .-]+\\/)*${FILENAME_SRC}$`, 'i').test(clean)) return;
    const body = content.replace(/^\n+/, '').replace(/\s+$/, '');
    if (!body || body.length > MAX_BYTES) return;
    seen.add(clean);
    out.push({ name: clean, content: body });
  };

  for (let i = 0; i < lines.length && out.length < MAX_FILES; i++) {
    const m = lines[i].match(NAME_LINE_RE);
    if (!m) continue;
    // the fenced block must start within the next 2 lines
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      if (/^\s*```/.test(lines[j])) {
        const buf = [];
        for (let k = j + 1; k < lines.length && !/^\s*```/.test(lines[k]); k++) buf.push(lines[k]);
        pushBlock(m[1], buf.join('\n'));
        break;
      }
    }
  }
  return out;
}

/** Persist extracted file blocks under workspaceDir. Returns saved names. */
export async function persistFileBlocks(text, workspaceDir, { log = () => {} } = {}) {
  const blocks = extractFileBlocks(text);
  if (!blocks.length || !workspaceDir) return [];
  const saved = [];
  const root = path.resolve(workspaceDir);
  for (const b of blocks.slice(0, MAX_FILES)) {
    try {
      const safe = b.name.split('/').map((p) => p.replace(/[^\w.-]/g, '_')).join('/');
      const full = path.resolve(root, safe);
      if (full !== root && !full.startsWith(root + path.sep)) continue; // never escape the workspace
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, b.content, 'utf-8');
      saved.push(safe);
    } catch (e) {
      log(`⚠ could not write ${b.name}: ${String(e && e.message || e).slice(0, 80)}`);
    }
  }
  return saved;
}
