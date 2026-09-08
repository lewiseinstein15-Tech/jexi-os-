/**
 * M6 — JUDGE CODE GATES regression suite.
 *
 * Proves: judgeVerdict() combines deterministic checks + independent model
 * verdicts honestly (checks-fail → FAIL, NEEDS WORK/BLOCKED → FAIL, no
 * model verdict → UNKNOWN, never a fake PASS); deterministicCodeChecks()
 * verifies delivered files offline (exists, non-empty, JS syntax via
 * node --check, escape rejection); and the autonomous coder runs the gate
 * over its real output (UNKNOWN offline with green checks, FAIL on broken
 * syntax, null when nothing was delivered).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-m6-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { deterministicCodeChecks, judgeVerdict } = await import('./src/services/CodeJudge.js');

console.log('\n== 1. judgeVerdict truth table ==');
const green = [{ name: 'exists:a', pass: true, detail: 'x' }];
ok(judgeVerdict({ checks: green, reviewVerdict: 'APPROVED', secVerdict: 'CLEARED' }).verdict === 'PASS', 'approved + cleared → PASS');
ok(judgeVerdict({ checks: green, reviewVerdict: 'APPROVED', secVerdict: null }).verdict === 'PASS', 'approved alone → PASS (coverage noted)');
{
  const v = judgeVerdict({ checks: green, reviewVerdict: 'APPROVED', secVerdict: null });
  ok(v.reasons.some((r) => r.includes('unavailable')), 'partial coverage is disclosed in reasons');
}
ok(judgeVerdict({ checks: green, reviewVerdict: null, secVerdict: null }).verdict === 'UNKNOWN', 'no model verdict → UNKNOWN (never fake PASS)');
ok(judgeVerdict({ checks: green, reviewVerdict: 'NEEDS WORK', secVerdict: 'CLEARED' }).verdict === 'FAIL', 'reviewer NEEDS WORK → FAIL');
ok(judgeVerdict({ checks: green, reviewVerdict: 'APPROVED', secVerdict: 'BLOCKED' }).verdict === 'FAIL', 'security BLOCKED → FAIL');
ok(judgeVerdict({ checks: [...green, { name: 'syntax:a', pass: false, detail: 'boom' }], reviewVerdict: 'APPROVED', secVerdict: 'CLEARED' }).verdict === 'FAIL', 'failed check beats model approval → FAIL');

console.log('\n== 2. deterministicCodeChecks over fixtures ==');
const ws = path.join(TMP, 'ws');
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, 'good.js'), 'console.log("ok");\n');
fs.writeFileSync(path.join(ws, 'bad.js'), 'function broken( {\n');
fs.writeFileSync(path.join(ws, 'empty.js'), '');
fs.writeFileSync(path.join(ws, 'notes.txt'), 'hello');
const cGood = deterministicCodeChecks(ws, ['good.js']);
ok(cGood.every((c) => c.pass) && cGood.some((c) => c.name === 'syntax:good.js'), 'valid JS passes all checks incl. syntax');
const cBad = deterministicCodeChecks(ws, ['bad.js']);
ok(cBad.some((c) => c.name === 'syntax:bad.js' && !c.pass), 'syntax error fails the syntax check with detail');
const cMissing = deterministicCodeChecks(ws, ['ghost.js']);
ok(cMissing.some((c) => !c.pass && c.detail.includes('missing')), 'claimed-but-missing file fails');
const cEmpty = deterministicCodeChecks(ws, ['empty.js']);
ok(cEmpty.some((c) => c.name === 'nonempty:empty.js' && !c.pass), 'empty file fails non-empty');
const cTxt = deterministicCodeChecks(ws, ['notes.txt']);
ok(cTxt.every((c) => c.pass) && !cTxt.some((c) => c.name.startsWith('syntax:')), 'non-JS gets presence checks, no syntax claim');
const cEsc = deterministicCodeChecks(ws, ['../escape.js']);
ok(cEsc.some((c) => !c.pass && c.detail.includes('escapes')), 'workspace escape rejected');
const cNone = deterministicCodeChecks(ws, []);
ok(cNone.length === 1 && !cNone[0].pass, 'no files → single failing check (nothing to judge)');

console.log('\n== 3. Coder runs the gate over real output (offline) ==');
const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');
const writeOk = (c) => ({ tool_call_id: c.id, content: JSON.stringify({ ok: true, kind: 'write-result', path: 'good.js', operation: 'create', size: 16 }) });
const ev = [];
const res = await runAutonomousCoding({
  query: 'build a good thing',
  sendEvent: (t, d) => ev.push(`${t}:${(d && d.message) || ''}`),
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'write', arguments: '{"file_path":"good.js","content":"x"}' }] },
    { text: '## Built\n\nCreated good.js.' },
  ],
  __executeOverride: async (calls) => calls.map((c) => writeOk(c)),
});
ok(res.gate && res.gate.verdict === 'UNKNOWN', `offline gate is UNKNOWN, not PASS (${res.gate && res.gate.verdict})`);
ok(res.gate && res.gate.checks.every((c) => c.pass), 'offline checks all green on valid output');
ok(res.statistics.verdict === 'UNKNOWN', 'statistics carry the verdict');
ok(/Judge gate: UNKNOWN/.test(res.summary), 'summary carries the honest gate line');
ok(ev.some((e) => e.includes('Judge gate: UNKNOWN')), 'gate event emitted to the stream');
ok(/Built/.test(res.summary), 'original summary text preserved (append-only)');

console.log('\n== 4. Broken syntax fails the gate ==');
const writeBad = (c) => ({ tool_call_id: c.id, content: JSON.stringify({ ok: true, kind: 'write-result', path: 'bad.js', operation: 'create', size: 18 }) });
const res2 = await runAutonomousCoding({
  query: 'build a broken thing',
  __mockCompletions: [
    { toolCalls: [{ id: 'c1', name: 'write', arguments: '{"file_path":"bad.js","content":"x"}' }] },
    { text: '## Built\n\nCreated bad.js.' },
  ],
  __executeOverride: async (calls) => calls.map((c) => writeBad(c)),
});
ok(res2.gate && res2.gate.verdict === 'FAIL', `broken syntax → FAIL (${res2.gate && res2.gate.verdict})`);
ok(res2.gate && res2.gate.checks.some((c) => c.name === 'syntax:bad.js' && !c.pass), 'failing check names the file');

console.log('\n== 5. Nothing delivered → no gate (never fake) ==');
const res3 = await runAutonomousCoding({ query: 'build nothing', __mockCompletions: [{ toolCalls: [] }] });
ok(res3.gate === null && res3.statistics.verdict === null, 'gate stays null with no files');
ok(!/Judge gate/.test(res3.summary), 'no gate line appended without a gate');

console.log(`\nM6 judge-gates: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
