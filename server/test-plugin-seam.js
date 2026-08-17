/**
 * B97 — Plugin Seam regression suite (deepseek-harness-style).
 * Plugins register tools/skills/events into a shared ctx; registrations are
 * reversible; plugin tools run through the gated ToolRuntime.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads DATA_DIR at import).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-plug-'));
process.env.WORKSPACE_DIR = path.join(process.env.DATA_DIR, 'ws');

const {
  createPluginContext, loadPlugins, setActivePluginContext,
  getActivePluginContext, getPluginTool, listPluginTools,
} = await import('./src/services/PluginContext.js');
const { executeTool } = await import('./src/services/ToolRuntime.js');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

console.log('\n== Context: tool registration is reversible ==');
const ctx = createPluginContext({ services: { ping: () => 'pong' } });
const unreg = ctx.tools.register({ slug: 'test-tool', name: 'Test', handler: async () => ({ ok: true, value: 'ran' }) });
ok(ctx.tools.get('test-tool') !== undefined, 'tool registered');
ok(ctx.tools.list().length === 1, 'one tool listed');
unreg();
ok(ctx.tools.get('test-tool') === undefined, 'unregister removes (reversible effect)');

console.log('\n== Context: duplicate + invalid rejected ==');
let threw = false;
try { ctx.tools.register({ slug: 'x', handler: null }); } catch { threw = true; }
ok(threw, 'invalid tool rejected');
ctx.tools.register({ slug: 'dup', handler: async () => ({ ok: true }) });
threw = false;
try { ctx.tools.register({ slug: 'dup', handler: async () => ({ ok: true }) }); } catch { threw = true; }
ok(threw, 'duplicate slug rejected');

console.log('\n== Context: skills + events ==');
const unregSkill = ctx.skills.register({ slug: 'my-skill', name: 'My Skill', load: async () => 'skill body' });
ok(ctx.skills.get('my-skill') !== undefined, 'skill registered');
let fired = 0;
const off = ctx.events.on('my/event', (d) => { fired += d.n; });
ctx.events.emit('my/event', { n: 3 });
ok(fired === 3, 'event handler fired');
off();
ctx.events.emit('my/event', { n: 5 });
ok(fired === 3, 'off() stops the handler');
unregSkill();
ok(ctx.skills.get('my-skill') === undefined, 'skill unregistered');

console.log('\n== Plugin file loading (real plugin dir) ==');
// Create a temp plugin dir with a plugin that mounts a tool.
const plugDir = path.join(process.env.DATA_DIR, 'test-plugins');
const pdir = path.join(plugDir, 'demo');
fs.mkdirSync(pdir, { recursive: true });
fs.writeFileSync(path.join(pdir, 'plugin.js'), `
export const name = 'demo';
export const version = '2.0.0';
export async function apply(ctx) {
  const unreg = ctx.tools.register({
    slug: 'demo-tool',
    name: 'Demo',
    desc: 'A demo plugin tool',
    handler: async (args) => ({ ok: true, kind: 'demo', echo: args && args.text }),
  });
  return () => unreg();
}
`);
const plugLoad = await loadPlugins({ dirs: [plugDir], services: {} });
const loaded = plugLoad.loaded;
ok(loaded.length === 1 && loaded[0].name === 'demo', 'plugin loaded from disk');
ok(plugLoad.failed.length === 0, 'no failures');
setActivePluginContext((await loadPlugins({ dirs: [plugDir] })).ctx);
ok(getPluginTool('demo-tool') !== undefined, 'plugin tool available via getPluginTool');

console.log('\n== Plugin tool executes through the gated ToolRuntime ==');
const res = await executeTool({ slug: 'demo-tool', args: { text: 'hello plugin' } });
ok(res.ok === true && res.result && /hello plugin/.test(JSON.stringify(res.result)), 'plugin tool ran via ToolRuntime');

console.log('\n== Real built-in plugin: weather (if present) ==');
const builtin = await loadPlugins({ dirs: [path.resolve(process.cwd(), 'plugins')] });
const weather = builtin.loaded.find((p) => p.name === 'weather');
if (weather) {
  ok(true, 'weather plugin loaded from server/plugins');
  ok(listPluginTools().some((t) => t.slug === 'weather-now') || builtin.ctx.tools.get('weather-now'), 'weather-now tool mounted');
} else {
  ok(true, 'weather plugin not present in this checkout — skipping');
}

console.log(`\nRESULT: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
