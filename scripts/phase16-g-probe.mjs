#!/usr/bin/env node
// Phase 16 Scope G — Approval Gating probe
import { approvals } from '../ui/web/console/chat/approvals.js';
import { taxonomy } from '../events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };

console.log('=== Phase 16 G — Approval Gating ===');

// P1 Request approval -> status pending. Resolve 'yes' -> caller resumes with original payload.
console.log('\n════ P1 — Request -> pending, resolve yes -> caller resumes original payload ════');
{
  approvals._reset();
  const turnId = 'turn-p1';
  const payload = { file: '/tmp/test.txt', content: 'original' };

  const reqPromise = approvals.request(turnId, { action: 'writeFile', payload, sessionId: 'sess-p1' });
  const approvalId = reqPromise.approvalId;
  console.log(`  requested approvalId=${approvalId}`);

  const st = approvals.status(approvalId);
  console.log(`  status: ${JSON.stringify(st)}`);
  ok(st.status === 'pending', `P1 status pending (got ${st.status})`);

  const pendingList = approvals.pending('sess-p1');
  console.log(`  pending list length: ${pendingList.length}`);
  ok(pendingList.length === 1, 'P1 pending list has 1');

  // Resolve yes after short delay
  setTimeout(() => {
    approvals.resolve(approvalId, 'yes');
  }, 50);

  const result = await reqPromise;
  console.log(`  caller resumed: ${JSON.stringify(result)}`);
  ok(result.decision === 'yes', `P1 decision yes (got ${result.decision})`);
  ok(result.payload.file === '/tmp/test.txt' && result.payload.content === 'original', 'P1 caller resumed with original payload');
}

// P2 Request -> resolve 'no' -> E_APPROVAL_DENIED with action name
console.log('\n════ P2 — Request -> resolve no -> E_APPROVAL_DENIED with action name ════');
{
  approvals._reset();
  const turnId = 'turn-p2';
  const payload = { file: '/tmp/secret.txt' };

  const reqPromise = approvals.request(turnId, { action: 'deleteFile', payload, sessionId: 'sess-p2' });
  const approvalId = reqPromise.approvalId;
  console.log(`  requested ${approvalId}`);

  setTimeout(() => {
    approvals.resolve(approvalId, 'no');
  }, 50);

  let threw = false;
  try {
    await reqPromise;
  } catch (e) {
    console.log(`  threw: code=${e.code} message=${e.message} action=${e.action}`);
    threw = e.code === 'E_APPROVAL_DENIED' && e.action === 'deleteFile';
  }
  ok(threw, 'P2 caller received E_APPROVAL_DENIED with action name');
}

// P3 Request -> resolve 'always', second same action auto-approves, third different action still requires approval
console.log('\n════ P3 — Always: same action auto-approves, different action still requires approval ════');
{
  approvals._reset();
  const sessionId = 'sess-p3';

  // First request
  const req1 = approvals.request('turn-p3-1', { action: 'writeFile', payload: { a: 1 }, sessionId });
  const id1 = req1.approvalId;
  setTimeout(() => approvals.resolve(id1, 'always'), 20);
  const res1 = await req1;
  console.log(`  first always result: ${JSON.stringify(res1)}`);
  ok(res1.decision === 'always', 'P3 first always decision');

  // Second request same action should auto-approve (no blocking)
  const start = Date.now();
  const req2 = approvals.request('turn-p3-2', { action: 'writeFile', payload: { a: 2 }, sessionId });
  const res2 = await req2; // should resolve immediately
  const elapsed = Date.now() - start;
  console.log(`  second same action auto-approved in ${elapsed}ms: ${JSON.stringify(res2)}`);
  ok(res2.autoApproved === true || res2.decision === 'always', 'P3 second same action auto-approved');
  ok(elapsed < 100, `P3 auto-approve fast (<100ms) got ${elapsed}ms`);

  // Third request different action still requires approval
  const req3 = approvals.request('turn-p3-3', { action: 'deleteFile', payload: { b: 1 }, sessionId });
  const id3 = req3.approvalId;
  const st3 = approvals.status(id3);
  console.log(`  third different action status: ${JSON.stringify(st3)}`);
  ok(st3.status === 'pending', 'P3 different action still pending (requires approval)');

  setTimeout(() => approvals.resolve(id3, 'yes'), 20);
  const res3 = await req3;
  console.log(`  third resolved: ${JSON.stringify(res3)}`);
  ok(res3.decision === 'yes', 'P3 different action resolved yes');
}

// P4 Request -> resolve { edits: {...} } -> caller resumed with edits, original unchanged
console.log('\n════ P4 — Edits: resolve with edits, caller resumed with edits, original unchanged ════');
{
  approvals._reset();
  const original = { file: '/tmp/out.txt', content: 'original content', mode: 'w' };
  const originalCopy = JSON.stringify(original);

  const req = approvals.request('turn-p4', { action: 'writeFile', payload: original, sessionId: 'sess-p4' });
  const id = req.approvalId;

  setTimeout(() => {
    approvals.resolve(id, { edits: { content: 'edited content' } });
  }, 20);

  const res = await req;
  console.log(`  result payload: ${JSON.stringify(res.payload)}`);
  console.log(`  original after: ${JSON.stringify(original)}`);
  ok(res.payload.content === 'edited content', 'P4 caller resumed with edited content');
  ok(res.payload.file === '/tmp/out.txt', 'P4 file preserved');
  ok(JSON.stringify(original) === originalCopy, 'P4 original payload unchanged');
  ok(res.originalPayload.content === 'original content', 'P4 originalPayload preserved');
}

// P5 Resolve unknown approvalId -> E_UNKNOWN_APPROVAL, double resolve -> E_ALREADY_RESOLVED
console.log('\n════ P5 — Unknown approvalId and double resolve errors ════');
{
  approvals._reset();
  let threwUnknown = false;
  try {
    approvals.resolve('unknown-id', 'yes');
  } catch (e) {
    console.log(`  unknown threw: code=${e.code}`);
    threwUnknown = e.code === 'E_UNKNOWN_APPROVAL';
  }
  ok(threwUnknown, 'P5 unknown approvalId throws E_UNKNOWN_APPROVAL');

  const req = approvals.request('turn-p5', { action: 'test', payload: {}, sessionId: 'sess-p5' });
  const id = req.approvalId;
  setTimeout(() => approvals.resolve(id, 'yes'), 10);
  await req;

  let threwDouble = false;
  try {
    approvals.resolve(id, 'yes');
  } catch (e) {
    console.log(`  double resolve threw: code=${e.code}`);
    threwDouble = e.code === 'E_ALREADY_RESOLVED';
  }
  ok(threwDouble, 'P5 double resolve throws E_ALREADY_RESOLVED');
}

// P6 Verify approval.requested and approval.resolved events validate against Scope A taxonomy
console.log('\n════ P6 — Verify emitted events validate against Scope A taxonomy ════');
{
  approvals._reset();
  const req = approvals.request('turn-p6', { action: 'writeFile', payload: { x: 1 }, sessionId: 'sess-p6' });
  const id = req.approvalId;
  setTimeout(() => approvals.resolve(id, 'yes'), 10);
  await req;

  const emitted = approvals._emitted();
  console.log(`  emitted ${emitted.length} events: ${emitted.map(e => e.type).join(', ')}`);
  let allValid = true;
  for (const ev of emitted) {
    const v = taxonomy.validate(ev);
    console.log(`  ${ev.type} valid=${v.valid} ${v.valid ? '' : JSON.stringify(v.errors).slice(0,100)}`);
    if (!v.valid) allValid = false;
    ok(v.valid, `P6 ${ev.type} validates against taxonomy`);
  }
  ok(allValid, 'P6 all emitted events valid');
  ok(emitted.some(e => e.type === 'approval.requested'), 'P6 has approval.requested');
  ok(emitted.some(e => e.type === 'approval.resolved'), 'P6 has approval.resolved');
}

// P7 Determinism same request+resolve sequence twice identical status output
console.log('\n════ P7 — Determinism: same sequence twice identical status output ════');
{
  approvals._reset();
  const runSequence = async () => {
    const req = approvals.request('turn-p7', { action: 'writeFile', payload: { a: 1 }, sessionId: 'sess-p7' });
    const id = req.approvalId;
    setTimeout(() => approvals.resolve(id, 'yes'), 5);
    const res = await req;
    const st = approvals.status(id);
    // Mask timestamps for comparison
    return { decision: res.decision, status: st.status, action: st.action };
  };

  const out1 = await runSequence();
  approvals._reset();
  const out2 = await runSequence();

  console.log(`  out1: ${JSON.stringify(out1)}`);
  console.log(`  out2: ${JSON.stringify(out2)}`);
  ok(JSON.stringify(out1) === JSON.stringify(out2), 'P7 deterministic identical output');
}

console.log(`\n════ SCOPE G PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);
