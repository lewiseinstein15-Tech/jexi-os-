/**
 * JEXI OS — benchmarks/humaneval-live/measure.mjs
 *
 * Derives the M22 required measurement table from a run's raw artefacts, so the
 * numbers in docs/M22-FINDINGS.md are re-derivable by another agent from the
 * committed JSON alone. The harness already reports tool-call / write / timeout
 * counts; the AST-derived rows (syntax-valid, duplicate-definition, truncation)
 * are computed here from the FULL written solution bytes, which live only in the
 * sibling `.transcript.json`.
 *
 *   node benchmarks/humaneval-live/measure.mjs <results.json> [more.json ...]
 *
 * Delivery rates (tool-call, file-write, prose-only, timeout, pass) are over
 * the run's task count. AST rates (syntax-valid and its buckets, duplicate-def,
 * placeholder-stub) are over WRITTEN files only — the harness seeds a valid
 * Python stub, so counting an untouched stub as syntax-valid would report a
 * high rate for a run that wrote nothing. Each row prints its own denominator.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { loadDataset } from './lib/tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* The classifier runs inside CPython so "syntax-valid" means exactly what the
   interpreter means by it, not a regex approximation. */
const CLASSIFIER = `
import ast, json, sys
out = {}
for rec in json.load(open(sys.argv[1])):
    tid, entry, src = rec['taskId'], rec['entryPoint'], rec['solution']
    r = {'taskId': tid, 'wrote': src is not None and src.strip() != ''}
    r.update(parses=False, syntaxError=None, syntaxClass=None, duplicateDef=False,
             hasEntry=False, placeholderStub=False)
    if r['wrote']:
        # A body the model left as a marker is a distinct defect from a body
        # that does not compile; bucket it separately rather than as "wrong".
        r['placeholderStub'] = any(m in src for m in (
            '# ...', 'remains the same', 'TODO', 'your code here', 'implementation here'))
        try:
            tree = ast.parse(src)
            r['parses'] = True
            names = [n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
            r['duplicateDef'] = names.count(entry) > 1
            r['hasEntry'] = entry in names
        except SyntaxError as e:
            msg = str(e)
            r['syntaxError'] = msg
            low = msg.lower()
            if any(k in low for k in ('unterminated', 'was never closed', 'eof while scanning')):
                r['syntaxClass'] = 'unterminated-string'
            elif 'expected an indented block' in low:
                r['syntaxClass'] = 'missing-body'
            elif 'unexpected eof' in low:
                r['syntaxClass'] = 'eof'
            else:
                r['syntaxClass'] = 'other'
        except Exception as e:
            r['syntaxError'] = type(e).__name__ + ': ' + str(e)
            r['syntaxClass'] = 'other'
    out[tid] = r
json.dump(out, sys.stdout)
`;

function classify(solutions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm22-measure-'));
  const inFile = path.join(dir, 'in.json');
  const pyFile = path.join(dir, 'classify.py');
  fs.writeFileSync(inFile, JSON.stringify(solutions));
  fs.writeFileSync(pyFile, CLASSIFIER);
  const stdout = execFileSync('python3', [pyFile, inFile], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

function loadRun(file) {
  const results = JSON.parse(fs.readFileSync(file, 'utf8'));
  const txFile = file.replace(/\.json$/, '.transcript.json');
  let tx = null;
  if (fs.existsSync(txFile)) tx = JSON.parse(fs.readFileSync(txFile, 'utf8'));
  const solById = new Map();
  if (tx) for (const t of tx.tasks || []) solById.set(t.taskId, t.solution ?? null);
  return { results, solById };
}

function measure(file) {
  const { results, solById } = loadRun(file);
  const rows = results.rows || [];
  const n = rows.length;

  /* The stub each task is seeded with, keyed by task id, so "wrote" is a real
     comparison even for the repair leg (which never recorded `wroteSolution`).
     A row that carries its own verdict (the probe) is trusted over the guess. */
  const stubById = new Map();
  try {
    for (const t of loadDataset().tasks) stubById.set(t.task_id, `${t.prompt}\n`);
  } catch { /* dataset unavailable: fall back to the row's own signal */ }

  const solutions = rows.map((r) => ({
    taskId: r.taskId,
    entryPoint: r.entryPoint,
    /* Probe runs keep the bytes in the sibling transcript; the bounded-repair
       driver inlines the final on-disk bytes on the row. */
    solution: r.finalSolution !== undefined ? r.finalSolution
      : (solById.has(r.taskId) ? solById.get(r.taskId) : null),
  }));
  const cls = classify(solutions);

  const c = {
    toolCall: 0, wroteFile: 0, syntaxValid: 0, unterminated: 0, missingBody: 0,
    placeholderStub: 0, duplicateDef: 0, officialPass: 0, verifiedPass: 0,
    falseSuccess: 0, timeout: 0, proseOnly: 0,
  };
  for (const r of rows) {
    const k = cls[r.taskId] || {};
    /* Union the tool calls across every repair attempt: a task the first
       attempt left as prose but a later attempt wrote is a delivered task, and
       the first-attempt-only view would score it as prose. */
    const attempts = r.attempts || [];
    const toolCalls = r.toolCalls
      || (attempts.length ? attempts.flatMap((a) => a.toolCalls || []) : []);
    const sol = r.finalSolution !== undefined ? r.finalSolution
      : (solById.has(r.taskId) ? solById.get(r.taskId) : null);
    const stub = stubById.get(r.taskId);
    const wroteByBytes = sol != null && sol.trim() !== '' && (stub === undefined || sol.trim() !== stub.trim());
    /* `wroteSolution` (probe) is authoritative when present; otherwise derive
       from the bytes against the seeded stub. */
    const wrote = r.wroteSolution !== undefined ? r.wroteSolution : wroteByBytes;
    const graded = r.gradedPass !== undefined ? r.gradedPass : r.finalPass;
    const pass = r.pass !== undefined ? r.pass : r.finalPass;
    if (toolCalls.length > 0) c.toolCall++;
    if (wrote) c.wroteFile++;
    if (wrote && k.parses) c.syntaxValid++;
    if (wrote && k.syntaxClass === 'unterminated-string') c.unterminated++;
    if (wrote && k.syntaxClass === 'missing-body') c.missingBody++;
    if (wrote && k.placeholderStub) c.placeholderStub++;
    if (wrote && k.duplicateDef) c.duplicateDef++;
    if (graded === true) c.officialPass++;
    if (pass === true) c.verifiedPass++;
    if (pass === true && graded !== true) c.falseSuccess++;
    if (r.agentTimedOut === true) c.timeout++;
    if (r.proseInsteadOfCall === true) c.proseOnly++;
  }

  return { file, n, c, manifest: results.manifest || {}, metrics: results.metrics || {} };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node measure.mjs <results.json> [...]');
  process.exit(2);
}

const label = (m) => `${m.manifest.promptVariant || '?'}/${m.manifest.model || '?'}@${String(m.manifest.gitCommit || '?').slice(0, 8)}`;
const pct = (x, n) => (n ? `${((x / n) * 100).toFixed(1)}%` : 'n/a');
const METRICS = [
  ['tool-call', (m) => m.c.toolCall, (m) => m.n],
  ['file-write', (m) => m.c.wroteFile, (m) => m.n],
  /* AST rows are over WRITTEN files only (see the stub note in measure()); the
     denominator is printed so the rate cannot be misread as "of all tasks". */
  ['syntax-valid', (m) => m.c.syntaxValid, (m) => m.c.wroteFile],
  ['syntax:unterminated', (m) => m.c.unterminated, (m) => m.c.wroteFile],
  ['syntax:missing-body', (m) => m.c.missingBody, (m) => m.c.wroteFile],
  ['placeholder-stub', (m) => m.c.placeholderStub, (m) => m.c.wroteFile],
  ['duplicate-def', (m) => m.c.duplicateDef, (m) => m.c.wroteFile],
  ['official-pass', (m) => m.c.officialPass, (m) => m.n],
  ['verified-pass', (m) => m.c.verifiedPass, (m) => m.n],
  ['false-success', (m) => m.c.falseSuccess, (m) => m.n],
  ['timeout', (m) => m.c.timeout, (m) => m.n],
  ['prose-only', (m) => m.c.proseOnly, (m) => m.n],
];

const runs = files.map(measure);
console.log(`\nDenominator: N = ${runs.map((r) => r.n).join(' / ')} tasks per run\n`);
console.log(`| metric | ${runs.map(label).join(' | ')} |`);
console.log(`|---|${runs.map(() => '---').join('|')}|`);
for (const [name, get, den] of METRICS) {
  console.log(`| ${name} | ${runs.map((r) => { const d = den(r); return `${get(r)}/${d} (${pct(get(r), d)})`; }).join(' | ')} |`);
}
console.log('');
for (const r of runs) {
  const m = r.metrics || {};
  if (m.recoveredByRepair !== undefined) {
    const denom = m.tasksUsingRepair || 0;
    console.log(`repair-recovery: ${m.recoveredByRepair}/${denom} repaired tasks recovered (${pct(m.recoveredByRepair, denom)}); repairsAttempted=${m.repairsAttempted}`);
  }
}
for (const r of runs) {
  console.log(`# ${path.basename(r.file)}  prompt=${r.manifest.promptVariant} model=${r.manifest.model} commit=${String(r.manifest.gitCommit).slice(0, 8)} timeout=${r.manifest.timeoutMs || '?'}`);
  console.log(`  providerLock=${r.manifest.providerLock} ladderSlid=${r.manifest.ladderSlid} temperature=${r.manifest.temperature ?? 'n/a'} seed=${r.manifest.seed ?? 'none'}`);
}
