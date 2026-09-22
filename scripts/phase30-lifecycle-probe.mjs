#!/usr/bin/env node
/** Phase 30 Scope F live probe: permission and command lifecycle hooks (P1-P6). */
import nodeAssert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import approvals from '../ui/web/console/chat/approvals.js';
import { createLifecycle } from '../harness/parity/lifecycle/index.js';

const [remoteRef, approvalsBlob, phase7HooksBlob, scopeAHooksBlob] = process.argv.slice(2);
nodeAssert.ok(remoteRef, 'authoritative remote ref argument is required');
nodeAssert.ok(approvalsBlob, 'authoritative Phase 16 G approvals blob argument is required');
nodeAssert.ok(phase7HooksBlob, 'authoritative Phase 7 B hooks blob argument is required');
nodeAssert.ok(scopeAHooksBlob, 'authoritative Scope A hooks facade blob argument is required');

function gitBlob(relativeUrl) {
  const filePath = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const bytes = fs.readFileSync(filePath);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

nodeAssert.equal(gitBlob('../ui/web/console/chat/approvals.js'), approvalsBlob);
nodeAssert.equal(gitBlob('../hooks/hooks.json'), phase7HooksBlob);
nodeAssert.equal(gitBlob('../harness/parity/hooks/index.js'), scopeAHooksBlob);

async function deniedApproval(turnId, action, sessionId) {
  const pending = approvals.request(turnId, { action, payload: { target: '/tmp/denied' }, sessionId });
  approvals.resolve(pending.approvalId, 'no');
  try {
    await pending;
  } catch (error) {
    nodeAssert.equal(error.code, 'E_APPROVAL_DENIED');
    return error;
  }
  throw new Error('approval denial did not reject');
}

const sources = {
  remoteRef,
  phase16Approvals: {
    path: 'ui/web/console/chat/approvals.js',
    blob: approvalsBlob,
  },
  phase7Hooks: {
    path: 'hooks/hooks.json',
    blob: phase7HooksBlob,
  },
  scopeAHooks: {
    path: 'harness/parity/hooks/index.js',
    blob: scopeAHooksBlob,
  },
};

approvals._reset();
const api = createLifecycle();
const permissionEvents = [];
const permissionRegistration = api.PermissionDenied.register((event) => {
  permissionEvents.push(event);
  return { retry: true };
});

console.log('P1 PERMISSION DENIED RETRIES ONCE');
const firstApprovalError = await deniedApproval('turn-p1', 'writeFile', 'session-p1');
let retryExecutions = 0;
const firstDecision = await api.PermissionDenied.handle({
  requestId: 'request-write-1',
  action: 'writeFile',
  error: firstApprovalError,
}, {
  retry: (_request, decision) => {
    retryExecutions += 1;
    return { requestRetried: true, attempt: decision.retryCount + 1 };
  },
});
const p1 = {
  registration: permissionRegistration,
  approvalError: {
    name: firstApprovalError.name,
    code: firstApprovalError.code,
    message: firstApprovalError.message,
    action: firstApprovalError.action,
    approvalId: firstApprovalError.approvalId,
  },
  decision: firstDecision,
  retryExecutions,
  handlerEvent: permissionEvents[0],
  sources,
};
console.log(JSON.stringify(p1, null, 2));
nodeAssert.deepEqual(permissionRegistration, { registered: true });
nodeAssert.equal(firstDecision.retry, true);
nodeAssert.equal(firstDecision.retryCount, 1);
nodeAssert.equal(firstDecision.hardDeny, false);
nodeAssert.equal(firstDecision.retried, true);
nodeAssert.equal(firstDecision.retryResult.requestRetried, true);
nodeAssert.equal(retryExecutions, 1);
nodeAssert.equal(permissionEvents.length, 1);
nodeAssert.equal(permissionEvents[0].catalog.declaredReturn, 'retry');
console.log('P1 PASS');

console.log('\nP2 SECOND DENIAL IS FINAL');
const secondApprovalError = await deniedApproval('turn-p2', 'writeFile', 'session-p1');
const secondDecision = await api.PermissionDenied.handle({
  requestId: 'request-write-1',
  action: 'writeFile',
  error: secondApprovalError,
}, {
  retry: () => {
    retryExecutions += 1;
    return { shouldNotRun: true };
  },
});
const p2 = {
  approvalError: {
    name: secondApprovalError.name,
    code: secondApprovalError.code,
    message: secondApprovalError.message,
    action: secondApprovalError.action,
    approvalId: secondApprovalError.approvalId,
  },
  decision: secondDecision,
  retryExecutions,
  handlerEvents: permissionEvents.length,
};
console.log(JSON.stringify(p2, null, 2));
nodeAssert.equal(secondDecision.retry, false);
nodeAssert.equal(secondDecision.retryCount, 1);
nodeAssert.equal(secondDecision.hardDeny, true);
nodeAssert.equal(secondDecision.reason, 'retry limit reached (max 1)');
nodeAssert.equal(secondDecision.retried, false);
nodeAssert.equal(retryExecutions, 1);
nodeAssert.equal(permissionEvents.length, 2);
console.log('P2 PASS');

console.log('\nP3 PROMPT EXPANSION BLOCKS SLASH COMMAND');
const promptEvents = [];
const promptRegistration = api.PromptExpansion.register((event) => {
  promptEvents.push(event);
  return { block: true, reason: 'policy' };
});
let slashCommandRuns = 0;
const promptDecision = await api.PromptExpansion.handle({
  command: '/deploy',
  arguments: '--production',
}, {
  run: () => {
    slashCommandRuns += 1;
    return { ran: true };
  },
});
const p3 = {
  registration: promptRegistration,
  decision: promptDecision,
  slashCommandRuns,
  handlerEvent: promptEvents[0],
};
console.log(JSON.stringify(p3, null, 2));
nodeAssert.deepEqual(promptRegistration, { registered: true });
nodeAssert.equal(promptDecision.block, true);
nodeAssert.equal(promptDecision.reason, 'policy');
nodeAssert.equal(promptDecision.executed, false);
nodeAssert.equal(slashCommandRuns, 0);
nodeAssert.equal(promptEvents.length, 1);
nodeAssert.equal(promptEvents[0].catalog.declaredReturn, 'block');
console.log('P3 PASS');

console.log('\nP4 POST TOOL BATCH FIRES ONCE');
let handlerCalls = 0;
let activeTools = 0;
let activeToolsAtHandler = null;
let maxParallel = 0;
const batchEvents = [];
const batchRegistration = api.PostToolBatch.register((event) => {
  handlerCalls += 1;
  activeToolsAtHandler = activeTools;
  batchEvents.push(event);
  return { ok: true };
});
const tool = (name, delay) => async () => {
  activeTools += 1;
  maxParallel = Math.max(maxParallel, activeTools);
  await new Promise((resolve) => setTimeout(resolve, delay));
  activeTools -= 1;
  return { tool: name, ok: true };
};
const batchResult = await api.PostToolBatch.run([
  tool('read', 30),
  tool('search', 20),
  tool('inspect', 10),
], { batchId: 'parallel-batch-1' });
const p4 = {
  registration: batchRegistration,
  toolCount: 3,
  maxParallel,
  activeToolsAtHandler,
  handlerCalls,
  batchEventCount: batchResult.eventCount,
  emittedEvents: api.PostToolBatch.emitted(),
  result: batchResult,
};
console.log(JSON.stringify(p4, null, 2));
nodeAssert.deepEqual(batchRegistration, { registered: true });
nodeAssert.equal(maxParallel, 3);
nodeAssert.equal(activeToolsAtHandler, 0);
nodeAssert.equal(handlerCalls, 1);
nodeAssert.equal(batchResult.eventCount, 1);
nodeAssert.equal(batchResult.ok, true);
nodeAssert.equal(batchResult.results.length, 3);
nodeAssert.equal(batchEvents.length, 1);
nodeAssert.equal(batchEvents[0].toolCount, 3);
nodeAssert.equal(batchEvents[0].catalog.declaredReturn, 'block');
console.log('P4 PASS');

console.log('\nP5 HOOK ERROR FAILS CLOSED');
const failing = createLifecycle();
const failingRegistration = failing.PromptExpansion.register(() => {
  throw new Error('hook exploded');
});
let failedHookCommandRuns = 0;
const fallback = await failing.PromptExpansion.handle({ command: '/unsafe' }, {
  run: () => {
    failedHookCommandRuns += 1;
    return { ran: true };
  },
});
const defaults = createLifecycle();
const denyDefaults = {
  permission: defaults.PermissionDenied.decide({ requestId: 'default-request' }),
  prompt: defaults.PromptExpansion.decide({ command: '/default' }),
  postToolBatch: await defaults.PostToolBatch.run([], { batchId: 'default-batch' }),
};
const p5 = {
  registration: failingRegistration,
  fallback,
  slashCommandRuns: failedHookCommandRuns,
  denyDefaults,
};
console.log(JSON.stringify(p5, null, 2));
nodeAssert.equal(fallback.block, true);
nodeAssert.equal(fallback.executed, false);
nodeAssert.equal(fallback.fallback, 'deny');
nodeAssert.equal(fallback.error.name, 'Error');
nodeAssert.equal(fallback.error.message, 'hook exploded');
nodeAssert.equal(failedHookCommandRuns, 0);
nodeAssert.equal(denyDefaults.permission.hardDeny, true);
nodeAssert.equal(denyDefaults.prompt.block, true);
nodeAssert.equal(denyDefaults.postToolBatch.ok, false);
console.log('P5 PASS');

console.log('\nP6 DETERMINISM');
async function runSequence() {
  const instance = createLifecycle();
  const registrations = {
    permission: instance.PermissionDenied.register(() => ({ retry: true })),
    prompt: instance.PromptExpansion.register(() => ({ block: false })),
    batch: instance.PostToolBatch.register(() => ({ ok: true })),
  };
  const first = instance.PermissionDenied.decide({ requestId: 'det-request', action: 'writeFile' });
  const second = instance.PermissionDenied.decide({ requestId: 'det-request', action: 'writeFile' });
  const prompt = await instance.PromptExpansion.handle({ command: '/status' }, {
    run: () => ({ expanded: 'status' }),
  });
  const batch = await instance.PostToolBatch.run([
    () => ({ tool: 'one' }),
    () => ({ tool: 'two' }),
  ], { batchId: 'det-batch' });
  return { registrations, first, second, prompt, batch, events: instance.PostToolBatch.emitted() };
}
const firstSequence = await runSequence();
const secondSequence = await runSequence();
const firstBytes = JSON.stringify(firstSequence);
const secondBytes = JSON.stringify(secondSequence);
const p6 = {
  first: firstSequence,
  second: secondSequence,
  firstBytes: Buffer.byteLength(firstBytes),
  secondBytes: Buffer.byteLength(secondBytes),
  firstSha256: sha256(firstBytes),
  secondSha256: sha256(secondBytes),
  byteIdentical: firstBytes === secondBytes,
};
console.log(JSON.stringify(p6, null, 2));
nodeAssert.equal(firstBytes, secondBytes);
nodeAssert.equal(p6.firstSha256, p6.secondSha256);
nodeAssert.equal(p6.byteIdentical, true);
console.log('P6 PASS');

console.log('\nPHASE30_SCOPE_F_PASS');
