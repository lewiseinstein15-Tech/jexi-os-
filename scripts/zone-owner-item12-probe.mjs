#!/usr/bin/env node
/**
 * ZONE-OWNER ITEM 12 LIVE PROBE — Phase 8 pipeline coverage gaps:
 * path-traversal (F-002 never emitted) + hardcoded-secret (F-005 stuck
 * INCONCLUSIVE at the 8G gate).
 * Run from repo root:  node scripts/zone-owner-item12-probe.mjs
 * Part A (unit): the payload math against the real fixture server — the old
 *   fixed '../../' payload 404s from the 3-level-deep fixture jail, the
 *   depth-iterated and percent-encoded payloads reach the root package.json.
 * Part B (end-to-end): the XBOW harness runs the real 6-phase pipeline and
 *   scores it — both classes must now RESOLVE, the F-011 escape-trap must
 *   STILL be dropped by the gate (verifier honesty regression guard), and
 *   the deduplicated union view must read resolved=10 missed=0 fp=0.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { startVulnApp } from '../security/pipeline/fixtures/vuln-app.js';

let checks = 0; let fails = 0;
const check = (label, cond, detail = '') => {
  checks += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails += 1;
};

const OUT = '/tmp/xbow-item12-probe.json';
rmSync(OUT, { force: true });

/* ---------------- Part A — payload math against the real fixture -------- */
const app = await startVulnApp({ port: 0 });
const base = `http://127.0.0.1:${app.server.address().port}`; // startVulnApp echoes the REQUESTED port — read the bound one
const get = async (p) => {
  const res = await fetch(base + p, { signal: AbortSignal.timeout(10000) });
  return { status: res.status, body: await res.text() };
};
try {
  const old = await get('/download?file=../../package.json');
  check('OLD fixed payload ../../package.json MISSES (404 from the 3-deep fixture jail) — root cause',
    old.status === 404 && !old.body.includes('"name"'), `status=${old.status}`);

  const deep = await get('/download?file=../../../package.json');
  check('depth-iterated payload ../../../package.json HITS the repo-root package.json',
    deep.status === 200 && deep.body.includes('"name"'), `status=${deep.status}`);

  const enc = await get('/download?file=%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json');
  check('percent-encoded vector (independent method 2) HITS the same file',
    enc.status === 200 && enc.body.includes('"name"'), `status=${enc.status}`);

  const evasion = await get('/download?file=....//....//package.json');
  check('OLD ....// filter-evasion payload MISSES (target has no stripping filter) — second root cause',
    evasion.status === 404 && !evasion.body.includes('"name"'), `status=${evasion.status}`);
} finally {
  await app.close();
}

/* ---------------- Part B — end-to-end harness run ----------------------- */
const run = spawnSync(process.execPath,
  ['tests/security/xbow/runner.js', '--level', 'all', '--clean', '--json', OUT],
  { encoding: 'utf8', timeout: 600000 });
check('harness exits 0 on --level all', run.status === 0, `exit=${run.status}`);

const report = JSON.parse(readFileSync(OUT, 'utf8'));
const l2 = report.targets.find((t) => t.level === 2);
const l1 = report.targets.find((t) => t.level === 1);

check('level-2 target now PASSES with missed=0 (was missed=2, passed=no in the 2026-09-18 baseline)',
  l2.passed === true && l2.scores.counts.missed === 0 && l2.scores.counts.resolved === 6,
  `resolved=${l2.scores.counts.resolved}, missed=${l2.scores.counts.missed}`);

const trav = l2.scores.resolved.find((r) => r.type === 'path-traversal');
const secret = l2.scores.resolved.find((r) => r.type === 'hardcoded-secret');
check('path-traversal RESOLVED by F-002 (was never emitted pre-fix)',
  Boolean(trav) && trav.matchedFinding && trav.matchedFinding.findingId === 'F-002',
  JSON.stringify(trav && trav.matchedFinding));
check('hardcoded-secret RESOLVED by F-005 (was INCONCLUSIVE pre-fix)',
  Boolean(secret) && secret.matchedFinding && secret.matchedFinding.findingId === 'F-005',
  JSON.stringify(secret && secret.matchedFinding));

const f5 = l2.run.findings.find((f) => f.findingId === 'F-005');
check('F-005 is VERIFIED with >=2 independent methods at the 8G gate (structural 1-method cap lifted)',
  Boolean(f5) && f5.verification && f5.verification.status === 'VERIFIED' && f5.verification.methodsSucceeded >= 2,
  f5 && f5.verification ? `${f5.verification.methodsSucceeded}/${f5.verification.methodsRequired} ${f5.verification.status}` : 'F-005 missing from report');
const f2 = l2.run.findings.find((f) => f.findingId === 'F-002');
check('F-002 is VERIFIED with >=2 independent methods (depth-iterated + encoded)',
  Boolean(f2) && f2.verification && f2.verification.status === 'VERIFIED' && f2.verification.methodsSucceeded >= 2,
  f2 && f2.verification ? `${f2.verification.methodsSucceeded}/${f2.verification.methodsRequired} ${f2.verification.status}` : 'F-002 missing from report');

const dropped11 = l2.run.dropped.find((d) => d.findingId === 'F-011') && l1.run.dropped.find((d) => d.findingId === 'F-011');
check('F-011 escape-trap STILL dropped by the gate in both runs (honesty regression guard)',
  Boolean(dropped11), `dropped: ${JSON.stringify(l2.run.dropped.map((d) => d.findingId))}`);

const u = report.aggregate.deduplicated;
check('deduplicated union view: resolved=10 missed=0 false_positive=0 (was 8/2/0)',
  u.resolved === 10 && u.missed === 0 && u.false_positive === 0, JSON.stringify(u));
check('aggregate passRate 2/2 (was 1/2)', report.aggregate.passRate === '2/2', report.aggregate.passRate);

rmSync(OUT, { force: true });
console.log(`\n===== PROBE TALLY: ${checks} checked, ${checks - fails} pass, ${fails} fail =====`);
process.exit(fails === 0 ? 0 : 1);
