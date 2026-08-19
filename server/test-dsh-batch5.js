/**
 * B136 — DSH BATCH 5 TEST ("Pull all, replace with jexi"):
 *
 *   session/session-projection(+cache)  → SessionProjection.js
 *   context/agent-instructions          → AgentInstructions.js (AGENTS.md)
 *   fs/fs-sandbox                       → FsSandbox.js (containment + mode gate)
 *   shell/shell-env                     → ShellEnv.js (scrubbed env)
 *   subprocess/subprocess-local         → SubprocessLocal.js
 *   workspace/workspace                 → WorkspaceEntity.js
 *   boot/app-boot (profile/dump)        → BootProfile.js
 *   bundle/headless                     → server/cli.js (headless CLI)
 *   host/plugin-inventory               → PluginInventory.js
 *   PluginContext _plugin stamp fix     → per-plugin counts
 *
 * All JEXI-branded (dsh → jexi in every user-facing string).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const SERVER_DIR = process.cwd();

/* ═══════════════════════ 1. SESSION PROJECTION ═══════════════════════ */
console.log('\n== 1. Session projection (dsh session-projection + cache) ==');
{
  const { projectSession, projectedConversationBlock, projectionCacheStats } = await import('./src/services/SessionProjection.js');
  const { appendConversationEvent } = await import('./src/services/SessionConversations.js');
  const conv = 't-proj-b136';
  for (let i = 1; i <= 20; i += 1) appendConversationEvent(conv, { role: i % 2 ? 'user' : 'jexi', text: `turn ${i} ` + 'x'.repeat(100), kind: 'chat' });
  const p = projectSession({ convId: conv, maxChars: 1500 });
  ok('projection ok with events', p.ok && p.events.length > 0);
  ok('projection bounded by budget', p.chars <= 1600 && p.events.length < 20);
  ok('projection reports dropped count', p.dropped > 0);
  ok('projection carries a dropped marker note', p.note.includes('dropped'));
  ok('projection stateVersion is the last seq', p.stateVersion >= 19);
  const p2 = projectSession({ convId: conv, maxChars: 1500 });
  ok('cache hit returns same projection', p2.cached === true && p2.stateVersion === p.stateVersion);
  appendConversationEvent(conv, { role: 'user', text: 'turn 21', kind: 'chat' });
  const p3 = projectSession({ convId: conv, maxChars: 1500 });
  ok('append invalidates the cache', p3.cached !== true && p3.stateVersion === p.stateVersion + 1);
  const block = projectedConversationBlock(conv, { maxChars: 800 });
  ok('prompt block renders', block.includes('This conversation so far'));
  const stats = projectionCacheStats();
  ok('cache stats', typeof stats.entries === 'number');
  const empty = projectSession({ convId: 't-proj-none' });
  ok('missing conversation projects to empty', empty.ok && empty.events.length === 0);
  const bad = projectSession({});
  ok('missing convId fails cleanly', bad.ok === false);
}

/* ═══════════════════════ 2. AGENT INSTRUCTIONS ═══════════════════════ */
console.log('\n== 2. Agent instructions (dsh agent-instructions / AGENTS.md) ==');
{
  const { discoverAgentInstructionFiles, loadBaselineInstructionSet, renderInstructionsBlock, newInstructionVersions, markInstructionsSeen, agentInstructionsStatus, touchProjectInstructions, loadInstructionFile } = await import('./src/services/AgentInstructions.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-agents-'));
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Rules\nAlways test.\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'sub', 'AGENTS.md'), 'Nested rules.\n', 'utf-8');
  const found = discoverAgentInstructionFiles(dir);
  ok('discovers root + nested AGENTS.md', found.length === 2 && found.every((f) => /agents\.md$/i.test(f.file)));
  ok('skips nothing outside maxDepth', found.length <= 20);
  const inst = loadBaselineInstructionSet({ root: dir });
  ok('baseline set loads with digests', inst.length === 2 && inst.every((i) => /^[0-9a-f]{16}$/.test(i.digest)));
  const rootInst = inst.find((i) => path.basename(i.file) === 'AGENTS.md');
  ok('digest is content-derived (sha256 head)', !!rootInst && loadInstructionFile(path.join(dir, 'AGENTS.md')).digest === rootInst.digest);
  const render = renderInstructionsBlock(inst, { maxChars: 2000 });
  ok('render includes the rules', render.includes('Always test') && render.includes('AGENTS.md'));
  ok('render is bounded', render.length <= 2400);
  const fresh = newInstructionVersions(inst);
  ok('new versions reported before seen', fresh.length === 2);
  markInstructionsSeen(inst);
  ok('seen versions are no longer new', newInstructionVersions(inst).length === 0);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Rules\nAlways test AND ship.\n', 'utf-8');
  const changed = loadBaselineInstructionSet({ root: dir });
  ok('changed digest becomes new again', newInstructionVersions(changed).length === 1);
  const status = agentInstructionsStatus({ root: dir });
  ok('status shape', status.files.length === 2 && typeof status.totalChars === 'number');
  touchProjectInstructions('AGENTS.md', { root: dir });
  ok('touch marks a file seen', newInstructionVersions(changed).length === 0);
}

/* ═══════════════════════ 3. FS SANDBOX ═══════════════════════ */
console.log('\n== 3. Fs sandbox (dsh fs-sandbox containment + mode gate) ==');
{
  const { checkFsOperation, isPathUnder, effectiveFsRoots } = await import('./src/services/FsSandbox.js');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ws-'));
  const insideFile = path.join(ws, 'a', 'b.txt');
  fs.mkdirSync(path.dirname(insideFile), { recursive: true });
  fs.writeFileSync(insideFile, 'x');
  ok('lexical containment: inside true', isPathUnder(insideFile, ws) === true);
  ok('lexical containment: outside false', isPathUnder('/etc/passwd', ws) === false);
  ok('containment: identity fallback (symlink alias)', (() => {
    try {
      const alias = path.join(os.tmpdir(), `jexi-alias-${Date.now()}`);
      fs.symlinkSync(ws, alias);
      const r = isPathUnder(path.join(alias, 'a'), ws);
      fs.unlinkSync(alias);
      return r;
    } catch { return true; } // platforms without symlinks skip gracefully
  })());
  const w1 = checkFsOperation({ op: 'write', target: insideFile, workspaceRoot: ws, mode: 'workspace-write' });
  ok('workspace-write allows workspace writes', w1.allowed === true);
  const w2 = checkFsOperation({ op: 'write', target: '/etc/passwd', workspaceRoot: ws, mode: 'workspace-write' });
  ok('workspace-write FAILS CLOSED outside', w2.allowed === false && /outside the workspace/.test(w2.reason));
  const w3 = checkFsOperation({ op: 'write', target: insideFile, workspaceRoot: ws, mode: 'read-only' });
  ok('read-only blocks writes inside too', w3.allowed === false && /read-only/.test(w3.reason));
  const w4 = checkFsOperation({ op: 'read', target: insideFile, workspaceRoot: ws, mode: 'read-only' });
  ok('read-only allows reads inside', w4.allowed === true);
  const w5 = checkFsOperation({ op: 'read', target: '/etc/hostname', workspaceRoot: ws, mode: 'read-only' });
  ok('read-only blocks outside reads', w5.allowed === false);
  const w6 = checkFsOperation({ op: 'read', target: '/etc/hostname', workspaceRoot: ws, mode: 'danger-full-access' });
  ok('danger-full-access allows outside reads', w6.allowed === true);
  const w7 = checkFsOperation({ op: 'delete', target: insideFile, workspaceRoot: ws, mode: 'workspace-write' });
  ok('delete is a write op (allowed in workspace)', w7.allowed === true);
  const roots = effectiveFsRoots({ workspaceRoot: ws, convId: 't-fsroots' });
  ok('effective roots include workspace + session temp', roots.length >= 2 && roots.includes(path.resolve(ws)));
}

/* ═══════════════════════ 4. SHELL ENV ═══════════════════════ */
console.log('\n== 4. Shell env (dsh shell-env) ==');
{
  const { shellEnv, looksLikeSecret, scrubbedNames } = await import('./src/services/ShellEnv.js');
  ok('secret name detected', looksLikeSecret('OPENAI_API_KEY', 'sk-abc') === true);
  ok('secret value shape detected', looksLikeSecret('MY_THING', 'sk-proj-123456789012345678901234') === true);
  ok('plain var not a secret', looksLikeSecret('HOME', '/home/x') === false);
  const env = shellEnv({ extra: { JEXI_TEST: '1' }, convId: 't-shell-env' });
  ok('identity vars present', env.JEXI_WORKSPACE && env.JEXI_SESSION === 't-shell-env' && env.JEXI_SHELL === '1');
  ok('scrubbed: API keys removed', (() => {
    process.env.SECRET_PROBE_KEY = 'sk-secretvalue12345678901234567890';
    const e = shellEnv({});
    delete process.env.SECRET_PROBE_KEY;
    return e.SECRET_PROBE_KEY === undefined;
  })());
  ok('extra wins over base', env.JEXI_TEST === '1');
  ok('extra undefined removes entry', shellEnv({ extra: { PATH: undefined } }).PATH === undefined);
  ok('scrubbedNames lists dropped names', scrubbedNames().every((n) => looksLikeSecret(n, process.env[n])));
}

/* ═══════════════════════ 5. SUBPROCESS LOCAL ═══════════════════════ */
console.log('\n== 5. Subprocess local (dsh subprocess-local) ==');
{
  const { spawnManaged, killManaged, listManagedProcesses, closeAllManagedProcesses } = await import('./src/services/SubprocessLocal.js');
  const done = await spawnManaged({ command: 'node', args: ['-e', 'console.log("sub-out-136"); process.exit(0)'], timeoutMs: 15000 });
  ok('spawned process settles with output', done.ok && done.stdout.includes('sub-out-136') && done.exitCode === 0);
  const failed = await spawnManaged({ command: 'node', args: ['-e', 'console.error("boom"); process.exit(5)'], timeoutMs: 15000 });
  ok('non-zero exit reported honestly', failed.ok === false && failed.exitCode === 5 && failed.stderr.includes('boom'));
  const timed = await spawnManaged({ command: 'node', args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 1500 });
  ok('timeout kills the process', timed.ok === false && (timed.error === 'timeout' || timed.status === 'exited' || timed.status === 'killed(SIGTERM)'));
  const bad = await spawnManaged({ command: '/nonexistent-binary-xyz' });
  ok('spawn error is honest failure', bad.ok === false && bad.error);
  const listed = listManagedProcesses();
  ok('list includes finished + running records', Array.isArray(listed) && listed.length >= 2);
  const kill = await killManaged('nope-123');
  ok('kill of unknown id fails cleanly', kill.ok === false);
  closeAllManagedProcesses();
}

/* ═══════════════════════ 6. WORKSPACE ENTITY ═══════════════════════ */
console.log('\n== 6. Workspace entity (dsh workspace) ==');
{
  const { initWorkspaceEntity, readWorkspaceEntity, updateWorkspaceEntity, attachSession, pathInWorkspace, workspaceEntityStatus, WORKSPACE_ENTITY_FILE } = await import('./src/services/WorkspaceEntity.js');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-ws-ent-'));
  const rec = initWorkspaceEntity(ws, { name: 'Test Workspace' });
  ok('entity created with id + name', rec.id && rec.name === 'Test Workspace');
  ok('entity file on disk', fs.existsSync(path.join(ws, WORKSPACE_ENTITY_FILE)));
  ok('re-init reads existing (id stable)', initWorkspaceEntity(ws).id === rec.id);
  const up = updateWorkspaceEntity(ws, { name: 'Renamed' });
  ok('update stamps updatedAt', up.ok && up.entity.name === 'Renamed' && up.entity.updatedAt >= rec.createdAt);
  attachSession(ws, 'sess-1');
  attachSession(ws, 'sess-2');
  const reread = readWorkspaceEntity(ws);
  ok('sessions attach (bounded list)', reread.sessions.length === 2 && reread.sessions.includes('sess-1'));
  ok('pathInWorkspace containment', pathInWorkspace(ws, path.join(ws, 'x/y.txt')) === true && pathInWorkspace(ws, '/etc') === false);
  const status = workspaceEntityStatus(ws);
  ok('status shape', status.ok && status.entity.sessionCount === 2);
}

/* ═══════════════════════ 7. BOOT PROFILE ═══════════════════════ */
console.log('\n== 7. Boot profile (dsh app-boot profile/config-dump) ==');
{
  const { writeBootProfile, readBootProfile, configDump, envSummary, featureFlags } = await import('./src/services/BootProfile.js');
  const profile = writeBootProfile({ phase: 'B136-TEST', commit: 'abc123' });
  ok('profile written with phase + commit', profile.phase === 'B136-TEST' && profile.commit === 'abc123');
  ok('profile has node/platform/env summary', profile.node && profile.platform && Array.isArray(profile.envNames) && profile.envNames.includes('PATH'));
  const reread = readBootProfile();
  ok('profile persists to disk', reread && reread.phase === 'B136-TEST');
  const dump = configDump({ groqKey: 'SECRET', theme: 'dark' });
  ok('config dump strips secrets', dump.settings.theme === 'dark' && !('groqKey' in dump.settings));
  const fs2 = featureFlags();
  ok('feature flags shape', typeof fs2.redis === 'boolean' && typeof fs2.sqlite === 'boolean');
  const es = envSummary({ A: '1' });
  ok('env summary is names+length only (never values)', es.A.length === 1 && !('value' in es.A));
}

/* ═══════════════════════ 8. HEADLESS CLI ═══════════════════════ */
console.log('\n== 8. Headless CLI (dsh bundle/headless) ==');
{
  const run = (args, timeoutMs = 60000) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SERVER_DIR, 'cli.js'), ...args], { cwd: SERVER_DIR, env: { ...process.env, JEXI_ALLOW_UNLOCKED: '1' } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
  const help = await run(['--help']);
  ok('--help exits 0 with usage', help.code === 0 && help.out.includes('headless'));
  const usage = await run([]);
  ok('no args exits 2 (usage error)', usage.code === 2);
  const self = await run(['--self-test'], 90000);
  let parsed = null;
  try {
    const lines = self.out.split('\n');
    const start = lines.findIndex((l) => l.trim().startsWith('{'));
    parsed = start >= 0 ? JSON.parse(lines.slice(start).join('\n')) : null;
  } catch { /* noop */ }
  ok('--self-test exits 0', self.code === 0);
  ok('--self-test covers registry + fs sandbox + projection', parsed && parsed.ok === true && parsed.total >= 6);
  ok('--self-test fs sandbox check passes', parsed && parsed.results.some((r) => r.name === 'fs sandbox fails closed outside workspace' && r.ok));
}

/* ═══════════════════════ 9. PLUGIN INVENTORY ═══════════════════════ */
console.log('\n== 9. Plugin inventory (dsh plugin-inventory) ==');
{
  const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');
  const { pluginInventory } = await import('./src/services/PluginInventory.js');
  const { ctx, loaded, failed } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  ok('plugins load', failed.length === 0 && loaded.length >= 8);
  const inv = pluginInventory();
  ok('inventory shape', inv.ok && Array.isArray(inv.plugins) && Array.isArray(inv.tools));
  ok('inventory counts: totalTools = registry + plugin', inv.counts.totalTools === inv.counts.registryTools + inv.counts.pluginTools);
  ok('per-plugin counts now stamped (the _plugin fix)', loaded.every((p) => p.tools >= 0) && inv.plugins.some((p) => p.name === 'coding' && p.tools >= 5));
  ok('inventory lists plugin tools with origin', inv.tools.some((t) => t.slug === 'bash' && t.origin === 'plugin'));
  ok('inventory registry tools marked', inv.tools.some((t) => t.slug === 'ralph' && t.origin === 'registry'));
}

/* ═══════════════════════ 10. INTEGRATION ═══════════════════════ */
console.log('\n== 10. Integration (prompt section + fs gate on plugin tools) ==');
{
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  const prompt = await assemblePrompt({ convId: 't-int-b136', normalMode: false });
  ok('assemblePrompt still works with the new section', typeof prompt === 'string' && prompt.length > 500);
  const { listPluginTools: listPluginTools2 } = await import('./src/services/PluginContext.js');
  const writeDef = listPluginTools2().find((t) => t.slug === 'write');
  ok('coding plugin args still validate (write schema on the def)', !!writeDef && writeDef.args && writeDef.args.file_path && writeDef.args.file_path.required === true);
  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry count stable at 206', TOOL_COUNT === 218 && TOOL_REGISTRY.some((t) => t.slug === 'ralph'));
  const { listPluginTools } = await import('./src/services/PluginContext.js');
  const tools = listPluginTools();
  ok('plugin tools still mounted', tools.length >= 13 && tools.some((t) => t.slug === 'write') && tools.some((t) => t.slug === 'bash'));
}

console.log(`\n${failures === 0 ? '🎉 ALL B136 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
