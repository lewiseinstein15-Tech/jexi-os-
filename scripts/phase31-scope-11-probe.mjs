/**
 * JEXI OS — PHASE 31 SCOPE 11 — live probe: GAIA harness adapter (build-only).
 *
 * P1: fixture loads; show task shapes (6 tasks, 2 per level).
 * P2: stub-pipeline run on the 6-task fixture; per-level + overall + per-task scores.
 * P3: score normalizer proved on 6 edge cases (case, whitespace, currency,
 *     commas, trailing period, unicode) + binary negative/positive controls.
 * P4: real HF loader present but NOT invoked in sandbox — fixturePath:null
 *     reports NOT VERIFIED with no network access.
 * P5: determinism — same fixture + same stub -> byte-identical report JSON.
 * P6: no live call made — network grep on benchmarks/gaia/** shows zero
 *     fetch/http outside the gated HF loader path.
 * P7: zone check — git status ⊆ benchmarks/gaia/**,
 *     benchmarks/_fixtures/gaia/**, scripts/phase31-*.mjs (PRE-commit).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAIA_DIR = path.join(ROOT, 'benchmarks', 'gaia');
const FIXTURE = path.join(ROOT, 'benchmarks', '_fixtures', 'gaia', 'mini-validation.json');
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const j = (v) => JSON.stringify(v);

const gaia = await import(pathToFileURL(path.join(GAIA_DIR, 'index.js')));
const g = gaia.default ?? gaia.gaia;

/* ============================ P1 — fixture loads ========================== */
console.log('== P1: fixture loads — task shapes ==');
const tasks = await g.load({ split: 'validation' });
console.log(tasks.map((t) => `  ${j(t)}`).join('\n'));
check('P1.count-6', tasks.length === 6, `${tasks.length} tasks loaded from mini-validation.json (expected 6)`);
const byLevel = { 1: tasks.filter((t) => t.level === 1).length, 2: tasks.filter((t) => t.level === 2).length, 3: tasks.filter((t) => t.level === 3).length };
check('P1.levels-2-2-2', byLevel['1'] === 2 && byLevel['2'] === 2 && byLevel['3'] === 2, `per-level counts: L1=${byLevel['1']} L2=${byLevel['2']} L3=${byLevel['3']} (expected 2/2/2)`);
const shapeOk = tasks.every((t) =>
  typeof t.task_id === 'string' && typeof t.question === 'string' &&
  [1, 2, 3].includes(t.level) && typeof t.final_answer === 'string' &&
  typeof t.file_name === 'string' && typeof t.annotator_metadata === 'string' &&
  t.source === 'fixture'
);
check('P1.task-shape', shapeOk, 'every task carries {task_id, question, level:1|2|3, final_answer, file_name, annotator_metadata, source:"fixture"}');

/* ==================== P2 — stub-pipeline run on fixture =================== */
console.log('\n== P2: stub-pipeline run — per-level + overall + per-task scores ==');
function deterministicStub(request) {
  const task = tasks.find((t) => t.task_id === request.task_id);
  return { answer: task.final_answer, trace: { mode: 'stub' } };
}
const report = await g.run({ fixture: FIXTURE, split: 'validation', pipeline: deterministicStub });
console.log(JSON.stringify(report, null, 2));
const o = report.overall;
check('P2.overall-6-of-6', o.total === 6 && o.passed === 6 && o.rate === 1, `overall ${o.passed}/${o.total} (rate ${o.rate})`);
const pl = report.perLevel;
check('P2.perLevel', pl['1'].total === 2 && pl['1'].passed === 2 && pl['2'].total === 2 && pl['2'].passed === 2 && pl['3'].total === 2 && pl['3'].passed === 2,
  `perLevel L1 ${pl['1'].passed}/${pl['1'].total}, L2 ${pl['2'].passed}/${pl['2'].total}, L3 ${pl['3'].passed}/${pl['3'].total}`);
const perTaskOk = report.perTask.length === 6 && report.perTask.every((r) => r.pass === true && r.pipeline === 'deterministicStub');
check('P2.perTask', perTaskOk, `perTask ${report.perTask.length} rows, all pass, all dispatched through deterministicStub`);

/* ==================== P3 — normalizer edge cases ========================== */
console.log('\n== P3: score normalizer — 6 edge cases + binary controls ==');
const norm = g.normalizeAnswer;
// 1. case
check('P3.1-case', norm('PARIS') === 'paris' && norm('paris') === 'paris', `normalize("PARIS")=${j(norm('PARIS'))} === normalize("paris")=${j(norm('paris'))}`);
// 2. whitespace
check('P3.2-whitespace', norm('  42  ') === '42' && norm('Canada,   United\tStates') === 'canada, united states',
  `normalize("  42  ")=${j(norm('  42  '))}; internal collapse: "Canada,   United\\tStates" -> ${j(norm('Canada,   United\tStates'))}`);
// 3. currency
check('P3.3-currency', norm('$1,234.56') === '1234.56' && norm('€500') === '500', `normalize("$1,234.56")=${j(norm('$1,234.56'))}; normalize("€500")=${j(norm('€500'))}`);
// 4. commas (thousands stripped, list commas kept)
check('P3.4-commas', norm('1,000,000') === '1000000' && norm('Canada, United States') === 'canada, united states',
  `normalize("1,000,000")=${j(norm('1,000,000'))}; list comma kept: ${j(norm('Canada, United States'))}`);
// 5. trailing period
check('P3.5-trailing-period', norm('Paris.') === 'paris' && norm('42.') === '42', `normalize("Paris.")=${j(norm('Paris.'))}; normalize("42.")=${j(norm('42.'))}`);
// 6. unicode
check('P3.6-unicode', norm('CAFÉ Central') === 'café central' && norm('Ⅻ') === norm('ⅻ'),
  `normalize("CAFÉ Central")=${j(norm('CAFÉ Central'))} === normalize("café central"); roman-numeral case-fold: ${j(norm('Ⅻ'))} === ${j(norm('ⅻ'))}`);
// binary controls
const sPos = g.score({ final_answer: '7,200' }, '7200');
const sNeg1 = g.score({ final_answer: 'Paris' }, 'Lyon');
const sNeg2 = g.score({ final_answer: '21' }, '20');
check('P3.7-binary-positive', sPos.pass === true, `score(final_answer="7,200", answer="7200") -> pass=${sPos.pass} (normalized ${j(sPos.normalized)}, expected ${j(sPos.expected)})`);
check('P3.8-binary-negative', sNeg1.pass === false && sNeg2.pass === false,
  `score("Paris","Lyon").pass=${sNeg1.pass}; score("21","20").pass=${sNeg2.pass} — no partial credit`);

/* ==================== P4 — real HF loader present, NOT invoked ============ */
console.log('\n== P4: real HF loader present but not invoked in sandbox ==');
check('P4.loader-present', typeof gaia.loadHf === 'function', `benchmarks/gaia/dataset.js exports loadHf (${typeof gaia.loadHf}); datasets-server rows API wired for scope 17`);
let p4err = null;
try { await g.load({ split: 'validation', fixturePath: null }); } catch (e) { p4err = e; }
check('P4.not-verified', !!p4err && p4err.code === 'GAIA_HF_NOT_VERIFIED' && p4err.message.includes('NOT VERIFIED') && p4err.verified === false,
  `gaia.load({ split:"validation", fixturePath:null }) -> ${p4err ? `${p4err.code}: ${p4err.message.slice(0, 88)}…` : 'NO THROW (BAD)'}`);
check('P4.no-network-issued', !!p4err && !/fetch failed|ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(p4err.message),
  'refusal raised by the network gate BEFORE any fetch; no connection error, no keys involved');

/* ==================== P5 — determinism ==================================== */
console.log('\n== P5: determinism — byte-identical reports ==');
const rep2 = await g.run({ fixture: FIXTURE, split: 'validation', pipeline: deterministicStub });
const rep3 = await g.run({ fixture: FIXTURE, split: 'validation', pipeline: deterministicStub });
const s1 = JSON.stringify(report), s2 = JSON.stringify(rep2), s3 = JSON.stringify(rep3);
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
check('P5.byte-identical', s1 === s2 && s2 === s3, `3 runs of { fixture, deterministicStub } -> identical JSON (sha256/16 ${h(s1)}, ${h(s2)}, ${h(s3)})`);
const nondeterministic = /"date"|"timestamp"|Date\.now|Math\.random/.test(s1);
check('P5.no-wallclock', !nondeterministic, 'report carries no timestamps or randomness — safe to byte-compare across runs');

/* ==================== P6 — network grep over benchmarks/gaia/** =========== */
console.log('\n== P6: network grep on benchmarks/gaia/** — zero fetch/http outside the gated HF loader path ==');
const NET_RE = /fetch\s*\(|https?:\/\//;
const files = ['dataset.js', 'dispatch.js', 'score.js', 'report.js', 'index.js'].map((f) => path.join(GAIA_DIR, f));
let outside = 0, inside = 0;
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
    if (!NET_RE.test(l)) return;
    const inGated = rel.endsWith('dataset.js') && lo >= 0 && hi > lo && i > lo && i < hi;
    console.log(`  ${inGated ? 'GATED ' : 'AUDIT '} ${rel}:${i + 1}: ${l.trim().slice(0, 90)}`);
    if (inGated) inside += 1; else outside += 1;
  });
}
check('P6.zero-outside-hf-path', outside === 0, `${outside} fetch/http hits outside the "// BEGIN/END HF LIVE PATH" span (expected 0)`);
check('P6.hf-path-real', inside >= 1, `${inside} fetch/http hits inside the gated HF loader span (loader present, unreachable without allowNetwork:true)`);

/* ==================== P7 — zone check (PRE-commit) ======================== */
console.log('\n== P7 zone check: git status --porcelain ⊆ benchmarks/gaia/**, benchmarks/_fixtures/gaia/**, scripts/phase31-*.mjs ==');
const statusOut = execSync('git status --porcelain -uall', { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (file.startsWith('benchmarks/gaia/')) return false;
  if (file.startsWith('benchmarks/_fixtures/gaia/')) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P7.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all inside the named call sites; violations: ${j(zoneViolations)}`);

/* ============================ summary ===================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
process.exit(FAILS.length ? 1 : 0);
