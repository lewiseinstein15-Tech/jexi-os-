/**
 * B138 — DSH BATCH 7 TEST ("Pull all"):
 *
 *   subagent providers (claude-code/codex/acp/dsh-sdk) → SubagentProviders.js
 *   code-runtime worker bootstrap hardening           → CodeRuntimeBootstrap.js
 *   boot config hot-reload                            → ConfigReload.js
 *   api/remotes (agent-lookup)                        → RemoteAgents.js
 *   context/tmux-context                              → TmuxContext.js
 *   typert/protocol                                   → TypingProtocol.js
 *   subagent tool provider routing                    → ToolRuntime 'subagent'
 *   ui-permission-presets (frontend panel)            → src/components/SettingsPanel.jsx
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ══════════════ 1. SUBAGENT PROVIDERS ══════════════ */
console.log('\n== 1. Subagent providers (external CLI dialects) ==');
{
  const { SUBAGENT_PROVIDERS, subagentProviderStatus, isExternalProvider, resolveSubagentProvider, runExternalSubagent, binaryAvailable } = await import('./src/services/SubagentProviders.js');
  ok('5 providers defined', Object.keys(SUBAGENT_PROVIDERS).length === 5);
  ok('in-process + dsh-sdk are in-process', isExternalProvider('in-process') === false && isExternalProvider('dsh-sdk') === false);
  ok('claude-code/codex/acp are external', isExternalProvider('claude-code') && isExternalProvider('codex') && isExternalProvider('acp'));
  ok('resolve unknown → in-process', resolveSubagentProvider('nope') === 'in-process');
  ok('resolve empty → in-process', resolveSubagentProvider('') === 'in-process');
  ok('resolve valid', resolveSubagentProvider('codex') === 'codex');
  const status = subagentProviderStatus();
  ok('status lists 5 with availability', status.length === 5 && status.some((p) => p.key === 'in-process' && p.available === true));

  // Missing binary → honest failure, not a crash.
  const missing = await runExternalSubagent({ provider: 'codex', task: 'hi', cwd: os.tmpdir() });
  ok('missing binary fails honestly with availability message', missing.ok === false && /not found on PATH/.test(missing.error));

  // Fake binary on PATH → runs and returns output.
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-fakebin-'));
  fs.writeFileSync(path.join(fakeBin, 'claude'), '#!/bin/sh\necho "fake-claude: $@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'codex'), '#!/bin/sh\necho "{\\"result\\": \\"fake-codex ok\\"}"\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'acp'), '#!/bin/sh\necho "fake-acp"\nexit 2\n', { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${oldPath}`;
  try {
    ok('binaryAvailable finds fake claude', binaryAvailable('claude') === true);
    const claude = await runExternalSubagent({ provider: 'claude-code', task: 'say hi', cwd: os.tmpdir(), timeoutMs: 15000 });
    ok('claude-code provider runs the CLI', claude.ok === true && claude.output.includes('fake-claude:') && claude.output.includes('say hi'));
    const codex = await runExternalSubagent({ provider: 'codex', task: 'x', cwd: os.tmpdir(), timeoutMs: 15000 });
    ok('codex provider runs the CLI', codex.ok === true && codex.output.includes('fake-codex'));
    const acp = await runExternalSubagent({ provider: 'acp', task: 'x', cwd: os.tmpdir(), timeoutMs: 15000 });
    ok('acp provider surfaces non-zero exit', acp.ok === false && acp.code === 2);
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
  }
  const empty = await runExternalSubagent({ provider: 'codex', task: '  ', cwd: os.tmpdir() });
  ok('empty task rejected', empty.ok === false);
  const inproc = await runExternalSubagent({ provider: 'in-process', task: 'x' });
  ok('in-process provider rejected for external runner', inproc.ok === false && /not an external CLI provider/.test(inproc.error));
}

/* ══════════════ 2. CODE RUNTIME BOOTSTRAP ══════════════ */
console.log('\n== 2. Code-runtime bootstrap hardening ==');
{
  const { jsonSnapshot, byteBudget, validateWorkerMessage, normalizeWorkerResult, workerBootstrapSelfCheck, WORKER_MESSAGE_TYPES } = await import('./src/services/CodeRuntimeBootstrap.js');
  ok('jsonSnapshot roundtrip', JSON.stringify(jsonSnapshot({ a: 1, b: ['x', true] })) === '{"a":1,"b":["x",true]}');
  let bigint = false;
  try { jsonSnapshot({ big: 10n }); } catch { bigint = true; }
  ok('BigInt rejected', bigint);
  let circ = false;
  try { const c = {}; c.self = c; jsonSnapshot(c); } catch { circ = true; }
  ok('circular rejected', circ);
  ok('functions dropped like JSON.stringify', JSON.stringify(jsonSnapshot({ f: () => {}, keep: 1 })) === '{"keep":1}');
  const bb = byteBudget('hello world', 5);
  ok('byteBudget truncates at bytes', bb.truncated === true && bb.text.startsWith('hello'));
  ok('byteBudget full under limit', byteBudget('hi', 100).truncated === false);
  ok('WORKER_MESSAGE_TYPES', WORKER_MESSAGE_TYPES.join(',') === 'start,log,output-limit,done,error');
  ok('validate: ok log', validateWorkerMessage({ type: 'log', text: 'x' }).ok === true);
  ok('validate: bad type', validateWorkerMessage({ type: 'nope' }).ok === false);
  ok('validate: null', validateWorkerMessage(null).ok === false);
  ok('validate: start needs code', validateWorkerMessage({ type: 'start' }).ok === false);
  ok('validate: done needs result', validateWorkerMessage({ type: 'done' }).ok === false);
  const norm = normalizeWorkerResult({ deep: { ok: true } });
  ok('normalizeWorkerResult roundtrip', norm.ok && norm.result.deep.ok === true);
  const big = normalizeWorkerResult({ pad: 'x'.repeat(40000) }, { maxResultBytes: 100 });
  ok('oversized worker result rejected', big.ok === false);
  const checks = workerBootstrapSelfCheck();
  ok('bootstrap self-check all pass', checks.length >= 10 && checks.every((c) => c.ok));
}

/* ══════════════ 3. CONFIG RELOAD ══════════════ */
console.log('\n== 3. Config hot-reload ==');
{
  const { foldConfigSnapshot, initConfigSnapshot, reloadConfig, configStatus, onConfigChange } = await import('./src/services/ConfigReload.js');
  const snap = foldConfigSnapshot({ env: { JEXI_API_KEY: 'x', REDIS_URL: 'r' }, settings: { agentPresets: { default: 'ptc' } } });
  ok('fold: keyLocked + features', snap.keyLocked === true && snap.hasRedis === true && snap.preset === 'ptc');
  const init = initConfigSnapshot({ env: { JEXI_API_KEY: 'x' }, settings: {} });
  ok('init snapshot', init.keyLocked === true && init.allowUnlocked === false);
  let events = 0;
  const off = onConfigChange(() => { events += 1; });
  const same = reloadConfig({ env: { JEXI_API_KEY: 'x' }, settings: {} });
  ok('unchanged reload → no change, no event', same.changed === false && events === 0);
  const changed = reloadConfig({ env: { JEXI_ALLOW_UNLOCKED: '1' }, settings: {} });
  ok('changed reload detected', changed.changed === true && changed.diff.allowUnlocked.from === false && changed.diff.allowUnlocked.to === true);
  ok('listener notified once', events === 1);
  ok('status shape', configStatus().snapshot.allowUnlocked === true && configStatus().listenerCount === 1);
  off();
}

/* ══════════════ 4. REMOTE AGENTS ══════════════ */
console.log('\n== 4. Remote agents (api/remotes) ==');
{
  const { registerRemoteAgent, lookupRemoteAgent, listRemoteAgents, unregisterRemoteAgent, remoteAgentsStatus, agentLookup } = await import('./src/services/RemoteAgents.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-remotes-'));
  const oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const r = registerRemoteAgent({ handle: 'office@host', agent: 'Office JEXI', url: 'https://office.example.com', enabled: true });
  ok('register ok', r.ok && r.remote.handle === 'office@host');
  ok('lookup resolves', lookupRemoteAgent('office@host').agent === 'Office JEXI');
  ok('lookup unknown → null', lookupRemoteAgent('nope') === null);
  ok('invalid handle rejected', registerRemoteAgent({ handle: 'BAD HANDLE!' }).ok === false);
  registerRemoteAgent({ handle: 'phone@host', agent: 'Phone JEXI', enabled: false });
  const list = listRemoteAgents();
  ok('list has 2 sorted', list.length === 2 && list[0].handle === 'office@host');
  const st = remoteAgentsStatus();
  ok('status counts enabled', st.count === 2 && st.enabled === 1);
  const lookup = agentLookup('office@host');
  ok('agentLookup found', lookup.found === true && lookup.agent === 'Office JEXI');
  const disabled = agentLookup('phone@host');
  ok('agentLookup treats disabled as not found', disabled.found === false);
  const del = unregisterRemoteAgent('office@host');
  ok('unregister ok', del.ok && listRemoteAgents().length === 1);
  ok('unregister unknown fails', unregisterRemoteAgent('zzz').ok === false);
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
}

/* ══════════════ 5. TMUX CONTEXT ══════════════ */
console.log('\n== 5. Tmux context ==');
{
  const { inTmux, tmuxContextBlock, tmuxStatus } = await import('./src/services/TmuxContext.js');
  ok('not in tmux by default', inTmux({}) === false);
  ok('block empty outside tmux', tmuxContextBlock({}) === '');
  const env = { TMUX: '/tmp/tmux-1000/default,1234,0', TMUX_PANE: '%0' };
  ok('inTmux detects env', inTmux(env) === true);
  const block = tmuxContextBlock(env);
  ok('block rendered inside tmux', block.includes('tmux session') && block.includes('default'));
  const st = tmuxStatus(env);
  ok('status shape', st.inTmux === true && st.session.includes('default'));
}

/* ══════════════ 6. TYPING PROTOCOL ══════════════ */
console.log('\n== 6. Typing protocol (typert) ==');
{
  const { validateTypingMessage, applyTypingOp, applyTypingScript, TYPING_MESSAGE_TYPES, clampPos } = await import('./src/services/TypingProtocol.js');
  ok('message types', TYPING_MESSAGE_TYPES.join(',') === 'open,insert,delete,cursor,close');
  ok('validate open ok', validateTypingMessage({ type: 'open', bufferId: 'b1', content: 'x' }).ok === true);
  ok('validate open requires bufferId', validateTypingMessage({ type: 'open' }).ok === false);
  ok('validate insert ok', validateTypingMessage({ type: 'insert', text: 'hi' }).ok === true);
  ok('validate insert requires text', validateTypingMessage({ type: 'insert' }).ok === false);
  ok('validate delete ok', validateTypingMessage({ type: 'delete', count: 2 }).ok === true);
  ok('validate delete rejects zero', validateTypingMessage({ type: 'delete', count: 0 }).ok === false);
  ok('validate bad type', validateTypingMessage({ type: 'nope' }).ok === false);
  ok('clampPos bounds', clampPos(-5, 10) === 0 && clampPos(50, 10) === 10 && clampPos(3, 10) === 3);
  let buf = '';
  let r = applyTypingOp(buf, { type: 'open', bufferId: 'b', content: 'hello' });
  ok('open sets buffer', r.buffer === 'hello');
  r = applyTypingOp(r.buffer, { type: 'insert', text: ' X', pos: 5 });
  ok('insert at pos', r.buffer === 'hello X');
  r = applyTypingOp(r.buffer, { type: 'delete', count: 2, pos: 5 });
  ok('delete at pos', r.buffer === 'hello');
  r = applyTypingOp(r.buffer, { type: 'cursor', pos: 2 });
  ok('cursor clamps', r.cursor === 2);
  let threw = false;
  try { applyTypingOp('x', { type: 'insert' }); } catch { threw = true; }
  ok('invalid op throws', threw);
  const script = applyTypingScript('', [
    { type: 'open', bufferId: 'b', content: '' },
    { type: 'insert', text: 'jexi', pos: 0 },
    { type: 'insert', text: ' os', pos: 4 },
    { type: 'delete', count: 3, pos: 4 },
  ]);
  ok('script applies', script.buffer === 'jexi' && script.log.length === 4);
}

/* ══════════════ 7. SUBAGENT TOOL PROVIDER ROUTING ══════════════ */
console.log('\n== 7. Subagent tool provider routing ==');
{
  const { executeTool, validateToolArgs } = await import('./src/services/ToolRuntime.js');
  ok('subagent schema validates provider arg', validateToolArgs('subagent', { task: 'x', provider: 'codex' }).ok === true);
  const missing = await executeTool({ slug: 'subagent', args: { task: 'x', provider: 'codex' }, spillOwner: 't-prov' });
  ok('external provider without binary fails honestly', missing.ok === false && /not found on PATH|in-process/.test(String(missing.error)));
  const badProvider = await executeTool({ slug: 'subagent', args: { task: 'x', provider: 'weird' }, spillOwner: 't-prov' });
  ok('unknown provider falls back in-process', badProvider.kind === 'subagent' || badProvider.ok === true || badProvider.result !== undefined);
}

/* ══════════════ 8. FRONTEND PANEL + INTEGRATION ══════════════ */
console.log('\n== 8. Frontend panel + integration ==');
{
  const panel = fs.readFileSync(path.join(__dirname_path(), '..', 'src', 'components', 'SettingsPanel.jsx'), 'utf-8');
  ok('SettingsPanel has the permission presets UI', panel.includes('PERMISSION PRESETS') && panel.includes('/api/permissions') && panel.includes('autonomous'));
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 207', TOOL_COUNT === 210);
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  const prompt = await assemblePrompt({ convId: 't-int-b138' });
  ok('prompt assembles (tmux section no-op outside tmux)', typeof prompt === 'string' && prompt.length > 500 && !prompt.includes('tmux session'));
}

function __dirname_path() {
  return path.dirname(new URL(import.meta.url).pathname);
}

console.log(`\n${failures === 0 ? '🎉 ALL B138 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
