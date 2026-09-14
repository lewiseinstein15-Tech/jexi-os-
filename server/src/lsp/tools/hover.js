/**
 * JEXI OS — LSP tool: hover.
 *
 * Returns the real hover payload (type signature + docs) for the symbol at a
 * one-based line/character via `textDocument/hover`.
 */

import path from 'node:path';
import { lspManager } from '../manager.js';

/** Flatten LSP Hover.contents (MarkupContent | MarkedString | array) to text. */
export function hoverText(contents) {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n');
  if (contents.value) return String(contents.value);
  if (contents.language && contents.value) return contents.value;
  return '';
}

export async function hover({ file, line, character, root } = {}, ctx = {}) {
  if (!file) return { ok: false, error: 'file is required' };
  if (!Number.isInteger(line) || !Number.isInteger(character)) return { ok: false, error: 'line and character (1-based integers) are required' };
  const base = root ?? ctx.root ?? process.cwd();
  const target = path.resolve(base, String(file));
  const manager = lspManager();
  manager.ensureRoot(base);
  const res = await manager.positionRequest(target, 'textDocument/hover', line, character);
  if (!res.available) return { ok: true, available: false, file: String(file), hover: null, note: res.reason };
  return { ok: true, available: true, server: res.server, file: String(file), hover: res.result ? { contents: hoverText(res.result.contents), range: res.result.range ?? null } : null };
}
