/**
 * JEXI OS — Phase 8 Scope G — LIVE PROBE (re-runnable, raw output).
 *
 *   P1  real vulnerability (Scope A fixture) → pipeline run → verifier
 *       re-executes → 2 independent methods for the CRITICAL finding →
 *       VERIFIED → evidence attached to the graph node
 *   P2  FALSE vulnerability (/announce — escaped server-side) → doer
 *       claims EXPLOITED on naive substrings → verifier re-executes with
 *       strict verbatim observation → PoC fails → REJECTED → dropped
 *       from the report
 *   P3  verifier forced to run AS the exploiting agent → REFUSED
 *       (VERIFIER_IS_DOER) — zero requests issued
 *   P4  exploit attempt outside the engagement RoE scope → roi.verifier
 *       blocks (TARGET_NOT_IN_SCOPE) — zero requests issued
 *   P5  finding modified AFTER verification → evidence hash mismatch →
 *       verification INVALIDATED
 *
 * Usage: node scripts/phase8-g-probe.mjs [--port=4591]
 * Exit 0 iff every probe PASSES. State lives under
 * security/pipeline/.state/ (gitignored) — nothing leaks into git.
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflow, store } from '../security/pipeline/index.js';
import { startVulnApp } from '../security/pipeline/fixtures/vuln-app.js';
import { open as openGraph } from '../mind/knowledge/index.js';
import { ExploitVerifier } from '../tests/verification/verifiers/index.js';
import { planDraft } from '../security/engagements/planner.js';
import { assembleBundle } from '../security/engagements/bundle.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE_ROOT = path.join(MODULE_DIR, '..', 'security', 'pipeline');

const { values } = parseArgs({ options: { port: { type: 'string', default: '4591' } } });
const PORT = Number(values.port);
const TARGET = `http://127.0.0.1:${PORT}`;

/* ------------------------------ helpers --------------------------------- */

const results = [];
function check(probe, name, ok, detail) {
  results.push({ probe, name, ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${probe} — ${name}${detail !== undefined ? `\n         ${detail}` : ''}`);
  return ok;
}
function section(title) {
  console.log(`\n${'='.repeat(66)}\n${title}\n${'='.repeat(66)}`);
}
const j = (o) => JSON.stringify(o);

/* ------------------------------ setup ----------------------------------- */

const engagementId = `phase8-g-probe-${Date.now()}`;
const app = await startVulnApp({ port: PORT });
console.log(`[probe] target=${TARGET} engagement=${engagementId} pid=${process.pid}`);

try {
  /* ======================================================================
   * P1 — REAL vulnerability: full pipeline, verifier re-executes, VERIFIED
   * ====================================================================== */
  section('P1 — REAL vulnerability: verifier re-executes, CRITICAL verified with 2 methods, evidence on the graph node');

  const events = [];
  const wf = createWorkflow({ engagementId, sourceRoot: path.join(STATE_ROOT, 'fixtures'), baseUrl: TARGET, stateRoot: STATE_ROOT });
  for await (const event of wf.execute()) events.push(event);

  const verifEvents = events.filter((e) => e.phaseId === 'verification');
  for (const e of verifEvents.filter((e) => e.type === 'progress' || (e.type === 'log' && /F-006|F-011/.test(e.data.message || '')))) {
    console.log(`  event: ${j(e.data).slice(0, 260)}`);
  }

  const verification = store.readArtifact(STATE_ROOT, engagementId, 'verification.json');
  check('P1', 'verification phase ran (artifact produced)', Boolean(verification), `counts=${j(verification && verification.counts)}`);

  const f006 = verification.verified.find((v) => v.findingId === 'F-006');
  console.log(`  F-006 verification record: ${j({ ...f006, methods: f006.methods.map((m) => ({ name: m.name, success: m.success, request: m.request })) })}`);
  check('P1', 'exploit.verifier ran on F-006 (re-executed, not trusted)', f006 && f006.reExecuted === true);
  check('P1', 'F-006 (CRITICAL) VERIFIED', f006 && f006.status === 'VERIFIED');
  check('P1', '>= 2 INDEPENDENT methods observed for CRITICAL', f006 && f006.methodsSucceeded >= 2 && f006.methodsRequired === 2,
    `methods=${f006.methods.filter((m) => m.success).map((m) => m.name).join(' + ')}`);
  check('P1', 'verifier used its OWN method library (verifier-* names, own markers)', f006 && f006.methods.every((m) => m.name.startsWith('verifier-')));

  // evidence attached to the graph node (raw rows)
  const graphPath = path.join(STATE_ROOT, '.state', engagementId, 'graph.db');
  const raw = new DatabaseSync(graphPath);
  const vulnRow = raw.prepare("SELECT id, severity, description, evidence FROM vulnerabilities WHERE id = 'vuln-F-006'").get();
  const verifRow = raw.prepare("SELECT * FROM finding_verifications WHERE finding_id = 'F-006'").get();
  const exploitRow = raw.prepare("SELECT * FROM exploits WHERE id = 'expl-F-006'").get();
  console.log(`  graph vuln-F-006 evidence (${JSON.parse(vulnRow.evidence).length} line(s)):`);
  for (const line of JSON.parse(vulnRow.evidence)) console.log(`    | ${line.slice(0, 200)}`);
  check('P1', 'evidence attached to the graph node (verifier observation lines on vuln-F-006)',
    JSON.parse(vulnRow.evidence).some((l) => l.startsWith('verifier[security-verifier]')));
  check('P1', 'evidence snapshot hash committed (verifier-hash line + finding_verifications.evidence_hash)',
    JSON.parse(vulnRow.evidence).some((l) => l.startsWith('verifier-hash:')) && verifRow && /^[0-9a-f]{64}$/.test(verifRow.evidence_hash),
    `evidence_hash=${verifRow && verifRow.evidence_hash}`);
  check('P1', 'exploit row verified flag follows the verifier verdict', exploitRow && exploitRow.verified === 1);
  raw.close();

  const report = store.readArtifact(STATE_ROOT, engagementId, 'report.json');
  const reportedF006 = report.findings.find((f) => f.findingId === 'F-006');
  check('P1', 'F-006 reached the report with its verification block',
    Boolean(reportedF006) && reportedF006.verification && reportedF006.verification.status === 'VERIFIED',
    reportedF006 && `report.verification=${j(reportedF006.verification).slice(0, 220)}`);

  /* ======================================================================
   * P2 — FALSE vulnerability: doer over-claims, verifier REJECTS, report drops
   * ====================================================================== */
  section('P2 — FALSE vulnerability (/announce, escaped server-side): claim overturned, REJECTED, dropped');

  const explo = store.readArtifact(STATE_ROOT, engagementId, 'exploitation.json');
  const doerF011 = explo.validated.find((v) => v.findingId === 'F-011');
  console.log(`  doer claim: ${j({ findingId: 'F-011', status: doerF011.status, methods: doerF011.methods.map((m) => ({ name: m.name, success: m.success })) })}`);
  check('P2', 'fixture planted the false vulnerability (F-011 reached the pipeline)', Boolean(doerF011));
  check('P2', 'the DOER claimed EXPLOITED (naive substring methods on escaped input)', doerF011 && doerF011.status === 'EXPLOITED');

  const verifF011 = verification.verified.find((v) => v.findingId === 'F-011');
  console.log(`  verifier verdict: ${j({ findingId: 'F-011', doerClaim: verifF011.doerClaim, status: verifF011.status, methodsSucceeded: verifF011.methodsSucceeded, methodsRequired: verifF011.methodsRequired, reason: verifF011.reason })}`);
  console.log(`  doer claim audit: ${j(verifF011.doerClaimAudit)}`);
  check('P2', 'claim audit exposes the doer\'s methods as non-independent (same request twice)',
    verifF011.doerClaimAudit && verifF011.doerClaimAudit.claimedIndependent < 2,
    `claimedIndependent=${verifF011.doerClaimAudit && verifF011.doerClaimAudit.claimedIndependent}, reasons=${j(verifF011.doerClaimAudit && verifF011.doerClaimAudit.claimReasons)}`);
  check('P2', 'exploit.verifier ran on F-011 (re-executed independently)', verifF011 && verifF011.reExecuted === true);
  check('P2', 'PoC FAILED under strict verbatim observation → REJECTED', verifF011 && verifF011.status === 'REJECTED',
    verifF011 && `observations=${j(verifF011.methods.map((m) => ({ name: m.name, success: m.success })))}`);
  const escapedEcho = verifF011.methods.map((m) => m.responseExcerpt).join(' ');
  check('P2', 'evidence shows the server-side ESCAPE (raw marker absent, &lt;…&gt; present)',
    escapedEcho.includes('&lt;') && !escapedEcho.includes('<svg onload=jexi-verify-a9f3>'),
    `excerpt="${escapedEcho.slice(0, 190)}"`);
  check('P2', 'doer claim OVERTURNED recorded (EXPLOITED → REJECTED)', verifF011.doerClaim === 'EXPLOITED' && verifF011.status === 'REJECTED');

  const gateEvent = events.find((e) => e.type === 'log' && /verification gate: F-011 REJECTED/.test(e.data.message || ''));
  check('P2', 'reporting dropped F-011 with the explicit gate log', Boolean(gateEvent), gateEvent && gateEvent.data.message);
  check('P2', 'F-011 NOT in the report findings', !report.findings.some((f) => f.findingId === 'F-011'));
  check('P2', 'F-011 in the report dropped list', report.dropped.some((d) => d.findingId === 'F-011'),
    `dropped=${j(report.dropped.map((d) => d.findingId))}`);
  check('P2', 'report verification summary records the overturn', report.verification && report.verification.doerClaimsOverturned >= 1,
    `report.verification=${j(report.verification)}`);

  /* ======================================================================
   * P3 — same-agent verification attempt → REFUSED (verifier ≠ doer)
   * ====================================================================== */
  section('P3 — same-agent verification attempt: REFUSED (VERIFIER_IS_DOER), zero requests');

  const p3Dir = path.join(STATE_ROOT, '.state', `${engagementId}-p3`);
  const graphP3 = openGraph({ dbPath: path.join(p3Dir, 'graph.db') });
  const hostP3 = graphP3.host.create({ hostname: '127.0.0.1', tags: ['probe'] }).row;
  const svcP3 = graphP3.service.create({ hostId: hostP3.id, port: PORT, protocol: 'http' }).row;
  graphP3.vulnerability.create({ id: 'vuln-F-P3', serviceId: svcP3.id, severity: 'high', description: 'planted claim for P3', evidence: [] });
  graphP3.exploit.create({ id: 'expl-F-P3', vulnerabilityId: 'vuln-F-P3', method: 'doer-claim', payload: 'GET /search?q=<x>', succeeded: true, verified: true });
  let p3Fetches = 0;
  const spyFetch = () => { p3Fetches += 1; return fetch(...arguments); };
  const doerVerifier = new ExploitVerifier({
    graph: graphP3,
    agent: 'pipeline:exploitation', // FORCED: same identity as the doer
    fetchImpl: (...a) => spyFetch(...a),
  });
  const p3 = await doerVerifier.verifyFinding({
    finding: { id: 'F-P3', owasp: 'A03:2021 Injection (XSS)', location: { endpoint: '/search', param: 'q' }, severity: 'high' },
    record: { findingId: 'F-P3', severity: 'high', status: 'EXPLOITED', methods: [{ name: 'doer-claim', request: 'GET /search?q=<x>', success: true, responseExcerpt: '...' }] },
    target: TARGET,
    exploitedBy: 'pipeline:exploitation',
  });
  console.log(`  verdict: ${j({ status: p3.status, rule: p3.rule, reason: p3.reason, reExecuted: p3.reExecuted })}`);
  check('P3', 'verification REFUSED with rule VERIFIER_IS_DOER', p3.status === 'REFUSED' && p3.rule === 'VERIFIER_IS_DOER', p3.reason);
  check('P3', 'refused BEFORE execution — 0 requests issued', p3.reExecuted === false && p3Fetches === 0, `fetchCalls=${p3Fetches}`);
  const p3Rec = graphP3.verification.getByFinding('F-P3');
  check('P3', 'refusal persisted as an auditable REFUSED record (nothing VERIFIED)', p3Rec && p3Rec.status === 'REFUSED' && p3Rec.refusalRule === 'VERIFIER_IS_DOER');
  graphP3.close();

  /* ======================================================================
   * P4 — exploit outside the engagement RoE → roi.verifier blocks
   * ====================================================================== */
  section('P4 — RoE out-of-scope re-execution: roi.verifier blocks (TARGET_NOT_IN_SCOPE), zero requests');

  const draftP4 = planDraft({
    name: 'scope-g-p4-external-only',
    targets: ['ext-scope-target.test'], // the engagement's scope: NOT the fixture
    allowedActions: ['scan', 'exploit', 'verify', 'report'],
  });
  const engagementP4 = assembleBundle(draftP4);
  const p4Dir = path.join(STATE_ROOT, '.state', `${engagementId}-p4`);
  const graphP4 = openGraph({ dbPath: path.join(p4Dir, 'graph.db') });
  const hostP4 = graphP4.host.create({ hostname: '127.0.0.1', tags: ['probe'] }).row;
  const svcP4 = graphP4.service.create({ hostId: hostP4.id, port: PORT, protocol: 'http' }).row;
  graphP4.vulnerability.create({ id: 'vuln-F-P4', serviceId: svcP4.id, severity: 'critical', description: 'planted claim for P4', evidence: [] });
  graphP4.exploit.create({ id: 'expl-F-P4', vulnerabilityId: 'vuln-F-P4', method: 'doer-claim', payload: 'GET /item?id=…', succeeded: true, verified: true });
  let p4Fetches = 0;
  const outOfScopeVerifier = new ExploitVerifier({
    graph: graphP4,
    agent: 'security-verifier', // distinct from the doer — only RoE can stop it here
    fetchImpl: () => { p4Fetches += 1; return fetch(...arguments); },
  });
  const p4 = await outOfScopeVerifier.verifyFinding({
    finding: { id: 'F-P4', owasp: 'A03:2021 Injection', location: { endpoint: '/item', param: 'id' }, severity: 'critical' },
    record: { findingId: 'F-P4', severity: 'critical', status: 'EXPLOITED', methods: [{ name: 'doer-claim', request: 'GET /item?id=…', success: true, responseExcerpt: '...' }] },
    target: TARGET, // 127.0.0.1 — OUTSIDE the engagement scope
    engagement: engagementP4,
    exploitedBy: 'pipeline:exploitation',
  });
  console.log(`  verdict: ${j({ status: p4.status, rule: p4.rule, reason: p4.reason, reExecuted: p4.reExecuted })}`);
  check('P4', 'roi.verifier BLOCKED the out-of-scope re-execution', p4.status === 'REFUSED' && p4.rule === 'TARGET_NOT_IN_SCOPE', p4.reason);
  check('P4', 'blocked BEFORE execution — 0 requests issued', p4.reExecuted === false && p4Fetches === 0, `fetchCalls=${p4Fetches}`);
  const p4Rec = graphP4.verification.getByFinding('F-P4');
  check('P4', 'RoE refusal persisted as REFUSED record', p4Rec && p4Rec.status === 'REFUSED' && p4Rec.refusalRule === 'TARGET_NOT_IN_SCOPE');
  graphP4.close();

  /* ======================================================================
   * P5 — immutable snapshot: post-verification tampering → INVALIDATED
   * ====================================================================== */
  section('P5 — immutable snapshot: finding modified AFTER verification → hash mismatch → INVALIDATED');

  const graphP5 = openGraph({ dbPath: graphPath });
  const gateP5 = new ExploitVerifier({ graph: graphP5, agent: 'security-verifier' });
  const before = gateP5.integrityCheck({ findingId: 'F-006' });
  check('P5', 'baseline: snapshot intact right after verification', before.checked && before.intact === true, before.reason);

  // TAMPER: modify the verified finding behind the verifier's back
  const tamper = new DatabaseSync(graphPath);
  tamper.prepare("UPDATE vulnerabilities SET severity = 'low', description = description || ' [tampered: severity downgraded post-verification]' WHERE id = 'vuln-F-006'").run();
  tamper.close();
  console.log('  tamper applied: UPDATE vulnerabilities SET severity=\'low\' … WHERE id=\'vuln-F-006\'');

  const after = gateP5.integrityCheck({ findingId: 'F-006' });
  console.log(`  integrity: ${j({ intact: after.intact, expectedHash: after.expectedHash, actualHash: after.actualHash, status: after.status })}`);
  check('P5', 'evidence hash NO LONGER matches after modification', after.checked && after.intact === false);
  check('P5', 'expected vs actual hash differ (raw)', after.expectedHash !== after.actualHash,
    `expected=${after.expectedHash}\n         actual  =${after.actualHash}`);
  check('P5', 'verification INVALIDATED automatically', after.status === 'INVALIDATED' && Boolean(after.invalidatedAt), `invalidatedAt=${after.invalidatedAt}`);
  const p5Rec = graphP5.verification.getByFinding('F-006');
  check('P5', 'record status is INVALIDATED (treated as unverified everywhere)', p5Rec.status === 'INVALIDATED');
  const stillVerifiedReportLine = gateP5.verificationStatus({ findingId: 'F-011' }); // REJECTED unaffected
  check('P5', 'unrelated records untouched (F-011 still REJECTED)', stillVerifiedReportLine && stillVerifiedReportLine.status === 'REJECTED');
  graphP5.close();

  /* ------------------------------ summary --------------------------------- */
  section('SUMMARY');
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.probe} — ${r.name}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[probe] ${results.length - failed.length}/${results.length} checks passed; engagement state: ${path.join(STATE_ROOT, '.state', engagementId)}`);
  console.log(`[probe] DONE exit=${failed.length ? 1 : 0}`);
  process.exitCode = failed.length ? 1 : 0;
} catch (err) {
  console.error(`[probe] FAILED: ${err.stack || err.message}`);
  process.exitCode = 1;
} finally {
  app.close();
}
