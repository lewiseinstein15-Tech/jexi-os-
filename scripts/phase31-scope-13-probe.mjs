/**
 * JEXI OS — PHASE 31 SCOPE 13 — live probe: Terminal-Bench 2.1 adapter (build-only).
 *
 * P1: fixture loads (mini-tasks.json: 4 entries — 2 pass, 1 fail,
 *     1 malformed to prove rejection); show task shapes.
 * P2: agent.step() with a stub pipeline — consumes observations, returns
 *     valid actions; show a 3-step trace; done() flips only on submit;
 *     missing pipeline refused.
 * P3: actions.validate — valid exec/wait/ctrl/submit forms; unknown
 *     action -> E_UNKNOWN_ACTION; empty/blank/missing command and frozen
 *     extra/ill-typed args -> E_INVALID_ARGUMENT.
 * P4: observation parsing — ANSI strip (CSI + OSC), blank lines and
 *     trailing whitespace preserved byte-for-byte, exit code + cwd kept
 *     separate; before/after shown on a fixture observation.
 * P5: run() on the 4-task fixture — 2 resolved, 1 fail (verifier-declared),
 *     1 rejected; per-task + aggregate; stub actions coherent with the
 *     recorded trace.
 * P6: error paths — E_INVALID_TASK (strict load + direct validate),
 *     E_INVALID_TRANSCRIPT (empty steps / non-boolean verifier / missing
 *     stdout / bad recorded action / missing per-task entry), and
 *     E_UNKNOWN_ACTION (validator + agent.step throw).
 * P7: determinism — same fixture + same stub -> byte-identical reports.
 * P8: no live call, no Docker, no Harbor invocation — network grep on
 *     benchmarks/terminal-bench/** (zero fetch/http outside the gated
 *     loader), zero process-spawn primitives, harness words in comments
 *     only, imports limited to node: builtins + local modules.
 * P9: zone check — git status ⊆ benchmarks/terminal-bench/**,
 *     benchmarks/_fixtures/terminal-bench/**, scripts/phase31-*.mjs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TB_DIR = path.join(ROOT, 'benchmarks', 'terminal-bench');
const FIXTURE = path.join(ROOT, 'benchmarks', '_fixtures', 'terminal-bench', 'mini-tasks.json');
const TRANSCRIPT = path.join(ROOT, 'benchmarks', '_fixtures', 'terminal-bench', 'mini-transcript.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'w31s13-probe-'));
const FAILS = [];
let n = 0;
function check(id, ok, detail) {
  n += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`);
  if (!ok) FAILS.push(`${id}: ${detail}`);
}
const j = (v) => JSON.stringify(v);
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const tb = (await import(pathToFileURL(path.join(TB_DIR, 'index.js')))).tb;
const transcriptRaw = JSON.parse(fs.readFileSync(TRANSCRIPT, 'utf8'));

/* ===================== P1 — fixture loads, shapes ========================= */
console.log('== P1: fixture loads — task shapes ==');
const tasks = await tb.load({ split: 'mini' });
console.log(tasks.map((t) => `  ${j(t)}`).join('\n'));
check('P1.valid-3', tasks.length === 3, `${tasks.length} valid tasks loaded (expected 3 of 4 entries; 1 malformed is rejected)`);
check('P1.ids', j(tasks.map((t) => t.task_id)) === j(['tb-mini-001', 'tb-mini-002', 'tb-mini-003']), `ids: ${j(tasks.map((t) => t.task_id))}`);
const shapeOk = tasks.every((t) =>
  typeof t.task_id === 'string' && typeof t.instruction === 'string' && t.instruction.trim() !== '' &&
  typeof t.category === 'string' && typeof t.difficulty === 'string' &&
  !!t.verification && Array.isArray(t.verification.tests) && t.verification.tests.length > 0 &&
  t.verification.tests.every((x) => typeof x === 'string' && x.trim() !== '') && t.source === 'fixture'
);
check('P1.task-shape', shapeOk, 'every valid task carries {task_id, instruction, category, difficulty, verification.tests[], source:"fixture"}');
const diag = await tb.loadDiagnostics({ split: 'mini' });
console.log(`  rejected: ${j(diag.rejected)}`);
check('P1.rejected-1', diag.rejected.length === 1 && diag.rejected[0].task_id === 'tb-mini-004' && diag.rejected[0].code === 'E_INVALID_TASK' && /verification/.test(diag.rejected[0].reason),
  `1 rejected entry: tb-mini-004 (${diag.rejected[0]?.reason})`);

/* ===================== P2 — agent.step() 3-step trace ===================== */
console.log('\n== P2: agent.step() with stub pipeline — 3-step trace ==');
const OBS1 = transcriptRaw.tasks['tb-mini-001'].steps.map((s) => s.observation);
const P2_SCRIPT = [
  { action: 'exec', args: { command: 'ls -la /app' } },
  { action: 'exec', args: { command: 'python3 /app/tests/test_outputs.py' } },
  { action: 'submit', args: {} },
];
const p2Pipeline = ({ observation, history }) => {
  console.log(`    pipeline sees step ${history.length}: exitCode=${observation.exitCode} cwd=${observation.cwd} stdout=${j(observation.stdout).slice(0, 56)}… history=${history.length}`);
  return P2_SCRIPT[history.length];
};
const agent = tb.agent({ pipeline: p2Pipeline });
const moves = [];
for (let i = 0; i < 3; i++) {
  const parsed = tb.observe(OBS1[i]);
  const move = await agent.step(parsed);
  const verdict = tb.actions.validate(move);
  moves.push(move);
  console.log(`  step ${i} -> ${j(move)} (validate.valid=${verdict.valid})`);
  check(`P2.step-${i}-valid`, verdict.valid === true && move.action === P2_SCRIPT[i].action, `step ${i} returns a valid frozen-v1 action (${move.action})`);
}
check('P2.moves-match-script', j(moves) === j(P2_SCRIPT), 'the 3-step trace equals the pre-declared script byte-for-byte');
const agentB = tb.agent({ pipeline: ({ history }) => P2_SCRIPT[history.length] });
await agentB.step(tb.observe(OBS1[0]));
check('P2.done-before-submit', agentB.done().finished === false, 'done().finished === false after 1 exec (no submit yet)');
check('P2.done-after-submit', agent.done().finished === true, 'done().finished === true after the submit step');
let pe = null;
try { tb.agent({}); } catch (e) { pe = e; }
check('P2.pipeline-required', !!pe && pe.code === 'TB_PIPELINE_REQUIRED', `agent without pipeline -> ${pe ? pe.code : 'NO THROW (BAD)'}`);

/* ===================== P3 — actions.validate matrix ======================= */
console.log('\n== P3: actions.validate — frozen v1 action space ==');
console.log(`  action space: ${j(tb.actions.ACTION_SPACE)}`);
const VALID = [
  { action: 'exec', args: { command: 'ls -la /app' } },
  { action: 'wait', args: { ms: 250 } },
  { action: 'wait', args: {} },
  { action: 'wait' },
  { action: 'ctrl', args: { key: 'c' } },
  { action: 'ctrl', args: { key: 'd' } },
  { action: 'ctrl', args: { key: 'z' } },
  { action: 'submit' },
  { action: 'submit', args: {} },
];
for (const v of VALID) console.log(`  valid   ${j(v)} -> ${j(tb.actions.validate(v))}`);
check('P3.valid-actions', VALID.every((v) => tb.actions.validate(v).valid === true), `all ${VALID.length} well-formed proposals accepted (exec/wait/ctrl/submit incl. optional-args forms)`);
const UNKNOWN = [
  { action: 'self_destruct', args: {} },
  'exec',
];
const unknownVerdicts = UNKNOWN.map((u) => tb.actions.validate(u));
unknownVerdicts.forEach((v, i) => console.log(`  unknown ${j(UNKNOWN[i])} -> ${j(v.errors.map((e) => e.code))}`));
check('P3.unknown-action', unknownVerdicts.every((v) => v.valid === false && v.errors[0].code === 'E_UNKNOWN_ACTION'), 'unknown action name and non-object proposal both rejected with E_UNKNOWN_ACTION');
const BAD_ARGS = [
  ['exec-empty', { action: 'exec', args: { command: '' } }],
  ['exec-blank', { action: 'exec', args: { command: '   ' } }],
  ['exec-missing', { action: 'exec', args: {} }],
];
BAD_ARGS.forEach(([label, b]) => console.log(`  ${label.padEnd(13)} ${j(b)} -> ${j(tb.actions.validate(b).errors.map((e) => e.code))}`));
check('P3.empty-command', BAD_ARGS.every(([, b]) => tb.actions.validate(b).errors[0].code === 'E_INVALID_ARGUMENT'), 'empty/blank/missing exec.command -> E_INVALID_ARGUMENT (never silently run)');
const FROZEN = [
  ['exec-extra', { action: 'exec', args: { command: 'ls', cwd: '/tmp' } }],
  ['wait-negative', { action: 'wait', args: { ms: -5 } }],
  ['wait-type', { action: 'wait', args: { ms: 'soon' } }],
  ['ctrl-badkey', { action: 'ctrl', args: { key: 'x' } }],
  ['submit-extra', { action: 'submit', args: { result: 'ok' } }],
];
FROZEN.forEach(([label, f]) => console.log(`  ${label.padEnd(13)} ${j(f)} -> ${j(tb.actions.validate(f).errors.map((e) => e.code))}`));
check('P3.frozen-args', FROZEN.every(([, f]) => tb.actions.validate(f).errors[0].code === 'E_INVALID_ARGUMENT'), 'frozen v1 enforced: extra keys, negative/ill-typed ms, bad ctrl key, submit payload all E_INVALID_ARGUMENT');

/* ===================== P4 — observation parsing =========================== */
console.log('\n== P4: observation parsing — ANSI strip, blank lines preserved, exit code separate ==');
const raw2 = transcriptRaw.tasks['tb-mini-002'].steps[1].observation;
const parsed = tb.observe(raw2);
console.log(`  before (raw):     ${j(raw2)}`);
console.log(`  after  (observe): ${j(parsed)}`);
check('P4.ansi-stripped', !parsed.stdout.includes('\u001B') && !parsed.stdout.includes('\u0007'), 'no ESC/BEL bytes survive in the parsed stdout');
check('P4.blank-lines-preserved', /\n\n\n/.test(raw2.stdout) && /\n\n\n/.test(parsed.stdout), 'the two consecutive blank lines are NOT collapsed');
check('P4.trailing-whitespace', raw2.stdout.endsWith('$   ') && parsed.stdout.endsWith('$   '), 'trailing whitespace after the prompt preserved byte-for-byte');
check('P4.byte-exact', parsed.stdout === '72\n\n\nroot@9d0e:/app$   ' && tb.stripAnsi(raw2.stdout) === parsed.stdout, `parsed stdout is exactly raw-minus-escapes (sha256/16 ${sha16(parsed.stdout)})`);
check('P4.exitcode-separate', typeof parsed.exitCode === 'number' && parsed.exitCode === 0 && parsed.cwd === '/app', 'exit code (0) and cwd (/app) ride as separate fields, never merged into the text');
const parsed0 = tb.observe(transcriptRaw.tasks['tb-mini-001'].steps[0].observation);
check('P4.exitcode-null', parsed0.exitCode === null && parsed0.cwd === '/app', 'initial pane with no command yet -> exitCode null (absent becomes null, not 0)');
const oscParsed = tb.observe({ stdout: '\u001B]0;window title\u0007output line\n', exitCode: 0 });
check('P4.osc-stripped', oscParsed.stdout === 'output line\n', 'OSC sequence (window title + BEL) stripped cleanly');
check('P4.idempotent', tb.observe(parsed).stdout === parsed.stdout, 'observe() is idempotent on already-parsed observations');
let oe = null;
try { tb.observe({ exitCode: 0 }); } catch (e) { oe = e; }
check('P4.invalid-observation', !!oe && oe.code === 'E_INVALID_OBSERVATION', `non-string stdout -> ${oe ? oe.code : 'NO THROW (BAD)'}`);

/* ===================== P5 — run() aggregate =============================== */
console.log('\n== P5: run() on the 4-task fixture — per-task + aggregate ==');
const SCRIPTS = {
  'tb-mini-001': [
    { action: 'exec', args: { command: "printf 'JEXI-TB-MINI-1\\n' > /app/hello.txt" } },
    { action: 'exec', args: { command: 'cat /app/hello.txt' } },
    { action: 'submit', args: {} },
  ],
  'tb-mini-002': [
    { action: 'exec', args: { command: "awk '{s+=$1} END {print s}' /app/data/numbers.txt > /app/sum.txt" } },
    { action: 'exec', args: { command: 'cat /app/sum.txt' } },
    { action: 'submit', args: {} },
  ],
  'tb-mini-003': [
    { action: 'exec', args: { command: 'python3 /app/scripts/rotate.py' } },
    { action: 'exec', args: { command: "sed -i 's/rotate_right/rotate_left/g' /app/scripts/rotate.py" } },
    { action: 'submit', args: {} },
  ],
};
function runPipeline({ task, history }) {
  const script = SCRIPTS[task.task_id];
  if (!script) throw new Error(`runPipeline: no pre-declared script for ${task.task_id}`);
  if (history.length >= script.length) throw new Error(`runPipeline: script exhausted for ${task.task_id} at step ${history.length}`);
  return script[history.length];
}
const report = await tb.run({ fixture: FIXTURE, split: 'mini', pipeline: runPipeline });
console.log(JSON.stringify(report, null, 2));
check('P5.aggregate', report.resolved === 2 && report.total === 3 && report.rate === 2 / 3, `resolved ${report.resolved}/${report.total} (rate ${report.rate}) — 2 pass, 1 fail, 1 rejected`);
const verdictLine = report.perTask.map((t) => `${t.task_id}:${t.resolved ? 'resolved' : 'failed'}`).join(', ');
console.log(`  per-task: ${verdictLine}`);
check('P5.per-task-verdicts', verdictLine === 'tb-mini-001:resolved, tb-mini-002:resolved, tb-mini-003:failed', '2 resolved, 1 verifier-declared failure (tb-mini-003)');
check('P5.submitted-all', report.perTask.every((t) => t.submitted === true), 'all three agents submitted their trace');
check('P5.steps-3', report.perTask.every((t) => t.stepsUsed === 3), 'each trace ran exactly 3 steps (exec, exec, submit)');
const coherence = report.perTask.every((t) =>
  j(t.actions) === j(transcriptRaw.tasks[t.task_id].actions) &&
  j(SCRIPTS[t.task_id]) === j(transcriptRaw.tasks[t.task_id].actions)
);
check('P5.recording-coherence', coherence, 'stub-produced actions byte-equal the recorded trace AND the independent probe script (stub == recording, not forced)');
check('P5.rejected-surfaced', report.rejected.length === 1 && report.rejected[0].task_id === 'tb-mini-004' && report.rejected[0].code === 'E_INVALID_TASK',
  `run report carries the rejection explicitly (not silent): ${j(report.rejected)}`);

/* ===================== P6 — error paths =================================== */
console.log('\n== P6: error paths — E_INVALID_TASK, E_INVALID_TRANSCRIPT, E_UNKNOWN_ACTION ==');
let e1 = null, e2 = null;
try { await tb.load({ split: 'mini', strict: true }); } catch (e) { e1 = e; }
const rawFixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const malformedTask = rawFixture.tasks.find((t) => t.task_id === 'tb-mini-004');
try { tb.validateTask(malformedTask, 'direct'); } catch (e) { e2 = e; }
console.log(`  strict load        -> ${e1 ? `${e1.code}: ${e1.message.slice(0, 90)}…` : 'NO THROW (BAD)'}`);
console.log(`  direct validate    -> ${e2 ? `${e2.code}: ${e2.message.slice(0, 90)}…` : 'NO THROW (BAD)'}`);
check('P6.invalid-task', !!e1 && e1.code === 'E_INVALID_TASK' && /tb-mini-004/.test(e1.message) && !!e2 && e2.code === 'E_INVALID_TASK' && /verification/.test(e2.message),
  'malformed task rejected with E_INVALID_TASK at strict load and direct validation');

const BAD_TRANSCRIPTS = [
  ['empty-steps', { tasks: { 'tb-x': { steps: [], actions: [], verifier: { resolved: true } } } }],
  ['verifier-type', { tasks: { 'tb-x': { steps: [{ observation: { stdout: 'ok', exitCode: 0 } }], actions: [{ action: 'submit', args: {} }], verifier: { resolved: 'yes' } } } }],
  ['missing-stdout', { tasks: { 'tb-x': { steps: [{ observation: { exitCode: 0 } }], actions: [{ action: 'submit', args: {} }], verifier: { resolved: true } } } }],
  ['bad-recorded-action', { tasks: { 'tb-x': { steps: [{ observation: { stdout: 'ok', exitCode: 0 } }], actions: [{ action: 'teleport', args: {} }], verifier: { resolved: true } } } }],
];
const tErrs = BAD_TRANSCRIPTS.map(([label, t]) => {
  let err = null;
  try { tb.validateTranscript(t, label); } catch (e) { err = e; }
  console.log(`  ${label.padEnd(20)} -> ${err ? `${err.code}: ${err.reason ?? err.message.slice(0, 70)}` : 'NO THROW (BAD)'}`);
  return { label, err };
});
check('P6.invalid-transcript', tErrs.every(({ err }) => !!err && err.code === 'E_INVALID_TRANSCRIPT'),
  'all four malformed transcript shapes rejected with E_INVALID_TRANSCRIPT (incl. recorded action outside the frozen space)');

const tmpEntry = JSON.parse(JSON.stringify(transcriptRaw));
delete tmpEntry.tasks['tb-mini-002'];
const tmpTranscript = path.join(TMP, 'mini-transcript-missing.json');
fs.writeFileSync(tmpTranscript, JSON.stringify(tmpEntry, null, 2));
let e3 = null;
try { await tb.run({ fixture: FIXTURE, split: 'mini', pipeline: runPipeline, transcriptPath: tmpTranscript }); } catch (e) { e3 = e; }
console.log(`  missing entry      -> ${e3 ? `${e3.code}: ${e3.message.slice(0, 80)}…` : 'NO THROW (BAD)'}`);
check('P6.invalid-transcript-missing-entry', !!e3 && e3.code === 'E_INVALID_TRANSCRIPT' && /tb-mini-002/.test(e3.message),
  'run() refuses a transcript that lacks an entry for a valid task (not silently skipped)');

const unknownVerdict = tb.actions.validate({ action: 'rm_rf', args: {} });
let e4 = null;
try {
  const badAgent = tb.agent({ pipeline: () => ({ action: 'dance', args: {} }) });
  await badAgent.step({ stdout: 'x', exitCode: 0, cwd: '/' });
} catch (e) { e4 = e; }
console.log(`  validate verdict   -> ${j(unknownVerdict.errors.map((e) => e.code))}`);
console.log(`  agent.step         -> ${e4 ? `${e4.code}: ${e4.message.slice(0, 80)}` : 'NO THROW (BAD)'}`);
check('P6.unknown-action', unknownVerdict.valid === false && unknownVerdict.errors[0].code === 'E_UNKNOWN_ACTION' && !!e4 && e4.code === 'E_UNKNOWN_ACTION',
  'E_UNKNOWN_ACTION from the validator AND from agent.step() when the pipeline proposes outside the frozen space');

/* ===================== P7 — determinism =================================== */
console.log('\n== P7: determinism — byte-identical reports ==');
const r2 = await tb.run({ fixture: FIXTURE, split: 'mini', pipeline: runPipeline });
const r3 = await tb.run({ fixture: FIXTURE, split: 'mini', pipeline: runPipeline });
const s1 = JSON.stringify(report), s2 = JSON.stringify(r2), s3 = JSON.stringify(r3);
check('P7.byte-identical', s1 === s2 && s2 === s3, `3 runs of { fixture, stub pipeline } -> identical JSON (sha256/16 ${sha16(s1)}, ${sha16(s2)}, ${sha16(s3)})`);
check('P7.no-wallclock', !/Date\.now|Math\.random|new Date\(/.test(s1), 'report carries no wall-clock or randomness');

/* ===================== P8 — no live call, no Docker ======================= */
console.log('\n== P8: network grep on benchmarks/terminal-bench/** — zero fetch/http outside the gated loader; no spawn; no deps ==');
const NET_RE = /fetch\s*\(|https?:\/\//;
const SPAWN_RE = /child_process|spawnSync|execFileSync|execSync|spawn\(|\bexec\(/;
const HARNESS_RE = /\bdocker\b|\bharbor\b/i;
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;
const files = ['tasks.js', 'agent.js', 'actions.js', 'observation.js', 'report.js', 'index.js'].map((f) => path.join(TB_DIR, f));
let outside = 0, inside = 0, spawns = 0;
const harnessHits = [];
const specifiers = new Set();
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const rel = path.relative(ROOT, file);
  let lo = -1, hi = -1;
  lines.forEach((l, i) => {
    if (l.includes('// BEGIN TB LIVE PATH')) lo = i;
    if (l.includes('// END TB LIVE PATH')) hi = i;
  });
  lines.forEach((l, i) => {
    if (NET_RE.test(l)) {
      const inGated = rel.endsWith('tasks.js') && lo >= 0 && hi > lo && i > lo && i < hi;
      console.log(`  ${inGated ? 'GATED ' : 'AUDIT '} ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`);
      if (inGated) inside += 1; else outside += 1;
    }
    if (SPAWN_RE.test(l)) { console.log(`  SPAWN  ${rel}:${i + 1}: ${l.trim().slice(0, 86)}`); spawns += 1; }
    if (HARNESS_RE.test(l)) harnessHits.push({ rel: rel, line: i + 1, comment: /^[/*]/.test(l.trim()) });
    for (const m of src.matchAll(SPEC_RE)) specifiers.add(m[2]);
  });
}
check('P8.zero-outside-tb-path', outside === 0, `${outside} fetch/http hits outside the "// BEGIN/END TB LIVE PATH" span (expected 0)`);
check('P8.tb-path-real', inside >= 1, `${inside} fetch/http hits inside the gated loader span (real GitHub task-index loader present, unreachable without allowNetwork:true)`);
check('P8.no-spawn-no-docker', spawns === 0, `${spawns} process-spawn primitives in the adapter (expected 0 — no Docker, no official-harness invocation; the runner side owns containers)`);
const badHarness = harnessHits.filter((h) => !h.comment);
console.log(`  harness words: ${harnessHits.length} hit(s)${harnessHits.map((h) => ` [${h.rel}:${h.line}${h.comment ? ' comment' : ' CODE'}]`).join('')}`);
check('P8.harness-words-comments-only', badHarness.length === 0, 'docker/harbor mentions appear in comments only — zero executable references');
const foreign = [...specifiers].filter((s) => !s.startsWith('node:') && !s.startsWith('./') && !s.startsWith('../'));
console.log(`  imports: ${[...specifiers].sort().join(', ')}`);
check('P8.no-new-deps', foreign.length === 0, `all imports are node: builtins or local modules; foreign: ${j(foreign)}`);

/* ===================== P9 — zone check (PRE-commit) ======================= */
console.log('\n== P9 zone check: git status --porcelain ⊆ benchmarks/terminal-bench/**, benchmarks/_fixtures/terminal-bench/**, scripts/phase31-*.mjs ==');
const statusOut = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT }).toString().split('\n').filter(Boolean).sort();
console.log(statusOut.map((l) => `  ${l}`).join('\n'));
const zoneViolations = statusOut.filter((line) => {
  const file = line.slice(3).trim().replace(/^(.*) -> .*$/, '$1');
  if (file.startsWith('benchmarks/terminal-bench/')) return false;
  if (file.startsWith('benchmarks/_fixtures/terminal-bench/')) return false;
  if (/^scripts\/phase31-[\w.-]*\.mjs$/.test(file)) return false;
  return true;
});
check('P9.zone-clean', zoneViolations.length === 0, `${statusOut.length} entries, all inside the named call sites; violations: ${j(zoneViolations)}`);

/* ============================ summary ===================================== */
console.log(`\n== SUMMARY: ${n - FAILS.length}/${n} PASS ==`);
if (FAILS.length) { console.log('FAILURES:'); for (const f of FAILS) console.log(`  - ${f}`); }
process.exit(FAILS.length ? 1 : 0);
