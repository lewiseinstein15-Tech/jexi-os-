/**
 * JEXI OS — LSP tool: definition.
 *
 * Resolves the symbol at a one-based line/character to its real definition
 * location(s) via `textDocument/definition`.
 */

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lspManager } from '../manager.js';

/** Normalize an LSP Location / LocationLink / array into a flat list. */
export function normalizeLocations(result) {
  const items = !result ? [] : Array.isArray(result) ? result : [result];
  return items
    .map((loc) => {
      const uri = loc.uri ?? loc.targetUri;
      const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange;
      if (!uri) return null;
      let file = uri;
      try { file = fileURLToPath(uri); } catch { /* keep uri */ }
      return {
        uri,
        file,
        line: (range?.start?.line ?? 0) + 1,
        character: (range?.start?.character ?? 0) + 1,
        endLine: (range?.end?.line ?? 0) + 1,
        endCharacter: (range?.end?.character ?? 0) + 1,
      };
    })
    .filter(Boolean);
}

export async function definition({ file, line, character, root } = {}, ctx = {}) {
  if (!file) return { ok: false, error: 'file is required' };
  if (!Number.isInteger(line) || !Number.isInteger(character)) return { ok: false, error: 'line and character (1-based integers) are required' };
  const base = root ?? ctx.root ?? process.cwd();
  const target = path.resolve(base, String(file));
  const manager = lspManager();
  manager.ensureRoot(base);
  const res = await manager.positionRequest(target, 'textDocument/definition', line, character);
  if (!res.available) return { ok: true, available: false, file: String(file), locations: [], note: res.reason };
  return { ok: true, available: true, server: res.server, file: String(file), locations: normalizeLocations(res.result) };
}

export { pathToFileURL };
