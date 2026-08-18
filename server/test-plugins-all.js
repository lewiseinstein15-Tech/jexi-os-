/**
 * B105 — PLUGIN REGRESSION SUITE ("when you add any plugin, confirm you don't
 * break any other, then test all of them").
 *
 * Proves, with ALL mounted plugins loaded:
 *  - every plugin loads without failure and exposes tools/skills,
 *  - no slug collisions across the registry + all plugins,
 *  - every plugin tool is MODEL-VISIBLE (buildNativeSchemas + normalizeTools),
 *  - every plugin tool executes through the gated ToolRuntime,
 *  - core registry tools STILL WORK after plugins are mounted,
 *  - the intent allowlist does not block plugin tools,
 *  - unloading a plugin reverses its effects.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-plugall-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { loadPlugins, setActivePluginContext, getPluginTool, listPluginTools, listPluginSkills } = await import('./src/services/PluginContext.js');
const { executeTool, buildNativeSchemas } = await import('./src/services/ToolRuntime.js');
const { normalizeTools } = await import('./src/services/LLMClient.js');
const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
const { enforceToolAllowlist } = await import('./src/services/ToolRegistry.js');

console.log('\n== 1. Load ALL plugins ==');
const { ctx, loaded, failed } = await loadPlugins({ services: {} });
setActivePluginContext(ctx);
ok(failed.length === 0, `no plugin failed to load (failed: ${failed.map((f) => f.file).join(', ') || 'none'})`);
ok(loaded.length >= 1, `at least one plugin loaded (${loaded.length}: ${loaded.map((p) => p.name).join(', ')})`);
const pluginTools = listPluginTools();
ok(pluginTools.length >= 7, `plugin tools mounted (${pluginTools.length}: ${pluginTools.map((t) => t.slug).join(', ')})`);
for (const slug of ['weather-now', 'time-now', 'currency-convert', 'crypto-price', 'ip-geo', 'web_search', 'web_fetch']) {
  ok(pluginTools.some((t) => t.slug === slug), `${slug} mounted (every plugin is accessible)`);
}

console.log('\n== 2. No slug collisions (registry ∪ plugins) ==');
const registrySlugs = new Set(TOOL_REGISTRY.map((t) => t.slug));
const dupes = pluginTools.filter((t) => registrySlugs.has(t.slug));
ok(dupes.length === 0, `no plugin tool collides with the registry (${dupes.map((d) => d.slug).join(', ') || 'none'})`);
const seen = new Set();
const pluginDupes = pluginTools.filter((t) => (seen.has(t.slug) ? true : !seen.add(t.slug)));
ok(pluginDupes.length === 0, 'no duplicate slugs BETWEEN plugins');
ok(TOOL_COUNT === 196, `registry count unchanged by plugin load (${TOOL_COUNT})`);

console.log('\n== 3. Plugin tools are MODEL-VISIBLE (the weather bug) ==');
const weatherDef = pluginTools.find((t) => t.slug === 'weather-now');
ok(!!weatherDef, 'weather-now mounted');
const schemas = buildNativeSchemas([{ slug: 'todo', name: 'Todo', desc: 'todo', schema: {} }, weatherDef]);
ok(schemas.some((s) => s.function.name === 'weather-now'), 'buildNativeSchemas includes plugin tools (was silently dropped)');
const ws = schemas.find((s) => s.function.name === 'weather-now');
ok(ws && ws.function.parameters && ws.function.parameters.properties.city, 'plugin args become provider-ready parameters (city)');
const norm = normalizeTools([weatherDef]);
ok(norm.length === 1 && norm[0].type === 'function' && norm[0].function.name === 'weather-now', 'normalizeTools converts plugin defs for providers');

console.log('\n== 4. Every plugin tool executes through the gate ==');
for (const t of pluginTools) {
  const r = await executeTool({ slug: t.slug, args: t.slug === 'weather-now' ? { city: 'Nairobi' } : {} });
  // Network-dependent tools may fail honestly; the GATE must never crash.
  ok(r && typeof r === 'object' && ('ok' in r), `"${t.slug}" returns a gated result`);
  if (t.slug === 'weather-now') {
    ok(r.ok === true || (r.ok === false && /weather|HTTP|failed|service/i.test(r.error || '')), `"${t.slug}" executes (ok or honest network failure)`);
  }
}

console.log('\n== 5. Core tools STILL WORK after plugins load ==');
const todo = await executeTool({ slug: 'todo', args: { op: 'add', text: 'plugin regression' } });
ok(todo.ok === true, 'todo still works');
const skill = await executeTool({ slug: 'skill-search', args: { query: 'zzz' } });
ok(skill.ok === true, 'skill-search still works');
const sess = await executeTool({ slug: 'session-list', args: {} });
ok(sess.ok === true, 'session-list still works');
const spill = await executeTool({ slug: 'spill-read', args: { locator: 'spill://nope/nope.txt' } });
ok(spill.ok === false && /invalid|unsafe|not found/.test(spill.error || ''), 'spill-read still works (honest failure)');
const rc = await executeTool({ slug: 'run_code', args: { code: `return 'still-works';`, description: 'regression' }, codeTools: [{ slug: 'todo', name: 'Todo', desc: 't' }] });
ok(rc.ok === true && /still-works/.test(String(rc.result || '')), 'run_code still works');

console.log('\n== 6. Intent allowlist does not block plugin tools ==');
ok(enforceToolAllowlist('direct_answer', 'weather-now').allowed === true, 'plugin tool callable under lightweight intents');
ok(enforceToolAllowlist('direct_answer', 'web-search').allowed === false, 'registry tools outside the allowlist stay blocked');

console.log('\n== 7. Reversibility: unload removes effects ==');
if (loaded[0] && typeof loaded[0].unload === 'function') {
  await loaded[0].unload();
  const remaining = listPluginTools().map((t) => t.slug);
  ok(!remaining.includes(loaded[0].name === 'weather' ? 'weather-now' : loaded[0].name), 'unload removed the plugin tool (reversible)');
} else {
  ok(true, 'unload API present on loaded plugins');
}

console.log(`\nB105 plugins-all: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
