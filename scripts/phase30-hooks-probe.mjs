#!/usr/bin/env node
/** Phase 30 Scope A live probe: official 30-hook catalog registry (P1-P6). */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import hooks from '../harness/parity/hooks/index.js';

const EXPECTED_EVENTS = Object.freeze([
  'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure',
  'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd', 'Setup',
  'TeammateIdle', 'TaskCreated', 'TaskCompleted', 'ConfigChange',
  'WorktreeCreate', 'WorktreeRemove', 'InstructionsLoaded', 'Elicitation',
  'ElicitationResult', 'StopFailure', 'CwdChanged', 'FileChanged',
  'PermissionDenied', 'UserPromptExpansion', 'PostToolBatch', 'MessageDisplay',
]);
const LIFECYCLES = Object.freeze([
  'session', 'tool', 'subagent', 'compaction', 'permission', 'worktree', 'message',
]);
const RETURNS = new Set(['block', 'retry', 'rewrite', 'none']);
const EXPECTED_MAPPED = Object.freeze([
  ['PreToolUse', 4],
  ['Stop', 1],
  ['PreCompact', 1],
  ['SessionStart', 1],
  ['SessionEnd', 1],
]);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const all = hooks.list();

console.log('P1 FULL CATALOG GROUPED BY LIFECYCLE');
assert.equal(hooks.count(), 30);
assert.deepEqual(all.map((spec) => spec.event), EXPECTED_EVENTS);
const groupedEvents = [];
for (const lifecycle of LIFECYCLES) {
  const group = all.filter((spec) => spec.lifecycle === lifecycle);
  console.log(`${lifecycle} (${group.length})`);
  for (const spec of group) {
    groupedEvents.push(spec.event);
    console.log(`  ${spec.event} | matcher=${spec.matcher ?? 'none'} | timeout=${spec.timeout}ms | async=${spec.async} | return=${spec.contract.return}`);
  }
}
assert.equal(groupedEvents.length, 30);
assert.equal(new Set(groupedEvents).size, 30);
console.log(`P1 PASS count=${hooks.count()} grouped=${groupedEvents.length} unique=${new Set(groupedEvents).size}`);

console.log('\nP2 SESSIONSTART FULL SPEC');
const sessionStart = hooks.get('SessionStart');
console.log(JSON.stringify(sessionStart, null, 2));
assert.equal(sessionStart.event, 'SessionStart');
assert.equal(sessionStart.matcher, 'source');
assert.equal(sessionStart.timeout, 5000);
assert.equal(sessionStart.async, false);
assert.deepEqual(sessionStart.contract, { return: 'none' });
assert.equal(sessionStart.handlers.length, 1);
assert.equal(sessionStart.stub, false);
console.log('P2 PASS');

console.log('\nP3 CONTRACT VALIDATION');
const validation = hooks.validate();
const fieldErrors = [];
for (const [index, spec] of all.entries()) {
  const at = `${index}:${spec.event}`;
  if (typeof spec.event !== 'string' || !spec.event) fieldErrors.push(`${at}:event`);
  if (!LIFECYCLES.includes(spec.lifecycle)) fieldErrors.push(`${at}:lifecycle`);
  if (typeof spec.when !== 'string' || !spec.when) fieldErrors.push(`${at}:when`);
  if (!(spec.matcher === null || typeof spec.matcher === 'string')) fieldErrors.push(`${at}:matcher`);
  if (!Number.isInteger(spec.timeout) || spec.timeout <= 0) fieldErrors.push(`${at}:timeout`);
  if (typeof spec.async !== 'boolean') fieldErrors.push(`${at}:async`);
  if (!spec.contract || !RETURNS.has(spec.contract.return)) fieldErrors.push(`${at}:contract`);
  if (!Array.isArray(spec.handlers)) fieldErrors.push(`${at}:handlers`);
  if (typeof spec.stub !== 'boolean') fieldErrors.push(`${at}:stub`);
  if (spec.stub && spec.contract.return !== 'none') fieldErrors.push(`${at}:stub-return`);
}
console.log(JSON.stringify({ validation, fieldErrors, checked: all.length }, null, 2));
assert.deepEqual(validation, { valid: true });
assert.deepEqual(fieldErrors, []);
console.log('P3 PASS');

console.log('\nP4 PHASE 7 HANDLERS VERSUS NO-OP STUBS');
const mapped = hooks.mapped();
const stubs = hooks.stubs();
assert.deepEqual(mapped.map((spec) => [spec.event, spec.handlers.length]), EXPECTED_MAPPED);
const handlerIds = mapped.flatMap((spec) => spec.handlers.map((handler) => handler.id));
assert.equal(handlerIds.length, 8);
assert.equal(new Set(handlerIds).size, handlerIds.length);
assert.equal(stubs.length, 25);
assert.ok(stubs.every((spec) => spec.handlers.length === 0 && spec.contract.return === 'none'));
for (const spec of mapped) {
  console.log(`handler ${spec.event} (${spec.handlers.length}): ${spec.handlers.map((handler) => handler.id).join(', ')}`);
}
console.log(`mapped-events=${mapped.length} mapped-handlers=${handlerIds.length} duplicate-handler-ids=${handlerIds.length - new Set(handlerIds).size}`);
console.log(`no-op-stubs=${stubs.length}: ${stubs.map((spec) => spec.event).join(', ')}`);
console.log('P4 PASS');

console.log('\nP5 UNKNOWN EVENT');
let unknown;
try {
  hooks.get('DefinitelyNotAHook');
} catch (error) {
  unknown = error;
}
assert.ok(unknown);
console.log(JSON.stringify({ name: unknown.name, code: unknown.code, message: unknown.message }, null, 2));
assert.equal(unknown.code, 'E_UNKNOWN_HOOK_EVENT');
console.log('P5 PASS');

console.log('\nP6 BYTE DETERMINISM AND COPY ISOLATION');
const first = JSON.stringify(hooks.list());
const second = JSON.stringify(hooks.list());
assert.equal(first, second);
const mutableCopy = hooks.list();
mutableCopy[0].event = 'mutated-copy';
mutableCopy[0].handlers.push({ id: 'mutated-copy' });
const afterMutation = JSON.stringify(hooks.list());
assert.equal(afterMutation, first);
console.log(JSON.stringify({
  firstBytes: Buffer.byteLength(first),
  secondBytes: Buffer.byteLength(second),
  firstSha256: digest(first),
  secondSha256: digest(second),
  byteIdentical: first === second,
  copyIsolated: afterMutation === first,
}, null, 2));
console.log('P6 PASS');

console.log('\nPHASE30_SCOPE_A_PASS');
