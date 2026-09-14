/**
 * JEXI OS — tools — lsp domain.
 *
 * code intelligence backed by a real language-server runtime
 * (server/src/lsp/): the manager spawns and tracks actual servers
 * (tsserver / pyright / gopls) and the workspace index opens sources at
 * mission start. Each tool routes through that manager.
 *
 *   lsp_diagnostics / lsp_definition / lsp_references / lsp_hover
 *   lsp_symbols / lsp_servers
 *
 * A language whose server is not installed resolves to a graceful
 * `{ available: false, note }` — never a faked result. For JavaScript/TypeScript
 * files, `lsp_diagnostics` falls back to the real ESLint engine when no
 * language server is available, so lint-driven skills keep honest diagnostics.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { runNativeCommand } from '../../../services/NativeCommand.js';
import { diagnostics, normalizeDiagnostics } from '../../../lsp/tools/diagnostics.js';
import { definition } from '../../../lsp/tools/definition.js';
import { references } from '../../../lsp/tools/references.js';
import { hover } from '../../../lsp/tools/hover.js';
import { symbols } from '../../../lsp/tools/symbols.js';
import { serverStatus } from '../../../lsp/router.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/** Resolve a CLI binary the way npm does (node_modules/.bin, walking up). */
function resolveBin(name) {
  let dir = path.resolve(__dir, '..');
  for (;;) {
    const binPath = path.join(dir, 'node_modules', '.bin', name);
    if (fs.existsSync(binPath)) return binPath;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return name;
}
const ESLINT_BIN = resolveBin('eslint');

const FILE_PARAM = { type: 'string', description: 'Path to the file, relative to the workspace root.' };
const LINE_PARAM = { type: 'number', description: 'One-based line of the cursor.' };
const CHAR_PARAM = { type: 'number', description: 'One-based character (UTF-16) column of the cursor.' };

/** Real ESLint diagnostics — the honest fallback for JS/TS without a server. */
async function eslintDiagnostics(file, root) {
  const filePath = path.resolve(root, String(file || ''));
  if (!fs.existsSync(filePath)) return { ok: false, error: `file not found: ${file}` };
  const args = ['--no-color', '--format', 'json'];
  const eslintConfig = path.join(root, 'eslint.config.js');
  if (fs.existsSync(eslintConfig)) args.push('--config', eslintConfig);
  args.push(filePath);
  const res = await runNativeCommand(ESLINT_BIN, args, { cwd: root, timeoutMs: 30000, maxOutputChars: 30000 });
  const diagnostics = [];
  try {
    const parsed = JSON.parse(res.output || '[]');
    for (const item of parsed) {
      for (const m of (item.messages || [])) {
        diagnostics.push({ file: item.filePath, severity: m.severity === 2 ? 'error' : 'warning', line: m.line, column: m.column, rule: m.ruleId, message: m.message });
      }
    }
  } catch { /* non-JSON eslint output — leave diagnostics empty and surface raw below */ }
  return { ok: true, mode: 'eslint', available: true, file, count: diagnostics.length, diagnostics, exitCode: res.code, raw: (res.output || '').slice(0, 1500) };
}

export function registerLspTools() {
  const defs = [
    defineTool({ name: 'lsp_diagnostics', description: 'Real diagnostics for a file: language-server (tsserver/pyright/gopls) when available, otherwise the real ESLint engine. Returns errors/warnings with 1-based line/column.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { file: FILE_PARAM, root: { type: 'string' } }, required: ['file'] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_definition', description: 'Resolve the symbol at a 1-based line/character to its definition location(s) via the language server.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { file: FILE_PARAM, line: LINE_PARAM, character: CHAR_PARAM, root: { type: 'string' } }, required: ['file', 'line', 'character'] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_references', description: 'Find real references to the symbol at a 1-based line/character (declaration included) via the language server.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { file: FILE_PARAM, line: LINE_PARAM, character: CHAR_PARAM, root: { type: 'string' } }, required: ['file', 'line', 'character'] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_hover', description: 'Hover information (type signature + docs) for the symbol at a 1-based line/character.', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { file: FILE_PARAM, line: LINE_PARAM, character: CHAR_PARAM, root: { type: 'string' } }, required: ['file', 'line', 'character'] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_symbols', description: 'Document symbols for a file, or workspace symbols when no file is given (optional query filter).', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: { file: FILE_PARAM, query: { type: 'string' }, root: { type: 'string' } }, required: [] }, sideEffects: ['lsp'], failureTypes: ['tool_error'], idempotent: false }),
    defineTool({ name: 'lsp_servers', description: 'Which language servers are installed and running (router status).', riskLevel: 'low', runtimeRing: 2, parameters: { type: 'object', properties: {} }, sideEffects: [], failureTypes: ['tool_error'], idempotent: true }),
  ];
  const unreg = registerToolBatch(defs);
  const engines = {
    async lsp_diagnostics(args = {}, ctx = {}) {
      const root = args.root ?? ctx.root ?? process.cwd();
      const res = await diagnostics(args, ctx);
      // No language server for this file → honest ESLint fallback for JS/TS so
      // lint-driven skills still get real diagnostics.
      if (res.available === false) {
        const ext = path.extname(String(args.file || '')).toLowerCase();
        if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(ext)) {
          const fb = await eslintDiagnostics(args.file, root);
          return { ...fb, note: res.note };
        }
      }
      return res;
    },
    lsp_definition: async (args, ctx) => definition(args, ctx),
    lsp_references: async (args, ctx) => references(args, ctx),
    lsp_hover: async (args, ctx) => hover(args, ctx),
    lsp_symbols: async (args, ctx) => symbols(args, ctx),
    lsp_servers: async () => ({ ok: true, servers: serverStatus() }),
  };
  return { unreg, engines, _normalizeDiagnostics: normalizeDiagnostics };
}
