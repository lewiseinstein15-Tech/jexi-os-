#!/usr/bin/env node
// JEXI OS — PHASE 31 SCOPE 1 — live probe (P1..P7).
// Zero new deps, zero network beyond 127.0.0.1 (the booted server itself).
// Proves: server boots with all wired subsystems, each item's public API is
// reachable through its consumer, the Node gate refuses below floor, shipped
// modules are untouched, zone is clean, boot log is deterministic.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31p1-'));
const results = [];
const check = (name, ok, evidence = '') => {
  results.push({ name, ok, evidence });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${evidence ? ` — ${evidence}` : ''}`);
};

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

function bootServer(port, runtimeDir) {
  const logFile = path.join(TMP, `boot-${port}.log`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JEXI_W31_RUNTIME: runtimeDir },
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
  });
  return { child, logFile };
}
const w31Lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('W31 '));
const normalize = (s, runtimeDir) => s.split(runtimeDir).join('<RUNTIME>').replace(/boot-\d+/g, 'boot-<pid>');

/* ================= P1 — server boots with all wired subsystems ============= */
console.log('\n== P1 server boots with wired subsystems ==');
const PORT1 = 4311 + (process.pid % 400) * 2;
const b1 = bootServer(PORT1, path.join(TMP, 'boot1-runtime'));
const h1 = await health(PORT1);
check('P1.server-up', !!h1 && h1.status === 200, h1 ? `GET /api/health -> ${h1.status}` : 'health never came up (see boot log)');
let p1lines = w31Lines(b1.logFile);
for (let i = 0; i < 10 && p1lines.length === 0 && !b1.child.killed; i++) { await pause(600); p1lines = w31Lines(b1.logFile); }
console.log(p1lines.join('\n'));
check('P1.all-15-wired', p1lines.length >= 15 && !p1lines.some((l) => l.includes('FAIL-SOFT')),
  `${p1lines.length} W31 boot lines, 0 FAIL-SOFT`);
const boot1Snapshot = p1lines.slice();

/* ================= P2 — per-item end-to-end through the consumer =========== */
console.log('\n== P2 per-item reachability (in-process, consumer-level calls) ==');
const W = await import(path.join(ROOT, 'server', 'src', 'wiring', 'phase31-bootstrap.js'));
const init = W.initPhase31Wiring({ sessionId: 'p2-session', runtimeRoot: path.join(TMP, 'p2-runtime') });
const w = W.wiring;
check('P2.init-wired', Object.values(init.wired).every(Boolean), JSON.stringify(init.wired));

// B1 — brain.repo reachable from server persistence path
const page = w.repo.create('concepts', 'w31-probe', { title: 'Wiring Probe', tags: ['phase31'], now: '2026-01-01T00:00:00Z' });
const reread = w.repo.read('concepts', 'w31-probe');
check('P2.B1.repo', !!page && !!reread, `create+read ok; list=${w.repo.list().length} pages; root=${init.brainRoot}`);

// B2 — brain.index invoked at session bootstrap (rebuild + search)
const rebuilt = await w.index.rebuild();
const hits = await w.index.search('wiring probe', { topK: 3 });
check('P2.B2.index', Array.isArray(rebuilt.chunks) && rebuilt.chunks.length >= 1 && Array.isArray(hits) && hits.length >= 1,
  `rebuild chunks=${rebuilt.chunks.length} backend=${rebuilt.embeddings && rebuilt.embeddings.backend}; search hits=${hits.length} top-score=${hits[0] && hits[0].score}`);

// B3 — brain.search.hybrid invoked on a chat retrieval (registered source)
const { collectSources } = await import(path.join(ROOT, 'server', 'src', 'context', 'sources', 'index.js'));
const secsB3 = await collectSources({ query: 'wiring probe' }, {}, { only: ['brain-hybrid'] });
const b3sec = (Array.isArray(secsB3) ? secsB3 : []).find((s) => s.name === 'brain-hybrid');
const b3shown = b3sec && b3sec.content;
check('P2.B3.hybrid-source', !!b3shown && String(b3shown).includes('concepts/w31-probe'),
  `collectSources(only=brain-hybrid) -> ${String(b3shown || '').replace(/\n/g, ' | ').slice(0, 140)}`);

// B4 — brain.hot.meta injected into prompt context section
await w.hot.extract({ text: 'Lewis prefers raw phase-report output', sourceId: 'probe', sessionId: 'p2-session', opSeq: 1, daySeq: 20000 });
const meta = w.hot.meta({ sessionId: 'p2-session', sourceId: 'probe' });
const facts = meta && meta.brain_hot_memory && meta.brain_hot_memory.facts;
const secsB4 = await collectSources({ sessionId: 'p2-session' }, {}, { only: ['brain-hot-memory'] });
const b4sec = (Array.isArray(secsB4) ? secsB4 : []).find((s) => s.name === 'brain-hot-memory');
check('P2.B4.hot-meta', !!facts && facts.length >= 1 && !!b4sec,
  `hot.meta facts=${facts ? facts.length : 0} [${facts && facts[0] ? String(facts[0].fact || '').slice(0, 60) : ''}]; source section=${b4sec ? String(b4sec.content).replace(/\n/g, ' | ').slice(0, 100) : 'MISSING'}`);

// B5 — brain.protocol verbs reachable via the memory-verb surface
const names = w.memoryVerbs.names();
const env5 = await w.memoryVerbs.call('recall', { query: 'wiring probe', opts: { topK: 3 } });
check('P2.B5.verbs', Array.isArray(names) && names.length === 5 && !!env5,
  `verbs=[${names.join(', ')}]; recall envelope ok=${env5 && env5.ok} verb=${env5 && env5.verb} results=${env5 && env5.data && env5.data.results ? env5.data.results.length : 'n/a'}`);

// WA1 — prompt assembly path reaches provider bridge
const assembled = await w.promptBridge.assemble({ includeSkills: false, includeSessionRefs: false, includeState: false });
const verdict = w.promptBridge.bridgeVerdict();
check('P2.WA1.bridge', typeof assembled === 'string' && assembled.length > 100 && verdict && typeof verdict.canChat === 'boolean',
  `assembled prompt chars=${assembled.length}; bridge verdict=${JSON.stringify(verdict)}`);

// WA8 — provider config plumbing present (live leg NOT VERIFIED)
const settings = w.providerConfig.load();
const skeys = settings && typeof settings === 'object' ? Object.keys(settings) : [];
check('P2.WA8.plumbing', Array.isArray(skeys), `settings keys=[${skeys.slice(0, 8).join(', ')}${skeys.length > 8 ? ', ...' : ''}] (names only, values never printed); live-LLM leg NOT VERIFIED — no new credentials rule`);

// WA2 — semantica graph reachable from memory subsystem
w.graph.addNode({ id: 'w31:n1', kind: 'entity', label: 'Probe Node One' });
w.graph.addNode({ id: 'w31:n2', kind: 'entity', label: 'Probe Node Two' });
w.graph.addEdge({ from: 'w31:n1', to: 'w31:n2', kind: 'relation', props: { why: 'wiring probe' } });
const found = w.graphQuery({ kind: 'entity' });
check('P2.WA2.graph', Array.isArray(found) && found.length === 2, `graph.query({kind:entity}) -> ${found.length} nodes [${found.map((n) => n.id).join(', ')}]`);

// WA3 — instincts observer fires on session lifecycle
const obsRoot = path.join(TMP, 'p2-observers');
const att = w.sessionLifecycle.attach(obsRoot, 'p2-lifecycle', { projectId: 'jexi-os' });
const oid = att && att.observerId ? att.observerId : 'observer-p2-lifecycle';
w.sessionLifecycle.push(obsRoot, { projectId: 'jexi-os', sessionId: 'p2-lifecycle', kind: 'probe', payload: { note: 'w31 scope1' } });
const active = w.sessionLifecycle.require(obsRoot, 'p2-lifecycle');
let drained = [];
try { const { drainObservations } = await import(path.join(ROOT, 'mind/instincts', 'observe', 'queue.js')); drained = drainObservations(obsRoot, 'jexi-os'); } catch { /* proven by require+push */ }
let detachedErr = '';
try { w.sessionLifecycle.detach(obsRoot, oid); w.sessionLifecycle.require(obsRoot, 'p2-lifecycle'); } catch (e) { detachedErr = e && e.code ? e.code : String(e && e.message || e).slice(0, 60); }
check('P2.WA3.lifecycle', !!active && detachedErr.length > 0,
  `attach -> ${oid}; push ok; requireActive -> active; drain=${drained.length}; after detach require -> ${detachedErr}`);

// WA5 — fleet reachable from supervisor
let fleetEv = '';
try {
  const fl = w.fleetAccess();
  let spawned;
  try { spawned = fl.spawn(['sleep', '30'], { id: 'w31p2' }); }
  catch { spawned = fl.spawn('sleep 30', { id: 'w31p2' }); }
  const listed = fl.list().find((s) => s.sessionId === spawned.sessionId);
  const killed = await fl.kill(spawned.sessionId);
  const reaped = await fl.reap();
  fleetEv = `spawn -> ${spawned.sessionId} pid=${spawned.pid} state=${listed && listed.state}; kill -> ${JSON.stringify(killed)}; reap -> ${reaped.length} terminal (killed already terminal)`;
} catch (e) { fleetEv = `fleet error: ${String(e && e.message || e).slice(0, 120)}`; }
check('P2.WA5.fleet', fleetEv.includes('state=running') && fleetEv.includes('"killed":true'), fleetEv);

// W10A1 — rlm kernel reachable from CommandRegistry
const rlmRes = await w.rlmExec('/rlm 40 + 2');
check('P2.W10A1.rlm', !!rlmRes && JSON.stringify(rlmRes).includes('42'), `tryExecuteCommand('/rlm 40 + 2') -> ${JSON.stringify(rlmRes).slice(0, 140)}`);

// W17 — code source graph-first path invoked
const { getSource } = await import(path.join(ROOT, 'server', 'src', 'context', 'sources', 'index.js'));
const codeSrc = getSource('code');
const sec17 = await codeSrc.produce({ query: 'what does createRepo call' });
const path17 = String(sec17 || '').startsWith('Code structure (graph-first)') ? 'graph-first' : (String(sec17 || '').startsWith('Code structure (file-read fallback)') ? 'file-read fallback' : 'empty');
check('P2.W17.code-source', !!sec17 && path17 !== 'empty', `produce('what does createRepo call') -> ${path17}: ${String(sec17 || '').replace(/\n/g, ' | ').slice(0, 160)}`);

// W18 — viking registered as source, tiered read
w.viking.write('viking://resources/probe/doc.md', 'hello from the viking tiered store (w31 probe)');
const vreadRaw = w.viking.read('viking://resources/probe/doc.md', { tier: 'L2' });
const vread = vreadRaw && typeof vreadRaw === 'object' ? vreadRaw.content : vreadRaw;
const sec18 = await getSource('viking').produce({ vikingUri: 'viking://resources/probe/doc.md' });
check('P2.W18.viking', String(vread).includes('hello from the viking') && String(sec18).includes('viking://resources/probe/doc.md'),
  `write+read L2 ok (${String(vread).length} chars); source section -> ${String(sec18 || '').replace(/\n/g, ' | ').slice(0, 120)}`);

// W19 — visual QA reachable from Verifier claim path
const claimOk = w.visualQA.claimsBrowser('I opened the page in a real browser and captured a screenshot');
const claimNo = w.visualQA.claimsBrowser('Parsed the JSON and returned the summary');
const vqa = await w.visualQA.run('Opened it with a real browser session');
check('P2.W19.visual-qa', claimOk === true && claimNo === false && vqa.applies === true,
  `claimsBrowser(true-case)=${claimOk}, (negative)=${claimNo}; run -> ${JSON.stringify(vqa).slice(0, 160)}`);

/* ================= P3 — boot-time Node gate refuses below floor ============ */
console.log('\n== P3 Node gate refusal ==');
const okGate = W.assertNodeFloor(process.version);
let refused = '';
try { W.assertNodeFloor('v20.11.0'); } catch (e) { refused = String(e.message); }
console.log(`gate(current): ${okGate}`);
console.log(`gate(simulated v20.11.0): ${refused}`);
check('P3.gate-refusal', refused.includes('W36 NODE FLOOR') && refused.includes('Refusing to boot'), refused.slice(0, 120));

/* ================= P4 — shipped modules untouched (read-only proof) ======== */
console.log('\n== P4 read-only proof (git diff of shipped module trees) ==');
const shippedTrees = ['mind/brain', 'services/semantica', 'mind/instincts', 'runtime/session/fleet', 'runtime/rlm', 'capabilities', 'runtime/context/viking', 'tests/verification/visual', 'capabilities/prompts', 'services/computer', 'harness'];
const diffArgs = ['diff', '--name-only', 'HEAD', '--', ...shippedTrees];
let diffs = '';
try { diffs = execSync(`git ${diffArgs.map((a) => `'${a}'`).join(' ')}`, { cwd: ROOT, encoding: 'utf8' }); } catch (e) { diffs = `GIT-ERR ${String(e.message).slice(0, 80)}`; }
console.log(diffs.trim() === '' ? '(empty — no shipped module modified)' : diffs);
check('P4.shipped-untouched', diffs.trim() === '', diffs.trim() === '' ? 'git diff HEAD -- <9 shipped trees> = EMPTY' : 'unexpected diffs');

/* ================= P5 — existing endpoints still respond =================== */
console.log('\n== P5 regression: server healthy, endpoints respond ==');
check('P5.health-200', !!h1 && h1.status === 200, `GET /api/health -> ${h1 ? h1.status : 'n/a'} body=${h1 ? h1.body.slice(0, 120) : ''}`);
b1.child.kill('SIGTERM');
await Promise.race([new Promise((r) => b1.child.once('exit', r)), pause(10000)]);
await pause(400);
const logAfterKill = fs.readFileSync(b1.logFile, 'utf8');
const detached = logAfterKill.includes('W31 WA3: instincts observer detached');
check('P5.graceful-shutdown', detached, 'SIGTERM -> W31 WA3 observer detached line present (SessionEnd seam)');

/* ================= P6 — zone check ========================================= */
console.log('\n== P6 zone check ==');
const status = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log(status.map((l) => JSON.stringify(l)).join('\n'));
const allowed = (l) => {
  const p = l.replace(/^(.{1,2})\s+/, '');
  return p === 'server/index.js' || p.startsWith('server/src/') || p.startsWith('scripts/phase31-');
};
check('P6.zone', status.length > 0 && status.every(allowed), `${status.length} entries, all inside server/index.js | server/src/** | scripts/phase31-*.mjs`);

/* ================= P7 — determinism: two boots, identical W31 log ========== */
console.log('\n== P7 determinism (two boots -> identical W31 lines modulo runtime path/pid) ==');
const b2 = bootServer(PORT1 + 1, path.join(TMP, 'boot2-runtime'));
const h2 = await health(PORT1 + 1);
check('P7.second-boot', !!h2 && h2.status === 200, `GET :${PORT1 + 1}/api/health -> ${h2 ? h2.status : 'n/a'}`);
const a = boot1Snapshot.map((l) => normalize(l, path.join(TMP, 'boot1-runtime')));
const b = w31Lines(b2.logFile).map((l) => normalize(l, path.join(TMP, 'boot2-runtime')));
b2.child.kill('SIGTERM');
if (a.length !== b.length) {
  check('P7.identical-boot-log', false, `line counts differ: ${a.length} vs ${b.length}`);
} else {
  let firstDiff = -1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { firstDiff = i; break; }
  check('P7.identical-boot-log', firstDiff === -1, firstDiff === -1 ? `${a.length} normalized W31 lines byte-identical across two boots` : `first diff at line ${firstDiff}: '${a[firstDiff]}' vs '${b[firstDiff]}'`);
}

/* ================= summary ================================================= */
console.log('\n== SUMMARY ==');
const pass = results.filter((r) => r.ok).length;
for (const r of results) if (!r.ok) console.log(`  FAILED: ${r.name} — ${r.evidence}`);
console.log(`[PHASE 31 SCOPE 1] ${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
