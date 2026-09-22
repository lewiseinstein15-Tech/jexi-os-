/**
 * JEXI OS — Phase 23 Scope C — live probe for ralph diagnostics.
 * Run from repo root: node scripts/phase23-ralph-probe.mjs
 *
 * P1  diagnostics.evaluate(cleanInput) -> { ok: true, findings: [] }
 * P2  evaluate(dirtyInput) -> findings with specific codes (code + severity + detail)
 * P3  ciDoctor.diagnose(failureLogs) -> rootCause + verbatim evidence (no ellipsis,
 *     no truncation, long lines intact); empty logs -> E_NO_LOGS
 * P4  addContext.inject twice -> get in injection order, op-seq stamps shown
 * P5  determinism: evaluate/diagnose/addContext byte-identical across calls
 * P6  zone check: only harness/hardening/ralph/** + scripts/phase23-*.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnostics, ciDoctor, addContext, createAddContext } from '../harness/hardening/ralph/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const CLEAN_LOG = [
  'loop: started task "fix flaky payments refund test"',
  'ran: payments.unit (14/14 pass), payments.integration (6/6 pass)',
  'ran: refund edge cases matrix (9/9 pass)',
  'loop: verification full — all declared suites green, evidence attached',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// P1 — clean input -> ok: true, no findings
// ─────────────────────────────────────────────────────────────────────────────
const cleanInput = {
  task: 'fix flaky refund test in payments module',
  verification: 'full',
  tests: ['payments.unit', 'payments.integration', 'payments.e2e.refund'],
  skills: ['debug-flaky-tests'],
  logs: CLEAN_LOG,
  deviations: [],
};
const clean = diagnostics.evaluate(cleanInput);
console.log('P1 clean result: ' + JSON.stringify(clean));
ok(clean.ok === true && Array.isArray(clean.findings) && clean.findings.length === 0, 'P1 clean input -> { ok: true, findings: [] }');

// ─────────────────────────────────────────────────────────────────────────────
// P2 — dirty input -> specific codes with severities
// ─────────────────────────────────────────────────────────────────────────────
const dirtyInput = {
  task: 'ship refund hotfix',
  verification: undefined,           // missing verification          -> E_MISSING_VERIFICATION (error)
  tests: [],                         // no tests                      -> E_NO_TESTS (error)
  skills: [],                        // no skills listed              -> W_NO_SKILLS (warn)
  logs: 'ok',                        // sparse logs                   -> W_LOGS_SPARSE (warn)
  deviations: [{ what: 'skipped the e2e suite', justification: '' }], // unjustified -> E_DEVIATION_UNJUSTIFIED (error)
};
const dirty = diagnostics.evaluate(dirtyInput);
console.log('P2 dirty result: ' + JSON.stringify(dirty, null, 2));
ok(dirty.ok === false && dirty.findings.length === 5, 'P2 dirty input -> ok: false with 5 findings');
const byCode = Object.fromEntries(dirty.findings.map((f) => [f.code, f]));
ok(byCode.E_MISSING_VERIFICATION && byCode.E_MISSING_VERIFICATION.severity === 'error', 'P2 E_MISSING_VERIFICATION present, severity error');
ok(byCode.E_NO_TESTS && byCode.E_NO_TESTS.severity === 'error', 'P2 E_NO_TESTS present, severity error');
ok(byCode.E_DEVIATION_UNJUSTIFIED && byCode.E_DEVIATION_UNJUSTIFIED.severity === 'error', 'P2 E_DEVIATION_UNJUSTIFIED present, severity error');
ok(byCode.W_NO_SKILLS && byCode.W_NO_SKILLS.severity === 'warn', 'P2 W_NO_SKILLS present, severity warn');
ok(byCode.W_LOGS_SPARSE && byCode.W_LOGS_SPARSE.severity === 'warn', 'P2 W_LOGS_SPARSE present, severity warn');
ok(dirty.findings.every((f) => ['error', 'warn', 'info'].includes(f.severity) && typeof f.detail === 'string' && f.detail.length > 0), 'P2 every finding carries a declared severity and a non-empty detail');
ok(byCode.E_DEVIATION_UNJUSTIFIED.detail.includes('skipped the e2e suite'), 'P2 deviation detail names the deviation');

// P2b — field-shape problems are findings, not throws; bare-string deviation is unjustified
const shape = diagnostics.evaluate({ task: 't', verification: 'tests', tests: 'oops', skills: ['s'], logs: CLEAN_LOG, deviations: ['skipped cleanup'] });
const shapeCodes = shape.findings.map((f) => f.code).join(',');
console.log('P2b shape-problems -> codes: ' + shapeCodes);
ok(shape.findings.some((f) => f.code === 'E_NO_TESTS') && shape.findings.some((f) => f.code === 'E_DEVIATION_UNJUSTIFIED'), 'P2b tests:"oops" -> E_NO_TESTS finding; bare-string deviation -> E_DEVIATION_UNJUSTIFIED (findings, not throws)');
const throwErr = errOf(() => diagnostics.evaluate(null));
ok(throwErr && throwErr.code === 'E_INVALID_ARGUMENT' && throwErr.name === 'SemanticaError', 'P2b non-object props bag -> E_INVALID_ARGUMENT (SemanticaError, no new error class)');

// ─────────────────────────────────────────────────────────────────────────────
// P3 — CI Doctor: rootCause + verbatim evidence; no truncation; E_NO_LOGS
// ─────────────────────────────────────────────────────────────────────────────
// A >300-char failure line (long assertion payload) that ALSO matches the
// winning pattern (TypeError:) — proves selected evidence is kept verbatim.
const LONG_DIFF_LINE = '    TypeError: assertion payload oversized: {"status":"refunded","amount":4200,"charge":"ch_9f2c8e1a7b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0","expected":"refund","received":"settled","trace":"refund-client.settle -> ledger.apply -> ledger.commit -> ledger.ack -> notifier.push -> audit.append -> audit.flush -> index.rebuild -> index.persist -> router.ack -> loop.complete","attempt":2,"loop":"loop-refund-hotfix","opSeq":4711}';
const FAILURE_LOG = [
  'loop: started task "issue full refund for settled charge"',
  'FAIL payments/integration/refund.test.js',
  '  refund issues a full refund for a settled charge',
  '    TypeError: Cannot read properties of undefined (reading \'status\')',
  '      at RefundClient.settle (payments/src/refund-client.js:88:24)',
  LONG_DIFF_LINE,
  'Tests: 1 failed, 12 passed, 13 total',
  'Process exited with code 1 after 3.1s',
].join('\n');
const dx = ciDoctor.diagnose({ logs: FAILURE_LOG });
console.log('P3 rootCause: ' + dx.rootCause);
console.log('P3 evidence (' + dx.evidence.length + ' lines, verbatim):');
for (const line of dx.evidence) console.log('  | ' + line);
console.log('P3 suggestions: ' + JSON.stringify(dx.suggestions));
const logLines = FAILURE_LOG.split('\n');
ok(typeof dx.rootCause === 'string' && dx.rootCause.length > 0, 'P3 rootCause is a non-empty string');
ok(dx.evidence.length > 0 && dx.evidence.every((line) => FAILURE_LOG.includes(line)), 'P3 every evidence line is a verbatim substring of the input log');
ok(dx.evidence.every((line) => !line.includes('...') && !line.includes('…')), 'P3 no ellipsis in any evidence line');
const longLineKept = dx.evidence.find((l) => l.length > 300);
ok(longLineKept !== undefined && longLineKept === LONG_DIFF_LINE, 'P3 long line (>300 chars) kept VERBATIM — no substring length cap (' + (longLineKept ? longLineKept.length : 0) + ' chars)');
ok(Array.isArray(dx.suggestions) && dx.suggestions.length > 0, 'P3 suggestions are non-empty');

// P3b — unknown signature: full log comes back verbatim, nothing dropped
const ODD_LOG = 'the flux capacitor undershot by 1.21 gigawatts\nsecond line of a strange failure';
const dxOdd = ciDoctor.diagnose({ logs: ODD_LOG });
console.log('P3b unknown-signature rootCause: ' + dxOdd.rootCause + ', evidence lines: ' + dxOdd.evidence.length);
ok(dxOdd.rootCause === 'unknown' && dxOdd.evidence.join('\n') === ODD_LOG, 'P3b unknown rootCause returns the FULL log verbatim (no truncation, no drop)');

// P3c — empty logs -> E_NO_LOGS
const noLogs = errOf(() => ciDoctor.diagnose({ logs: '' }));
const wsLogs = errOf(() => ciDoctor.diagnose({ logs: '   \n  \n ' }));
const missingLogs = errOf(() => ciDoctor.diagnose({}));
console.log('P3c empty logs -> ' + (noLogs && noLogs.code) + ' | whitespace logs -> ' + (wsLogs && wsLogs.code) + ' | missing logs -> ' + (missingLogs && missingLogs.code));
ok(noLogs && noLogs.code === 'E_NO_LOGS' && noLogs.name === 'SemanticaError', 'P3c empty logs -> E_NO_LOGS (SemanticaError, no new error class)');
ok(wsLogs && wsLogs.code === 'E_NO_LOGS' && missingLogs && missingLogs.code === 'E_NO_LOGS', 'P3c whitespace-only and missing logs -> E_NO_LOGS as well');

// ─────────────────────────────────────────────────────────────────────────────
// P4 — mid-loop context injection, op-seq based, retrievable in order
// ─────────────────────────────────────────────────────────────────────────────
const r1 = addContext.inject('loop-alpha', { context: 'constraint: never merge with failing gates (Phase 23 A contract)' });
const r2 = addContext.inject('loop-alpha', { context: 'budget: two attempts left before escalation' });
const alpha = addContext.get('loop-alpha');
console.log('P4 inject #1 -> ' + JSON.stringify(r1) + ' | inject #2 -> ' + JSON.stringify(r2));
console.log('P4 get(loop-alpha): ' + JSON.stringify(alpha));
ok(alpha.length === 2 && alpha[0].context.includes('never merge with failing gates') && alpha[1].context.includes('two attempts left'), 'P4 injected contexts retrievable in injection order');
ok(alpha[0].injectedAt === r1.injectedAt && alpha[1].injectedAt === r2.injectedAt && r1.injectedAt < r2.injectedAt, 'P4 op-seq stamps match inject returns and strictly increase (' + r1.injectedAt + ' < ' + r2.injectedAt + ')');
ok(typeof r1.injectedAt === 'number' && Number.isInteger(r1.injectedAt), 'P4 injectedAt is an integer op-seq (no clocks)');
const beta1 = addContext.inject('loop-beta', { context: 'priority: root-cause before retry' });
const beta = addContext.get('loop-beta');
console.log('P4 inject(loop-beta) -> ' + JSON.stringify(beta1) + ' | get(loop-beta): ' + JSON.stringify(beta));
ok(beta.length === 1 && beta[0].injectedAt === beta1.injectedAt && beta1.injectedAt > r2.injectedAt, 'P4 op-seq is per-instance and shared across loopIds (' + beta1.injectedAt + ' continues after ' + r2.injectedAt + ')');
ok(addContext.get('loop-unknown').length === 0, 'P4 unknown loopId reads as [] (empty, not an error)');
const isolated = createAddContext();
const iso1 = isolated.inject('loop-gamma', { context: 'isolated instance' });
ok(iso1.injectedAt === 1 && isolated.get('loop-gamma').length === 1 && addContext.get('loop-gamma').length === 0, 'P4 createAddContext() isolates counter and state (fresh op-seq starts at 1, invisible to the shared instance)');

// ─────────────────────────────────────────────────────────────────────────────
// P5 — determinism: byte-identical outputs for identical inputs
// ─────────────────────────────────────────────────────────────────────────────
const ev1 = JSON.stringify(diagnostics.evaluate(cleanInput));
const ev2 = JSON.stringify(diagnostics.evaluate(cleanInput));
const evd1 = JSON.stringify(diagnostics.evaluate(dirtyInput));
const evd2 = JSON.stringify(diagnostics.evaluate(dirtyInput));
const ddx1 = JSON.stringify(ciDoctor.diagnose({ logs: FAILURE_LOG }));
const ddx2 = JSON.stringify(ciDoctor.diagnose({ logs: FAILURE_LOG }));
const ac1 = createAddContext();
ac1.inject('l', { context: 'ctx-one' });
ac1.inject('l', { context: 'ctx-two' });
const ac2 = createAddContext();
ac2.inject('l', { context: 'ctx-one' });
ac2.inject('l', { context: 'ctx-two' });
console.log('P5 evaluate(clean) byte-identical: ' + (ev1 === ev2) + ' | evaluate(dirty): ' + (evd1 === evd2) + ' | diagnose: ' + (ddx1 === ddx2) + ' | addContext replay: ' + (JSON.stringify(ac1.get('l')) === JSON.stringify(ac2.get('l'))));
ok(ev1 === ev2 && evd1 === evd2, 'P5 evaluate twice -> byte-identical (clean + dirty)');
ok(ddx1 === ddx2, 'P5 diagnose twice -> byte-identical');
ok(JSON.stringify(ac1.get('l')) === JSON.stringify(ac2.get('l')), 'P5 addContext: same inject sequence in fresh instances -> byte-identical records (op-seq 1,2)');

// ─────────────────────────────────────────────────────────────────────────────
// P6 — zone check
// ─────────────────────────────────────────────────────────────────────────────
const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
const touched = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
const zoneRe = /^(harness\/hardening\/ralph\/|scripts\/phase23-)/;
const outside = touched.filter((p) => !zoneRe.test(p));
console.log('P6 touched paths:');
for (const p of touched) console.log('  ' + p + (zoneRe.test(p) ? '  [zone]' : '  [OUTSIDE ZONE]'));
ok(outside.length === 0, 'P6 zero paths outside the phase-23 zone (harness/hardening/ralph/** + scripts/phase23-*.mjs); clean committed tree passes vacuously');

console.log('');
console.log('SCOPE C: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
