/**
 * JEXI OS — LSP tool: diagnostics.
 *
 * Real language-server diagnostics for a file. Routes through the manager,
 * which spawns the owning server if needed and waits for the published
 * diagnostic set. A language with no installed server is skipped honestly.
 */

import path from 'node:path';
import { lspManager } from '../manager.js';

/** LSP DiagnosticSeverity → label. */
export function severityLabel(severity) {
  return { 1: 'error', 2: 'warning', 3: 'information', 4: 'hint' }[severity] ?? 'unknown';
}

/** Normalize LSP diagnostics to a flat, 1-based list. */
export function normalizeDiagnostics(diagnostics = []) {
  return diagnostics.map((d) => ({
    severity: severityLabel(d.severity),
    line: (d.range?.start?.line ?? 0) + 1,
    character: (d.range?.start?.character ?? 0) + 1,
    endLine: (d.range?.end?.line ?? 0) + 1,
    endCharacter: (d.range?.end?.character ?? 0) + 1,
    code: d.code ?? null,
    source: d.source ?? null,
    message: d.message,
  }));
}

/**
 * @param {object} args  { file, root? }
 * @param {object} ctx   { root? }
 */
export async function diagnostics({ file, root } = {}, ctx = {}) {
  if (!file) return { ok: false, error: 'file is required' };
  const base = root ?? ctx.root ?? process.cwd();
  const target = path.resolve(base, String(file));
  const manager = lspManager();
  manager.ensureRoot(base);
  const res = await manager.diagnosticsFor(target);
  if (!res.available) {
    return { ok: true, available: false, file: String(file), server: null, diagnostics: [], note: res.reason };
  }
  return {
    ok: true,
    available: true,
    file: String(file),
    server: res.server,
    settled: res.settled,
    count: normalizeDiagnostics(res.diagnostics).length,
    diagnostics: normalizeDiagnostics(res.diagnostics),
  };
}
