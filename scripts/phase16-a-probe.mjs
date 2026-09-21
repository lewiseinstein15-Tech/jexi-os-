#!/usr/bin/env node
// Phase 16 Scope A — chat event taxonomy probe
import { taxonomy } from '../events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };

console.log('=== Phase 16 A — Event Taxonomy ===');

const allTypes = taxonomy.list();
console.log(`list() → ${allTypes.length} types: ${allTypes.join(', ')}`);

// P1 emit each type, validate each
console.log('\n════ P1 — emit each type, validate each ════');
{
  const now = new Date().toISOString();
  const samples = {
    'message.delta': { delta: 'hello', messageId: 'm1' },
    'thinking.delta': { delta: 'hmm', thinkingId: 't1' },
    'plan.created': { planId: 'p1', steps: [{ title: 'step1' }], title: 'Plan' },
    'plan.updated': { planId: 'p1', steps: [{ title: 'step1', status: 'done' }], status: 'running' },
    'tool.started': { toolCallId: 'tc1', toolName: 'readFile', args: { path: '/tmp' } },
    'tool.progress': { toolCallId: 'tc1', progress: 0.5, message: 'half' },
    'tool.completed': { toolCallId: 'tc1', result: { ok: true }, durationMs: 100 },
    'tool.failed': { toolCallId: 'tc1', error: { message: 'failed' } },
    'approval.requested': { approvalId: 'ap1', reason: 'need approval', options: ['yes','no'] },
    'approval.resolved': { approvalId: 'ap1', decision: 'approved', resolver: 'user' },
    'artifact.created': { artifactId: 'art1', path: '/tmp/out.txt', content: 'hello' },
    'agent.spawned': { agentId: 'agent-1', role: 'coder', parentId: 'root' },
    'agent.completed': { agentId: 'agent-1', result: { ok: true }, status: 'done' },
    'turn.completed': { turnId: 'turn1', status: 'ok', summary: 'done' },
    'checkpoint.created': { checkpointId: 'cp1', snapshot: { version: 1 } },
    'narration.line': { narrationType: 'acknowledge', text: 'I understand - you want X', ctx: {}, input: 'user input' },
  };

  for (const type of allTypes) {
    const event = {
      type,
      version: 1,
      ts: now,
      sessionId: 'test-session',
      agentId: 'agent-root',
      payload: samples[type] || { dummy: true },
    };
    const res = taxonomy.validate(event);
    console.log(`  ${type}: valid=${res.valid} ${res.errors ? JSON.stringify(res.errors).slice(0,100) : ''}`);
    ok(res.valid, `P1 ${type} validates`);
  }
}

// P2 emit malformed -> refused with specific error
console.log('\n════ P2 — malformed events refused with specific error ════');
{
  const badEvents = [
    { type: 'unknown.type', version: 1, ts: new Date().toISOString(), sessionId: 's1', payload: {} },
    { type: 'message.delta', version: 0, ts: new Date().toISOString(), sessionId: 's1', payload: { delta: 'hi' } },
    { type: 'message.delta', version: 1, ts: 'not-a-date', sessionId: 's1', payload: { delta: 'hi' } },
    { type: 'message.delta', version: 1, ts: new Date().toISOString(), sessionId: 'bad id!', payload: { delta: 'hi' } },
    { type: 'message.delta', version: 1, ts: new Date().toISOString(), sessionId: 's1', payload: null },
    { type: 'message.delta', version: 1, ts: new Date().toISOString(), sessionId: 's1', payload: {} }, // missing delta
    { type: 'narration.line', version: 1, ts: new Date().toISOString(), sessionId: 's1', payload: { narrationType: 'invalid', text: 'hi' } },
  ];

  for (let i = 0; i < badEvents.length; i++) {
    const res = taxonomy.validate(badEvents[i]);
    console.log(`  bad ${i}: valid=${res.valid} errors=${JSON.stringify(res.errors).slice(0,200)}`);
    ok(!res.valid && res.errors && res.errors.length > 0, `P2 malformed ${i} refused with error code ${res.errors?.[0]?.code}`);
  }
}

// P3 list() shows every type
console.log('\n════ P3 — list() shows every type ════');
{
  const list = taxonomy.list();
  console.log(`  list: ${JSON.stringify(list)}`);
  ok(list.length === 16, `P3 list length 16 (got ${list.length})`);
  const expected = ['message.delta','thinking.delta','plan.created','plan.updated','tool.started','tool.progress','tool.completed','tool.failed','approval.requested','approval.resolved','artifact.created','agent.spawned','agent.completed','turn.completed','checkpoint.created','narration.line'];
  for (const t of expected) {
    ok(list.includes(t), `P3 list includes ${t}`);
  }
}

// P4 versioned schema lookup works
console.log('\n════ P4 — versioned schema lookup works ════');
{
  for (const type of allTypes) {
    const schema = taxonomy.schemaFor(type);
    console.log(`  schemaFor(${type}): $id=${schema.$id} version=${schema.version} required=${schema.required.join(',')}`);
    ok(schema.$id === `jexi.chat.${type}`, `P4 schema $id for ${type}`);
    ok(schema.version === 1, `P4 schema version 1 for ${type}`);
    ok(Array.isArray(schema.required) && schema.required.includes('type'), `P4 schema has required fields for ${type}`);
  }

  let threwUnknown = false;
  try {
    taxonomy.schemaFor('unknown.type');
  } catch (e) {
    console.log(`  schemaFor unknown threw: code=${e.code} message=${e.message}`);
    threwUnknown = e.code === 'E_UNKNOWN_TYPE';
  }
  ok(threwUnknown, 'P4 unknown type throws E_UNKNOWN_TYPE');
}

console.log(`\n════ SCOPE A PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);
