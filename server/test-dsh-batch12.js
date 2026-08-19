/**
 * B143 — DSH BATCH 12 TEST ("Do all pull them") — the 100% finish:
 *
 *   extensions/cordis-runner-*  → CordisRunner.js + cordis_define/run/stop/undefine/inspect_self
 *   client/modules              → src/utils/clientModules.js (slots/sessions/workspaces/events/tz/baseline)
 *   web/web                     → src/utils/web.js (WebRuntime providers + renderer + SSE)
 *   web/web-react               → src/hooks/index.js (hooks barrel)
 *   ui-*                        → src/hooks/useSlots.js + src/utils/modelSelection.js
 *   parity manifest             → 123/123 ported (100%)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const SERVER_DIR = process.cwd();
const SRC_DIR = path.join(SERVER_DIR, '..', 'src');

/* ══════════════ 1. CORDIS RUNNER (define → run → stop → undefine) ══════════════ */
console.log('\n== 1. Cordis runner (dynamic plugin lifecycle) ==');
{
  const { CordisRunner } = await import('./src/services/CordisRunner.js');
  const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');
  const { ctx } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx); // the live seam the host code registers into
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-cordis-')), 'cordis.json');
  const runner = new CordisRunner({ stateFile });

  const bad = runner.define({ name: 'Bad Name!', purpose: 'x', code: { host: 'return () => {}' } });
  ok('define rejects invalid name', bad.ok === false && /name matching/.test(bad.error));
  const noCode = runner.define({ name: 'empty', purpose: 'x', code: {} });
  ok('define rejects missing host code', noCode.ok === false && /needs code.host/.test(noCode.error));
  const def = runner.define({ name: 'demo', purpose: 'A demo dynamic plugin', code: { host: 'jexi.registerTool({ slug: "dyn_" + input.slug, name: "Dyn", desc: "d", handler: async () => ({ ok: true, kind: "dyn", value: input.value }) }); return () => jexi.unregisterAll();' } });
  ok('define returns receipts', def.ok === true && def.pluginId && def.packageId && def.hasHostHalf === true);

  const badRun = await runner.run({ pluginId: 'nope', packageId: def.packageId });
  ok('run unknown plugin fails honestly', badRun.ok === false && /no dynamic plugin/.test(badRun.error));
  const run = await runner.run({ pluginId: def.pluginId, packageId: def.packageId, input: { slug: 'greeter', value: 7 } });
  ok('run evaluates host code against the seam', run.ok === true && run.runId);

  // The dynamically registered tool is real on the plugin seam.
  const { getPluginTool } = await import('./src/services/PluginContext.js');
  const dynTool = getPluginTool('dyn_greeter');
  ok('host code registered a live plugin tool', !!dynTool);
  const result = await dynTool.handler({});
  ok('dynamic tool executes', result.ok === true && result.value === 7);

  const self = runner.inspectSelf();
  ok('inspect_self lists the plugin + run', self.plugins.length === 1 && self.plugins[0].running === true && !!self.plugins[0].runId);
  ok('inspect_self has no unknown plugins', self.plugins.every((p) => !!p.pluginId));

  const stop = await runner.stop({ pluginId: def.pluginId });
  ok('stop cleans up (wasRunning)', stop.ok === true && stop.wasRunning === true);
  ok('stop withdraws registrations', getPluginTool('dyn_greeter') === undefined);
  const stop2 = await runner.stop({ pluginId: def.pluginId });
  ok('stop on idle run is a no-op', stop2.ok === true && stop2.wasRunning === false);

  const undef = await runner.undefine({ pluginId: def.pluginId });
  ok('undefine removes the plugin', undef.ok === true);
  ok('plugin gone from self-inspect', runner.inspectSelf().plugins.length === 0);
  ok('persisted across restart (new runner, same file)', (() => {
    const r2 = new CordisRunner({ stateFile });
    return r2.inspectSelf().plugins.length === 0; // undefine persisted
  })());
}

/* ══════════════ 2. CORDIS RUNNER TOOLS (registry + engine) ══════════════ */
console.log('\n== 2. Cordis runner tools ==');
{
  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  for (const slug of ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'cordis_inspect_self']) {
    ok(`${slug} in registry`, TOOL_REGISTRY.some((t) => t.slug === slug));
  }
  ok('registry count is 218', TOOL_COUNT === 218);
  const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');
  ok('all five have contracts', ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'cordis_inspect_self'].every((s) => hasOutputContract(s)));
  ok('define validates args', validateToolArgs('cordis_define', { name: 'x', purpose: 'p', code: { host: 'return 1' } }).ok === true);
  ok('define requires name', validateToolArgs('cordis_define', { purpose: 'p' }).ok === false);

  const defined = await executeTool({ slug: 'cordis_define', args: { name: 'tool-demo', purpose: 'p', code: { host: 'return () => {}' } }, spillOwner: 't-cordis-run' });
  ok('cordis_define executes', defined.ok === true && String(defined.result).includes('tool-demo'));
  const { cordisRunner } = await import('./src/services/CordisRunner.js');
  const plg = cordisRunner().inspectSelf().plugins.find((p) => p.name === 'tool-demo');
  ok('defined via tool is inspectable', !!plg);
  // packageId is on the plugin's packages — fetch it from the runner directly.
  const pkgId = [...cordisRunner().plugins.get(plg.pluginId).packages.keys()][0];
  const ran2 = await executeTool({ slug: 'cordis_run', args: { pluginId: plg.pluginId, packageId: pkgId }, spillOwner: 't-cordis-run' });
  ok('cordis_run executes', ran2.ok === true && String(ran2.result).includes('run_'));
  const stopped = await executeTool({ slug: 'cordis_stop', args: { pluginId: plg.pluginId }, spillOwner: 't-cordis-run' });
  ok('cordis_stop executes', stopped.ok === true);
  const selfTool = await executeTool({ slug: 'cordis_inspect_self', args: {}, spillOwner: 't-cordis-run' });
  ok('cordis_inspect_self executes', selfTool.ok === true && String(selfTool.result).includes('tool-demo'));
  const undef = await executeTool({ slug: 'cordis_undefine', args: { pluginId: plg.pluginId }, spillOwner: 't-cordis-run' });
  ok('cordis_undefine executes', undef.ok === true);
}

/* ══════════════ 3. CLIENT MODULES ══════════════ */
console.log('\n== 3. Client modules (slots/sessions/workspaces/events/tz/baseline) ==');
{
  const mod = await import(pathToFileURL(path.join(SRC_DIR, 'utils', 'clientModules.js')).href);
  const { SlotRegistry, SessionRuntime, WorkspaceRuntime, ConversationEventRegistry, resolveTimeZone, OrderedBaseline } = mod;

  const slots = new SlotRegistry();
  const dispose = slots.register('main', { label: 'Main' });
  ok('slot register/get', slots.get('main').label === 'Main' && slots.has('main'));
  let dup = false;
  try { slots.register('main', {}); } catch { dup = true; }
  ok('slot duplicate rejected', dup);
  dispose();
  ok('slot disposer removes', !slots.has('main'));

  const events = new ConversationEventRegistry();
  let got = null;
  events.on('done', (ev) => { got = ev; });
  events.feed({ type: 'done', summary: 'x' });
  ok('event registry routes by type', got && got.summary === 'x');

  ok('timezone resolves', typeof resolveTimeZone() === 'string' && resolveTimeZone('Africa/Nairobi') === 'Africa/Nairobi');

  const baseline = new OrderedBaseline({ max: 3 });
  baseline.push({ id: 'a' });
  baseline.push({ id: 'b' });
  baseline.push({ id: 'a' }); // dedupe + move to end
  ok('ordered baseline dedupes', baseline.list().map((x) => x.id).join(',') === 'b,a');
  baseline.push({ id: 'c' });
  baseline.push({ id: 'd' });
  ok('ordered baseline caps', baseline.list().length === 3);
  baseline.remove('c');
  ok('ordered baseline removes', !baseline.list().some((x) => x.id === 'c'));

  const ws = new WorkspaceRuntime();
  ok('workspace containment', ws.pathInWorkspace('/ws/a/b', '/ws/') === true && ws.pathInWorkspace('/etc', '/ws/') === false);
  const sr = new SessionRuntime({ base: '/api/conversations' });
  ok('session runtime constructed', typeof sr.list === 'function' && typeof sr.invalidate === 'function');
}

/* ══════════════ 4. WEB RUNTIME ══════════════ */
console.log('\n== 4. Web runtime (provider registry + renderer + SSE) ==');
{
  const mod = await import(pathToFileURL(path.join(SRC_DIR, 'utils', 'web.js')).href);
  const { WebRuntime, WebError, createWebRenderer, createEventStream } = mod;
  const rt = new WebRuntime({ env: { JEXI_WEB_SEARCH_PROVIDER: 'searx' } });
  const d1 = rt.registerSearchProvider({ id: 'searx', search: async () => [] });
  const d2 = rt.registerFetchProvider({ id: 'reader', fetch: async () => '' });
  ok('providers registered', rt.status().searchCount === 1 && rt.status().fetchCount === 1);
  ok('env override selects provider', rt.resolveSearchProvider().id === 'searx');
  ok('fallback resolves first when no override', rt.resolveFetchProvider().id === 'reader');
  let dup = false;
  try { rt.registerSearchProvider({ id: 'searx' }); } catch (e) { dup = e instanceof WebError && e.code === 'WEB_DUPLICATE_PROVIDER'; }
  ok('duplicate provider → WEB_DUPLICATE_PROVIDER', dup);
  d1(); d2();
  ok('disposers unregister', rt.status().searchCount === 0);

  let disposed = false;
  const renderer = createWebRenderer({ root: {}, render: () => () => { disposed = true; } });
  renderer.dispose();
  ok('renderer mounts + disposes', disposed === true && renderer.isDisposed() === true);
  ok('createEventStream factory', typeof createEventStream('/x', {}) === 'object');
}

/* ══════════════ 5. HOOKS BARREL + UI SLOTS + MODEL SELECTION ══════════════ */
console.log('\n== 5. Hooks barrel + ui-slots + model selection ==');
{
  const barrel = fs.readFileSync(path.join(SRC_DIR, 'hooks', 'index.js'), 'utf-8');
  for (const hook of ['useJexiEngine', 'useUpdateChecker', 'useProjection', 'usePluginInventory', 'useSlots']) {
    ok(`hooks barrel exports ${hook}`, barrel.includes(hook));
  }
  const slotsHook = fs.readFileSync(path.join(SRC_DIR, 'hooks', 'useSlots.js'), 'utf-8');
  ok('useSlots uses the registry + useSyncExternalStore', slotsHook.includes('SlotRegistry') && slotsHook.includes('useSyncExternalStore'));
  const mod = await import(pathToFileURL(path.join(SRC_DIR, 'utils', 'modelSelection.js')).href);
  const { resolveProviderForIntent, modelSelectionStatus, MODEL_PROVIDERS } = mod;
  ok('provider table', Object.keys(MODEL_PROVIDERS).length >= 7);
  ok('intent resolution prefers fast for conversation', resolveProviderForIntent('conversation').startsWith('groq') || resolveProviderForIntent('conversation').startsWith('cerebras'));
  ok('vision intent prefers vision-capable', ['gemini', 'openrouter', 'xai'].includes(resolveProviderForIntent('vision')));
  ok('status shape', modelSelectionStatus().providers.length >= 7);
}

/* ══════════════ 6. PARITY 100% + INTEGRATION ══════════════ */
console.log('\n== 6. Parity 100% + integration ==');
{
  const { bundleStatus } = await import('./src/services/BundleBase.js');
  const st = bundleStatus();
  ok('ALL packages ported', st.counts.total >= 123 && st.counts.ported === st.counts.total && st.counts.notYet === 0 && st.counts.partial === 0);
  const parity = fs.readFileSync(path.join(SERVER_DIR, '..', 'DSH-PARITY.md'), 'utf-8');
  ok('parity doc says 100%', parity.includes('100%'));
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 218', TOOL_COUNT === 218);
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  ok('prompt assembles', (await assemblePrompt({ convId: 't-int-b143' })).length > 500);
  const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');
  const { ctx, failed } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  ok('plugins still load clean', failed.length === 0);
}

console.log(`\n${failures === 0 ? '🎉 ALL B143 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
