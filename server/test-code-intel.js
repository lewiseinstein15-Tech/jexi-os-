/**
 * M7 — CODE INTELLIGENCE EXTENSIONS regression suite.
 *
 * Proves: diagnoseJsFile() reports structured JS results (pass, or the
 * failing line + message, never throws); the lsp tool's documentSymbols
 * lists one file's symbols with kinds and positions; workspaceSymbols
 * searches the whole index with an optional query (bounded, truncation
 * disclosed); diagnostics reports real JS syntax errors with line numbers
 * and honestly declines other languages; and the four original DSH
 * operations are unaffected.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m7-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
fs.mkdirSync(process.env.WORKSPACE_DIR, { recursive: true });

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { diagnoseJsFile } = await import('./src/services/CodeJudge.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');
const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');
const { ctx } = await loadPlugins({ services: {} });
setActivePluginContext(ctx);

const WS = process.env.WORKSPACE_DIR;
fs.writeFileSync(path.join(WS, 'lib.js'), 'export function add(a, b) { return a + b; }\nexport const VERSION = 7;\n');
fs.writeFileSync(path.join(WS, 'app.js'), 'import { add } from "./lib.js";\nconsole.log(add(1, 2));\n');
fs.writeFileSync(path.join(WS, 'broken.js'), 'function () {}\n');
fs.writeFileSync(path.join(WS, 'notes.txt'), 'just text\n');
const J = (r) => { try { return JSON.parse(String(r.result || '{}')); } catch { return {}; } };

console.log('\n== 1. diagnoseJsFile: structured JS results ==');
const dGood = diagnoseJsFile(path.join(WS, 'lib.js'));
ok(dGood.pass === true, 'valid JS passes');
const dBad = diagnoseJsFile(path.join(WS, 'broken.js'));
ok(dBad.pass === false && dBad.line === 1 && dBad.message.length > 0, `broken JS fails at line 1 with a message (${dBad.message.slice(0, 40)}…)`);
const dMissing = diagnoseJsFile(path.join(WS, 'ghost.js'));
ok(dMissing.pass === false && dMissing.message.includes('readable'), 'missing file fails honestly, never throws');

console.log('\n== 2. documentSymbols lists one file ==');
const ds = await executeTool({ slug: 'lsp', args: { operation: 'documentSymbols', file_path: 'lib.js' } });
const dsJ = J(ds);
ok(ds.ok === true && dsJ.kind === 'symbols', 'symbols kind returned');
ok(dsJ.symbols.some((s) => s.name === 'add' && s.kind === 'function' && s.line === 1), 'function add at line 1');
ok(dsJ.symbols.some((s) => s.name === 'VERSION' && s.line === 2), 'const VERSION at line 2');
const dsMissing = await executeTool({ slug: 'lsp', args: { operation: 'documentSymbols', file_path: 'ghost.js' } });
ok(dsMissing.ok === false && /not found/.test(dsMissing.error || ''), 'missing file fails honestly');
const dsNone = await executeTool({ slug: 'lsp', args: { operation: 'documentSymbols' } });
ok(dsNone.ok === false && /file_path/.test(dsNone.error || ''), 'file_path still required for documentSymbols');

console.log('\n== 3. workspaceSymbols searches the index ==');
const wq = await executeTool({ slug: 'lsp', args: { operation: 'workspaceSymbols', query: 'vers' } });
const wqJ = J(wq);
ok(wq.ok === true && wqJ.symbols.some((s) => s.name === 'VERSION' && s.file === 'lib.js'), 'query finds VERSION across the workspace');
const wAll = await executeTool({ slug: 'lsp', args: { operation: 'workspaceSymbols' } });
const wAllJ = J(wAll);
ok(wAll.ok === true && wAllJ.symbols.length >= 2 && typeof wAllJ.truncated === 'boolean', 'empty query lists all (bounded, truncation disclosed)');
const wMiss = await executeTool({ slug: 'lsp', args: { operation: 'workspaceSymbols', query: 'zzz-no-such-symbol' } });
ok(wMiss.ok === true && J(wMiss).symbols.length === 0, 'no match returns empty, not an error');

console.log('\n== 4. diagnostics: real JS errors, honest elsewhere ==');
const dgBad = await executeTool({ slug: 'lsp', args: { operation: 'diagnostics', file_path: 'broken.js' } });
const dgBadJ = J(dgBad);
ok(dgBad.ok === true && dgBadJ.supported === true, 'JS is a supported language');
ok(dgBadJ.diagnostics.length === 1 && dgBadJ.diagnostics[0].line === 1 && dgBadJ.diagnostics[0].severity === 'error', 'one error at line 1 with severity');
const dgGood = await executeTool({ slug: 'lsp', args: { operation: 'diagnostics', file_path: 'lib.js' } });
ok(dgGood.ok === true && J(dgGood).diagnostics.length === 0, 'clean file reports zero diagnostics');
const dgTxt = await executeTool({ slug: 'lsp', args: { operation: 'diagnostics', file_path: 'notes.txt' } });
ok(dgTxt.ok === true && J(dgTxt).supported === false, 'non-JS honestly declines (supported:false, no fake-clean)');

console.log('\n== 5. Original DSH operations unaffected ==');
const def = await executeTool({ slug: 'lsp', args: { operation: 'goToDefinition', file_path: 'app.js', line: 2, character: 13 } });
ok(def.ok === true && String(def.result || '').includes('lib.js'), 'goToDefinition still resolves');
const hov = await executeTool({ slug: 'lsp', args: { operation: 'hover', file_path: 'app.js', line: 2, character: 13 } });
ok(hov.ok === true && /function add/.test(String(hov.result || '')), 'hover still shows the definition');
const e1 = await executeTool({ slug: 'lsp', args: { operation: 'bogus', file_path: 'app.js', line: 1, character: 1 } });
ok(e1.ok === false && /operation/.test(e1.error || ''), 'bad operation still fails honestly');
const e2 = await executeTool({ slug: 'lsp', args: { operation: 'hover', file_path: 'app.js', line: 0, character: 1 } });
ok(e2.ok === false && /one-based/.test(e2.error || ''), 'one-based contract still enforced');

console.log(`\nM7 code-intel: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
