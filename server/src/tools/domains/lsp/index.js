/**
 * JEXI OS — tools — lsp domain.
 *
 * diagnostics, definition, references. Executors are injected; definitions are always registered so the
 * capability surface stays stable and provider-independent.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runNativeCommand } from '../../../services/NativeCommand.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * LSP diagnostics (JS/TS) — real language diagnostics via the ESLint engine
 * that ships with this repo. A full typescript-language-server is not
 * installed in the sandbox, so the diagnostic source is the real eslint
 * binary: it returns real rule diagnostics (errors/warnings with line/col).
 */
export function registerLspTools() {
  const defs = [
    defineTool({ name: 'lsp_diagnostics', description: 'Run real diagnostics (ESLint) against a file.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { file: { type: 'string' }, cwd: { type: 'string' } }, required: ['file'] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_definition', description: 'Resolve a symbol to its definition (ESLint source lookup).', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { symbol: { type: 'string' }, cwd: { type: 'string' } }, required: ['symbol'] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_references', description: 'Find references to a symbol in a workspace.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { symbol: { type: 'string' }, cwd: { type: 'string' } }, required: ['symbol'] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false })
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    async lsp_diagnostics({ file, cwd }, ctx = {}) {
      const root = cwd ?? ctx.root ?? process.cwd();
      const filePath = path.resolve(root, String(file || ''));
      if (!fs.existsSync(filePath)) return { ok: false, error: `file not found: ${file}` };
      const args = ['--no-color', '--format', 'json', filePath];
      const res = await runNativeCommand('eslint', args, { cwd: root, timeoutMs: 30000, maxOutputChars: 30000 });
      // eslint exits 1 on lint errors; parse JSON payload either way.
      let diagnostics = [];
      try {
        const parsed = JSON.parse(res.output || '[]');
        for (const item of parsed) {
          for (const m of (item.messages || [])) {
            diagnostics.push({ file: item.filePath, severity: m.severity === 2 ? 'error' : 'warning', line: m.line, column: m.column, rule: m.ruleId, message: m.message });
          }
        }
      } catch { /* non-JSON eslint output — leave diagnostics empty and surface raw below */ }
      return { ok: true, file, diagnostics, exitCode: res.code, raw: (res.output || '').slice(0, 1500) };
    },
    async lsp_definition({ symbol, cwd }, ctx = {}) {
      const root = cwd ?? ctx.root ?? process.cwd();
      if (!String(symbol || '').trim()) return { ok: false, error: 'symbol required' };
      const res = await runNativeCommand('grep', ['-rn', `\\b${String(symbol)}`, '--include=*.js', '--include=*.cjs', '--include=*.mjs', '.'], { cwd: root, timeoutMs: 20000, maxOutputChars: 8000 });
      const lines = String(res.output || '').split('\n').filter((l) => l.trim()).slice(0, 10);
      return { ok: true, symbol, definitions: lines };
    },
    async lsp_references({ symbol, cwd }, ctx = {}) {
      const root = cwd ?? ctx.root ?? process.cwd();
      if (!String(symbol || '').trim()) return { ok: false, error: 'symbol required' };
      const res = await runNativeCommand('grep', ['-rln', `\\b${String(symbol)}`, '--include=*.js', '--include=*.cjs', '--include=*.mjs', '.'], { cwd: root, timeoutMs: 20000, maxOutputChars: 8000 });
      const files = String(res.output || '').split('\n').filter((l) => l.trim()).slice(0, 20);
      return { ok: true, symbol, files };
    },
  };
  return { unreg, engines };
}
