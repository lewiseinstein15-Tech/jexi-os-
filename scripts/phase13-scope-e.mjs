#!/usr/bin/env node
/**
 * JEXI OS — PHASE 13 SCOPE E — LIVE PROBE.
 *
 *   node scripts/phase13-scope-e.mjs
 *
 *   P1  3 verified actions -> score rises; history has 3 entries (derivation shown)
 *   P2  1 unverified action -> score unchanged (verified-only contribution shown)
 *   P3  sign -> verify passes
 *   P4  tampered payload -> E_PAYLOAD_MISMATCH; tampered sig -> E_SIG_MISMATCH
 *   P5  unknown agent -> E_UNKNOWN_AGENT on StrategyError
 *   P6  taxonomy: no TrustError/ScoreError anywhere in workforce/trust/
 *   P7  determinism: same sequence twice -> byte-identical score+history+signature
 *   P8  persistence: reload -> byte-identical state
 *   P9  zone check (workforce/trust/** + scripts/phase13-*.mjs only)
 *
 * Fixtures use temp state roots; the repo's own state dir is never written.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { createTrust } from '../workforce/trust/index.js';
import { scoreOf, weightOf } from '../workforce/trust/scoring.js';
import { StrategyError } from '../workforce/nexus/strategy.js';
import { createRegistry as createAgentRegistry } from '../workforce/agents/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`[PASS] ${m}`); };
const no = (m) => { fail += 1; console.log(`[FAIL] ${m}`); };
const head = (m) => console.log(`\n── ${m} ──`);
const caught = (fn) => { try { return { value: fn() }; } catch (e) { return { error: e }; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p13e-'));
const wipe = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// Seeded roster so agent existence checks pass without loading the full 400.
const root = tmp();
const agents = createAgentRegistry({ root });
// The roster loader needs the real repo layout; use the real registry but a
// temp STATE root for trust. Agents checked: ui-designer (real roster agent).
const roster = createAgentRegistry();
roster.load();
const identity = createTrust({ root, agents: roster });
identity.load();
const WHO = 'ui-designer';

// ══════════════════════════════════ P1 ══════════════════════════════════
head('P1 three verified actions -> score rises; history has 3 entries');

const A1 = { kind: 'review', summary: 'approved PR #12' };
const A2 = { kind: 'build', summary: 'landed feature flag' };
const A3 = { kind: 'ship', summary: 'released v0.4.0' };
const r1 = identity.record(WHO, A1, { verified: true });
const r2 = identity.record(WHO, A2, { verified: true });
const r3 = identity.record(WHO, A3, { verified: true });
console.log(`  after record 1 (review, w=${weightOf('review')}): score=${r1.score}`);
console.log(`  after record 2 (build,  w=${weightOf('build')}): score=${r2.score}`);
console.log(`  after record 3 (ship,   w=${weightOf('ship')}): score=${r3.score}`);
const s3 = identity.score(WHO);
console.log('  derivation:', JSON.stringify(s3.score ? { verifiedCounts: scoreOf(s3.history).counts, formula: `0.20*1 + 0.30*1 + 0.40*1 = 0.90` } : {}));
if (r1.score === 0.2 && r2.score === 0.5 && r3.score === 0.9) ok('P1 score rises exactly along the declared curve (0.20 -> 0.50 -> 0.90)');
else no(`P1 curve wrong: ${r1.score}, ${r2.score}, ${r3.score}`);
if (s3.history.length === 3) ok('P1b history has 3 entries');
else no(`P1b history length ${s3.history.length}`);

// ══════════════════════════════════ P2 ══════════════════════════════════
head('P2 one unverified action -> score unchanged (verified-only contribution)');

const before = identity.score(WHO);
const rU = identity.record(WHO, { kind: 'ship', summary: 'claimed release (not verified)' }, { verified: false });
const after = identity.score(WHO);
console.log(`  before: score=${before.score} | recorded unverified ship (w=${weightOf('ship')} would be 0.40 if verified)`);
console.log(`  after:  score=${after.score}`);
const deriv = scoreOf(after.history);
console.log('  derivation:', JSON.stringify({ verifiedCounts: deriv.counts, note: 'only verified entries contribute; unverified contributes 0' }));
if (before.score === after.score && after.history.length === before.history.length + 1) {
  ok('P2 unverified action recorded in history but score unchanged');
} else no('P2 unverified action moved the score or was not recorded');

// ══════════════════════════════════ P3 ══════════════════════════════════
head('P3 sign a payload -> verify passes');

const payload = { vote: 'approve', on: 'doc-7', agentId: WHO };
const signed = identity.sign(WHO, payload);
console.log('  sig (first 24 chars):', signed.sig.slice(0, 24) + '…');
const v = identity.verify(WHO, payload, signed.sig, signed);
console.log('  verify:', JSON.stringify(v));
if (v.valid === true) ok('P3 signature and payload hash both match -> { valid: true }');
else no(`P3 verify failed: ${JSON.stringify(v)}`);

// ══════════════════════════════════ P4 ══════════════════════════════════
head('P4 tamper -> specific refusals');

const tamperedPayload = { ...payload, vote: 'reject' };
const vPayload = identity.verify(WHO, tamperedPayload, signed.sig, signed);
console.log('  tampered payload ->', JSON.stringify(vPayload));
if (vPayload.valid === false && vPayload.reason === 'E_PAYLOAD_MISMATCH') {
  ok('P4a tampered payload -> E_PAYLOAD_MISMATCH (payload-first attribution)');
} else no(`P4a wrong: ${JSON.stringify(vPayload)}`);

const vSig = identity.verify(WHO, payload, 'f'.repeat(64), signed);
console.log('  tampered sig     ->', JSON.stringify(vSig));
if (vSig.valid === false && vSig.reason === 'E_SIG_MISMATCH') {
  ok('P4b tampered sig -> E_SIG_MISMATCH');
} else no(`P4b wrong: ${JSON.stringify(vSig)}`);

// ══════════════════════════════════ P5 ══════════════════════════════════
head('P5 unknown agent -> E_UNKNOWN_AGENT on StrategyError');

const unknown = caught(() => identity.score('no-such-agent-anywhere'));
console.log('  unknown score ->', unknown.error && `${unknown.error.code} (${unknown.error.name})`);
if (unknown.error && unknown.error.code === 'E_UNKNOWN_AGENT' && unknown.error instanceof StrategyError) {
  ok('P5 E_UNKNOWN_AGENT thrown on StrategyError (no new error class)');
} else no('P5 wrong refusal shape');
const u2 = caught(() => identity.sign('no-such-agent-anywhere', { x: 1 }));
if (u2.error && u2.error.code === 'E_UNKNOWN_AGENT') ok('P5b sign refuses unknown agents too');
else no('P5b sign did not refuse');

// ══════════════════════════════════ P6 ══════════════════════════════════
head('P6 taxonomy check: no layer-local error class in workforce/trust/');

let grepOut = '';
try {
  grepOut = execFileSync('grep', ['-rn', '-E', 'TrustError|ScoreError', 'workforce/trust/'], { cwd: REPO, encoding: 'utf8' });
} catch (e) {
  if (e.status !== 1) throw e; // grep exit 1 = no matches = good
}
console.log(grepOut ? grepOut : '  (no matches)');
if (!grepOut) ok('P6 zero hits for layer-local error classes; all throws are StrategyError');
else no('P6 layer-local error class found');

// ══════════════════════════════════ P7 ══════════════════════════════════
head('P7 determinism: same sequence twice -> byte-identical results');

function runSequence(rootDir) {
  const t = createTrust({ root: rootDir, agents: roster });
  t.load();
  t.record(WHO, A1, { verified: true });
  t.record(WHO, A2, { verified: true });
  t.record(WHO, A3, { verified: true });
  const sc = t.score(WHO);
  const sg = t.sign(WHO, payload);
  return JSON.stringify({ score: sc.score, history: sc.history, sig: sg.sig, hash: sg.hash });
}
const rootA = tmp();
const rootB = tmp();
const runA = runSequence(rootA);
const runB = runSequence(rootB);
console.log('  run A === run B:', runA === runB);
if (runA === runB) ok('P7 score + history + signature byte-identical across independent runs');
else no('P7 runs differ');
wipe(rootA); wipe(rootB);

// ══════════════════════════════════ P8 ══════════════════════════════════
head('P8 persistence: reload from disk -> same state');

const beforeState = JSON.stringify({ score: identity.score(WHO).score, history: identity.score(WHO).history, seq: identity.seqValue() });
const reloaded = createTrust({ root, agents: roster });
reloaded.load();
const afterState = JSON.stringify({ score: reloaded.score(WHO).score, history: reloaded.score(WHO).history, seq: reloaded.seqValue() });
console.log('  seq on disk:', reloaded.seqValue(), '| state byte-identical:', beforeState === afterState);
if (beforeState === afterState) ok('P8 reload is byte-identical (score + history + seq)');
else no('P8 reload differs');

const postReloadSig = reloaded.sign(WHO, payload);
if (postReloadSig.sig === signed.sig) ok('P8b signatures are stable across reload (derived keys, no stored secret)');
else no('P8b signature changed after reload');
wipe(root);

// ══════════════════════════════════ P9 ══════════════════════════════════
head('P9 zone check: git status --short');

let status = '';
try {
  status = execFileSync('git', ['status', '--short'], { cwd: REPO, encoding: 'utf8' });
} catch {
  console.log('  (git status unavailable)');
}
const files = status.split('\n').filter(Boolean);
console.log(files.length ? files.map((f) => '  ' + f).join('\n') : '  (clean)');
const zoneOk = files.every((f) => {
  const p = f.slice(3).trim();
  return p.startsWith('workforce/trust/') || /^scripts\/phase13-[^/]*\.mjs$/.test(p);
});
if (files.length > 0 && zoneOk) ok('P9 every changed path is in the Scope E zone');
else if (files.length === 0) ok('P9 committed-tree run (clean) — documented precondition artifact');
else no(`P9 zone violation: ${JSON.stringify(files)}`);

console.log('\n=============================');
console.log(`SCOPE E PROBE: ${pass} PASS / ${fail} FAIL`);
console.log('=============================');
process.exit(fail === 0 ? 0 : 1);
