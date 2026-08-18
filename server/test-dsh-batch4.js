/**
 * B135 — DSH BATCH 4 TEST (the "Pull all" batch):
 *
 *   util/home-paths            → HomePaths.js
 *   util/launch-environment    → LaunchEnvironment.js
 *   settings/settings-file     → SettingsFile.js
 *   storage/storage-json+sqlite→ StorageHub.js
 *   session-persistence-sqlite → SessionPersistenceSqlite.js
 *   shell/tool-bash-persistent → BashPersistent.js + coding-plugin bash upgrade
 *   hooks/hooks-codex + claude-code → HookBridges.js
 *   workflow/tool-ralph        → RalphRunner.js + ralph registry tool
 *   mcp/mcp-client             → McpClient.js (stdio/streamable-http, namespaced tools)
 *   sandbox/sandbox-local + e2b→ SandboxLocal.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { setTimeout as sleep } from 'timers/promises';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

/* ═══════════════════════ 1. HOME PATHS ═══════════════════════ */
console.log('\n== 1. Home paths (dsh home-paths) ==');
{
  const { resolveJexiHome, expandHomePath, jexiHomePath, jexiHomeDisplay, JEXI_HOME_ENV } = await import('./src/services/HomePaths.js');
  const home = os.homedir();
  ok('default home is ~/.jexi', resolveJexiHome(undefined, {}) === path.join(home, '.jexi'));
  ok('JEXI_HOME env wins', resolveJexiHome(undefined, { JEXI_HOME: '/tmp/jexi-home' }) === path.resolve('/tmp/jexi-home'));
  ok('blank JEXI_HOME is treated as unset', resolveJexiHome(undefined, { JEXI_HOME: '   ' }) === path.join(home, '.jexi'));
  ok('configured path beats env', resolveJexiHome('/opt/jexi', { JEXI_HOME: '/tmp/jexi-home' }) === path.resolve('/opt/jexi'));
  ok('tilde expansion', expandHomePath('~/x/y') === path.join(home, 'x/y'));
  ok('display: default ~/.jexi', jexiHomeDisplay(path.join(home, '.jexi')) === '~/.jexi');
  ok('display: configured $JEXI_HOME', jexiHomeDisplay('/custom/jexi') === '$JEXI_HOME');
  ok('jexiHomePath joins segments', jexiHomePath('settings.yaml').endsWith(path.join('.jexi', 'settings.yaml')) || jexiHomePath('settings.yaml').endsWith('settings.yaml'));
  ok(`${JEXI_HOME_ENV} is the override env name`, JEXI_HOME_ENV === 'JEXI_HOME');
}

/* ═══════════════════════ 2. LAUNCH ENVIRONMENT ═══════════════════════ */
console.log('\n== 2. Launch environment (dsh launch-environment) ==');
{
  const { createLaunchEnvironmentSnapshot, parseDotEnv, buildLaunchEnvironment, setLaunchEnvironment, launchEnvironmentOf } = await import('./src/services/LaunchEnvironment.js');
  const snap = createLaunchEnvironmentSnapshot([
    { source: 'user-env', values: { X: 'user', ONLY_USER: 'u' } },
    { source: 'process', values: { X: 'process' } },
    { source: 'project-env', values: { X: 'project', ONLY_PROJECT: 'p' } },
  ]);
  ok('process wins over project/user', snap.get('X').value === 'process' && snap.get('X').source === 'process');
  ok('project-env beats user-env', snap.get('ONLY_PROJECT').value === 'p');
  ok('user-env resolves when nothing higher', snap.get('ONLY_USER').value === 'u');
  ok('getFrom filters layers', snap.getFrom('X', ['user-env', 'project-env']).value === 'project');
  ok('getFrom respects trust order', snap.getFrom('X', ['user-env']).value === 'user');
  ok('missing key → undefined', snap.get('NOPE') === undefined);
  ok('parseDotEnv handles quotes/comments', parseDotEnv('# c\nA="x y"\nB=z\n').A === 'x y' && parseDotEnv('# c\nA="x y"\nB=z\n').B === 'z');
  const boot = buildLaunchEnvironment({ cwd: os.tmpdir(), jexiHome: os.tmpdir() });
  ok('boot snapshot resolves PATH', typeof boot.get('PATH') === 'object' && boot.get('PATH').value.length > 0);
  setLaunchEnvironment(snap);
  ok('launchEnvironmentOf returns the set snapshot', launchEnvironmentOf().get('X').value === 'process');
}

/* ═══════════════════════ 3. SETTINGS FILE ═══════════════════════ */
console.log('\n== 3. Settings file (dsh settings-file) ==');
{
  const { SettingsFileStore, parseYamlSubset, stringifyYamlSubset, resolveSettingsSpec } = await import('./src/services/SettingsFile.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-settings-'));
  const store = new SettingsFileStore({ path: path.join(dir, 'settings.json'), watch: false });
  ok('empty doc by default', Object.keys(store.all()).length === 0);
  const r1 = store.set('ui', 'theme', 'dark');
  ok('set persists ok', r1.ok && store.getKey('ui', 'theme') === 'dark');
  ok('file exists with JSON', fs.existsSync(path.join(dir, 'settings.json')));
  const reread = new SettingsFileStore({ path: path.join(dir, 'settings.json'), watch: false });
  ok('reload from disk', reread.getKey('ui', 'theme') === 'dark');
  store.set('ui', 'fontSize', 14);
  ok('namespace sections', store.get('ui').fontSize === 14);
  store.remove('ui', 'theme');
  ok('remove key', store.getKey('ui', 'theme') === undefined);
  ok('bad extension rejected', (() => { try { resolveSettingsSpec({ path: path.join(dir, 'x.toml') }); return false; } catch { return true; } })());
  const y = parseYamlSubset('ui:\n  theme: dark\n  zoom: 2\nmodels:\n  - groq\n  - gemini\n');
  ok('yaml subset nested maps', y.ui && y.ui.theme === 'dark' && y.ui.zoom === 2);
  ok('yaml subset scalar list', Array.isArray(y.models) && y.models.length === 2 && y.models[0] === 'groq');
  const ys = stringifyYamlSubset({ a: { b: 1 }, c: 'x' });
  ok('yaml stringify roundtrip', parseYamlSubset(ys).a.b === 1 && parseYamlSubset(ys).c === 'x');
  store.stop();
}

/* ═══════════════════════ 4. STORAGE HUB ═══════════════════════ */
console.log('\n== 4. Storage hub (dsh storage-json + storage-sqlite) ==');
{
  const { createStorageHub, StorageError, UNIT_NAME_RE } = await import('./src/services/StorageHub.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-storage-'));
  const hub = await createStorageHub({ root: path.join(dir, 'units'), sqlitePath: path.join(dir, 'store.sqlite') });
  ok('both backends registered', !!hub.backends.json && !!hub.backends.sqlite);
  const unit = await hub.open('prefs', 'json');
  ok('json unit set/get', unit.set('k', { deep: true }).version >= 1 && unit.get('k').deep === true);
  ok('version stamp increments', unit.set('x', 1).version === unit.version);
  let doubleOpen = false;
  try { await hub.open('prefs', 'json'); } catch { doubleOpen = true; }
  ok('double-open rejected', doubleOpen);
  let badName = false;
  try { await hub.open('UPPER bad!', 'json'); } catch { badName = true; }
  ok('invalid unit name rejected', badName);
  const s1 = await hub.open('memories', 'sqlite');
  s1.set('note', 'hello sqlite');
  ok('sqlite unit set/get', s1.get('note') === 'hello sqlite');
  ok('unit name pattern', UNIT_NAME_RE.test('a.b_c-1') && !UNIT_NAME_RE.test('UPPER'));
  const list = hub.listUnits();
  ok('listUnits sees both backends', list.some((u) => u.name === 'prefs' && u.backend === 'json') && list.some((u) => u.name === 'memories' && u.backend === 'sqlite'));
  const peeked = await hub.peek('prefs');
  ok('peek reads without taking a handle', peeked && peeked.value.k && peeked.value.k.deep === true);
  await hub.close();
  let closedErr = false;
  try { await hub.open('prefs', 'json'); } catch (e) { closedErr = e instanceof StorageError; }
  ok('open after close fails closed', closedErr);
}

/* ═══════════════════════ 5. SESSION PERSISTENCE SQLITE ═══════════════════════ */
console.log('\n== 5. Session persistence sqlite (dsh session-persistence-sqlite) ==');
{
  const { openSessionPersistence, sessionRevision, sessionPersistenceStatus, persistSessionEvent, closeSessionPersistence } = await import('./src/services/SessionPersistenceSqlite.js');
  const { appendConversationEvent, onConversationEvent } = await import('./src/services/SessionConversations.js');
  const r = await openSessionPersistence(':memory:');
  ok('sqlite mirror available', r.available === true);
  const off = onConversationEvent((convId, ev) => persistSessionEvent(convId, ev));
  appendConversationEvent('t-batch4-conv', { role: 'user', text: 'hello', kind: 'chat' });
  appendConversationEvent('t-batch4-conv', { role: 'jexi', text: 'hi there', kind: 'chat', meta: { m: 1 } });
  await sleep(300); // batched flush
  const rev = sessionRevision('t-batch4-conv');
  ok('revision reflects appended seqs', rev && rev.revision >= 1);
  const status = sessionPersistenceStatus();
  ok('status reports rows', status.available && status.sessions >= 1 && status.events >= 2);
  off();
  await closeSessionPersistence();
}

/* ═══════════════════════ 6. PERSISTENT BASH ═══════════════════════ */
console.log('\n== 6. Persistent bash (dsh tool-bash-persistent) ==');
{
  const { runPersistentBash, resetShell, listPersistentShells, closeAllShells } = await import('./src/services/BashPersistent.js');
  const one = await runPersistentBash({ owner: 't-bash-1', command: 'echo hello-b135', timeoutMs: 15000 });
  ok('runs a command', one.ok && one.output.includes('hello-b135') && one.code === 0);
  const two = await runPersistentBash({ owner: 't-bash-1', command: 'export KEEP_ME=42; echo "$KEEP_ME"', timeoutMs: 15000 });
  ok('env persists across calls', two.ok && two.output.includes('42'));
  await runPersistentBash({ owner: 't-bash-1', command: 'cd /tmp', timeoutMs: 15000 });
  const three = await runPersistentBash({ owner: 't-bash-1', command: 'pwd', timeoutMs: 15000 });
  ok('cwd persists across calls', three.ok && three.output.includes('/tmp'));
  const four = await runPersistentBash({ owner: 't-bash-1', command: '(exit 3)', timeoutMs: 15000 });
  ok('exit code surfaces', !four.ok && four.code === 3);
  const five = await runPersistentBash({ owner: 't-bash-1', command: 'echo after-failure', timeoutMs: 15000 });
  ok('shell survives a failing command', five.ok && five.output.includes('after-failure'));
  const six = await runPersistentBash({ owner: 't-bash-1', command: 'pwd', timeoutMs: 15000, reset: true });
  ok('reset restarts from the workspace', six.ok && six.reset && !six.output.includes('/tmp'));
  const listed = listPersistentShells();
  ok('status lists live shells', listed.some((s) => s.owner === 't-bash-1'));
  const big = await runPersistentBash({ owner: 't-bash-1', command: 'seq 1 500', timeoutMs: 15000, maxOutputChars: 200 });
  ok('oversized output is truncated with the DSH note', big.ok && big.truncated === true && big.output.includes('<response clipped>'));
  resetShell('t-bash-1');
  closeAllShells();
}

/* ═══════════════════════ 7. HOOK BRIDGES ═══════════════════════ */
console.log('\n== 7. Hook bridges (dsh hooks-codex + hooks-claude-code) ==');
{
  const { parseCodexConfig, parseClaudeCodeConfig, substituteCommand, HookBridge, CODEX_EVENTS, CLAUDE_EVENTS } = await import('./src/services/HookBridges.js');
  const codex = parseCodexConfig({
    hooks: {
      PreToolUse: [{ matcher: '^bash$', hooks: [{ type: 'command', command: 'echo pre', timeoutSec: 5 }, { async: true, command: 'nope' }] }],
      UserPromptSubmit: [{ hooks: [{ command: 'echo p' }] }],
      PostToolUse: [{ matcher: 'write', hooks: [{ command: 'echo post' }] }],
    },
  });
  ok('codex: 3 events parsed', Object.keys(codex.config).length === 3);
  ok('codex: async hook skipped with reason', codex.skipped.some((s) => s.reason === 'async hook'));
  ok('codex: matcher kept on PreToolUse', codex.config.PreToolUse[0].matcher === '^bash$');
  ok('codex: matcher dropped on UserPromptSubmit', codex.config.UserPromptSubmit[0].matcher === undefined);
  let threw = false;
  try { parseCodexConfig({ hooks: { PreToolUse: [{ matcher: '([', hooks: [{ command: 'x' }] }] } }); } catch (e) { threw = e instanceof SyntaxError; }
  ok('codex: invalid regex rejects the config', threw);
  const cc = parseClaudeCodeConfig({ hooks: { PreToolUse: [{ matcher: 'edit', hooks: [{ command: 'echo ${CLAUDE_PROJECT_DIR} ${CLAUDE_PLUGIN_ROOT}' }] }], SubagentStart: [{ hooks: [{ command: 'echo s' }] }] } }, { projectDir: '/proj', pluginRoot: '/plug' });
  ok('claude-code: substitution applied at parse time', cc.config.PreToolUse[0].hooks[0].command === 'echo /proj /plug');
  ok('claude-code: SubagentStart parsed', !!cc.config.SubagentStart);
  ok('substituteCommand replaces tokens', substituteCommand('a ${CLAUDE_PLUGIN_ROOT} b ${CLAUDE_PROJECT_DIR}', { pluginRoot: 'P', projectDir: 'J' }) === 'a P b J');
  ok('codex events list', CODEX_EVENTS.join(',') === 'PreToolUse,PostToolUse,SessionStart,UserPromptSubmit,Stop');
  ok('claude events add subagent', CLAUDE_EVENTS.includes('SubagentStart') && CLAUDE_EVENTS.includes('SubagentStop'));

  // Execution: blocking via exit 2 (codex), via JSON decision (claude-code), matcher gating.
  const blockBridge = new HookBridge({ dialect: 'codex', groups: { PreToolUse: [{ matcher: '^bash$', hooks: [{ command: 'exit 2' }] }] }, skipped: [], configPath: '/x' });
  const r1 = await blockBridge.fire('PreToolUse', { tool: 'bash', args: { command: 'ls' } });
  ok('codex exit 2 blocks PreToolUse', r1.blocked === true);
  const r2 = await blockBridge.fire('PreToolUse', { tool: 'write', args: {} });
  ok('matcher gates (write not blocked)', r2.blocked === false && r2.ran === 0);
  const ccBlock = new HookBridge({ dialect: 'claude-code', groups: { PreToolUse: [{ matcher: 'bash', hooks: [{ command: "echo '{\"decision\":\"block\",\"reason\":\"policy\"}'" }] }] }, skipped: [], configPath: '/x' });
  const r3 = await ccBlock.fire('PreToolUse', { tool: 'bash', args: {} });
  ok('claude-code JSON decision blocks', r3.blocked === true && r3.reason.includes('policy'));
  const ccAllow = new HookBridge({ dialect: 'claude-code', groups: { PreToolUse: [{ hooks: [{ command: 'exit 1' }] }] }, skipped: [], configPath: '/x' });
  const r4 = await ccAllow.fire('PreToolUse', { tool: 'bash', args: {} });
  ok('non-zero exit without block signal is NOT blocking (fail-open)', r4.blocked === false);
}

/* ═══════════════════════ 8. RALPH LOOP ═══════════════════════ */
console.log('\n== 8. Ralph loop (dsh tool-ralph) ==');
{
  const { validateRalphReport, decodeRalphReport, runRalph, RALPH_STATUSES } = await import('./src/services/RalphRunner.js');
  ok('valid complete report', validateRalphReport({ status: 'complete', summary: 'done', evidence: ['e1'], nextSteps: [], blocker: '' }).status === 'complete');
  ok('valid continue report', validateRalphReport({ status: 'continue', summary: 'going', evidence: [], nextSteps: ['n1'], blocker: '' }).status === 'continue');
  ok('valid blocked report', validateRalphReport({ status: 'blocked', summary: 'stuck', evidence: [], nextSteps: [], blocker: 'need api key' }).status === 'blocked');
  let bad = false;
  try { validateRalphReport({ status: 'complete', summary: 'x', evidence: [], nextSteps: [], blocker: '' }); } catch { bad = true; }
  ok('complete without evidence rejected', bad);
  bad = false;
  try { validateRalphReport({ status: 'continue', summary: 'x', evidence: [], nextSteps: [], blocker: '' }); } catch { bad = true; }
  ok('continue without nextSteps rejected', bad);
  bad = false;
  try { validateRalphReport({ status: 'blocked', summary: 'x', evidence: [], nextSteps: [], blocker: '  ' }); } catch { bad = true; }
  ok('blocked without concrete blocker rejected', bad);
  bad = false;
  try { validateRalphReport({ status: 'weird', summary: 'x', evidence: [], nextSteps: [], blocker: '' }); } catch { bad = true; }
  ok('invalid status rejected', bad);
  ok('decode strips fences', decodeRalphReport('```json\n{"status":"complete","summary":"s","evidence":["e"],"nextSteps":[],"blocker":""}\n```').summary === 's');
  ok('RALPH_STATUSES exported', RALPH_STATUSES.join(',') === 'complete,blocked,budget-limited,round-failed');

  // End-to-end with a roundFn seam: round 1 continue → round 2 complete.
  const events = [];
  const res = await runRalph({
    objective: 'test objective',
    maxRounds: 5,
    sendEvent: (t) => events.push(t),
    roundFn: ({ round }) => JSON.stringify(round === 1
      ? { status: 'continue', summary: 'started', evidence: [], nextSteps: ['inspect workspace'], blocker: '' }
      : { status: 'complete', summary: 'all done', evidence: ['verified'], nextSteps: [], blocker: '' }),
  });
  ok('ralph completes with fresh child per round', res.ok === true && res.status === 'complete' && res.roundsStarted === 2);
  ok('ralph streams round events', events.includes('ralph.round') && events.includes('ralph.done'));
  ok('handoff carries the previous report', events.filter((e) => e === 'ralph.round').length === 2);
  const blocked = await runRalph({ objective: 'x', maxRounds: 3, roundFn: async () => JSON.stringify({ status: 'blocked', summary: 'stuck', evidence: [], nextSteps: [], blocker: 'waiting on user' }) });
  ok('ralph blocked status', blocked.ok === false && blocked.status === 'blocked' && blocked.error === 'waiting on user');
  const budget = await runRalph({ objective: 'x', maxRounds: 2, roundFn: async () => JSON.stringify({ status: 'continue', summary: 'still going', evidence: [], nextSteps: ['more'], blocker: '' }) });
  ok('ralph budget-limited at cap', budget.status === 'budget-limited' && budget.roundsStarted === 2);
  const failed = await runRalph({ objective: 'x', maxRounds: 3, roundFn: async () => 'not json' });
  ok('ralph round-failed on malformed child output', failed.status === 'round-failed' && failed.roundsStarted === 1);
  const noObj = await runRalph({ objective: '  ' });
  ok('ralph rejects empty objective', noObj.ok === false);
}

/* ═══════════════════════ 9. MCP CLIENT ═══════════════════════ */
console.log('\n== 9. MCP client (dsh mcp-client) ==');
{
  const { mountMcp } = await import('./mcp-server.js');
  const { connectMcpServer, disconnectMcpServer, mcpServerStatus, validateServerSpec } = await import('./src/services/McpClient.js');
  const { createPluginContext, setActivePluginContext, getPluginTool, listPluginTools } = await import('./src/services/PluginContext.js');
  setActivePluginContext(createPluginContext());
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  mountMcp(app);
  const server = app.listen(0);
  const port = server.address().port;

  ok('serverName pattern enforced', (() => { try { validateServerSpec({ serverName: 'UPPER!', transport: 'stdio', command: 'x' }); return false; } catch { return true; } })());
  const conn = await connectMcpServer({
    serverName: 'jexitest',
    transport: 'streamable-http',
    url: `http://127.0.0.1:${port}/mcp`,
    failOnStartupError: true,
    toolCallTimeoutMs: 20000,
  });
  ok('connects to the local MCP server', conn.ok === true && conn.tools.length >= 5);
  ok('tools are namespaced mcp__server__tool', conn.tools.every((t) => t.startsWith('mcp__jexitest__')));
  ok('namespaced tool visible on the plugin seam', listPluginTools().some((t) => t.slug === 'mcp__jexitest__get_health'));
  const health = await getPluginTool('mcp__jexitest__get_health').handler({});
  ok('namespaced tool callable (get_health)', health.ok === true && typeof health.output === 'string' && health.output.length > 0);
  const status = mcpServerStatus();
  ok('status lists the server', status.some((s) => s.serverName === 'jexitest' && s.status === 'connected'));
  const dup = await connectMcpServer({ serverName: 'jexitest', transport: 'streamable-http', url: `http://127.0.0.1:${port}/mcp`, failOnStartupError: true });
  ok('duplicate serverName rejected (no silent shadowing)', dup.ok === false);
  const disc = await disconnectMcpServer('jexitest');
  ok('disconnect unregisters tools', disc.ok === true && !listPluginTools().some((t) => t.slug.startsWith('mcp__jexitest__')));
  const missing = await disconnectMcpServer('jexitest');
  ok('disconnect of unknown server fails cleanly', missing.ok === false);
  server.close();
}

/* ═══════════════════════ 10. SANDBOX LOCAL ═══════════════════════ */
console.log('\n== 10. Sandbox local (dsh sandbox-local / e2b) ==');
{
  const { probeConfinement, sandboxTempDir, revokeSandboxTempDir, sandboxFacts, confine, bwrapProfileArgs } = await import('./src/services/SandboxLocal.js');
  const facts = probeConfinement();
  ok('probe reports platform + enforcement', facts.platform === process.platform && typeof facts.enforcement === 'string' && Array.isArray(facts.wrappers));
  ok('enforcement is either bwrap or the in-process fence', facts.enforcement === 'bwrap' || facts.enforcement === 'in-process');
  const t1 = sandboxTempDir('t-sandbox-a');
  const t2 = sandboxTempDir('t-sandbox-a');
  ok('per-session temp dir provisioned', t1.ok && t1.dir === t2.dir && fs.existsSync(t1.dir));
  const t3 = sandboxTempDir('t-sandbox-b');
  ok('sessions get SEPARATE private dirs', t3.ok && t3.dir !== t1.dir);
  const f = sandboxFacts('t-sandbox-a');
  ok('facts include temp dirs', f.tempDirs.some((d) => d.session.includes('t-sandbox-a')));
  const wrapped = confine(['ls'], { mode: 'workspace-write' });
  ok('confine returns argv either way (fail-closed semantics)', Array.isArray(wrapped.argv) && wrapped.argv.length >= 1);
  const prof = bwrapProfileArgs({ mode: 'workspace-write', workspaceRoot: '/ws' });
  ok('bwrap profile args for workspace-write', prof.includes('--bind') && prof.includes('/ws'));
  revokeSandboxTempDir('t-sandbox-a');
  ok('revoke removes the temp dir', !fs.existsSync(t1.dir));
  revokeSandboxTempDir('t-sandbox-b');
}

/* ═══════════════════════ 11. REGISTRY + PLUGIN BASH ═══════════════════════ */
console.log('\n== 11. Registry ralph + persistent plugin bash ==');
{
  const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('ralph in the registry', TOOL_REGISTRY.some((t) => t.slug === 'ralph'));
  ok('registry count is 206', TOOL_COUNT === 206);
  const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');
  ok('ralph has an output contract', hasOutputContract('ralph'));
  ok('ralph schema validates args', validateToolArgs('ralph', { objective: 'x' }).ok === true);
  const missing = validateToolArgs('ralph', {});
  ok('ralph requires objective', missing.ok === false);
  const badRalph = await executeTool({ slug: 'ralph', args: { objective: '  ' }, spillOwner: 't-ralph-exec' });
  ok('ralph engine fails cleanly on empty objective', badRalph.ok === false && badRalph.error && badRalph.error.length > 0);

  // Plugin seam: bash is now the PERSISTENT bash (owner = convId via meta).
  const { loadPlugins, setActivePluginContext: setCtx, listPluginTools } = await import('./src/services/PluginContext.js');
  const { ctx, failed } = await loadPlugins({ services: {} });
  setCtx(ctx);
  ok('plugins load clean', failed.length === 0);
  ok('bash still mounted as a plugin tool', listPluginTools().some((t) => t.slug === 'bash'));
  const parsed = (r) => { try { return typeof r.result === 'string' ? JSON.parse(r.result) : (r.result || r); } catch { return r; } };
  const p1 = await executeTool({ slug: 'bash', args: { command: 'echo persistent-1', description: 'test' }, spillOwner: 't-plug-bash' });
  ok('plugin bash runs (persistent engine)', p1.ok === true && String(parsed(p1).output || '').includes('persistent-1'));
  await executeTool({ slug: 'bash', args: { command: 'cd /tmp', description: 'cd' }, spillOwner: 't-plug-bash' });
  const p2 = await executeTool({ slug: 'bash', args: { command: 'pwd', description: 'pwd' }, spillOwner: 't-plug-bash' });
  ok('plugin bash state persists per conversation', p2.ok === true && String(parsed(p2).output || '').includes('/tmp'));
  const other = await executeTool({ slug: 'bash', args: { command: 'pwd', description: 'pwd' }, spillOwner: 't-plug-bash-other' });
  ok('other conversation starts fresh (no cross-owner bleed)', other.ok === true && !String(parsed(other).output || '').includes('/tmp'));
  const badBash = await executeTool({ slug: 'bash', args: { command: '(exit 7)', description: 'x' }, spillOwner: 't-plug-bash' });
  ok('plugin bash surfaces exit codes', badBash.ok === false && parsed(badBash).code === 7);
}

console.log(`\n${failures === 0 ? '🎉 ALL B135 CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
