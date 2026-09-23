#!/usr/bin/env node
/**
 * JEXI OS — PHASE 31 SCOPE 17 — live-path readiness probe.
 *
 * S17-P1  Part A: loader fix — diff shown; adapter cfg populated;
 *         isConfigured() true with a keyRef-shaped env value, false absent.
 *         No key values are ever printed (cfg keys are env-var NAMES).
 * S17-P2  Part B: scope-3 probe re-run on this env -> exit 0; the probe's
 *         own diff (stale assertions replaced) shown raw.
 * S17-P3  Part C: 16.5 probe on the reference Node — plain run (node:sqlite
 *         unflagged) AND the NODE_OPTIONS=--experimental-sqlite run
 *         (child-process-scoped env only; the host env is never mutated).
 * S17-P4  Part D: GAIA — keys checked by NAME only. Keys absent -> the
 *         bundled 6-task fixture runs through the SAME entry point the live
 *         run uses (gaia.run) with the disclosed deterministic stub; the
 *         live HF loader path is proven to refuse honestly without a fetch.
 *         Live leg reported NOT VERIFIED — no keys on host.
 * S17-P6  Boot + /api/health 200 + W31 boot lines == live in-process count.
 * S17-P7  Zone check: only named call sites + scripts/phase31-*.mjs dirty.
 *
 * (S17-P5, the chunked regression suite, runs standalone — its full output
 * is reported beside this probe.)
 *
 * Zero dependencies. No network (except the server's own loopback health).
 * No env vars are set on the host; no credentials are touched.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s17-probe-'));
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
const runChild = (label, args, extraEnv = {}, timeoutMs = 480000) =>
  new Promise((resolve) => {
    const logFile = path.join(TMP, `${label}.log`);
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
    });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, logFile }); });
  });
const tail = (file, lines = 12) => {
  const all = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  return all.slice(-lines).join('\n');
};

console.log(`node ${process.version} — phase-31-wiring @ ${execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()}`);

/* ============ S17-P1 — Part A: loader fix (authorized, cross-zone) ========= */
console.log('\n== S17-P1 Part A: provider config loader fix (server/src/providers/config/loader.js) ==');
const loaderDiff = execSync('git diff -- server/src/providers/config/loader.js', { cwd: ROOT, encoding: 'utf8' });
console.log(loaderDiff);
const fixedLine = loaderDiff.includes('+    providers: parseYamlSubset(providersText) ?? {}');
const droppedAccess = loaderDiff.includes('-    providers: parseYamlSubset(providersText).providers ?? {}');
check('S17-P1.loader-diff', fixedLine && droppedAccess, 'diff drops the dead `.providers` access and reads the parsed root');

const { loadProviderConfig } = await import(path.join(ROOT, 'server/src/providers/config/loader.js'));
const cfg = loadProviderConfig();
const providerIds = Object.keys(cfg.providers || {});
check('S17-P1.cfg-populated', providerIds.length === 8 && cfg.providers.openai?.keyEnv === 'OPENAI_API_KEY' && cfg.providers.openai?.baseUrl === 'https://api.openai.com/v1',
  `loadProviderConfig().providers now carries all ${providerIds.length} provider ids (${providerIds.join(', ')}); openai cfg = ${JSON.stringify(cfg.providers.openai)}`);

const { buildRegistry } = await import(path.join(ROOT, 'server/src/providers/registry.js'));
const keyRefValue = 'keyring:probe/not-a-real-key'; // keyRef-SHAPED value — never a real key, never printed
const withRefEnv = buildRegistry({ OPENAI_API_KEY: keyRefValue });
const openaiW = withRefEnv.find((a) => a.id === 'openai');
check('S17-P1.adapter-cfg', openaiW.cfg.keyEnv === 'OPENAI_API_KEY' && openaiW.cfg.baseUrl === 'https://api.openai.com/v1',
  `adapter cfg populated from providers.yaml: ${JSON.stringify(openaiW.cfg)}`);
check('S17-P1.isConfigured.true', openaiW.isConfigured() === true,
  `isConfigured() with a keyRef-shaped env value at keyEnv -> true (value never read or printed)`);
const noRefEnv = buildRegistry({});
check('S17-P1.isConfigured.false', noRefEnv.find((a) => a.id === 'openai').isConfigured() === false,
  'isConfigured() with the env value absent -> false');
check('S17-P1.needsKey-false-honored', noRefEnv.find((a) => a.id === 'ollama').isConfigured() === true,
  'ollama (needsKey:false in providers.yaml) stays configured without a key');
console.log('  (no key values printed anywhere in S17-P1 — only cfg with env-var NAMES and booleans)');

/* ============ S17-P2 — Part B: scope-3 probe re-run + its diff ============= */
console.log('\n== S17-P2 Part B: scope-3 probe re-run on this env (stale assertions fixed) ==');
console.log('-- diff of scripts/phase31-scope-3-probe.mjs (stale assertions replaced) --');
console.log(execSync('git diff --stat -- scripts/phase31-scope-3-probe.mjs', { cwd: ROOT, encoding: 'utf8' }));
console.log(execSync('git diff -- scripts/phase31-scope-3-probe.mjs', { cwd: ROOT, encoding: 'utf8' }));
console.log('-- full re-run output --');
const s3 = await runChild('scope3-rerun', [path.join(ROOT, 'scripts/phase31-scope-3-probe.mjs')]);
console.log(fs.readFileSync(s3.logFile, 'utf8'));
check('S17-P2.scope3-probe-exit0', s3.code === 0, `node scripts/phase31-scope-3-probe.mjs -> exit ${s3.code} (0 = all scope-3 checks pass on the live tree)`);
check('S17-P2.scope3-summary-green', /SUMMARY: \d+\/\d+ checks pass/.test(tail(s3.logFile, 6)) && !tail(s3.logFile, 6).includes('FAILURES:'),
  `scope-3 probe summary: ${tail(s3.logFile, 3).trim().split('\n')[0]}`);

/* ============ S17-P3 — Part C: reference-env sweep (16.5 legs) ============= */
console.log('\n== S17-P3 Part C: reference-env sweep — 16.5 probe, plain + sqlite-flag legs ==');
const p165 = await runChild('scope165-plain', [path.join(ROOT, 'scripts/phase31-scope-16.5-probe.mjs')]);
console.log(`-- plain run (node:sqlite unflagged on ${process.version}) exit ${p165.code} --`);
console.log(tail(p165.logFile, 24));
const plainOut = fs.readFileSync(p165.logFile, 'utf8');
check('S17-P3.sqlite-control-ran', p165.code === 0 && plainOut.includes('== P2-sqlite ==') && !plainOut.includes('[SKIP] P2'),
  'P2 SQLite live control ran (not SKIP): JobStore({ file: ":memory:" }) hydrated identically to memory');
const p165flag = await runChild('scope165-flag', [path.join(ROOT, 'scripts/phase31-scope-16.5-probe.mjs')], { NODE_OPTIONS: '--experimental-sqlite' });
console.log(`-- NODE_OPTIONS=--experimental-sqlite run (child-process env only) exit ${p165flag.code} --`);
console.log(tail(p165flag.logFile, 10));
const flagOut = fs.readFileSync(p165flag.logFile, 'utf8');
check('S17-P3.sqlite-flag-run', p165flag.code === 0 && flagOut.includes('== P2-sqlite ==') && !flagOut.includes('[SKIP] P2'),
  'NODE_OPTIONS=--experimental-sqlite run green (host env untouched — flag scoped to the child process)');

/* ============ S17-P4 — Part D: GAIA live leg =============================== */
console.log('\n== S17-P4 Part D: GAIA — key check by name, fixture leg through gaia.run ==');
const groqPresent = 'GROQ_API_KEY' in process.env;
const deepseekPresent = 'DEEPSEEK_API_KEY' in process.env;
console.log(`GROQ_API_KEY: ${groqPresent ? 'PRESENT' : 'ABSENT'}; DEEPSEEK_API_KEY: ${deepseekPresent ? 'PRESENT' : 'ABSENT'} (names only)`);
const { gaia, FIXTURES } = await import(path.join(ROOT, 'benchmarks/gaia/index.js'));
const fixtureTasks = await gaia.load({ split: 'validation' });
check('S17-P4.fixture-loaded', fixtureTasks.length === 6, `bundled mini-validation fixture loaded: ${fixtureTasks.length} tasks (2 per level)`);
function deterministicStub(request) {
  const task = fixtureTasks.find((t) => t.task_id === request.task_id);
  return { answer: task.final_answer, trace: { mode: 'stub' } };
}
const report = await gaia.run({ fixture: FIXTURES.validation, split: 'validation', pipeline: deterministicStub });
console.log(JSON.stringify({ benchmark: report.benchmark, split: report.split, fixture: report.fixture, perLevel: report.perLevel, overall: report.overall }, null, 2));
console.log(report.perTask.map((r) => `  ${r.task_id} L${r.level} pass=${r.pass} pipeline=${r.pipeline}`).join('\n'));
const pl = report.perLevel;
check('S17-P4.gaia-run-fixture', report.overall.total === 6 && report.overall.passed === 6 && pl['1'].passed === 2 && pl['2'].passed === 2 && pl['3'].passed === 2,
  `gaia.run() fixture leg: overall ${report.overall.passed}/${report.overall.total}; perLevel L1 ${pl['1'].passed}/${pl['1'].total}, L2 ${pl['2'].passed}/${pl['2'].total}, L3 ${pl['3'].passed}/${pl['3'].total} (deterministic stub disclosed in trace, not fabricated live answers)`);
let hfRefusal = null;
try { await gaia.load({ split: 'validation', fixturePath: null }); } catch (e) { hfRefusal = e; }
check('S17-P4.live-loader-honest-refusal', !!hfRefusal && hfRefusal.code === 'GAIA_HF_NOT_VERIFIED' && hfRefusal.verified === false,
  `live HF loader refuses without allowNetwork:true — ${hfRefusal ? hfRefusal.code : 'NO THROW (BAD)'}; no fetch issued`);
if (groqPresent || deepseekPresent) {
  console.log('  keys present — live 6-task validation-split run WOULD proceed here (allowNetwork loader + provider-bridge pipeline)');
  check('S17-P4.live-leg', false, 'keys unexpectedly present on host — live leg should have been attempted, not skipped (probe needs the live-pipeline branch)');
} else {
  console.log('  live leg NOT VERIFIED — no keys on host (GROQ_API_KEY / DEEPSEEK_API_KEY absent; none were set, per scope guard)');
  check('S17-P4.live-leg-disclosed', true, 'live leg NOT VERIFIED — no keys on host; harness path proven via gaia.run + fixture + stub; no answers fabricated, no keys set');
}

/* ============ S17-P6 — boot + health + W31 line count (live) =============== */
console.log('\n== S17-P6 boot + /api/health + W31 boot line count ==');
const { initPhase31Wiring, wiring } = await import(path.join(ROOT, 'server/src/wiring/phase31-bootstrap.js'));
const RT = path.join(TMP, 'probe-runtime');
fs.mkdirSync(RT, { recursive: true });
const boot = initPhase31Wiring({ sessionId: `boot-${process.pid}`, runtimeRoot: RT, brainRoot: path.join(RT, 'brain'), fleetDir: path.join(RT, 'fleet'), observersRoot: path.join(RT, 'instincts-observe'), vikingRoot: path.join(RT, 'viking') });
const liveTotal = boot.log.length;
try { wiring.autonomy.engine().stop(); } catch { /* not started */ }
console.log(`  in-process wiring boot: ${liveTotal} W31 lines (live count at this tip)`);
const PORT6 = 5600 + (process.pid % 200) * 2;
const rt6 = path.join(TMP, 'boot6-runtime');
const dt6 = path.join(TMP, 'boot6-data');
const b6 = bootServer(PORT6, rt6, dt6);
const h6 = await health(PORT6);
let p6lines = w31Lines(b6.logFile);
for (let i = 0; i < 10 && p6lines.length === 0 && !b6.child.killed; i++) { await pause(600); p6lines = w31Lines(b6.logFile); }
console.log(`  server boot: GET /api/health -> ${h6 ? h6.status : 'never up'}; W31 lines in boot log: ${p6lines.length}`);
console.log(p6lines.map((l) => `  ${l}`).join('\n'));
check('S17-P6.boot-health-lines', !!h6 && h6.status === 200 && p6lines.length === liveTotal && !p6lines.some((l) => l.includes('FAIL-SOFT')),
  `server up (health 200); ${p6lines.length} W31 boot lines == live in-process count ${liveTotal}; 0 FAIL-SOFT`);
b6.child.kill('SIGTERM');
await Promise.race([new Promise((r) => b6.child.once('exit', r)), pause(10000)]);

/* ============ S17-P7 — zone check ========================================== */
console.log('\n== S17-P7 zone check ==');
const status = execSync('git status --short', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
console.log(status.map((l) => `  ${JSON.stringify(l)}`).join('\n') || '  (clean tree)');
const first31c = execSync("git rev-list --reverse --grep='^phase-31' HEAD", { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')[0];
const committedSurface = new Set(execSync(`git diff --name-only ${first31c}^ HEAD`, { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean));
const namedCallSites = ['server/src/providers/config/loader.js'];
const allowedP7 = (l) => {
  const p = l.replace(/^(.{1,2})\s+/, '');
  return namedCallSites.includes(p) || committedSurface.has(p) || p.startsWith('scripts/phase31-') || p.startsWith('benchmarks/gaia/');
};
const violationsP7 = status.map((l) => l.replace(/^(.{1,2})\s+/, '')).filter((p) => !allowedP7(p));
check('S17-P7.zone', violationsP7.length === 0, `${status.length} entries — only named scope-17 call sites + scripts/phase31-*.mjs (+ benchmarks/gaia run path if ever dirty) + phase-31 committed surface (violations: ${JSON.stringify(violationsP7)})`);

/* ============ summary ======================================================= */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} checks pass ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
console.log(`probe runtime: ${TMP}`);
process.exit(FAILS.length ? 1 : 0);
