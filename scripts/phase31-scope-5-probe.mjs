/**
 * JEXI OS — PHASE 31 SCOPE 5 — live probe (P1–P7).
 *
 * P1 server boots with all 8 Scope 5 targets initialized (Scope 1 + 3 lines intact)
 * P2 per-item end-to-end reachability with real call traces:
 *      W13        gatedDispatch invoked from the executor path; audit record written
 *      W14        AAS registered in mcp/registry.json; local stdio ping succeeds
 *      W29        doctor pre-flight checks reachable (agent-clis/mcp-registry/bundles)
 *      S4-N8N     n8n-mcp entry present in the registry (declarative, NOT live-verified)
 *      S4-EXEC    executable skills registered in server/src/skills catalog + REAL run
 *      S4-REPOCTX repo-map reachable from the session bootstrap context path
 *      W23c       forgejo-mcp entry present (live forge leg NOT VERIFIED — no credentials)
 *      W16        Phase 12 gates loop call sites located + reported (NOT WIRED — owner call)
 * P3 registry diff: mcp/registry.json additions only, zero removals
 * P4 read-only proof: shipped modules referenced by wired imports diff EMPTY
 *    except the named call sites (bootstrap, gated-dispatch extension, registry)
 * P5 regression: Scope 1 (15) + Scope 3 (7) W31 lines still present; /api/health 200
 * P6 zone check: git status --short only named call sites + scripts/phase31-*.mjs
 * P7 determinism: same boot twice -> identical W31 boot lines
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s5-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function health(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { status: res.status, body: await res.text() };
    } catch { /* not up yet */ }
    await pause(700);
  }
  return null;
}
function bootServer(port, runtimeDir, dataDir) {
  const logFile = path.join(TMP, `boot-${port}.log`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JEXI_W31_RUNTIME: runtimeDir, DATA_DIR: dataDir },
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
  });
  return { child, logFile };
}
const w31Lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('W31 '));
const normalize = (s, runtimeDir, dataDir) => s.split(runtimeDir).join('<RUNTIME>').split(dataDir).join('<DATA>').replace(/boot-\d+/g, 'boot-<pid>');

/* ============ in-process wiring instance for P2 (probe-owned runtime) ====== */
const { initPhase31Wiring, wiring } = await import(path.join(ROOT, 'server/src/wiring/phase31-bootstrap.js'));
const RT = path.join(TMP, 'probe-runtime');
const DT = path.join(TMP, 'probe-data');
fs.mkdirSync(RT, { recursive: true });
fs.mkdirSync(DT, { recursive: true });
const boot = initPhase31Wiring({ sessionId: `boot-${process.pid}`, runtimeRoot: RT, brainRoot: path.join(RT, 'brain'), fleetDir: path.join(RT, 'fleet'), observersRoot: path.join(RT, 'instincts-observe'), vikingRoot: path.join(RT, 'viking') });
const isS5 = (l) => /W31 (W13|W14|W29|S4-N8N|S4-EXEC|S4-REPOCTX|W23c|W16)/.test(l);
const isS3 = (l) => /W31 (S3-|W23e|W23f|WA4:)/.test(l);
const s5Lines = boot.log.filter(isS5);
const s3Lines = boot.log.filter(isS3);
const s1Lines = boot.log.filter((l) => !isS3(l) && !isS5(l));
check('P2.probe-init', s1Lines.length === 15 && s3Lines.length === 7 && s5Lines.length === 8 && !boot.log.some((l) => l.includes('FAIL-SOFT')),
  `probe boot: ${s1Lines.length} Scope-1 + ${s3Lines.length} Scope-3 + ${s5Lines.length} Scope-5 lines, 0 FAIL-SOFT`);
console.log(s5Lines.map((l) => `  ${l}`).join('\n'));

/* ================= P1 — server boots with all 8 targets ==================== */
console.log('\n== P1 server boots with all 8 Scope 5 targets initialized ==');
const PORT1 = 5100 + (process.pid % 400) * 2;
const rt1 = path.join(TMP, 'boot1-runtime');
const dt1 = path.join(TMP, 'boot1-data');
const b1 = bootServer(PORT1, rt1, dt1);
const h1 = await health(PORT1);
check('P1.server-up', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p1lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p1lines.length === 0 && !b1.child.killed; i++) { await pause(600); p1lines = w31Lines(b1.logFile); }
const p1s5 = p1lines.filter(isS5);
console.log(p1s5.map((l) => `  ${l}`).join('\n'));
check('P1.all-8-targets', p1s5.length === 8 && !p1lines.some((l) => l.includes('FAIL-SOFT')),
  `${p1s5.length}/8 Scope 5 boot lines on the live server, 0 FAIL-SOFT across all ${p1lines.length} W31 lines`);

/* ================= P2 — per-item end-to-end reachability =================== */
console.log('\n== P2 per-item reachability (end-to-end, consumer level) ==');

/* ---- W13: gatedDispatch invoked from the executor path; audit written ----- */
console.log('-- W13 --');
const { registerAllDomains } = await import(path.join(ROOT, 'server/src/tools/domains/index.js'));
const { readAudit } = await import(path.join(ROOT, 'skills/gates/state.js'));
const auditBefore = readAudit().length;
const dom = registerAllDomains();
const gx = wiring.gates.makeGatedExecutor({ engines: dom.engines, permissions: { allowAll: true, maxRisk: 'critical' } });
const r1 = await gx.execute({ id: 'w13-c1', name: 'fs_write', arguments: { path: 'w13-probe.txt', content: 'gated executor probe (Scope 5)' } }, { root: RT });
const r2 = await gx.execute({ id: 'w13-c2', name: 'fs_read', arguments: { path: 'w13-probe.txt' } }, { root: RT, action: 'push', stage: 'review' });
const auditNew = readAudit().slice(auditBefore);
console.log('  execute(fs_write) ->', JSON.stringify({ ok: r1.ok, gateAudit: r1.gateAudit }));
console.log('  execute(fs_read, ctx{action:push}) ->', JSON.stringify({ ok: r2.ok, gateAudit: r2.gateAudit }));
console.log('  audit records written this probe:');
console.log(auditNew.map((a) => `    ${JSON.stringify(a)}`).join('\n'));
const allowRecorded = auditNew.some((a) => a.action === 'audit:fs_write' && a.blocked === false);
const blockRecorded = auditNew.some((a) => a.gate === 'review-gate' && a.blocked === true);
check('P2.W13.executor-path-gated', r1.ok === true && r1.gateAudit && r1.gateAudit.verdict === 'allowed' && allowRecorded,
  `real tool executed through makeGatedExecutor; shipped gatedDispatch ran on the executor path (audit stub) and the allow verdict hit the shipped JSONL audit log`);
check('P2.W13.audit-only-default', r2.ok === true && r2.gateAudit && r2.gateAudit.verdict === 'blocked' && r2.gateAudit.gate === 'review-gate' && blockRecorded,
  'review-gate verdict = blocked (recorded, gate review-gate) yet the REAL call still executed — audit-only default; default-deny stays an owner call');

/* ---- W14: AAS registered + local stdio ping ------------------------------- */
console.log('-- W14 --');
const [aasEntry] = wiring.mcpRegistry.entries(['aas']);
console.log('  registry entry:', JSON.stringify({ name: aasEntry.name, command: aasEntry.command, args: aasEntry.args, enabled: aasEntry.enabled }));
const aas = spawn('node', ['skills/aas/mcp-server.js'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
let aasBuf = '';
aas.stdout.on('data', (d) => { aasBuf += d; });
aas.stderr.on('data', () => {});
await pause(1200);
aas.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'w31-probe', version: '1' } } }) + '\n');
aas.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
await pause(1500);
aas.kill();
const msgs = aasBuf.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const initMsg = msgs.find((m) => m.id === 1);
const toolsMsg = msgs.find((m) => m.id === 2);
const toolNames = toolsMsg && toolsMsg.result && toolsMsg.result.tools ? toolsMsg.result.tools.map((t) => t.name) : [];
console.log('  stdio ping: initialize ->', JSON.stringify(initMsg && initMsg.result && initMsg.result.serverInfo), '; tools/list ->', JSON.stringify(toolNames));
check('P2.W14.aas-stdio-live', !!aasEntry && aasEntry.enabled === true && !!initMsg && initMsg.result.serverInfo.name === 'jexi-aas' && toolNames.length === 4,
  `entry aas (enabled, stdio, node skills/aas/mcp-server.js) + REAL local stdio handshake: initialize ok, tools/list returned [${toolNames.join(', ')}]`);

/* ---- W29: doctor pre-flight checks reachable ------------------------------- */
console.log('-- W29 --');
const pf = await wiring.doctor.preflight();
console.log('  preflight ->', JSON.stringify({ overall: pf.overall, healthy: pf.healthy }));
console.log(pf.subsystems.map((s) => `    ${s.name}: ${s.status} — ${s.message}`).join('\n'));
const shapeOk = pf.subsystems.every((s) => 'name' in s && ['ok', 'warn', 'off', 'error'].includes(s.status) && 'message' in s);
const mcpSub = pf.subsystems.find((s) => s.name === 'mcp-registry');
const bunSub = pf.subsystems.find((s) => s.name === 'bundles');
check('P2.W29.preflight-reachable', shapeOk && mcpSub.status === 'ok' && bunSub.status === 'ok' && mcpSub.detail.servers === 56 && mcpSub.detail.enabled >= 15,
  `shipped doctor shape ({name,status,message,detail}); mcp-registry ok (${mcpSub.detail.servers} servers, ${mcpSub.detail.enabled} enabled); bundles ok (${bunSub.detail.packages} packages); agent-clis honest 'off' (no CLIs on PATH — env-dependent)`);

/* ---- S4-N8N: registry entry present ---------------------------------------- */
console.log('-- S4-N8N --');
const [n8nEntry] = wiring.mcpRegistry.entries(['n8n-mcp']);
console.log('  registry entry:', JSON.stringify({ name: n8nEntry.name, transport: n8nEntry.transport, command: `${n8nEntry.command} ${n8nEntry.args.join(' ')}`, enabled: n8nEntry.enabled, upstream: n8nEntry.upstream }));
check('P2.S4-N8N.entry-present', n8nEntry && n8nEntry.enabled === false && n8nEntry.transport === 'stdio' && !!n8nEntry.upstream,
  'declarative n8n-mcp entry present (enabled:false — NOT live-verified in sandbox; enable only on a provisioned host)');

/* ---- S4-EXEC: executable skills in the catalog + REAL run ------------------ */
console.log('-- S4-EXEC --');
const { catalog } = await import(path.join(ROOT, 'server/src/skills/catalog.js'));
const { readSkill } = await import(path.join(ROOT, 'server/src/skills/loader.js'));
const { pythonSkill } = await import(path.join(ROOT, 'skills/executable/python-skill.js'));
const cat = await catalog();
const execSt = wiring.executableSkills.status();
const meta = readSkill('test-hello');
const ran = await pythonSkill.run('skills/executable/test-hello', { name: 'scope-5-probe' });
console.log('  registrar status:', JSON.stringify({ registered: execSt.registered, skills: execSt.skills }));
console.log('  catalog entry:', JSON.stringify(cat['test-hello']));
console.log('  readSkill(test-hello):', JSON.stringify({ name: meta.name, version: meta.version, whenToUse: meta.whenToUse }));
console.log('  pythonSkill.run(test-hello):', JSON.stringify(ran).slice(0, 220));
check('P2.S4-EXEC.registered-and-loadable', execSt.registered && !!cat['test-hello'] && meta && meta.name === 'test-hello',
  `skills/executable joined the server catalog via its OWN plugin-skill seam (merged with PluginRegistry global): catalog lists test-hello, loader reads real frontmatter`);
check('P2.S4-EXEC.real-run', !!ran && ran.ok !== false && JSON.stringify(ran).includes('scope-5-probe'),
  `the REAL python skill executed (CPython -I -B): ${JSON.stringify(ran.result || ran).slice(0, 120)}`);

/* ---- S4-REPOCTX: repo-map reachable from the session bootstrap context path - */
console.log('-- S4-REPOCTX --');
const map1 = wiring.repoCtx.map();
const map2 = wiring.repoCtx.map();
console.log('  repoMap.build ->', JSON.stringify({ files: map1.files.length, tokens: map1.tokens, cache: map1.cache }), '-> second call cache:', map2.cache);
const { collectSources } = await import(path.join(ROOT, 'server/src/context/sources/index.js'));
const rm = await collectSources({}, {}, { only: ['repo-map'] });
console.log('  collectSources(repo-map) ->', JSON.stringify((rm[0] && rm[0].content || '').slice(0, 160)));
check('P2.S4-REPOCTX.bootstrap-reachable', map1.files.length > 0 && map1.tokens <= 1000 && map2.cache === 'hit' && rm[0] && rm[0].content.includes('Repo map (bounded'),
  `shipped repoMap.build over the server tree (bounded budget): ${map1.files.length} file(s), ~${map1.tokens} tokens, cache ${map1.cache}->${map2.cache}; the registered session-context source returns the real section (collectSources = the chat prompt pipeline)`);

/* ---- W23c: forgejo-mcp entry present (live leg NOT VERIFIED) ---------------- */
console.log('-- W23c --');
const [fjEntry] = wiring.mcpRegistry.entries(['forgejo-mcp']);
console.log('  registry entry:', JSON.stringify({ name: fjEntry.name, transport: fjEntry.transport, command: `${fjEntry.command} ${fjEntry.args.join(' ')}`, enabled: fjEntry.enabled }));
const forgejo = await import(path.join(ROOT, 'harness/hardening/forgejo/index.js'));
let refusal = null;
try {
  const out = await forgejo.dispatch('repo.get', { owner: 'probe', repo: 'probe' });
  refusal = out;
} catch (e) { refusal = { thrown: e.code || String(e.message).slice(0, 120) }; }
console.log(`  library surface reachable: TAXONOMY_TOTAL=${forgejo.TAXONOMY_TOTAL} tools; dispatch(repo.get) -> ${JSON.stringify(refusal)}`);
check('P2.W23c.entry-present', !!fjEntry && fjEntry.enabled === false && forgejo.TAXONOMY_TOTAL === 103 && refusal && refusal.ok === false,
  `declarative entry present (enabled:false — placeholder notes disclose: library surface, no stdio bridge, live forge leg W23d blocked by no-credentials); shipped toolset reachable: ${forgejo.TAXONOMY_TOTAL} tools, dispatch -> ${JSON.stringify(refusal)} (honest refusal, nothing faked) — live forge leg NOT VERIFIED`);

/* ---- W16: loop call sites located + reported (NOT WIRED) -------------------- */
console.log('-- W16 --');
const codingLoop = fs.readFileSync(path.join(ROOT, 'server/src/services/CodingLoop.js'), 'utf8');
const verifLoop = fs.readFileSync(path.join(ROOT, 'server/src/services/VerificationLoop.js'), 'utf8');
const gatesRefs = (t) => (t.match(/gatedDispatch|skills\/gates/g) || []).length;
console.log(`  CodingLoop.js: ${codingLoop.split('\n').length} lines, gates references: ${gatesRefs(codingLoop)}`);
console.log(`  VerificationLoop.js: ${verifLoop.split('\n').length} lines, gates references: ${gatesRefs(verifLoop)}`);
check('P2.W16.located-not-wired', gatesRefs(codingLoop) === 0 && gatesRefs(verifLoop) === 0,
  'Phase 12 gates loop call sites LOCATED: server/src/services/CodingLoop.js + VerificationLoop.js (ZONE-OWNER items 16/W16) — zero gates references today; both files are OUTSIDE this scope\'s named call sites -> reported, NOT WIRED (loop owner call)');

/* ================= P3 — registry diff: additions only ======================= */
console.log('\n== P3 registry diff: mcp/registry.json additions only ==');
const regDiff = execSync('git diff -- server/mcp/registry.json', { cwd: ROOT, encoding: 'utf8' });
const added = regDiff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
const removed = regDiff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
console.log(`  +${added.length} / -${removed.length} lines`);
console.log('  added entry names: ' + JSON.stringify(added.filter((l) => l.includes('"name"')).map((l) => l.trim())));
check('P3.registry-additions-only', added.length >= 50 && removed.length === 0,
  `mcp/registry.json: ${added.length} insertions, ${removed.length} removals — aas, n8n-mcp, forgejo-mcp appended, nothing removed`);

/* ================= P4 — read-only proof on shipped modules ================== */
console.log('\n== P4 read-only proof: shipped modules referenced by wired imports ==');
const shippedRefs = [
  'skills/gates/index.js', 'skills/gates/state.js', 'skills/gates/brainstorming-gate.js', 'skills/gates/planning-gate.js',
  'skills/gates/tdd-gate.js', 'skills/gates/review-gate.js',
  'server/src/tools/execution/executor.js', 'server/src/tools/registry/ToolRegistry.js',
  'server/src/tools/domains/index.js', 'server/src/tools/domains/filesystem/index.js',
  'server/src/services/PluginRegistry.js', 'server/src/skills/catalog.js', 'server/src/skills/loader.js',
  'services/semantica/repo-map/index.js', 'services/semantica/repo-map/rank.js', 'services/semantica/repo-map/summarize.js', 'services/semantica/repo-map/cache.js',
  'skills/executable/python-skill.js', 'skills/aas/mcp-server.js', 'skills/aas/catalog.js',
  'harness/hardening/forgejo/index.js', 'harness/hardening/forgejo/taxonomy.js', 'harness/hardening/forgejo/transport.js',
];
const numstat = execSync('git diff --numstat', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log('  git diff --numstat:');
console.log(numstat.map((l) => `    ${l}`).join('\n'));
const touched = numstat.map((l) => l.split('\t')[2]);
const namedCallSites = ['server/src/wiring/phase31-bootstrap.js', 'skills/gates/gated-dispatch.js', 'server/mcp/registry.json'];
const otherShippedDirty = shippedRefs.filter((f) => !namedCallSites.includes(f) && touched.includes(f));
const gdDiff = execSync('git diff -- skills/gates/gated-dispatch.js', { cwd: ROOT, encoding: 'utf8' });
console.log('  skills/gates/gated-dispatch.js diff (named call site — approved extension):');
console.log(gdDiff.split('\n').map((l) => `    | ${l}`).join('\n'));
check('P4.shipped-internals-empty', otherShippedDirty.length === 0,
  `every shipped module referenced by wired imports diff EMPTY (violations: ${JSON.stringify(otherShippedDirty)}); the 3 dirty tracked files are exactly the named call sites`);
const gdRemovals = gdDiff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
check('P4.gated-dispatch-extension-only', gdRemovals.length === 0 && gdDiff.includes('+import { registerExecutorGate }') && gdDiff.includes('+registerExecutorGate(gatedDispatch);'),
  'gated-dispatch.js = 1 wiring import + 1 register call, ZERO removals (blocking dispatch untouched, default-deny untouched)');

/* ================= P5 — regression ========================================== */
console.log('\n== P5 regression: Scope 1 + Scope 3 lines intact, health 200 ==');
const p1s1 = p1lines.filter((l) => !isS3(l) && !isS5(l));
const p1s3 = p1lines.filter(isS3);
check('P5.scopes-intact', p1s1.length === 15 && p1s3.length === 7 && !!h1 && h1.status === 200,
  `boot1: ${p1s1.length}/15 Scope 1 lines + ${p1s3.length}/7 Scope 3 lines verbatim; GET /api/health -> ${h1 ? h1.status : 'n/a'}`);

/* ================= P6 — zone check ========================================== */
console.log('\n== P6 zone check ==');
const status = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log(status.map((l) => `  ${JSON.stringify(l)}`).join('\n'));
const allowed = (l) => {
  const p = l.replace(/^(.{1,2})\s+/, '');
  return ['server/src/wiring/phase31-bootstrap.js', 'skills/gates/gated-dispatch.js', 'server/mcp/registry.json',
    'server/src/wiring/phase31-registries.js', 'server/src/wiring/phase31-repoctx.js'].includes(p)
    || p.startsWith('server/src/capability/')
    || p.startsWith('server/src/skills/')
    || p.startsWith('scripts/phase31-');
};
check('P6.zone', status.length > 0 && status.every(allowed), `${status.length} entries, all inside named call sites + scripts/phase31-*.mjs`);

/* ================= P7 — determinism ========================================= */
console.log('\n== P7 determinism: same boot twice -> identical W31 boot lines ==');
const PORT2 = PORT1 + 1;
const b2 = bootServer(PORT2, path.join(TMP, 'boot2-runtime'), path.join(TMP, 'boot2-data'));
const h2 = await health(PORT2);
let p7lines = w31Lines(b2.logFile);
for (let i = 0; i < 10 && p7lines.length === 0 && !b2.child.killed; i++) { await pause(600); p7lines = w31Lines(b2.logFile); }
const norm1 = p1lines.map((l) => normalize(l, rt1, dt1));
const norm2 = p7lines.map((l) => normalize(l, path.join(TMP, 'boot2-runtime'), path.join(TMP, 'boot2-data')));
const identical = norm1.length === norm2.length && norm1.every((l, i) => l === norm2[i]);
console.log(`  boot1 ${norm1.length} lines vs boot2 ${norm2.length} lines -> ${identical ? 'IDENTICAL' : 'DIFFERENT'}`);
if (!identical) {
  for (let i = 0; i < Math.max(norm1.length, norm2.length); i++) {
    if (norm1[i] !== norm2[i]) console.log(`    diff @${i}:\n      boot1: ${norm1[i]}\n      boot2: ${norm2[i]}`);
  }
}
check('P7.deterministic-boot', !!h2 && identical, 'two boots -> byte-identical W31 boot lines (modulo runtime/data path and pid)');
b2.child.kill('SIGTERM');
b1.child.kill('SIGTERM');
await Promise.race([new Promise((r) => b2.child.once('exit', r)), pause(8000)]);

/* ================= summary ================================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} checks pass ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
console.log(`probe runtime: ${TMP}`);
process.exit(FAILS.length ? 1 : 0);
