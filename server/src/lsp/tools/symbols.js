/**
 * JEXI OS — LSP tool: symbols.
 *
 * Document symbols for a file (via `textDocument/documentSymbol`), flattened
 * to a 1-based list, plus workspace symbol search (via `workspace/symbol`)
 * when no file is given.
 */

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lspManager } from '../manager.js';

/** SymbolKind → label (LSP 3.17 numbering). */
export const SYMBOL_KINDS = ['', 'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter'];

/** Flatten DocumentSymbol | SymbolInformation trees to a flat 1-based list. */
export function flattenSymbols(result, file) {
  const out = [];
  const visit = (sym, container) => {
    const range = sym.selectionRange ?? sym.range ?? sym.location?.range;
    const uri = sym.location?.uri;
    let symFile = file;
    if (uri) { try { symFile = fileURLToPath(uri); } catch { symFile = uri; } }
    out.push({
      name: sym.name,
      kind: SYMBOL_KINDS[sym.kind] ?? String(sym.kind ?? ''),
      file: symFile,
      line: (range?.start?.line ?? 0) + 1,
      character: (range?.start?.character ?? 0) + 1,
      container: container ?? sym.containerName ?? null,
    });
    for (const child of sym.children ?? []) visit(child, sym.name);
  };
  for (const sym of result ?? []) visit(sym, null);
  return out;
}

export async function symbols({ file, query, root } = {}, ctx = {}) {
  const base = root ?? ctx.root ?? process.cwd();
  const manager = lspManager();
  manager.ensureRoot(base);

  if (!file) {
    // Workspace-wide symbol search — needs at least one running server.
    const res = await manager.workspaceSymbols(String(query ?? ''));
    if (!res.available) return { ok: true, available: false, symbols: [], note: res.reason };
    return { ok: true, available: true, scope: 'workspace', query: String(query ?? ''), symbols: flattenSymbols(res.result, null) };
  }

  const target = path.resolve(base, String(file));
  const res = await manager.documentSymbols(target);
  if (!res.available) return { ok: true, available: false, file: String(file), symbols: [], note: res.reason };
  const flat = flattenSymbols(res.result, target);
  const filtered = query ? flat.filter((s) => s.name.toLowerCase().includes(String(query).toLowerCase())) : flat;
  return { ok: true, available: true, scope: 'document', server: res.server, file: String(file), symbols: filtered };
}

export { pathToFileURL };
