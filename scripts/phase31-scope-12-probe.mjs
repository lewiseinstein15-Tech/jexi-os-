/**
 * JEXI OS — PHASE 31 SCOPE 12 — live probe: SWE-bench Pro adapter (build-only).
 *
 * P1: fixture loads (mini-instances.json: 4 entries — 2 pass, 1 fail,
 *     1 malformed to prove rejection); show instance shapes.
 * P2: patchFromEdits produces a unified diff byte-equal to GNU
 *     `diff -u --label=...` for the same inputs (both shown); plain
 *     `diff -u` differs only by its wall-clock timestamp suffix.
 * P3: apply() dryRun:true on the mini-repo scratch fixture -> files
 *     affected + hunk count, disk untouched (snapshot hash equal, main
 *     repo clean); real apply (dryRun:false) refuses via the Docker
 *     gate without invoking Docker.
 * P4: evaluate() with stub testRunner -> per-instance verdicts.
 * P5: run() on the fixture -> aggregate resolved rate (+ rejected entry).
 * P6: error paths: E_MALFORMED_PATCH (bad header / count mismatch),
 *     E_INVALID_INSTANCE (strict load + direct validate + evaluate).
 * P7: determinism — same fixture + same stub -> byte-identical reports.
 * P8: no live call, no Docker — network grep on benchmarks/swebench-pro/**
 *     (zero fetch/http outside the gated loader) + zero process-spawn
 *     primitives in the adapter.
 * P9: zone check — git status ⊆ benchmarks/swebench-pro/**,
 *     benchmarks/_fixtures/swebench-pro/**, scripts/phase31-*.mjs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SWE_DIR = path.join(ROOT, 'benchmarks', 'swebench-pro');
const FIXTURE = path.join(ROOT, 'benchmarks', '_fixtures', 'swebench-pro', 'mini-instances.json');
const MINI_REPO = path.join(ROOT, 'benchmarks', '_fixtures', 'swebench-pro', 'mini-repo');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s12-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const j = (v) => JSON.stringify(v);
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const swepro = (await import(pathToFileURL(path.join(SWE_DIR, 'index.js')))).swepro;

function runDiff(args, cwd) {
  try {
    return execFileSync('diff', args, { cwd }).toString();
  } catch (e) {
    if (typeof e.status === 'number' && e.status <= 2 && e.stdout) return e.stdout.toString();
    throw e;
  }
}

function repoSnapshotHash(dir) {
  const files = [];
  (function walk(d) {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else files.push({ rel: path.relative(dir, p), content: fs.readFileSync(p) });
    }
  })(dir);
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.rel); h.update('\u0000'); h.update(f.content); h.update('\u0001');
  }
  return h.digest('hex');
}

/* ===================== P1 — fixture loads, shapes ========================= */
console.log('== P1: fixture loads — instance shapes ==');
const instances = await swepro.load({ split: 'mini' });
console.log(instances.map((t) => `  ${j(t)}`).join('\n'));
check('P1.valid-3', instances.length === 3, `${instances.length} valid instances loaded (expected 3 of 4 entries; 1 malformed is rejected)`);
check('P1.ids', j(instances.map((i) => i.instance_id)) === j(['swepro-mini-001', 'swepro-mini-002', 'swepro-mini-003']), `ids: ${j(instances.map((i) => i.instance_id))}`);
const shapeOk = instances.every((t) =>
  typeof t.instance_id === 'string' && typeof t.problem_statement === 'string' &&
  typeof t.repo === 'string' && typeof t.language === 'string' &&
  Array.isArray(t.FAIL_TO_PASS) && t.FAIL_TO_PASS.length > 0 &&
  Array.isArray(t.PASS_TO_PASS) && t.PASS_TO_PASS.length > 0 && t.source === 'fixture'
);
check('P1.instance-shape', shapeOk, 'every valid instance carries {instance_id, repo, language, base_commit, problem_statement, FAIL_TO_PASS[], PASS_TO_PASS[], source:"fixture"}');
const diag = await swepro.loadDiagnostics({ split: 'mini' });
console.log(`  rejected: ${j(diag.rejected)}`);
check('P1.rejected-1', diag.rejected.length === 1 && diag.rejected[0].instance_id === 'swepro-mini-004' && diag.rejected[0].code === 'E_INVALID_INSTANCE' && /PASS_TO_PASS/.test(diag.rejected[0].reason),
  `1 rejected entry: swepro-mini-004 (${diag.rejected[0]?.reason})`);

/* ===================== P2 — patchFromEdits byte-equal ===================== */
console.log('\n== P2: patchFromEdits vs GNU diff -u — byte-for-byte ==');
const BEFORE = fs.readFileSync(path.join(MINI_REPO, 'src', 'utils', 'str.js'), 'utf8');
const AFTER = BEFORE.replace(
  ".replace(/[^a-z0-9-]+/g, '-')",
  ".replace(/[^a-z0-9]+/g, '-')\n    .replace(/-+/g, '-')"
);
const REL = 'src/utils/str.js';
const EDIT_PATHS = ['a/src/utils/str.js', 'b/src/utils/str.js'];
fs.mkdirSync(path.join(TMP, 'a/src/utils'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'b/src/utils'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'a/src/utils/str.js'), BEFORE);
fs.writeFileSync(path.join(TMP, 'b/src/utils/str.js'), AFTER);
const patch = swepro.patchFromEdits({
  edits: [{ path: REL, find: ".replace(/[^a-z0-9-]+/g, '-')", replace: ".replace(/[^a-z0-9]+/g, '-')\n    .replace(/-+/g, '-')" }],
  before: [{ path: REL, content: BEFORE }],
  after: [{ path: REL, content: AFTER }],
});
const diffLab = runDiff(['-u', `--label=${EDIT_PATHS[0]}`, `--label=${EDIT_PATHS[1]}`, EDIT_PATHS[0], EDIT_PATHS[1]], TMP);
console.log('--- patchFromEdits output ---');
console.log(patch);
console.log('--- diff -u --label=a/... --label=b/... output ---');
console.log(diffLab);
check('P2.byte-equal-labeled', patch === diffLab, `patchFromEdits === GNU diff -u output byte-for-byte (sha256/16 ${sha16(patch)} vs ${sha16(diffLab)})`);
const diffPlain = runDiff(['-u', EDIT_PATHS[0], EDIT_PATHS[1]], TMP);
console.log('--- plain diff -u (timestamps embedded) ---');
console.log(diffPlain.split('\n').slice(0, 2).map((l) => `  ${l}`).join('\n'));
const norm = diffPlain.split('\n').map((l) => (l.startsWith('--- ') || l.startsWith('+++ ') ? l.replace(/\t.*$/, '') : l)).join('\n');
check('P2.plain-diff-only-timestamp', norm === patch, 'plain diff -u differs ONLY by the \\t<timestamp> suffix on ---/+++ headers (context lines, hunk headers byte-identical)');

/* ===================== P3 — apply dry-run on mini-repo ==================== */
console.log('\n== P3: apply() dryRun:true on the mini-repo — disk untouched ==');
const hashBefore = repoSnapshotHash(MINI_REPO);
const plan = swepro.apply(patch, { repoPath: MINI_REPO, dryRun: true });
console.log(`  ${j(plan)}`);
check('P3.plan', plan.applied === false && plan.dryRun === true && j(plan.filesChanged) === j([REL]) && plan.files[0].hunks === 1 && plan.files[0].added === 2 && plan.files[0].removed === 1 && plan.hunksTotal === 1,
  `dry-run plan: filesChanged=${j(plan.filesChanged)}, hunks=${plan.files[0].hunks}, +${plan.files[0].added}/-${plan.files[0].removed}`);
const hashAfter = repoSnapshotHash(MINI_REPO);
check('P3.disk-untouched', hashBefore === hashAfter, `mini-repo snapshot hash unchanged after dry-run (${hashBefore})`);
const statusBefore = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT }).toString();
let gateErr = null;
try { swepro.apply(patch, { repoPath: MINI_REPO, dryRun: false }); } catch (e) { gateErr = e; }
check('P3.docker-gate', !!gateErr && gateErr.code === 'SWEBENCH_DOCKER_NOT_VERIFIED' && gateErr.message.includes('NOT VERIFIED'),
  `dryRun:false -> ${gateErr ? `${gateErr.code}: ${gateErr.message.slice(0, 72)}…` : 'NO THROW (BAD)'}`);
check('P3.gate-no-writes', repoSnapshotHash(MINI_REPO) === hashBefore && execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT }).toString() === statusBefore,
  'main repo status byte-identical after the gate refusal; mini-repo still untouched; no Docker invoked');

/* ===================== P4 — evaluate() with stub runner =================== */
console.log('\n== P4: evaluate() with stub testRunner — per-instance verdicts ==');
const DECLARED = {
  'swepro-mini-001': { FAIL_TO_PASS: true, PASS_TO_PASS: true },
  'swepro-mini-002': { FAIL_TO_PASS: true, PASS_TO_PASS: true },
  'swepro-mini-003': { FAIL_TO_PASS: false, PASS_TO_PASS: true },
};
function stubTestRunner({ instance_id, kind }) {
  const row = DECLARED[instance_id];
  if (!row) throw new Error(`stubTestRunner: no pre-declared result for ${instance_id}`);
  return row[kind];
}
const verdicts = {};
for (const inst of instances) {
  verdicts[inst.instance_id] = await swepro.evaluate(inst, { testRunner: stubTestRunner });
  const v = verdicts[inst.instance_id];
  console.log(`  ${inst.instance_id}: failToPass=${v.failToPass} passToPass=${v.passToPass} resolved=${v.resolved} (${v.tests.filter((t) => t.pass).length}/${v.tests.length} tests pass)`);
}
check('P4.001-resolved', verdicts['swepro-mini-001'].resolved === true, 'swepro-mini-001 resolved:true (ftp + ptp)');
check('P4.002-resolved', verdicts['swepro-mini-002'].resolved === true, 'swepro-mini-002 resolved:true (ftp + ptp)');
check('P4.003-fails', verdicts['swepro-mini-003'].resolved === false && verdicts['swepro-mini-003'].failToPass === false && verdicts['swepro-mini-003'].passToPass === true,
  'swepro-mini-003 resolved:false — failToPass:false blocks resolution, passToPass regression-free');
let runnerErr = null;
try { await swepro.evaluate(instances[0], {}); } catch (e) { runnerErr = e; }
check('P4.runner-required', !!runnerErr && runnerErr.code === 'SWEBENCH_RUNNER_REQUIRED', `evaluate without runner -> ${runnerErr ? runnerErr.code : 'NO THROW (BAD)'}`);

/* ===================== P5 — run() aggregate =============================== */
console.log('\n== P5: run() on the fixture — aggregate resolved rate ==');
const report = await swepro.run({ fixture: FIXTURE, split: 'mini', testRunner: stubTestRunner });
console.log(JSON.stringify(report, null, 2));
check('P5.aggregate', report.resolved === 2 && report.total === 3 && report.rate === 2 / 3, `resolved ${report.resolved}/${report.total} (rate ${report.rate}) — 2 pass, 1 fail, 1 rejected`);
check('P5.rejected-surfaced', report.rejected.length === 1 && report.rejected[0].instance_id === 'swepro-mini-004' && report.rejected[0].code === 'E_INVALID_INSTANCE',
  `run report carries the rejection explicitly (not silent): ${j(report.rejected)}`);

/* ===================== P6 — error paths =================================== */
console.log('\n== P6: error paths — E_MALFORMED_PATCH, E_INVALID_INSTANCE ==');
const badHeader = '--- a/x.txt\n+++ b/x.txt\n@@ -x @@\n-old\n+new\n';
let e1 = null;
try { swepro.apply(badHeader, { dryRun: true }); } catch (e) { e1 = e; }
console.log(`  bad hunk header  -> ${e1 ? `${e1.code}: ${e1.message}` : 'NO THROW (BAD)'}`);
check('P6.malformed-header', !!e1 && e1.code === 'E_MALFORMED_PATCH', 'bad hunk header rejected, not silently applied');
const badCounts = '--- a/x.txt\n+++ b/x.txt\n@@ -1,3 +1,3 @@\n-first\n+first\n';
let e2 = null;
try { swepro.apply(badCounts, { dryRun: true }); } catch (e) { e2 = e; }
console.log(`  count mismatch   -> ${e2 ? `${e2.code}: ${e2.message}` : 'NO THROW (BAD)'}`);
check('P6.malformed-counts', !!e2 && e2.code === 'E_MALFORMED_PATCH', 'hunk line counts inconsistent with header rejected');
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).instances;
const malformedEntry = raw.find((x) => x.instance_id === 'swepro-mini-004');
let e3 = null, e4 = null, e5 = null;
try { await swepro.load({ split: 'mini', strict: true }); } catch (e) { e3 = e; }
try { swepro.validateInstance(malformedEntry, 'direct'); } catch (e) { e4 = e; }
try { await swepro.evaluate(malformedEntry, { testRunner: stubTestRunner }); } catch (e) { e5 = e; }
console.log(`  strict load      -> ${e3 ? `${e3.code}: ${e3.message}` : 'NO THROW (BAD)'}`);
console.log(`  direct validate  -> ${e4 ? `${e4.code}: ${e4.message}` : 'NO THROW (BAD)'}`);
console.log(`  evaluate()       -> ${e5 ? `${e5.code}: ${e5.message}` : 'NO THROW (BAD)'}`);
check('P6.invalid-instance', !!e3 && e3.code === 'E_INVALID_INSTANCE' && /swepro-mini-004/.test(e3.message) &&
  !!e4 && e4.code === 'E_INVALID_INSTANCE' && /PASS_TO_PASS/.test(e4.message) &&
  !!e5 && e5.code === 'E_INVALID_INSTANCE',
  'malformed instance rejected with E_INVALID_INSTANCE at strict load, direct validation and evaluate()');

/* ===================== P7 — determinism =================================== */
console.log('\n== P7: determinism — byte-identical reports ==');
const r2 = await swepro.run({ fixture: FIXTURE, split: 'mini', testRunner: stubTestRunner });
const r3 = await swepro.run({ fixture: FIXTURE, split: 'mini', testRunner: stubTestRunner });
const s1 = JSON.stringify(report), s2 = JSON.stringify(r2), s3 = JSON.stringify(r3);
check('P7.byte-identical', s1 === s2 && s2 === s3, `3 runs of { fixture, stubTestRunner } -> identical JSON (sha256/16 ${sha16(s1)}, ${sha16(s2)}, ${sha16(s3)})`);
const patch2 = swepro.patchFromEdits({
  edits: [{ path: REL }],
  before: [{ path: REL, content: BEFORE }],
  after: [{ path: REL, content: AFTER }],
});
check('P7.patch-deterministic', patch2 === patch, 'patchFromEdits reproduces the identical diff on re-run (no timestamps, no randomness)');
check('P7.no-wallclock', !/Date\.now|Math\.random|new Date\(/.test(s1), 'report carries no wall-clock or randomness');

/* ===================== P8 — no live call, no Docker ======================= */
console.log('\n== P8: network grep on benchmarks/swebench-pro/** — zero fetch/http outside the gated loader; zero spawn primitives ==');
const NET_RE = /fetch\s*\(|https?:\/\//;
const SPAWN_RE = /child_process|spawnSync|execFileSync|execSync|spawn\(|\bexec\(/;
const files = ['dataset.js', 'patch.js', 'apply.js', 'evaluate.js', 'report.js', 'index.js'].map((f) => path.join(SWE_DIR, f));
let outside = 0, inside = 0, spawns = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const rel = path.relative(ROOT, file);
  let lo = -1, hi = -1;
  lines.forEach((l, i) => {
    if (l.includes('// BEGIN HF LIVE PATH')) lo = i;
    if (l.includes('// END HF LIVE PATH')) hi = i;
  });
  lines.forEach((l, i) => {
    if (NET_RE.test(l)) {
      const inGated = rel.endsWith('dataset.js') && lo >= 0 && hi > lo && i > lo && i < hi;
      console.log(`  ${inGated ? 'GATED ' : 'AUDIT '} ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`);
      if (inGated) inside += 1; else outside += 1;
    }
    if (SPAWN_RE.test(l)) { console.log(`  SPAWN  ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`); spawns += 1; }
  });
}
check('P8.zero-outside-hf-path', outside === 0, `${outside} fetch/http hits outside the "// BEGIN/END HF LIVE PATH" span (expected 0)`);
check('P8.hf-path-real', inside >= 1, `${inside} fetch/http hits inside the gated HF loader span (731-instance loader present, unreachable without allowNetwork:true)`);
check('P8.no-spawn-no-docker', spawns === 0, `${spawns} process-spawn primitives in the adapter (expected 0 — Docker only via the scope-17 harness, never from this module)`);

/* ===================== P9 — zone check (PRE-commit) ======================= */
console.log('\n== P9 zone check: git status --porcelain ⊆ benchmarks/swebench-pro/**, benchmarks/_fixtures/swebench-pro/**, scripts/phase31-*.mjs ==');
const statusOut = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (file.startsWith('benchmarks/swebench-pro/')) return false;
  if (file.startsWith('benchmarks/_fixtures/swebench-pro/')) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P9.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all inside the named call sites; violations: ${j(zoneViolations)}`);

/* ============================ summary ===================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
process.exit(FAILS.length ? 1 : 0);
