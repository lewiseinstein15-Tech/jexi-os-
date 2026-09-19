/**
 * JEXI OS — Phase 8 Scope D: LIVE PROBE RUNNER (re-runnable, raw output).
 *
 * One mode per formal probe. Every mode prints raw JSON — no summaries.
 *
 *   p1         plan an engagement, print the full 8-doc bundle + OPPLAN
 *   p2         validate ALLOWED action            (scan @ 127.0.0.1, in window)
 *   p3         validate FORBIDDEN target          (scan @ 10.0.0.1)
 *   p4         validate FORBIDDEN action          (delete @ 127.0.0.1)
 *   p5         validate OUT-OF-TIME-WINDOW action (window ended in the past)
 *   p6         pipeline + valid engagement → all actions allowed, audit written
 *   p7         pipeline + forbidden target → HALTED at first action
 *   p8-create  engagement where exploit requires approval
 *   p8-run     pipeline run (halts at exploitation pre-approval; use --resume)
 *   p8-approve grant the approval
 *   p9         persistence: load engagement created by an earlier (killed)
 *              process and byte-compare against its receipt
 *   p10        execute the cleanup document, print removal receipts
 *   p11        signature: sign → tamper (raw SQL) → FAIL → restore → PASS
 *
 * Usage: node probe.js --mode=p1 [--db=PATH] [--engagement=ID] [--port=N]
 *                   [--resume] [--receipt=PATH]
 */

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflow } from '../pipeline/index.js';
import { startVulnApp } from '../pipeline/fixtures/vuln-app.js';
import { openEngagements } from './index.js';
import { validateRoE } from './validator.js';
import { renderOpplan } from './bundle.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = path.resolve(MODULE_DIR, '..', 'pipeline');

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    db: { type: 'string' },
    engagement: { type: 'string' },
    port: { type: 'string', default: '4491' },
    resume: { type: 'boolean', default: false },
    receipt: { type: 'string' },
    hold: { type: 'boolean', default: false },
  },
});

const mode = values.mode;
if (!mode) {
  console.error('usage: node probe.js --mode=<p1..p11|p8-create|p8-run|p8-approve> [--db=PATH] [--engagement=ID] [--port=N] [--resume] [--receipt=PATH]');
  process.exit(2);
}

const dbPath = values.db || path.join(MODULE_DIR, '.data', `probe-${mode}.db`);
const eng = openEngagements({ dbPath });
const J = (x) => console.log(JSON.stringify(x, null, 2));

/* ------------------------------ RoE templates ----------------------------- */

function p1Input(now = Date.now()) {
  return {
    name: 'sandbox-roe-demo',
    targets: ['127.0.0.1'],
    forbidden: ['10.0.0.1'],
    networks: [],
    allowedActions: ['scan', 'exploit'],
    forbiddenActions: ['delete', 'exfiltrate'],
    requiresApproval: [],
    timeWindows: [{ start: new Date(now - 3600e3).toISOString(), end: new Date(now + 3600e3).toISOString() }],
    contacts: [
      { name: 'Blue Team Lead', email: 'blue-team@example.test', role: 'blue-team coordinator' },
      { name: 'Authorization Owner', email: 'owner@example.test', role: 'authorization owner' },
    ],
    coordinationWindows: [{ start: new Date(now - 3600e3).toISOString(), end: new Date(now + 3600e3).toISOString() }],
    dataHandling: { collected: ['findings', 'evidence excerpts', 'pipeline artifacts'], retention: 30, classification: 'confidential' },
    cleanupSteps: [
      'remove engagement artifacts and collected data from disk',
      'remove any test accounts or credentials provisioned during the engagement',
      'verify no residual changes persist on the target',
    ],
  };
}

const outOfWindowInput = (now = Date.now()) => ({
  ...p1Input(now),
  name: 'sandbox-expired-window',
  timeWindows: [{ start: new Date(now - 7200e3).toISOString(), end: new Date(now - 3600e3).toISOString() }],
});

/* --------------------------------- modes ---------------------------------- */

if (mode === 'p1') {
  const e = eng.plan(p1Input());
  console.log(`[p1] engagement planned: ${e.id} (db=${dbPath})`);
  J(e);
  console.log('\n[p1] ===== 8-DOCUMENT OPPLAN =====');
  console.log(renderOpplan(e));
  if (values.receipt) {
    // raw persisted bytes for the P9 byte-comparison (bundle column as stored)
    const raw = JSON.stringify({ ...e, approvals: undefined }, null, 2) + '\n';
    fs.mkdirSync(path.dirname(values.receipt), { recursive: true });
    fs.writeFileSync(values.receipt, raw);
    console.log(`[p1] receipt written: ${values.receipt}`);
  }
  if (values.hold) {
    // bundle is durable (SQLite WAL, synchronous write) — hold the process
    // open so the P9 probe can SIGKILL it and prove persistence the hard way
    console.error('[p1] bundle persisted — holding process open (awaiting SIGKILL)');
    setInterval(() => {}, 1_000_000); // keep the event loop alive indefinitely
    await new Promise(() => {});
  }
} else if (mode === 'p2') {
  const e = eng.get(values.engagement);
  const v = validateRoE(e, { action: 'scan', target: '127.0.0.1', at: new Date() });
  console.log(`[p2] action=scan target=127.0.0.1 engagement=${e.id}`);
  J(v);
} else if (mode === 'p3') {
  const e = eng.get(values.engagement);
  const v = validateRoE(e, { action: 'scan', target: '10.0.0.1', at: new Date() });
  console.log(`[p3] action=scan target=10.0.0.1 engagement=${e.id}`);
  J(v);
} else if (mode === 'p4') {
  const e = eng.get(values.engagement);
  const v = validateRoE(e, { action: 'delete', target: '127.0.0.1', at: new Date() });
  console.log(`[p4] action=delete target=127.0.0.1 engagement=${e.id}`);
  J(v);
} else if (mode === 'p5') {
  const e = eng.plan(outOfWindowInput());
  console.log(`[p5] engagement with past-ended window planned: ${e.id}`);
  const v = validateRoE(e, { action: 'scan', target: '127.0.0.1', at: new Date() });
  console.log('[p5] validation at now:');
  J(v);
} else if (mode === 'p6' || mode === 'p7') {
  const port = Number(values.port);
  const now = Date.now();
  const input = mode === 'p6'
    ? { ...p1Input(now), name: 'pipeline-allowed', allowedActions: ['scan', 'exploit', 'verify', 'report'] } // Phase 8(G): verification re-executes exploits — the RoE must authorize it
    : { ...p1Input(now), name: 'pipeline-forbidden-target', targets: ['10.0.0.1'], forbidden: ['127.0.0.1'], allowedActions: ['scan', 'exploit', 'verify', 'report'] };
  const e = eng.plan(input);
  console.log(`[${mode}] engagement ${e.id} planned (targets=${JSON.stringify(e.scope.targets)} forbidden=${JSON.stringify(e.scope.forbidden)})`);
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = mode === 'p6' ? await startVulnApp({ port }) : null;
  try {
    const wf = createWorkflow({
      engagementId: e.id,
      sourceRoot: path.join(PIPELINE_DIR, 'fixtures'),
      baseUrl,
      stateRoot: PIPELINE_DIR,
      engagement: eng.get(e.id),
      engagementsStore: eng,
    });
    for await (const event of wf.execute({ resume: false })) {
      // raw: every event, flagged so the engagement gate lines are greppable
      console.log(JSON.stringify(event));
    }
    console.log(`[${mode}] PIPELINE COMPLETED — audit log:`);
    J(eng.auditLog(e.id));
  } catch (err) {
    console.log(`[${mode}] PIPELINE ABORTED — ${err.name}: ${err.message}`);
    console.log(`[${mode}] audit log at abort:`);
    J(eng.auditLog(e.id));
    if (mode === 'p6') { console.log(`[p6] UNEXPECTED ABORT — treating as failure`); process.exitCode = 1; }
  } finally {
    if (app) await app.close();
  }
} else if (mode === 'p8-create') {
  const now = Date.now();
  const e = eng.plan({
    ...p1Input(now),
    name: 'pipeline-approval-required',
    allowedActions: ['scan', 'exploit', 'verify', 'report'], // Phase 8(G): verify authorizes the verification phase's re-execution
    requiresApproval: ['exploit'],
  });
  console.log(`[p8-create] engagement ${e.id} planned — requiresApproval=${JSON.stringify(e.roe.requiresApproval)}`);
  console.log(`[p8-create] ENGAGEMENT_ID=${e.id}`);
} else if (mode === 'p8-run') {
  const port = Number(values.port);
  const e = eng.get(values.engagement);
  if (!e) { console.error(`[p8-run] no engagement ${values.engagement}`); process.exit(1); }
  const app = await startVulnApp({ port });
  try {
    const wf = createWorkflow({
      engagementId: e.id,
      sourceRoot: path.join(PIPELINE_DIR, 'fixtures'),
      baseUrl: `http://127.0.0.1:${port}`,
      stateRoot: PIPELINE_DIR,
      engagement: eng.get(e.id), // fresh read: approvals granted between runs are visible
      engagementsStore: eng,
    });
    for await (const event of wf.execute({ resume: values.resume })) {
      console.log(JSON.stringify(event));
    }
    console.log('[p8-run] PIPELINE COMPLETED — final engagement approvals:');
    J(eng.get(e.id).approvals);
  } catch (err) {
    console.log(`[p8-run] PIPELINE PAUSED/ABORTED — ${err.name}: ${err.message}`);
  } finally {
    await app.close();
  }
} else if (mode === 'p8-approve') {
  const e = eng.grantApproval(values.engagement, { action: 'exploit', grantedBy: 'authorization owner', note: 'P8 live approval' });
  console.log(`[p8-approve] approval granted on ${e.id}:`);
  J(e.approvals);
} else if (mode === 'p9') {
  const e = eng.get(values.engagement);
  if (!e) { console.error(`[p9] no engagement ${values.engagement} — P1 must run first`); process.exit(1); }
  console.log(`[p9] loaded engagement ${e.id} from ${dbPath} (fresh process, previous process was SIGKILLed)`);
  J(e);
  if (values.receipt && fs.existsSync(values.receipt)) {
    const receiptRaw = fs.readFileSync(values.receipt, 'utf8');
    const dbRaw = JSON.stringify({ ...e, approvals: undefined }, null, 2) + '\n';
    const identical = receiptRaw === dbRaw;
    console.log(`[p9] receipt bytes === db bundle bytes: ${identical}`);
    console.log(`[p9] IDENTICAL: ${identical}`);
  }
} else if (mode === 'p10') {
  const id = values.engagement;
  const target10 = eng.get(id);
  if (!target10) { console.error(`[p10] no engagement ${id}`); process.exit(1); }
  const collectionDir = path.resolve(target10.dataHandling.storage); // stage at the DECLARED storage path
  fs.mkdirSync(collectionDir, { recursive: true });
  fs.writeFileSync(path.join(collectionDir, 'findings.json'), JSON.stringify({ staged: 'collected findings copy for P10' }, null, 2));
  fs.writeFileSync(path.join(collectionDir, 'evidence-001.txt'), 'evidence excerpt captured during the engagement\n'.repeat(10));
  console.log(`[p10] staged collected data at ${collectionDir} (the engagement's declared dataHandling.storage)`);
  const receipt = eng.runCleanup(id, { stateRoots: [PIPELINE_DIR] });
  console.log('[p10] cleanup receipt:');
  J(receipt);
  const after = eng.get(id);
  console.log('[p10] persisted bundle after cleanup:');
  J({ cleanup: after.cleanup });
  console.log(`[p10] declared storage dir still present: ${fs.existsSync(collectionDir)}`);
  console.log(`[p10] pipeline state dir still present: ${fs.existsSync(path.join(PIPELINE_DIR, '.state', id))}`);
} else if (mode === 'p11') {
  const e0 = eng.get(values.engagement);
  if (!e0) { console.error('[p11] no engagement — pass --engagement'); process.exit(1); }
  const signed = eng.addSignature(values.engagement, { role: 'authorization owner', name: 'A. Operator' });
  console.log(`[p11] signature added to ${values.engagement}:`);
  J(signed.signatures);
  console.log('[p11] verify (untampered):');
  J(eng.verifySignatures(values.engagement));

  // TAMPER via raw SQL — an external mutation of the signed bundle bytes.
  const db = eng.db;
  const row = db.prepare('SELECT bundle FROM engagements WHERE id = ?').get(values.engagement);
  const originalBytes = row.bundle;
  const tampered = JSON.parse(originalBytes);
  tampered.roe.allowedActions = [...tampered.roe.allowedActions, 'exfiltrate'];
  db.prepare('UPDATE engagements SET bundle = ? WHERE id = ?').run(JSON.stringify(tampered, null, 2) + '\n', values.engagement);
  console.log('[p11] bundle TAMPERED via raw SQL update (roe.allowedActions += exfiltrate)');
  console.log('[p11] verify (tampered):');
  J(eng.verifySignatures(values.engagement));

  db.prepare('UPDATE engagements SET bundle = ? WHERE id = ?').run(originalBytes, values.engagement);
  console.log('[p11] bundle RESTORED to original bytes');
  console.log('[p11] verify (restored):');
  J(eng.verifySignatures(values.engagement));
} else {
  console.error(`[probe] unknown mode: ${mode}`);
  process.exit(2);
}

eng.close();
