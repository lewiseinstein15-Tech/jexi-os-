/**
 * JEXI OS — PHASE 31 SCOPE 16 — live probe: unified metrics +
 * reproducibility + cost caps (build-only).
 *
 * P1: meta.result() on 5 sample raw results (one per benchmark) ->
 *     5 unified envelopes; show all 5; key order, counts, rates,
 *     manifestRef, costUsed, ranAt, statuses.
 * P2: meta.manifest(): same inputs twice -> identical sha256;
 *     model.version change -> different sha256; seed change ->
 *     different sha256; clocked variant stable with pinned createdAt.
 * P3: meta.cost(): charge below cap -> used/remaining correct;
 *     charge over cap -> E_COST_CAP_EXCEEDED with the charge refused;
 *     exact-to-cap boundary allowed; meta.run mid-flight abort ->
 *     remaining tasks marked NOT_RUN, trace holds only completed tasks.
 * P4: meta.trace(): record 3 tasks, flush to disk -> deterministic
 *     JSON (recursive sorted keys), byte-identical across two runs;
 *     memory sink -> { path: null }; missing costUsd -> E_INCOMPLETE_TASK.
 * P5: meta.run(): full pipeline on a stub runner (terminal-bench) ->
 *     unifiedResult with manifestRef, tracePath, costUsed; trace
 *     runId derives from benchmark + manifest sha.
 * P6: error paths: E_NO_MANIFEST (absent + empty-sha manifest),
 *     E_INCOMPLETE_TASK (row missing durationMs), E_COST_CAP_EXCEEDED;
 *     all ride SemanticaError — no new error class.
 * P7: determinism: same input + same injected clock -> byte-identical
 *     unified result + manifest + trace (meta.run x2, meta.result x3).
 * P8: no live call, no network, no wall-clock — source audit over
 *     benchmarks/_meta/**: zero network/spawn primitives, zero clock
 *     primitives, import audit -> node: builtins + local modules only
 *     (adapters consumed shape-only, read-only).
 * P9: zone check — git status ⊆ benchmarks/_meta/**,
 *     benchmarks/_fixtures/_meta/**, scripts/phase31-scope-16-probe.mjs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const META_DIR = path.join(ROOT, 'benchmarks', '_meta');
const FIXTURE = path.join(ROOT, 'benchmarks', '_fixtures', '_meta', 'sample-runs.json');
const OUT = '/home/z/my-project/scripts'; // runtime artifacts OUTSIDE the worktree
const CLOCK = '2026-09-23T00:00:00.000Z'; // injected test clock — the only time source
const MODEL = { name: 'stub-model', version: '2024-08-06' };
const REV = 'mini-2026-09';

const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const j = (v) => JSON.stringify(v);
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const eps = (a, b) => Math.abs(a - b) < 1e-9;
const indent = (s) => s.split('\n').map((l) => `  ${l}`).join('\n');

const meta = await import(pathToFileURL(path.join(META_DIR, 'index.js')));
const samples = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const MANIFESTS = {};
const manifestFor = (bench, ver) => {
  const k = `${bench}@${ver}`;
  if (!MANIFESTS[k]) {
    MANIFESTS[k] = meta.manifest({ benchmark: bench, adapterVersion: ver, model: MODEL, datasetRev: REV, seed: 316 });
  }
  return MANIFESTS[k];
};

/* ===================== P1 — 5 unified envelopes ========================== */
console.log('== P1: meta.result() on 5 sample raw results — 5 unified envelopes ==');
const ORDER = ['gaia', 'swebench-pro', 'terminal-bench', 'webarena', 'osworld'];
const EXPECT_BENCH = { gaia: 'gaia', 'swebench-pro': 'swebench-pro', 'terminal-bench': 'terminal-bench', webarena: 'webarena-verified', osworld: 'osworld' };
const EXPECT_VER = { gaia: 'v1', 'swebench-pro': 'v1', 'terminal-bench': '2.1', webarena: 'v1', osworld: 'v1' };
const EXPECT_RESOLVED = { gaia: 2, 'swebench-pro': 2, 'terminal-bench': 1, webarena: 2, osworld: 2 };
const KEY_ORDER = ['benchmark', 'adapterVersion', 'ranAt', 'total', 'resolved', 'rate', 'perTask', 'manifestRef', 'costUsed', 'costCap'];
const ROW_KEYS = ['taskId', 'pass', 'tokens', 'durationMs', 'costUsd', 'status'];

const envelopes = {};
for (const key of ORDER) {
  const man = manifestFor(EXPECT_BENCH[key], EXPECT_VER[key]);
  const env = meta.result(key, samples[key], { manifest: man, clock: CLOCK, cap: 1 });
  envelopes[key] = env;
  console.log(`\n  [${key}]`);
  console.log(indent(JSON.stringify(env, null, 2)));
}
console.log('');
check('P1.five', ORDER.every((k) => envelopes[k]), '5 envelopes built, one per benchmark');
check('P1.benchmarks', ORDER.every((k) => envelopes[k].benchmark === EXPECT_BENCH[k]), `benchmark fields: ${j(ORDER.map((k) => envelopes[k].benchmark))}`);
check('P1.adapter-versions', ORDER.every((k) => envelopes[k].adapterVersion === EXPECT_VER[k]), 'adapterVersion: gaia/swebench default v1 (raw carries none), terminal-bench 2.1 from raw');
check('P1.key-order', ORDER.every((k) => j(Object.keys(envelopes[k])) === j(KEY_ORDER)), 'envelope key order matches the contract exactly');
check('P1.row-key-order', ORDER.every((k) => envelopes[k].perTask.every((r) => j(Object.keys(r)) === j(ROW_KEYS))), 'perTask row key order: taskId, pass, tokens, durationMs, costUsd, status');
check('P1.counts', ORDER.every((k) => envelopes[k].total === 3 && envelopes[k].resolved === EXPECT_RESOLVED[k]), `total 3 each; resolved gaia 2, swebench 2, terminal 1, webarena 2, osworld 2 (rate===1 strict)`);
check('P1.rates', ORDER.every((k) => eps(envelopes[k].rate, EXPECT_RESOLVED[k] / 3)), 'rate == resolved/total recomputed');
check('P1.manifest-ref', ORDER.every((k) => envelopes[k].manifestRef === manifestFor(EXPECT_BENCH[k], EXPECT_VER[k]).sha256), 'manifestRef == the pinning manifest sha256, all 5');
const ROWS_FIELD = { gaia: 'perTask', 'swebench-pro': 'perInstance', 'terminal-bench': 'perTask', webarena: 'perTask', osworld: 'perTask' };
check('P1.cost-used', ORDER.every((k) => eps(envelopes[k].costUsed, samples[k][ROWS_FIELD[k]].reduce((a, r) => a + r.costUsd, 0))), `costUsed == per-task sum (gaia 0.0375, swebench 0.1875, terminal 0.15, webarena 0.15, osworld 0.375)`);
check('P1.ranAt', ORDER.every((k) => envelopes[k].ranAt === CLOCK), `ranAt from the injected clock ${CLOCK} — no wall-clock`);
check('P1.cost-cap', ORDER.every((k) => envelopes[k].costCap === 1), 'costCap echoed (1)');
check('P1.status', ORDER.every((k) => envelopes[k].perTask.every((r) => r.status === 'EVALUATED')), 'all rows status EVALUATED');

/* ===================== P2 — manifest pin stability ======================= */
console.log('== P2: meta.manifest() — same pins -> same sha, changed pin -> new sha ==');
const mA = meta.manifest({ benchmark: 'gaia', adapterVersion: 'v1', model: MODEL, datasetRev: REV, seed: 316 });
const mB = meta.manifest({ benchmark: 'gaia', adapterVersion: 'v1', model: MODEL, datasetRev: REV, seed: 316 });
check('P2.same-sha', mA.sha256 === mB.sha256, `same inputs twice -> identical sha256 (${mA.sha256.slice(0, 16)})`);
check('P2.no-clock-null', mA.manifest.createdAt === null, 'createdAt null without an injected clock — hash depends only on pins');
console.log(`  pinned manifest: ${j(mA.manifest)}`);
console.log(`  sha256: ${mA.sha256}`);
const mC = meta.manifest({ benchmark: 'gaia', adapterVersion: 'v1', model: { name: MODEL.name, version: '2024-10-25' }, datasetRev: REV, seed: 316 });
check('P2.model-rehash', mC.sha256 !== mA.sha256, `model.version ${MODEL.version} -> 2024-10-25 -> different sha256`);
const mD = meta.manifest({ benchmark: 'gaia', adapterVersion: 'v1', model: MODEL, datasetRev: REV, seed: 317 });
check('P2.seed-rehash', mD.sha256 !== mA.sha256 && mD.sha256 !== mC.sha256, 'seed 316 -> 317 -> different sha256');
const mE1 = meta.manifest({ benchmark: 'gaia', adapterVersion: 'v1', model: MODEL, datasetRev: REV, seed: 316 }, { clock: CLOCK });
const mE2 = meta.manifest({ benchmark: 'gaia', adapterVersion: 'v1', model: MODEL, datasetRev: REV, seed: 316 }, { clock: CLOCK });
check('P2.clocked-stable', mE1.sha256 === mE2.sha256 && mE1.manifest.createdAt === CLOCK, `with injected clock: stable sha + createdAt pinned to ${CLOCK}`);

/* ===================== P3 — cost caps + NOT_RUN ========================== */
console.log('== P3: meta.cost() — used/remaining, refused over-cap charge, NOT_RUN marking ==');
const c = meta.cost({ cap: 1, currency: 'USD' });
const r1 = c.charge(0.25);
check('P3.charge-1', r1.used === 0.25 && r1.remaining === 0.75, `charge 0.25 -> ${j(r1)}`);
const r2 = c.charge(0.25);
check('P3.charge-2', r2.used === 0.5 && r2.remaining === 0.5, `charge 0.25 -> ${j(r2)}`);
let capErr = null;
try { c.charge(0.75); } catch (e) { capErr = e; }
check('P3.over-cap', !!capErr && capErr.code === 'E_COST_CAP_EXCEEDED', `charge 0.75 at used 0.5 cap 1 -> E_COST_CAP_EXCEEDED (charge REFUSED, not clamped)`);
check('P3.refused-not-charged', c.snapshot().used === 0.5, `used stays 0.5 after refusal: ${j(c.snapshot())}`);
c.assert();
check('P3.assert-clean', true, 'assert() silent while used <= cap');
const r3 = c.charge(0.5);
check('P3.exact-cap-ok', r3.used === 1 && r3.remaining === 0, 'charging exactly TO the cap allowed (remaining 0)');
let capErr2 = null;
try { c.charge(0.0001); } catch (e) { capErr2 = e; }
check('P3.over-cap-2', !!capErr2 && capErr2.code === 'E_COST_CAP_EXCEEDED', 'any further positive charge refused at remaining 0');

const COSTS = { t1: 0.25, t2: 0.25, t3: 0.75, t4: 0.1 };
const mAb = manifestFor('gaia', 'v1');
const abTrace = path.join(OUT, 's16-trace-abort.json');
const ab = await meta.run({
  adapter: 'gaia',
  runner: {
    taskIds: ['t1', 't2', 't3', 't4'],
    runTask: (id) => ({ pass: true, tokens: 100, durationMs: 10, costUsd: COSTS[id], output: `stub ${id}` }),
  },
  manifest: mAb,
  costCap: 0.5,
  clock: CLOCK,
  tracePath: abTrace,
});
const st = ab.unifiedResult.perTask.map((r) => `${r.taskId}:${r.status}`);
console.log(`  abort run perTask: ${st.join(' ')}`);
check('P3.abort-statuses', j(st) === j(['t1:EVALUATED', 't2:EVALUATED', 't3:NOT_RUN', 't4:NOT_RUN']), 't3 charge refused -> clean abort; t3 + t4 marked NOT_RUN');
check('P3.abort-resolved', ab.unifiedResult.resolved === 2 && eps(ab.unifiedResult.costUsed, 0.5), 'resolved 2 (NOT_RUN never counts), costUsed 0.5 — no phantom spend');
const abDoc = JSON.parse(fs.readFileSync(abTrace, 'utf8'));
check('P3.abort-trace', j(abDoc.tasks.map((t) => t.taskId)) === j(['t1', 't2']), 'trace holds only tasks completed under the cap: t1, t2');

/* ===================== P4 — trace determinism ============================ */
console.log('== P4: meta.trace() — record 3, disk flush byte-identical, sorted keys ==');
function buildTrace(tracePath) {
  const t = meta.trace({ runId: 'probe-trace-001', adapter: 'gaia', tracePath });
  t.record('gaia-mini-001', {
    input: { level: 1, question: 'release year stamp' },
    toolCalls: [{ name: 'web.search', args: { q: 'release year' } }],
    output: '1917', tokens: 812, durationMs: 3400, costUsd: 0.0075,
  });
  t.record('gaia-mini-002', {
    input: { level: 2, question: 'sheet sum' },
    toolCalls: [{ name: 'file.read' }, { name: 'code.run' }],
    output: '42', tokens: 1503, durationMs: 5210, costUsd: 0.0125,
  });
  t.record('gaia-mini-003', {
    input: { level: 3, question: 'git stage' },
    toolCalls: [],
    output: 'staged', tokens: 2104, durationMs: 7308, costUsd: 0.0175,
  });
  return t;
}
const p4a = path.join(OUT, 's16-trace-p4-a.json');
const p4b = path.join(OUT, 's16-trace-p4-b.json');
const fa = await buildTrace(p4a).flush();
const fb = await buildTrace(p4b).flush();
check('P4.flush', fa.path === p4a && fb.path === p4b && fa.tasks === 3, `flush -> ${fa.path} (${fa.tasks} tasks, ${fa.bytes} bytes)`);
const ba = fs.readFileSync(p4a);
const bb = fs.readFileSync(p4b);
check('P4.byte-identical', ba.equals(bb) && sha16(ba.toString('utf8')) === sha16(bb.toString('utf8')), `two runs byte-identical (sha256/16 ${sha16(ba.toString('utf8'))} x2)`);
const localCanonical = (v) => {
  if (v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(localCanonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, vv]) => `${j(k)}:${localCanonical(vv)}`).join(',')}}`;
  }
  return j(v);
};
const parsed = JSON.parse(ba.toString('utf8'));
check('P4.sorted-keys', ba.toString('utf8') === `${localCanonical(parsed)}\n`, 'file bytes == INDEPENDENT recursive key-sorted re-serialization');
console.log(indent(`head: ${ba.toString('utf8').slice(0, 120)}...`));
const mem = meta.trace({ runId: 'probe-mem', adapter: 'osworld' });
mem.record('osw-mini-001', { tokens: 1, durationMs: 1, costUsd: 0 });
const mf = await mem.flush();
check('P4.memory-sink', mf.path === null && mf.tasks === 1, 'memory sink (default) flush -> { path: null }');
let incErr = null;
try { meta.trace({ runId: 'x', adapter: 'gaia' }).record('t', { tokens: 1, durationMs: 1 }); } catch (e) { incErr = e; }
check('P4.incomplete', !!incErr && incErr.code === 'E_INCOMPLETE_TASK', 'record without costUsd -> E_INCOMPLETE_TASK');

/* ===================== P5 — full pipeline ================================ */
console.log('== P5: meta.run() — full pipeline on a stub runner (terminal-bench) ==');
const TB = {
  'tb-mini-001': { pass: true, tokens: 1100, durationMs: 9800, costUsd: 0.025, input: { n: 1 }, toolCalls: [{ name: 'shell', args: { cmd: 'tar czf logs.tgz logs' } }], output: 'archived' },
  'tb-mini-002': { pass: false, tokens: 1904, durationMs: 15400, costUsd: 0.05, input: { n: 2 }, toolCalls: [], output: 'rebase conflict' },
  'tb-mini-003': { pass: false, tokens: 2760, durationMs: 21100, costUsd: 0.075, input: { n: 3 }, toolCalls: [], output: 'no submit' },
};
const mTB = manifestFor('terminal-bench', '2.1');
const p5Trace = path.join(OUT, 's16-trace-p5.json');
const p5 = await meta.run({
  adapter: 'terminal-bench',
  runner: { taskIds: Object.keys(TB), runTask: (id) => TB[id] },
  manifest: mTB,
  costCap: 2,
  clock: CLOCK,
  tracePath: p5Trace,
});
console.log(indent(JSON.stringify(p5.unifiedResult, null, 2)));
check('P5.return-shape', j(Object.keys(p5)) === j(['unifiedResult', 'manifest', 'tracePath']), 'returns { unifiedResult, manifest, tracePath }');
check('P5.manifest-ref', p5.unifiedResult.manifestRef === mTB.sha256, `manifestRef == manifest sha256 (${mTB.sha256.slice(0, 16)})`);
check('P5.bench-pin', p5.unifiedResult.benchmark === 'terminal-bench' && p5.unifiedResult.adapterVersion === '2.1', 'benchmark + adapterVersion from the manifest pin');
check('P5.resolved', p5.unifiedResult.total === 3 && p5.unifiedResult.resolved === 1 && eps(p5.unifiedResult.rate, 1 / 3), 'mixed stub: 1/3 resolved, rate recomputed');
check('P5.cost-used', eps(p5.unifiedResult.costUsed, 0.15) && p5.unifiedResult.costCap === 2, 'costUsed 0.15 under cap 2');
check('P5.trace-path', typeof p5.tracePath === 'string' && fs.existsSync(p5.tracePath), `tracePath ${p5.tracePath} written`);
const p5doc = JSON.parse(fs.readFileSync(p5.tracePath, 'utf8'));
check('P5.trace-runid', p5doc.runId === `terminal-bench-${mTB.sha256.slice(0, 16)}` && p5doc.tasks.length === 3, `runId ${p5doc.runId} (benchmark + manifest sha/16), 3 records`);

/* ===================== P6 — error paths ================================== */
console.log('== P6: error paths — E_NO_MANIFEST, E_INCOMPLETE_TASK, E_COST_CAP_EXCEEDED ==');
let e1 = null;
try { meta.result('gaia', samples.gaia); } catch (x) { e1 = x; }
check('P6.no-manifest', !!e1 && e1.code === 'E_NO_MANIFEST', 'meta.result without a manifest -> E_NO_MANIFEST');
let e1b = null;
try { meta.result('gaia', samples.gaia, { manifest: { manifest: {}, sha256: '' } }); } catch (x) { e1b = x; }
check('P6.no-manifest-empty', !!e1b && e1b.code === 'E_NO_MANIFEST', 'manifest envelope with empty sha256 -> E_NO_MANIFEST');
const broken = JSON.parse(JSON.stringify(samples.gaia));
delete broken.perTask[1].durationMs;
let e2 = null;
try { meta.result('gaia', broken, { manifest: manifestFor('gaia', 'v1'), clock: CLOCK }); } catch (x) { e2 = x; }
check('P6.incomplete', !!e2 && e2.code === 'E_INCOMPLETE_TASK', `row missing durationMs -> E_INCOMPLETE_TASK ("${e2 ? e2.message.slice(0, 72) : ''}...")`);
let e3 = null;
try { meta.cost({ cap: 0.5 }).charge(1.5); } catch (x) { e3 = x; }
check('P6.cost-cap', !!e3 && e3.code === 'E_COST_CAP_EXCEEDED', `charge 1.5 over cap 0.5 -> E_COST_CAP_EXCEEDED`);
check('P6.err-class', [e1, e1b, e2, e3].every((e) => e instanceof Error && e.name === 'SemanticaError'), 'all four ride the existing per-layer class (SemanticaError) — no new error class');

/* ===================== P7 — determinism ================================== */
console.log('== P7: determinism — same input + same injected clock -> byte-identical ==');
const runOpts = (tracePath) => ({
  adapter: 'terminal-bench',
  runner: { taskIds: Object.keys(TB), runTask: (id) => TB[id] },
  manifest: mTB,
  costCap: 2,
  clock: CLOCK,
  tracePath,
});
const d1 = await meta.run(runOpts(path.join(OUT, 's16-trace-p7-a.json')));
const d2 = await meta.run(runOpts(path.join(OUT, 's16-trace-p7-b.json')));
const h1 = sha16(JSON.stringify(d1.unifiedResult));
const h2 = sha16(JSON.stringify(d2.unifiedResult));
check('P7.result-identical', h1 === h2, `unified result sha256/16 ${h1} x2 (tracePath lives OUTSIDE the envelope)`);
check('P7.manifest-identical', d1.manifest.sha256 === d2.manifest.sha256 && j(d1.manifest) === j(d2.manifest), `manifest byte-identical (sha256/16 ${d1.manifest.sha256.slice(0, 16)})`);
const t7a = fs.readFileSync(path.join(OUT, 's16-trace-p7-a.json'));
const t7b = fs.readFileSync(path.join(OUT, 's16-trace-p7-b.json'));
check('P7.trace-identical', t7a.equals(t7b), `trace files byte-identical (sha256/16 ${sha16(t7a.toString('utf8'))})`);
const o1 = meta.result('osworld', samples.osworld, { manifest: manifestFor('osworld', 'v1'), clock: CLOCK, cap: 1 });
const o2 = meta.result('osworld', samples.osworld, { manifest: manifestFor('osworld', 'v1'), clock: CLOCK, cap: 1 });
check('P7.result2-identical', sha16(JSON.stringify(o1)) === sha16(JSON.stringify(o2)) && sha16(JSON.stringify(o1)) === sha16(JSON.stringify(envelopes.osworld)), `meta.result(osworld) sha256/16 ${sha16(JSON.stringify(o1))} stable across three builds`);

/* ===================== P8 — no live call, no network ===================== */
console.log('== P8: source audit over benchmarks/_meta/** — no network, no wall-clock, node:+local imports only ==');
const FILES = ['cost.js', 'index.js', 'manifest.js', 'result.js', 'trace.js'];
const NET_RE = /fetch|http|XMLHttpRequest|WebSocket|child_process|spawn|\bexec\b/g;
const CLOCK_RE = /Date\.now|new Date|performance\.now|process\.hrtime/g;
const SPEC_RE = /^import\s[\s\S]*?from\s['"]([^'"]+)['"];?$|^export\s\{[^}]*\}\sfrom\s['"]([^'"]+)['"];?$/;
const ALLOW = new Set([
  'node:crypto', 'node:fs/promises', 'node:path',
  '../../services/semantica/_internal.js',
  './manifest.js', './result.js', './trace.js', './cost.js',
]);
let netHits = 0;
let clockHits = 0;
const importLines = [];
const badSpecs = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(META_DIR, f), 'utf8');
  netHits += (src.match(NET_RE) ?? []).length;
  clockHits += (src.match(CLOCK_RE) ?? []).length;
  for (const line of src.split('\n')) {
    const m = SPEC_RE.exec(line);
    if (m) {
      const spec = m[1] ?? m[2];
      importLines.push(`${f}: ${line.trim()}`);
      if (!ALLOW.has(spec)) badSpecs.push(`${f}: ${spec}`);
    }
  }
}
check('P8.no-network', netHits === 0, `network/spawn primitive hits across benchmarks/_meta/**: ${netHits}`);
check('P8.no-wall-clock', clockHits === 0, `wall-clock primitive hits: ${clockHits} (ranAt/createdAt from the injected clock only)`);
check('P8.imports', importLines.length > 0 && badSpecs.length === 0, `import + re-export specifiers all allowlisted (node: builtins + local modules) — adapters consumed shape-only, read-only`);
console.log(importLines.map((l) => `  ${l}`).join('\n'));

/* ===================== P9 — zone check =================================== */
console.log('== P9: zone check ==');
const status = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
const ZONE_RE = /^\S+\s+(benchmarks\/_meta\/|benchmarks\/_fixtures\/_meta\/|scripts\/phase31-scope-16-probe\.mjs)/;
check('P9.zone', status.length > 0 && status.every((l) => ZONE_RE.test(l)), `${status.length} entries, all inside benchmarks/_meta/** | benchmarks/_fixtures/_meta/** | scripts/phase31-scope-16-probe.mjs`);
console.log(status.map((l) => `  ${l}`).join('\n'));
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT }).toString().trim();
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
check('P9.branch', branch === 'phase-31-wiring', `branch ${branch}`);
check('P9.head', head === '6c89edb', `HEAD ${head} (Scope 15 tip)`);

/* ===================== summary =========================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) {
  console.log(FAILS.map((f) => `  FAIL: ${f}`).join('\n'));
  process.exit(1);
}
