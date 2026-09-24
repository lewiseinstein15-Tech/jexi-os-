/**
 * JEXI OS — PHASE 31 SCOPE 14 — live probe: WebArena Verified adapter (build-only).
 *
 * P1: fixture loads (mini-tasks.json: 6 tasks across 5 sites, 1+1+1+1+2);
 *     show task shapes + site coverage.
 * P2: adapter(mode:'dom', browser:stub).step() -> valid WebArena actions;
 *     show a 3-step trace; missing arm + bad mode refused.
 * P3: adapter(mode:'hybrid', ...) — DOM-confirm path proven with an
 *     injected VLM stub: VLM locates, DOM confirms (a11y membership),
 *     DOM executes; show the arbitration trace; unknown element is
 *     fail-closed.
 * P4: observe() on a fixture DOM snapshot -> { url, visibleText, focus,
 *     a11y }; show before/after; defaults + E_INVALID_OBSERVATION.
 * P5: verify() with the rule-based evaluator on the 6 fixture final
 *     snapshots -> 4 pass, 2 fail (rules decide, nothing pre-declared).
 * P6: error paths: E_UNKNOWN_ELEMENT, E_INVALID_ARGUMENT,
 *     E_UNKNOWN_ACTION, E_INVALID_TASK (+ missing per-task observation
 *     trace refused).
 * P7: run() on the fixture + determinism: same fixture + same stub ->
 *     byte-identical reports; aggregate shown.
 * P8: no live browser, no Docker, no network — grep on
 *     benchmarks/webarena/**: zero fetch/http outside the gated loader,
 *     zero spawn primitives, no browser-automation deps, imports limited
 *     to node: builtins + local modules.
 * P9: zone check — git status ⊆ benchmarks/webarena/**,
 *     benchmarks/_fixtures/webarena/**, scripts/phase31-*.mjs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WA_DIR = path.join(ROOT, 'benchmarks', 'webarena');
const FIXTURE = path.join(ROOT, 'benchmarks', '_fixtures', 'webarena', 'mini-tasks.json');
const OBSERVATIONS = path.join(ROOT, 'benchmarks', '_fixtures', 'webarena', 'mini-observations.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s14-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const j = (v) => JSON.stringify(v);
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const wa = (await import(pathToFileURL(path.join(WA_DIR, 'index.js')))).wa;
const obsRaw = JSON.parse(fs.readFileSync(OBSERVATIONS, 'utf8'));

/* ===================== P1 — fixture loads, shapes ========================= */
console.log('== P1: fixture loads — 6 tasks across 5 sites ==');
const tasks = await wa.load({ split: 'mini' });
console.log(tasks.map((t) => `  ${j(t)}`).join('\n'));
check('P1.valid-6', tasks.length === 6, `${tasks.length} tasks loaded (expected 6, all valid)`);
check('P1.ids', j(tasks.map((t) => t.task_id)) === j(['wa-mini-001', 'wa-mini-002', 'wa-mini-003', 'wa-mini-004', 'wa-mini-005', 'wa-mini-006']), `ids: ${j(tasks.map((t) => t.task_id))}`);
check('P1.task-shape', tasks.every((t) =>
  typeof t.task_id === 'string' && typeof t.intent === 'string' && t.intent.trim() !== '' &&
  typeof t.start_url === 'string' && Array.isArray(t.sites) && t.sites.length >= 1 &&
  t.sites.every((s) => wa.SITES.includes(s)) && !!t.evaluator && t.source === 'fixture'
), 'every task carries {task_id, intent, sites[], start_url, evaluator, source:"fixture"} with sites inside the frozen 5-site enum');
const siteCounts = {};
for (const t of tasks) {
  const s = t.sites[0];
  siteCounts[s] = (siteCounts[s] ?? 0) + 1;
}
console.log(`  site coverage: ${j(siteCounts)}`);
check('P1.site-coverage', j(siteCounts) === j({ shopping: 2, cms: 1, reddit: 1, gitlab: 1, map: 1 }), '5 sites covered 1+1+1+1+2 (shopping carries 2)');
const diag = await wa.loadDiagnostics({ split: 'mini' });
check('P1.no-rejected', diag.rejected.length === 0 && diag.observationsRef === 'mini-observations.json', `all 6 entries valid (rejected: ${j(diag.rejected)}); observations fixture declared: ${diag.observationsRef}`);

/* ===================== P2 — dom-mode 3-step trace ========================= */
console.log('\n== P2: adapter(mode:dom, browser:stub).step() — 3-step trace ==');
const SCRIPT_001 = [
  { action: 'type', args: { element_id: 'el-1', text: 'coffee grinder', press_enter: true } },
  { action: 'click', args: { element_id: 'el-5' } },
  { action: 'noop', args: {} },
];
const p2Browser = { dom: { propose: async ({ history }) => SCRIPT_001[history.length] } };
const domAdapter = wa.adapter({ mode: 'dom', browser: p2Browser });
const snaps1 = obsRaw.tasks['wa-mini-001'].snapshots;
const moves2 = [];
for (let i = 0; i < 3; i++) {
  const parsed = wa.observe(snaps1[i]);
  const move = await domAdapter.step(parsed);
  const v = wa.validateAction(move);
  moves2.push({ action: move.action, args: move.args });
  console.log(`  step ${i} -> ${j({ action: move.action, args: move.args })} (valid=${v.valid}, trace=${j(move.trace)})`);
  check(`P2.step-${i}`, v.valid === true && move.action === SCRIPT_001[i].action && move.trace?.arm === 'dom',
    `step ${i}: DOM arm proposal translated to a valid frozen-v1 action (${move.action})`);
}
check('P2.moves-match-script', j(moves2) === j(SCRIPT_001), 'the 3-step trace equals the pre-declared DOM-arm script byte-for-byte');
let ar = null;
try { wa.adapter({ mode: 'dom', browser: {} }); } catch (e) { ar = e; }
check('P2.arm-required', !!ar && ar.code === 'WA_BROWSER_ARM_REQUIRED', `dom mode without browser.dom.propose -> ${ar ? ar.code : 'NO THROW (BAD)'}`);
let bm = null;
try { wa.adapter({ mode: 'telepathy', browser: p2Browser }); } catch (e) { bm = e; }
check('P2.bad-mode', !!bm && bm.code === 'E_INVALID_ARGUMENT', `mode outside dom|visual|hybrid -> ${bm ? bm.code : 'NO THROW (BAD)'}`);

/* ===================== P3 — hybrid arbitration ============================ */
console.log('\n== P3: adapter(mode:hybrid) — VLM locates, DOM confirms, DOM executes ==');
const SCRIPT_004 = [
  { action: 'click', args: { element_id: 'el-2' } },
  { action: 'click', args: { element_id: 'el-1' } },
  { action: 'noop', args: {} },
];
const p3Browser = { visual: { ground: async ({ history }) => SCRIPT_004[history.length] } };
const hybrid = wa.adapter({ mode: 'hybrid', browser: p3Browser });
const snaps4 = obsRaw.tasks['wa-mini-004'].snapshots;
const moves3 = [];
for (let i = 0; i < 3; i++) {
  const parsed = wa.observe(snaps4[i]);
  const move = await hybrid.step(parsed);
  const v = wa.validateAction(move);
  moves3.push({ action: move.action, args: move.args });
  console.log(`  step ${i}: VLM locates ${j({ action: move.action, args: move.args })} -> DOM confirm=${move.trace.elementConfirmed === null ? 'n/a (no element)' : move.trace.elementConfirmed} -> DOM executes (valid=${v.valid}, trace=${j(move.trace)})`);
  check(`P3.step-${i}`,
    v.valid === true && move.action === SCRIPT_004[i].action &&
    move.trace.arm === 'hybrid' && move.trace.locate === 'visual' && move.trace.confirm === 'dom' &&
    move.trace.elementConfirmed === (move.action === 'noop' ? null : true),
    `step ${i}: hybrid arbitration ${move.trace.elementConfirmed === null ? 'skips confirm for element-free action' : 'confirms the element against the a11y tree'}`);
}
check('P3.moves-match-script', j(moves3) === j(SCRIPT_004), 'the hybrid trace equals the pre-declared visual-arm script byte-for-byte');
const hybridBad = wa.adapter({
  mode: 'hybrid',
  browser: { visual: { ground: async () => ({ action: 'click', args: { element_id: 'el-404' } }) } },
});
let fc = null;
try { await hybridBad.step(wa.observe(snaps4[0])); } catch (e) { fc = e; }
console.log(`  fail-closed: VLM proposes click el-404 (absent from a11y) -> ${fc ? `${fc.code}: ${fc.message.slice(0, 90)}…` : 'NO THROW (BAD)'}`);
check('P3.fail-closed', !!fc && fc.code === 'E_UNKNOWN_ELEMENT', 'hybrid DOM-confirm rejects an element the VLM hallucinated — fail-closed, never executed');

/* ===================== P4 — observation parsing =========================== */
console.log('\n== P4: observe() on a fixture DOM snapshot — 4-key WebArena format ==');
const rawSnap = snaps1[1];
const parsed = wa.observe(rawSnap);
console.log(`  before (raw snapshot): ${j(rawSnap)}`);
console.log(`  after  (observe):      ${j(parsed)}`);
check('P4.shape-4-keys', Object.keys(parsed).sort().join(',') === 'a11y,focus,url,visibleText', 'output has exactly the four WebArena observation keys; snapshot extras dropped');
check('P4.types', typeof parsed.url === 'string' && parsed.url === rawSnap.url && typeof parsed.visibleText === 'string' && parsed.visibleText === rawSnap.visibleText && Array.isArray(parsed.a11y),
  'url and visibleText preserved byte-for-byte; a11y is an array');
check('P4.a11y-preserved', parsed.a11y.length === 3 && j(parsed.a11y) === j(rawSnap.a11y), 'a11y nodes preserved ({element_id, role, name} x3)');
check('P4.focus-preserved', !!parsed.focus && parsed.focus.element_id === 'el-6' && j(parsed.focus) === j(rawSnap.focus), 'focus carried through (el-6 textbox "Search products")');
const dflt = wa.observe({ url: 'http://defaults.jexi.local/' });
check('P4.defaults', dflt.visibleText === '' && dflt.focus === null && j(dflt.a11y) === j([]), 'absent visibleText/focus/a11y default to "" / null / []');
let oe1 = null, oe2 = null;
try { wa.observe({ visibleText: 'x' }); } catch (e) { oe1 = e; }
try { wa.observe({ url: 'http://x.local/', a11y: [{ role: 'link' }] }); } catch (e) { oe2 = e; }
check('P4.invalid', !!oe1 && oe1.code === 'E_INVALID_OBSERVATION' && !!oe2 && oe2.code === 'E_INVALID_OBSERVATION',
  `missing url -> ${oe1 ? oe1.code : 'NO THROW (BAD)'}; a11y node without element_id -> ${oe2 ? oe2.code : 'NO THROW (BAD)'}`);

/* ===================== P5 — rule-based verify ============================= */
console.log('\n== P5: verify() with rule-based evaluator on 6 fixture final snapshots ==');
const EXPECTED = { 'wa-mini-001': true, 'wa-mini-002': false, 'wa-mini-003': true, 'wa-mini-004': true, 'wa-mini-005': true, 'wa-mini-006': false };
const verdicts = {};
for (const task of tasks) {
  const finalState = wa.observe(obsRaw.tasks[task.task_id].snapshots.at(-1));
  const verdict = wa.verify(task, finalState);
  verdicts[task.task_id] = verdict.pass;
  console.log(`  ${task.task_id}: ${j(verdict.rules)} -> pass=${verdict.pass}`);
}
const passed = Object.values(verdicts).filter(Boolean).length;
check('P5.verdicts', j(verdicts) === j(EXPECTED) && passed === 4, `4 pass, 2 fail — rules decide against the recorded final snapshots (nothing pre-declared): ${j(verdicts)}`);
const kindsUsed = new Set();
let allFormUsed = false;
for (const task of tasks) {
  if (Array.isArray(task.evaluator.all)) { allFormUsed = true; task.evaluator.all.forEach((r) => kindsUsed.add(r.kind)); }
  else kindsUsed.add(task.evaluator.kind);
}
check('P5.rule-kinds', j([...kindsUsed].sort()) === j(['a11y_contains', 'string_match', 'url_match']) && allFormUsed,
  `all three frozen rule kinds exercised (url_match | string_match | a11y_contains) + the { all } AND-form (wa-mini-005)`);
check('P5.binary', Object.values(verdicts).every((v) => typeof v === 'boolean'), 'binary success per task — no partial credit');

/* ===================== P6 — error paths =================================== */
console.log('\n== P6: error paths — E_UNKNOWN_ELEMENT, E_INVALID_ARGUMENT, E_UNKNOWN_ACTION, E_INVALID_TASK ==');
const badEl = wa.adapter({ mode: 'dom', browser: { dom: { propose: async () => ({ action: 'click', args: { element_id: 'el-404' } }) } } });
let e1 = null;
try { await badEl.step(wa.observe(snaps1[0])); } catch (e) { e1 = e; }
console.log(`  unknown element    -> ${e1 ? `${e1.code}: ${e1.message.slice(0, 84)}…` : 'NO THROW (BAD)'}`);
check('P6.unknown-element', !!e1 && e1.code === 'E_UNKNOWN_ELEMENT' && e1.element_id === 'el-404', 'click on an element_id absent from the current a11y tree -> E_UNKNOWN_ELEMENT (dom mode)');

const missArg = wa.adapter({ mode: 'dom', browser: { dom: { propose: async () => ({ action: 'click', args: {} }) } } });
const badDir = wa.adapter({ mode: 'dom', browser: { dom: { propose: async () => ({ action: 'scroll', args: { direction: 'left' } }) } } });
let e2 = null, e3 = null;
try { await missArg.step(wa.observe(snaps1[0])); } catch (e) { e2 = e; }
try { await badDir.step(wa.observe(snaps1[0])); } catch (e) { e3 = e; }
console.log(`  missing arg        -> ${e2 ? `${e2.code}: ${e2.message}` : 'NO THROW (BAD)'}`);
console.log(`  ill-typed arg      -> ${e3 ? `${e3.code}: ${e3.message}` : 'NO THROW (BAD)'}`);
check('P6.invalid-arg', !!e2 && e2.code === 'E_INVALID_ARGUMENT' && !!e3 && e3.code === 'E_INVALID_ARGUMENT', 'missing click.element_id and scroll.direction outside up|down -> E_INVALID_ARGUMENT');

const badAct = wa.adapter({ mode: 'dom', browser: { dom: { propose: async () => ({ action: 'drag', args: {} }) } } });
let e4 = null;
try { await badAct.step(wa.observe(snaps1[0])); } catch (e) { e4 = e; }
console.log(`  unknown action     -> ${e4 ? `${e4.code}: ${e4.message.slice(0, 84)}…` : 'NO THROW (BAD)'}`);
check('P6.unknown-action', !!e4 && e4.code === 'E_UNKNOWN_ACTION', "action 'drag' outside the frozen WebArena v1 space -> E_UNKNOWN_ACTION");

const BAD_TASKS = [
  ['missing-intent', { task_id: 'x', start_url: 'http://s.local/', sites: ['shopping'] }],
  ['missing-start-url', { task_id: 'x', intent: 'i', sites: ['shopping'] }],
  ['missing-sites', { task_id: 'x', intent: 'i', start_url: 'http://s.local/' }],
  ['bad-site', { task_id: 'x', intent: 'i', start_url: 'http://s.local/', sites: ['azure'] }],
  ['bad-evaluator', { task_id: 'x', intent: 'i', start_url: 'http://s.local/', sites: ['shopping'], evaluator: { kind: 'vibes' } }],
];
const tErrs = BAD_TASKS.map(([label, t]) => {
  let err = null;
  try { wa.validateTask(t, label); } catch (e) { err = e; }
  console.log(`  ${label.padEnd(17)} -> ${err ? `${err.code}: ${err.reason ?? err.message.slice(0, 60)}` : 'NO THROW (BAD)'}`);
  return { label, err };
});
check('P6.invalid-task', tErrs.every(({ err }) => !!err && err.code === 'E_INVALID_TASK'),
  'malformed tasks (missing intent/start_url/sites, site outside the frozen enum, unknown evaluator kind) all rejected with E_INVALID_TASK');

const tmpObs = JSON.parse(JSON.stringify(obsRaw));
delete tmpObs.tasks['wa-mini-001'];
const tmpObsPath = path.join(TMP, 'mini-observations-missing.json');
fs.writeFileSync(tmpObsPath, JSON.stringify(tmpObs, null, 2));
const runBrowser0 = { dom: { propose: async () => ({ action: 'noop', args: {} }) } };
let e5 = null;
try { await wa.run({ fixture: FIXTURE, split: 'mini', agent: wa.adapter({ mode: 'dom', browser: runBrowser0 }), verify: wa.verify, observationsPath: tmpObsPath }); } catch (e) { e5 = e; }
console.log(`  missing obs trace  -> ${e5 ? `${e5.code}: ${e5.message.slice(0, 84)}…` : 'NO THROW (BAD)'}`);
check('P6.obs-missing-entry', !!e5 && e5.code === 'E_INVALID_OBSERVATION' && /wa-mini-001/.test(e5.message), 'run() refuses an observations fixture lacking an entry for a valid task (not silently skipped)');

/* ===================== P7 — run() + determinism =========================== */
console.log('\n== P7: run() on the fixture + determinism — byte-identical reports ==');
const RUN_SCRIPTS = {
  'wa-mini-001': SCRIPT_001,
  'wa-mini-002': [
    { action: 'click', args: { element_id: 'el-1' } },
    { action: 'click', args: { element_id: 'el-3' } },
    { action: 'noop', args: {} },
  ],
  'wa-mini-003': [
    { action: 'click', args: { element_id: 'el-1' } },
    { action: 'click', args: { element_id: 'el-3' } },
    { action: 'noop', args: {} },
  ],
  'wa-mini-004': SCRIPT_004,
  'wa-mini-005': [
    { action: 'click', args: { element_id: 'el-1' } },
    { action: 'click', args: { element_id: 'el-3' } },
    { action: 'noop', args: {} },
  ],
  'wa-mini-006': [
    { action: 'type', args: { element_id: 'el-1', text: 'Depot' } },
    { action: 'type', args: { element_id: 'el-2', text: 'Harbor', press_enter: true } },
    { action: 'noop', args: {} },
  ],
};
const runBrowser = {
  dom: {
    propose: async ({ task, history }) => {
      const script = RUN_SCRIPTS[task.task_id];
      if (!script) throw new Error(`runBrowser: no pre-declared script for ${task.task_id}`);
      if (history.length >= script.length) throw new Error(`runBrowser: script exhausted for ${task.task_id} at step ${history.length}`);
      return script[history.length];
    },
  },
};
const runAgent = wa.adapter({ mode: 'dom', browser: runBrowser });
const report = await wa.run({ fixture: FIXTURE, split: 'mini', agent: runAgent, verify: wa.verify });
console.log(JSON.stringify(report, null, 2));
const r2 = await wa.run({ fixture: FIXTURE, split: 'mini', agent: wa.adapter({ mode: 'dom', browser: runBrowser }), verify: wa.verify });
const r3 = await wa.run({ fixture: FIXTURE, split: 'mini', agent: wa.adapter({ mode: 'dom', browser: runBrowser }), verify: wa.verify });
const s1 = JSON.stringify(report), s2 = JSON.stringify(r2), s3 = JSON.stringify(r3);
check('P7.byte-identical', s1 === s2 && s2 === s3, `3 runs of { fixture, dom-stub adapter, wa.verify } -> identical JSON (sha256/16 ${sha16(s1)}, ${sha16(s2)}, ${sha16(s3)})`);
check('P7.no-wallclock', !/Date\.now|Math\.random|new Date\(/.test(s1), 'report carries no wall-clock or randomness');
check('P7.aggregate',
  report.overall.passed === 4 && report.overall.total === 6 && report.overall.rate === 4 / 6 &&
  j(report.perSite) === j([
    { site: 'shopping', total: 2, passed: 1, rate: 0.5 },
    { site: 'cms', total: 1, passed: 1, rate: 1 },
    { site: 'reddit', total: 1, passed: 1, rate: 1 },
    { site: 'gitlab', total: 1, passed: 1, rate: 1 },
    { site: 'map', total: 1, passed: 0, rate: 0 },
  ]) && report.rejected.length === 0,
  `overall 4/6 (rate ${report.overall.rate}); per-site: shopping 1/2, cms 1/1, reddit 1/1, gitlab 1/1, map 0/1; rejected empty`);

/* ===================== P8 — no live browser, no Docker ==================== */
console.log('\n== P8: network grep on benchmarks/webarena/** — zero fetch/http outside the gated loader; no spawn; no browser deps ==');
const NET_RE = /fetch\s*\(|https?:\/\//;
const SPAWN_RE = /child_process|spawnSync|execFileSync|execSync|spawn\(|\bexec\(/;
const BROWSER_DEPS_RE = /\bdocker\b|\bplaywright\b|\bpuppeteer\b|\bselenium\b/i;
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;
const files = ['tasks.js', 'adapter.js', 'observation.js', 'verifier.js', 'report.js', 'index.js'].map((f) => path.join(WA_DIR, f));
let outside = 0, inside = 0, spawns = 0;
const depHits = [];
const specifiers = new Set();
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const rel = path.relative(ROOT, file);
  let lo = -1, hi = -1;
  lines.forEach((l, i) => {
    if (l.includes('// BEGIN WA LIVE PATH')) lo = i;
    if (l.includes('// END WA LIVE PATH')) hi = i;
  });
  lines.forEach((l, i) => {
    if (NET_RE.test(l)) {
      const inGated = rel.endsWith('tasks.js') && lo >= 0 && hi > lo && i > lo && i < hi;
      console.log(`  ${inGated ? 'GATED ' : 'AUDIT '} ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`);
      if (inGated) inside += 1; else outside += 1;
    }
    if (SPAWN_RE.test(l)) { console.log(`  SPAWN  ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`); spawns += 1; }
    if (BROWSER_DEPS_RE.test(l)) depHits.push({ rel: rel, line: i + 1, comment: /^[/*]/.test(l.trim()) });
    for (const m of src.matchAll(SPEC_RE)) specifiers.add(m[2]);
  });
}
check('P8.zero-outside-wa-path', outside === 0, `${outside} fetch/http hits outside the "// BEGIN/END WA LIVE PATH" span (expected 0)`);
check('P8.wa-path-real', inside >= 1, `${inside} fetch/http hits inside the gated loader span (real 812-task set loader present, unreachable without allowNetwork:true)`);
check('P8.no-spawn-no-docker', spawns === 0, `${spawns} process-spawn primitives in the adapter (expected 0 — no browser launch, no Docker, no official-harness invocation)`);
const badDeps = depHits.filter((h) => !h.comment);
console.log(`  browser/docker words: ${depHits.length} hit(s)${depHits.map((h) => ` [${h.rel}:${h.line}${h.comment ? ' comment' : ' CODE'}]`).join('')}`);
check('P8.no-browser-deps', badDeps.length === 0, 'docker/playwright/puppeteer/selenium mentions in comments only — zero executable references (adapter is a translator, not a browser)');
const foreign = [...specifiers].filter((s) => !s.startsWith('node:') && !s.startsWith('./') && !s.startsWith('../'));
console.log(`  imports: ${[...specifiers].sort().join(', ')}`);
check('P8.no-new-deps', foreign.length === 0, `all imports are node: builtins or local modules; foreign: ${j(foreign)}`);

/* ===================== P9 — zone check (PRE-commit) ======================= */
console.log('\n== P9 zone check: git status --porcelain ⊆ benchmarks/webarena/**, benchmarks/_fixtures/webarena/**, scripts/phase31-*.mjs ==');
const statusOut = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (file.startsWith('benchmarks/webarena/')) return false;
  if (file.startsWith('benchmarks/_fixtures/webarena/')) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P9.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all inside the named call sites; violations: ${j(zoneViolations)}`);

/* ============================ summary ===================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
process.exit(FAILS.length ? 1 : 0);
