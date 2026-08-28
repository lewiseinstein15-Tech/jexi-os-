/**
 * B144 — PULL-COMPLETENESS TEST ("Make sure you have pulled every plugin
 * and everything else").
 *
 *   Manifest completeness   → all 229 DSH packages tracked (227 upstream + 2 retained ports), 100% ported
 *   session-query packages  → SessionQuery.js (log/export/sqlite/search)
 *   util/brand              → Brand.js
 *   util/output-retention   → OutputRetention.js
 *   util/native-command     → NativeCommand.js
 *   web/web-search-*        → WebSearchProviders.js
 *   compaction-tool-result-pruner → ToolResultPruner.js
 *   fs/tool-fs-search       → fs_search plugin tool
 *   boot/cmdline            → cli.js parseCliArgs
 *   test-support/acp-snapshot → test-support/acp-snapshot.js
 */

import fs from 'fs';
import path from 'path';

let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures += 1;
};

const SERVER_DIR = process.cwd();

/* ══════════════ 1. MANIFEST COMPLETENESS ══════════════ */
console.log('\n== 1. Manifest completeness (every DSH package tracked) ==');
{
  const { bundleStatus } = await import('./src/services/BundleBase.js');
  const st = bundleStatus();
  ok('manifest tracks ALL 229 packages', st.counts.total === 229);
  ok('every package ported (0 partial, 0 not-yet)', st.counts.ported === 229 && st.counts.partial === 0 && st.counts.notYet === 0);
  const names = st.packages.map((p) => p.package);
  ok('package names unique', new Set(names).size === names.length);
  ok('no wildcard entries (every name is a real DSH package)', !names.some((n) => n.includes('*')));
  const missingPorts = st.packages.filter((p) => !p.port);
  ok('every entry has a JEXI port', missingPorts.length === 0);
  // Spot-check the previously-missing areas are now tracked.
  for (const pkg of ['session-query/session-query', 'session-query/session-log-export', 'session-query/session-query-sqlite', 'session-query/tool-session-query', 'util/brand', 'util/native-command', 'util/output-retention', 'fs/tool-fs-search', 'compaction/compaction-tool-result-pruner', 'web/web-search-exa', 'core/system-prompt', 'client/ui-slots', 'boot/cmdline', 'test-support/acp-snapshot']) {
    ok(`tracked: ${pkg}`, names.includes(pkg));
  }
  const parity = fs.readFileSync(path.join(SERVER_DIR, '..', 'DSH-PARITY.md'), 'utf-8');
  ok('parity doc says 229/100%', parity.includes("229") && parity.includes('100%'));
  // Manifest file itself parses and matches the generator shape.
  const manifest = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'bundles', 'manifest.json'), 'utf-8'));
  ok('manifest file has 229 packages', manifest.packages.length === 229);
}

/* ══════════════ 2. SESSION QUERY ══════════════ */
console.log('\n== 2. Session query (log/export/sqlite/search) ==');
{
  const { querySessionLog, exportSessionLog, querySessionSqlite, searchSessions } = await import('./src/services/SessionQuery.js');
  const { appendConversationEvent } = await import('./src/services/SessionConversations.js');
  const conv = `t-sq-b144-${Date.now()}`;
  for (let i = 1; i <= 5; i += 1) {
    appendConversationEvent(conv, { role: 'user', text: `q${i}`, kind: 'chat' });
    appendConversationEvent(conv, { role: 'jexi', text: `a${i}`, kind: 'chat' });
  }
  const all = querySessionLog(conv, {});
  ok('query all events', all.ok && all.count === 10);
  const users = querySessionLog(conv, { role: 'user' });
  ok('query by role', users.ok && users.count === 5 && users.events.every((e) => e.role === 'user'));
  const kinds = querySessionLog(conv, { kind: 'chat' });
  ok('query by kind', kinds.ok && kinds.count === 10);
  const after = querySessionLog(conv, { afterSeq: 6 });
  ok('query after seq', after.ok && after.events.every((e) => e.seq > 6) && after.count >= 1);
  const limited = querySessionLog(conv, { limit: 3 });
  ok('query limit', limited.ok && limited.count === 3);
  const exported = exportSessionLog(conv);
  ok('export jsonl', exported.ok && exported.format === 'jsonl' && exported.lines >= 10 && exported.content.includes('q1'));
  const sqlite = querySessionSqlite(conv, {});
  ok('sqlite query honest (available or not)', sqlite.ok === true || (sqlite.ok === false && /not available/.test(sqlite.error)));
  const found = searchSessions('q1');
  ok('search sessions', found.ok === true && Array.isArray(found.results));
  ok('search requires query', searchSessions('').ok === false);
  ok('query missing conv fails cleanly', querySessionLog('').ok === false);
}

/* ══════════════ 3. BRAND + OUTPUT RETENTION + NATIVE COMMAND ══════════════ */
console.log('\n== 3. Brand + retention + native command ==');
{
  const { BRAND, brandIdentity, brandName, brandTagline } = await import('./src/services/Brand.js');
  ok('brand constants', BRAND.name === 'JEXI OS' && BRAND.envHome === 'JEXI_HOME' && BRAND.defaultBackendPort === 3002);
  ok('brand helpers', brandName() === 'JEXI OS' && brandTagline().length > 0 && brandIdentity().includes('JEXI OS'));

  const { retainHeadTail, retainTail, retentionStatus, RETENTION_BUDGETS } = await import('./src/services/OutputRetention.js');
  ok('budgets defined', RETENTION_BUDGETS.toolOutput === 12000 && RETENTION_BUDGETS.spillThreshold === 14000);
  const big = 'x'.repeat(10000);
  const kept = retainHeadTail(big, 1000);
  ok('head-tail keeps both ends', kept.truncated === true && kept.text.startsWith('xxx') && kept.text.endsWith('xxx') && kept.text.includes('clipped'));
  const tail = retainTail('hello world', 5);
  ok('tail retention', tail.truncated === true && tail.text === 'world');
  ok('no truncation under budget', retainHeadTail('small', 1000).truncated === false);
  ok('status shape', retentionStatus().ok === true);

  const { runNativeCommand } = await import('./src/services/NativeCommand.js');
  const okRun = await runNativeCommand('node', ['-e', 'console.log("native-144")'], { timeoutMs: 10000 });
  ok('native command runs', okRun.ok === true && okRun.output.includes('native-144'));
  const failRun = await runNativeCommand('node', ['-e', 'process.exit(3)'], { timeoutMs: 10000 });
  ok('native command exit code', failRun.ok === false && failRun.code === 3);
  const noCmd = await runNativeCommand('', []);
  ok('native command requires command', noCmd.ok === false);
  const missingBin = await runNativeCommand('/nonexistent-bin-xyz', [], { timeoutMs: 5000 });
  ok('native command missing bin honest', missingBin.ok === false && missingBin.error);
}

/* ══════════════ 4. WEB SEARCH PROVIDERS + TOOL RESULT PRUNER ══════════════ */
console.log('\n== 4. Web providers + tool result pruner ==');
{
  const { webSearchProviderStatus } = await import('./src/services/WebSearchProviders.js');
  // B164 — the static table became the LIVE seam registry (15 providers:
  // DSH trio + datacenter-proof keyless + HTML engines + verticals).
  const live = webSearchProviderStatus().search;
  ok('live provider registry has 15 search providers', live.length >= 15);
  ok('keyed providers present', live.some((p) => p.id === 'exa') && live.some((p) => p.id === 'perplexity') && live.some((p) => p.id === 'deepseek-official'));
  const st = webSearchProviderStatus();
  ok('status shape (B164 live seam)', st.ok && st.search.length >= 15 && st.fetch.length >= 1 && typeof st.resolvedSearch === 'string');

  const { pruneToolResult } = await import('./src/services/ToolResultPruner.js');
  const small = pruneToolResult({ text: 'tiny', convId: 't-prune' });
  ok('small result passes through', small.spilled === false && small.text === 'tiny');
  const huge = pruneToolResult({ text: 'y'.repeat(20000), convId: 't-prune' });
  ok('oversized result pruned with locator', huge.spilled === true && (huge.locator || huge.truncated === true));
}

/* ══════════════ 5. FS SEARCH TOOL ══════════════ */
console.log('\n== 5. fs_search tool (dsh fs/tool-fs-search) ==');
{
  const { loadPlugins, setActivePluginContext, getPluginTool } = await import('./src/services/PluginContext.js');
  const { ctx, failed } = await loadPlugins({ services: {} });
  setActivePluginContext(ctx);
  ok('plugins load', failed.length === 0);
  ok('fs_search mounted', !!getPluginTool('fs_search'));
  // The coding plugin resolves the workspace from config at import time, so
  // search the REAL workspace dir (unique file names, cleaned up after).
  const wsDir = path.join(SERVER_DIR, 'jexi-workspace');
  fs.mkdirSync(wsDir, { recursive: true });
  const alpha = path.join(wsDir, 'alpha-fssearch-144.txt');
  const beta = path.join(wsDir, 'beta-fssearch-144.md');
  fs.writeFileSync(alpha, 'hello secret-content-144\n');
  fs.writeFileSync(beta, 'other\n');
  try {
    const byName = await getPluginTool('fs_search').handler({ name: 'alpha-fssearch-144' });
    ok('search by name', byName.ok === true && byName.count === 1 && byName.results[0].name === 'alpha-fssearch-144.txt');
    const byContent = await getPluginTool('fs_search').handler({ query: 'secret-content' });
    ok('search by content', byContent.ok === true && byContent.count === 1 && byContent.results[0].path.includes('alpha-fssearch-144.txt'));
    const both = await getPluginTool('fs_search').handler({ name: 'beta-fssearch', query: 'other' });
    ok('search by name+content', both.ok === true && both.count === 1);
    const none = await getPluginTool('fs_search').handler({ query: 'zzz-none' });
    ok('no matches → count 0', none.ok === true && none.count === 0);
    const bad = await getPluginTool('fs_search').handler({});
    ok('requires name or query', bad.ok === false);
  } finally {
    try { fs.unlinkSync(alpha); } catch { /* noop */ }
    try { fs.unlinkSync(beta); } catch { /* noop */ }
  }
}

/* ══════════════ 6. CMDLINE + ACP SNAPSHOT ══════════════ */
console.log('\n== 6. Cmdline + acp snapshot ==');
{
  const { parseCliArgs } = await import('./cli.js');
  const parsed = parseCliArgs(['--json', '--conv', 'abc', '--port=3999', 'hello world']);
  ok('flags parsed', parsed.options['--json'] === true);
  ok('valued flags parsed (space + equals)', parsed.options['--conv'] === 'abc' && parsed.options['--port'] === '3999');
  ok('positional preserved', parsed.positional.join(' ') === 'hello world');

  const { createAcpSnapshot } = await import('./test-support/acp-snapshot.js');
  const snap = createAcpSnapshot({ max: 10 });
  const out = await snap.capture(async () => ({ ok: true }), { method: 'tools/list', id: 1 });
  ok('capture returns result + records', out.ok === true && snap.count() === 1 && snap.entries()[0].method === 'tools/list');
  let threw = false;
  try {
    await snap.capture(async () => { throw Object.assign(new Error('boom'), { code: -32603 }); }, { method: 'fail', id: 2 });
  } catch { threw = true; }
  ok('capture records errors and rethrows', threw === true && snap.entries()[1].error.code === -32603);
  const exported = snap.export();
  ok('export json', JSON.parse(exported).count === 2);
  snap.clear();
  ok('clear resets', snap.count() === 0);
}

/* ══════════════ 7. INTEGRATION ══════════════ */
console.log('\n== 7. Integration ==');
{
  const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
  ok('registry stable at 218', TOOL_COUNT === 218); // fs_search is a plugin tool, not registry
  const { assemblePrompt } = await import('./src/services/PromptAssembly.js');
  ok('prompt assembles', (await assemblePrompt({ convId: 't-int-b144' })).length > 500);
  const { listPluginTools } = await import('./src/services/PluginContext.js');
  ok('plugin tools ≥14 (fs_search added)', listPluginTools().length >= 14);
}

console.log(`\n${failures === 0 ? '🎉 ALL B144 COMPLETENESS CHECKS PASSED' : `💥 ${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
