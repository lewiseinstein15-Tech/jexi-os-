/**
 * JEXI OS — Phase 23 Scope A — live probe for madtea atomic finish.
 * Run from repo root: node scripts/phase23-madtea-probe.mjs
 *
 * P1  dryRun -> 5-step sequence, no side effects
 * P2  finish() sandbox -> real commit, push aborts E_NO_REMOTE (step named)
 * P3  gate failure aborts BEFORE merge -> gatesPassed: false + gate name
 * P4  credential leak detection -> E_CRED_LEAK, value withheld from output;
 *     inline credential refused; keyring keyRef resolves
 * P5  determinism -> dryRun twice, byte-identical plans
 * P6  zone check -> only harness/hardening/** + scripts/phase23-*.mjs touched
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { finish, dryRun, runGates, resolveCredentials, createSecretGuard } from '../harness/hardening/madtea/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('PASS ' + label); } else { fail += 1; console.log('FAIL ' + label); } };

/** Non-throwing git helper for fixture setup + assertions. */
const g = (cwd, args) => {
  try { return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: '', err: String(e.stderr || e.message) }; }
};

function makeRepo(dir, file, content) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const args of [['init'], ['config', 'user.email', 'probe@jexi.local'], ['config', 'user.name', 'Phase 23 Probe'], ['config', 'commit.gpgsign', 'false']]) {
    const r = g(dir, args);
    if (!r.ok) throw new Error('fixture git ' + args.join(' ') + ' failed: ' + r.err);
  }
  fs.writeFileSync(path.join(dir, file), content);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-m', 'initial']);
  return dir;
}

const FIX = '/tmp/p23-madtea';

// ─────────────────────────────────────────────────────────────────────────────
// P1 — dryRun shows the exact 5-step sequence; no side effects
// ─────────────────────────────────────────────────────────────────────────────
const repo1 = makeRepo(FIX + '/repo1', 'a.txt', 'one\n');
const headBefore = g(repo1, ['rev-parse', 'HEAD']).out.trim();

const planFull = dryRun({ branch: 'feature/p1', message: 'phase-23 probe p1', gates: [{ name: 'smoke', cmd: 'exit 0' }] });
console.log('P1 dryRun(full) steps: ' + JSON.stringify(planFull.steps));
ok(planFull.steps.length === 5 && planFull.steps.map((s) => s.name).join(',') === 'commit,push,pr,gates,merge', 'P1 dryRun shows the 5-step sequence commit->push->pr->gates->merge');
ok(planFull.steps.every((s) => s.willRun === true), 'P1 all 5 steps willRun: true (full mode, gates configured)');

const headAfter = g(repo1, ['rev-parse', 'HEAD']).out.trim();
const branchAbsent = !g(repo1, ['rev-parse', '--verify', 'refs/heads/feature/p1']).ok;
const cleanTree = g(repo1, ['status', '--porcelain']).out.trim() === '';
ok(headBefore === headAfter && branchAbsent && cleanTree, 'P1 no side effects: HEAD unchanged, branch not created, tree clean');

const planNoGates = dryRun({ branch: 'feature/p1', message: 'phase-23 probe p1' });
console.log('P1 dryRun(no gates) gates step: ' + JSON.stringify(planNoGates.steps.find((s) => s.name === 'gates')));
ok(planNoGates.steps.find((s) => s.name === 'gates').willRun === false, 'P1 gates not configured -> gates willRun: false with reason');

// ─────────────────────────────────────────────────────────────────────────────
// P2 — finish() in sandbox: commit executes (real git), push aborts E_NO_REMOTE
// ─────────────────────────────────────────────────────────────────────────────
const repo2 = makeRepo(FIX + '/repo2', 'b.txt', 'two\n');
fs.writeFileSync(path.join(repo2, 'work.txt'), 'phase-23 A probe work\n');
const p2 = finish({ repoDir: repo2, branch: 'feature/p2', message: 'phase-23 probe: p2 atomic finish commit' });
console.log('P2 abort result: ' + JSON.stringify(p2, null, 2));
ok(p2.committed === true && typeof p2.sha === 'string' && p2.sha.length === 40, 'P2 commit executed for real (committed: true, 40-hex sha)');
ok(p2.sha === g(repo2, ['rev-parse', 'HEAD']).out.trim(), 'P2 result sha equals actual git HEAD of the temp repo');
ok(g(repo2, ['log', '--format=%s', '-1']).out.trim() === 'phase-23 probe: p2 atomic finish commit', 'P2 commit message recorded in the temp repo');
ok(p2.pushed === false && p2.prOpened === false && p2.merged === false, 'P2 push/pr/merge all false — nothing faked');
ok(p2.abortedAt === 'push' && p2.errorCode === 'E_NO_REMOTE', 'P2 aborted at the named step: push, E_NO_REMOTE');
ok(typeof p2.reason === 'string' && p2.reason.startsWith('push:'), 'P2 reason names the step: ' + p2.reason);
ok(g(repo2, ['rev-parse', '--verify', 'refs/heads/feature/p2']).ok, 'P2 branch feature/p2 exists in temp repo (real checkout -b ran)');

// ─────────────────────────────────────────────────────────────────────────────
// P3 — gate failure aborts BEFORE merge (localOnly exposes the gates step
//      offline: network steps are skipped with E_NO_REMOTE, never faked)
// ─────────────────────────────────────────────────────────────────────────────
const repo3 = makeRepo(FIX + '/repo3', 'c.txt', 'three\n');
fs.writeFileSync(path.join(repo3, 'work.txt'), 'p3 work\n');
const p3 = finish({
  repoDir: repo3, branch: 'feature/p3', message: 'phase-23 probe: p3 gate failure', localOnly: true,
  gates: [{ name: 'unit-tests', cmd: 'echo "3 unit tests failed" >&2; exit 1' }],
});
console.log('P3 gate-failure result: ' + JSON.stringify(p3, null, 2));
ok(p3.gatesPassed === false && p3.merged === false && p3.reason === 'unit-tests' && p3.abortedAt === 'gates' && p3.errorCode === 'E_GATE_FAILED', 'P3 contract shape: merged: false, gatesPassed: false, reason = gate name, aborted BEFORE merge');
ok(Array.isArray(p3.gateResults) && p3.gateResults[0].name === 'unit-tests' && p3.gateResults[0].passed === false && p3.gateResults[0].exitCode === 1, 'P3 gateResults capture the failing gate (name, passed: false, exitCode: 1)');

// P3b control — passing gates complete the localOnly subset; merge still refused
const repo3b = makeRepo(FIX + '/repo3b', 'c2.txt', 'three-b\n');
fs.writeFileSync(path.join(repo3b, 'work.txt'), 'p3b work\n');
const p3b = finish({
  repoDir: repo3b, branch: 'feature/p3b', message: 'phase-23 probe: p3b gates pass', localOnly: true,
  gates: [{ name: 'smoke', cmd: 'exit 0' }, { name: 'pure-check', check: () => true }],
});
console.log('P3b gates-pass result: ' + JSON.stringify(p3b, null, 2));
ok(p3b.gatesPassed === true && p3b.committed === true && p3b.pushed === false && p3b.prOpened === false && p3b.merged === false, 'P3b gates ran and passed; network steps remain refused (never faked)');
ok(p3b.steps.filter((s) => ['push', 'pr', 'merge'].includes(s.name)).every((s) => s.ran === false && s.code === 'E_NO_REMOTE'), 'P3b skipped network steps each recorded E_NO_REMOTE in the ledger');
ok(p3b.gateResults.length === 2 && p3b.gateResults.every((r) => r.passed === true), 'P3b both gates (cmd + check) executed and passed');

// ─────────────────────────────────────────────────────────────────────────────
// P4 — credential leak detection (value withheld from every output surface)
// ─────────────────────────────────────────────────────────────────────────────
const FAKE = 'jexitok-fake-7c9e1f4a2b';
process.env.MADTEA_PROBE_TOKEN = FAKE;

const envCred = resolveCredentials({ keyRef: 'MADTEA_PROBE_TOKEN' });
console.log('P4 env credential resolved: found=' + envCred.found + ' source=' + envCred.source + ' (value withheld)');
ok(envCred.found === true && envCred.source === 'env:MADTEA_PROBE_TOKEN', 'P4 keyRef resolves a credential from env (reference only, value never shown)');

const keyringCred = resolveCredentials({ keyRef: 'keyring:madtea/probe', keyring: { 'madtea/probe': FAKE } });
console.log('P4 keyring credential resolved: found=' + keyringCred.found + ' source=' + keyringCred.source + ' (value withheld)');
ok(keyringCred.found === true && keyringCred.source === 'keyring:madtea/probe', 'P4 keyring:<ref> keyRef resolves against the caller-supplied keyring');

const repo4 = makeRepo(FIX + '/repo4', 'd.txt', 'four\n');
fs.writeFileSync(path.join(repo4, 'work.txt'), 'p4 work\n');
const p4 = finish({
  repoDir: repo4, branch: 'feature/p4', message: 'phase-23 probe: p4 leak check', localOnly: true,
  keyRef: 'MADTEA_PROBE_TOKEN',
  // A tool that PASSES but prints the credential into its output:
  gates: [{ name: 'leaky-tool', cmd: 'echo "debug: token=$MADTEA_PROBE_TOKEN"; exit 0' }],
});
console.log('P4 leak-abort result: ' + JSON.stringify(p4, null, 2));
ok(p4.errorCode === 'E_CRED_LEAK' && p4.abortedAt === 'gates', 'P4 E_CRED_LEAK raised, operation aborted at the leaking step (even though the gate itself passed)');
ok(!JSON.stringify(p4).includes(FAKE), 'P4 credential value NOT present anywhere in the finish result');
ok(typeof p4.reason === 'string' && p4.reason.includes('value withheld') && !p4.reason.includes(FAKE), 'P4 abort reason names the leak but withholds the value');

const guard = createSecretGuard([FAKE]);
const redacted = guard.redact('debug: token=' + FAKE + ' end');
console.log('P4 guard.redact sample: ' + redacted);
ok(redacted === 'debug: token=[REDACTED] end' && !redacted.includes(FAKE), 'P4 SecretGuard.redact replaces the credential with [REDACTED]');

// P4b inline credential refused outright
let inlineErr = null;
try {
  finish({ repoDir: repo4, branch: 'feature/p4b', message: 'x', localOnly: true, token: FAKE });
} catch (e) { inlineErr = e; }
console.log('P4b inline credential -> ' + (inlineErr ? inlineErr.code + ': ' + inlineErr.message : 'NOT REFUSED'));
ok(inlineErr && inlineErr.code === 'E_INLINE_KEY_REFUSED' && !String(inlineErr.message).includes(FAKE), 'P4b inline token prop refused E_INLINE_KEY_REFUSED (field named, value absent)');

// ─────────────────────────────────────────────────────────────────────────────
// P5 — determinism: dryRun twice -> byte-identical plans
// ─────────────────────────────────────────────────────────────────────────────
const planA1 = dryRun({ branch: 'feature/x', message: 'm', gates: [{ name: 't', cmd: 'exit 0' }] });
const planA2 = dryRun({ branch: 'feature/x', message: 'm', gates: [{ name: 't', cmd: 'exit 0' }] });
const planL1 = dryRun({ branch: 'feature/x', message: 'm', localOnly: true });
const planL2 = dryRun({ branch: 'feature/x', message: 'm', localOnly: true });
console.log('P5 full-mode plans byte-identical: ' + (JSON.stringify(planA1) === JSON.stringify(planA2)));
console.log('P5 localOnly plans byte-identical: ' + (JSON.stringify(planL1) === JSON.stringify(planL2)));
ok(JSON.stringify(planA1) === JSON.stringify(planA2) && JSON.stringify(planL1) === JSON.stringify(planL2), 'P5 same input -> byte-identical dryRun plan (full + localOnly)');

// ─────────────────────────────────────────────────────────────────────────────
// P6 — zone check: only harness/hardening/** + scripts/phase23-*.mjs touched
// ─────────────────────────────────────────────────────────────────────────────
const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
const touched = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
const zoneRe = /^(harness\/hardening\/|scripts\/phase23-)/;
const outside = touched.filter((p) => !zoneRe.test(p));
console.log('P6 touched paths:');
for (const p of touched) console.log('  ' + p + (zoneRe.test(p) ? '  [zone]' : '  [OUTSIDE ZONE]'));
ok(outside.length === 0, 'P6 zero paths outside the phase-23 zone (harness/hardening/** + scripts/phase23-*.mjs); clean committed tree passes vacuously');

console.log('');
console.log('SCOPE A: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
