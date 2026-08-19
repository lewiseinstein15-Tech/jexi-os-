/**
 * B131 — LSP CODE INTELLIGENCE regression suite
 * (deepseek-harness tool-lsp mirror).
 *
 * Proves: the lsp tool mounts with the DSH contract (operations, one-based
 * positions), goToDefinition/findReferences/hover/goToImplementation work
 * over a real workspace fixture, references include the declaration, and
 * errors are honest (bad operation, missing file, off-symbol cursor).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-lsp-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
fs.mkdirSync(process.env.WORKSPACE_DIR, { recursive: true });

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { executeTool } = await import('./src/services/ToolRuntime.js');
const { loadPlugins, setActivePluginContext, listPluginTools } = await import('./src/services/PluginContext.js');
const { ctx } = await loadPlugins({ services: {} });
setActivePluginContext(ctx);

// fixture: two JS files with a shared symbol + an interface implementation
fs.writeFileSync(path.join(process.env.WORKSPACE_DIR, 'lib.js'), [
  '// shared math library',
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'export const VERSION = "1.0";',
  '',
  'export class Calculator {',
  '  constructor() { this.total = 0; }',
  '  add(n) { this.total += n; return this; }',
  '}',
].join('\n'), 'utf-8');
fs.writeFileSync(path.join(process.env.WORKSPACE_DIR, 'app.js'), [
  'import { add, VERSION, Calculator } from "./lib.js";',
  '',
  'const result = add(2, 3);',
  'console.log(VERSION, result);',
  '',
  'const calc = new Calculator();',
  'calc.add(5);',
  '',
  'class AdvancedCalculator extends Calculator {}',
  'const adv = new AdvancedCalculator();',
].join('\n'), 'utf-8');

console.log('\n== 1. Plugin mounts the lsp tool ==');
ok(listPluginTools().some((t) => t.slug === 'lsp'), 'lsp mounted (dsh tool-lsp)');

console.log('\n== 2. goToDefinition ==');
// app.js line 3 (1-based) is `const result = add(2, 3);` — cursor on "add" col 18
const def = await executeTool({ slug: 'lsp', args: { operation: 'goToDefinition', file_path: 'app.js', line: 3, character: 16 } });
ok(def.ok === true && /"kind": "locations"/.test(String(def.result || '')), 'returns locations (DSH contract)');
ok(String(def.result || '').includes('lib.js'), 'definition resolves into lib.js');
ok(/range/.test(String(def.result || '')), 'locations carry ranges');

console.log('\n== 3. findReferences includes the declaration (DSH semantics) ==');
const refs = await executeTool({ slug: 'lsp', args: { operation: 'findReferences', file_path: 'app.js', line: 4, character: 13 } }); // VERSION usage (V is col 13)
ok(refs.ok === true && /"kind": "locations"/.test(String(refs.result || '')), 'findReferences returns locations');
const refsText = String(refs.result || '');
ok(refsText.includes('lib.js'), 'declaration in lib.js included');
ok(refsText.includes('app.js'), 'usages in app.js included');

console.log('\n== 4. hover ==');
const hov = await executeTool({ slug: 'lsp', args: { operation: 'hover', file_path: 'app.js', line: 3, character: 16 } });
ok(hov.ok === true && /"kind": "hover"/.test(String(hov.result || '')), 'hover returns the hover kind');
ok(/function add/.test(String(hov.result || '')), 'hover contents show the definition');

console.log('\n== 5. goToImplementation (extends/implements) ==');
const impl = await executeTool({ slug: 'lsp', args: { operation: 'goToImplementation', file_path: 'app.js', line: 9, character: 34 } }); // 'Calculator' in 'class AdvancedCalculator extends Calculator {}' starts at col 34
ok(impl.ok === true && /"kind": "locations"/.test(String(impl.result || '')), 'goToImplementation returns locations');
ok(String(impl.result || '').includes('app.js'), 'finds the implementation site (the extends line in app.js)');

console.log('\n== 6. Honest errors ==');
const e1 = await executeTool({ slug: 'lsp', args: { operation: 'bogus', file_path: 'app.js', line: 1, character: 1 } });
ok(e1.ok === false && /operation/.test(e1.error || ''), 'bad operation fails honestly');
const e2 = await executeTool({ slug: 'lsp', args: { operation: 'hover', file_path: 'missing.js', line: 1, character: 1 } });
ok(e2.ok === false && /not found/.test(e2.error || ''), 'missing file fails honestly');
const e3 = await executeTool({ slug: 'lsp', args: { operation: 'hover', file_path: 'app.js', line: 0, character: 1 } });
ok(e3.ok === false && /one-based/.test(e3.error || ''), 'zero line rejected (one-based contract)');
const e4 = await executeTool({ slug: 'lsp', args: { operation: 'hover', file_path: 'app.js', line: 2, character: 1 } }); // blank line
ok(e4.ok === false && /no identifier/.test(e4.error || ''), 'off-symbol cursor fails honestly');

console.log('\n== 7. contract + plugin-all coverage ==');
const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
ok(TOOL_COUNT === 210, `registry count unchanged by plugin (${TOOL_COUNT})`);

console.log(`\nB131 lsp: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
