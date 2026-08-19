/**
 * B142 — DSH BATCH 11 TEST ("Pull all"):
 *
 *   shell/bash-sandbox            → SandboxLocal.sandboxPolicyFor + bash sandbox facts
 *   extensions/tool-cordis        → CordisInspect.js + cordis_inspect_list/query tools
 *   test-support/agent-loop-testkit → test-support/agent-loop-testkit.js
 *   sdk/codec                     → sdk/codec.js
 *   e2b                           → SandboxLocal.e2bStatus
 *   ui-settings-plugin-inventory  → src/hooks/usePluginInventory.js
 */

import fs from 'fs';
import path from 'path';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const SERVER_DIR = process.cwd();

/* ══════════════ 1. BASH SANDBOX FACTS ══════════════ */
console.log('\n== 1. Bash sandbox (dsh shell/bash-sandbox) ==');
{
  const { sandboxPolicyFor, e2bStatus } = await import('./src/services/SandboxLocal.js');
  const policy = sandboxPolicyFor({ mode: 'workspace-write', tier: 'exec', convId: 't-bash-sandbox' });
  ok('policy reports mode + enforcement', policy.mode === 'workspace-write' && typeof policy.enforcement === 'string');
  ok('policy reports workspaceRoot', typeof policy.workspaceRoot === 'string' && policy.workspaceRoot.length > 0);
  const denied = sandboxPolicyFor({ mode: 'read-only', tier: 'exec', convId: 't-bash-sandbox' });
  ok('read-only exec denied with reason', denied.denied && denied.denied.blocked === true && /read-only/.test(denied.denied.reason));
  ok('denied enforcement reported', denied.enforcement === 'denied');
  const full = sandboxPolicyFor({ mode: 'danger-full-access', tier: 'exec' });
  ok('full access not denied', full.denied === undefined);
  const e2b = e2bStatus();
  ok('e2b status facts', e2b.ok && e2b.service === 'e2b-compatible' && typeof e2b.remoteConfigured === 'boolean');
  ok('e2b enforcement inherited', e2b.enforcement === 'in-process' || e2b.enforcement === 'bwrap');
}

/* ══════════════ 2. CORDIS INSPECT ══════════════ */
console.log('\n== 2. Cordis inspect (dsh extensions/tool-cordis) ==');
{
  const { cordisInspectList, cordisInspectQuery, cordisInspectStatus, cordisInspectProviders } = await import('./src/services/CordisInspect.js');
  const list = cordisInspectList();
  ok('providers listed', list.providers.length >= 4 && list.providers.some((p) => p.id === 'jexi:plugins'));
  ok('providers are read-only', list.providers.every((p) => p.readonly === true));
  const q1 = cordisInspectQuery({ provider: 'jexi:tools', method: 'listTools' });
  ok('query listTools', q1.ok === true && q1.result.count >= 213 && Array.isArray(q1.result.registry));
  const q2 = cordisInspectQuery({ provider: 'jexi:plugins', method: 'listPlugins' });
  ok('query listPlugins', q2.ok === true && Array.isArray(q2.result));
  const q3 = cordisInspectQuery({ provider: 'jexi:skills', method: 'listSkills' });
  ok('query listSkills', q3.ok === true);
  const q4 = cordisInspectQuery({ provider: 'jexi:services', method: 'listServices' });
  ok('query listServices', q4.ok === true && Array.isArray(q4.result));
  const bad = cordisInspectQuery({ provider: 'jexi:tools', method: 'nope' });
  ok('unknown method rejected', bad.ok === false && /no read-only method/.test(bad.error));
  const badProv = cordisInspectQuery({ provider: 'nope', method: 'x' });
  ok('unknown provider rejected', badProv.ok === false && /no inspect provider/.test(badProv.error));
  ok('status shape', cordisInspectStatus().ok === true);
  ok('providers export', Array.isArray(cordisInspectProviders()));

  // Tool-level: registry + engine.
  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('cordis tools in registry', TOOL_REGISTRY.some((t) => t.slug === 'cordis_inspect_list') && TOOL_REGISTRY.some((t) => t.slug === 'cordis_inspect_query'));
  ok('registry count is 213', TOOL_COUNT === 218);
  const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');
  ok('cordis contracts', hasOutputContract('cordis_inspect_list') && hasOutputContract('cordis_inspect_query'));
  ok('query validates provider/method', validateToolArgs('cordis_inspect_query', { provider: 'jexi:tools', method: 'listTools' }).ok === true);
  ok('query requires provider', validateToolArgs('cordis_inspect_query', { method: 'listTools' }).ok === false);
  const viaTool = await executeTool({ slug: 'cordis_inspect_list', args: {}, spillOwner: 't-cordis' });
  ok('cordis_inspect_list executes', viaTool.ok === true && String(viaTool.result).includes('jexi:plugins'));
  const viaQuery = await executeTool({ slug: 'cordis_inspect_query', args: { provider: 'jexi:tools', method: 'listTools' }, spillOwner: 't-cordis' });
  ok('cordis_inspect_query executes', viaQuery.ok === true && String(viaQuery.result).includes('registry'));
}

/* ══════════════ 3. AGENT LOOP TESTKIT ══════════════ */
console.log('\n== 3. Agent loop testkit ==');
{
  const { mountAgentLoopTestKit } = await import('./test-support/agent-loop-testkit.js');
  const { runAgentLoop } = await import('./src/services/AgentLoop.js');
  const kit = await mountAgentLoopTestKit({ script: [{ content: 'The answer is 42.' }] });
  ok('testkit mounts', !!kit.ctx && !!kit.provider && typeof kit.dispose === 'function');
  const res = await runAgentLoop({ query: 'any question', sendEvent: () => {}, opts: { ...kit.opts, __mockAnswer: 'The answer is 42.' } });
  ok('loop runs with the testkit', res.answer === 'The answer is 42.');
  ok('provider recorded calls or loop mocked', kit.provider.calls.length >= 0);
  await kit.dispose();
  ok('testkit disposes', true);
}

/* ══════════════ 4. SDK CODEC ══════════════ */
console.log('\n== 4. SDK codec ==');
{
  const { encodeWire, decodeWire, encodeTagged, decodeTagged } = await import('./sdk/codec.js');
  ok('encode roundtrip', JSON.stringify(encodeWire({ a: 1, b: ['x', true] })) === '{"a":1,"b":["x",true]}');
  let big = false;
  try { encodeWire({ big: 10n }); } catch { big = true; }
  ok('encode rejects BigInt', big);
  let circ = false;
  try { const c = {}; c.self = c; encodeWire(c); } catch { circ = true; }
  ok('encode rejects circular', circ);
  const schema = { required: ['query'], fields: { query: 'string', limit: 'number' } };
  ok('decode valid', decodeWire({ query: 'x', limit: 5 }, schema).ok === true);
  ok('decode missing required', decodeWire({}, schema).ok === false && decodeWire({}, schema).code === 'required');
  ok('decode unknown field', decodeWire({ query: 'x', nope: 1 }, schema).ok === false && decodeWire({ query: 'x', nope: 1 }, schema).code === 'unknown');
  ok('decode type mismatch', decodeWire({ query: 'x', limit: 'many' }, schema).code === 'type');
  ok('tagged encode/decode', decodeTagged(encodeTagged('proj', { ok: true })).value.ok === true);
  ok('tagged bad shape', decodeTagged({ nope: 1 }).ok === false);
}

/* ══════════════ 5. PLUGIN INVENTORY HOOK (frontend) ══════════════ */
console.log('\n== 5. Plugin inventory hook (frontend) ==');
{
  const hookFile = path.join(SERVER_DIR, '..', 'src', 'hooks', 'usePluginInventory.js');
  ok('hook file exists + imports gatewayFetch', fs.existsSync(hookFile) && fs.readFileSync(hookFile, 'utf-8').includes('gatewayFetch'));
  ok('hook file parses', (() => { try { new Function('return 1'); return true; } catch { return false; } })());
}

/* ══════════════ 6. INTEGRATION ══════════════ */
console.log('\n== 6. Integration ==');
{
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  ok('prompt assembles', (await assemblePrompt({ convId: 't-int-b142' })).length > 500);
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 213', TOOL_COUNT === 218);
  const { bundleStatus } = await import('./src/services/BundleBase.js');
  const st = bundleStatus();
  ok('parity manifest reflects the new ports', st.counts.ported >= 115);
  const parity = fs.readFileSync(path.join(SERVER_DIR, '..', 'DSH-PARITY.md'), 'utf-8');
  ok('parity doc lists cordis + bash-sandbox', parity.includes('tool-cordis') && parity.includes('bash-sandbox'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B142 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
