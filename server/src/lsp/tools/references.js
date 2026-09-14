/**
 * JEXI OS — LSP tool: references.
 *
 * Finds real references to the symbol at a one-based line/character via
 * `textDocument/references` (declaration included).
 */

import path from 'node:path';
import { lspManager } from '../manager.js';
import { normalizeLocations } from './definition.js';

export async function references({ file, line, character, root } = {}, ctx = {}) {
  if (!file) return { ok: false, error: 'file is required' };
  if (!Number.isInteger(line) || !Number.isInteger(character)) return { ok: false, error: 'line and character (1-based integers) are required' };
  const base = root ?? ctx.root ?? process.cwd();
  const target = path.resolve(base, String(file));
  const manager = lspManager();
  manager.ensureRoot(base);
  const res = await manager.positionRequest(target, 'textDocument/references', line, character);
  if (!res.available) return { ok: true, available: false, file: String(file), locations: [], note: res.reason };
  return { ok: true, available: true, server: res.server, file: String(file), locations: normalizeLocations(res.result) };
}
