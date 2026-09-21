#!/usr/bin/env node
// Phase 16 Scope B — Narration layer probe
import { narration } from '../workforce/narration/index.js';
import { taxonomy } from '../events/chat/taxonomy.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${msg}`); };

console.log('=== Phase 16 B — Narration Layer ===');

// P1 Emit each of 7 types
console.log('\n════ P1 — Emit each of 7 narration types, show event + validate ════');
{
  const baseCtx = {
    sessionId: 'test-session-b',
    agentId: 'agent-root',
    source: 'user-input: build feature X',
    input: 'build feature X',
  };

  const cases = [
    { type: 'acknowledge', ctx: { ...baseCtx, input: 'build a chat UI', want: 'build a chat UI' } },
    { type: 'recon', ctx: { ...baseCtx, source: 'src/components/console/ChatView.jsx', file: 'ChatView.jsx' } },
    { type: 'finding', ctx: { ...baseCtx, source: 'grep results', found: 'ChatView.jsx has 200 lines', details: 'uses consoleData' } },
    { type: 'decision', ctx: { ...baseCtx, source: 'finding: ChatView pattern', build: 'chat runtime module', pattern: 'existing console' } },
    { type: 'progress', ctx: { ...baseCtx, source: 'tool: npm test', current: 2, total: 5, passing: 2, message: '2 of 5 passing' } },
    { type: 'correction', ctx: { ...baseCtx, source: 'tool: npm test failed', error: 'test failed', next: 'fixing the mock' } },
    { type: 'completion', ctx: { ...baseCtx, source: 'tool: build', built: 'chat runtime with 7 narration types', summary: 'all tests green' } },
  ];

  for (const { type, ctx } of cases) {
    try {
      const event = narration.emit(type, ctx);
      const validation = taxonomy.validate(event);
      console.log(`  ${type}: text="${event.payload.text}" source="${event.payload.source}" valid=${validation.valid}`);
      ok(validation.valid, `P1 ${type} event valid`);
    } catch (e) {
      console.log(`  ${type} threw: code=${e.code} message=${e.message}`);
      ok(false, `P1 ${type} should not throw`);
    }
  }
}

// P2 All events pass Scope A validation
console.log('\n════ P2 — All events pass Scope A validation (7 valid results) ════');
{
  const ctx = { sessionId: 'test-b', agentId: 'agent-1', source: 'input: test', input: 'test input' };
  let allValid = true;
  for (const type of narration.list()) {
    const event = narration.emit(type, { ...ctx, source: `source for ${type}`, input: `input for ${type}`, found: `found ${type}`, build: `build ${type}`, current: 3, total: 10 });
    const res = taxonomy.validate(event);
    console.log(`  ${type}: valid=${res.valid}`);
    if (!res.valid) allValid = false;
    ok(res.valid, `P2 ${type} passes taxonomy.validate`);
  }
  ok(allValid, 'P2 all 7 pass Scope A validation');
}

// P3 Determinism same input twice byte-identical payload (timestamps masked)
console.log('\n════ P3 — Determinism: same input twice byte-identical payload (timestamps masked) ════');
{
  const ctx = { sessionId: 'sess-determinism', agentId: 'agent-root', source: 'user-input: same', input: 'same input', want: 'same want', found: 'same file', build: 'same build', pattern: 'same pattern' };
  for (const type of narration.list()) {
    const e1 = narration.emit(type, ctx);
    const e2 = narration.emit(type, ctx);
    // Mask timestamps
    const c1 = { ...e1, ts: 'MASKED' };
    const c2 = { ...e2, ts: 'MASKED' };
    const b1 = JSON.stringify(c1);
    const b2 = JSON.stringify(c2);
    const identical = b1 === b2;
    console.log(`  ${type}: identical=${identical} bytes=${b1.length}`);
    ok(identical, `P3 ${type} deterministic byte-identical when ts masked`);
  }
}

// P4 Unknown type refused E_UNKNOWN_NARRATION
console.log('\n════ P4 — Unknown type refused E_UNKNOWN_NARRATION ════');
{
  let threw = false;
  try {
    narration.emit('not-a-type', { sessionId: 's', agentId: 'a', source: 'src' });
  } catch (e) {
    console.log(`  threw: code=${e.code} message=${e.message}`);
    threw = e.code === 'E_UNKNOWN_NARRATION';
  }
  ok(threw, 'P4 unknown type throws E_UNKNOWN_NARRATION');
}

// P5 Missing source refused E_MISSING_SOURCE
console.log('\n════ P5 — Missing source refused E_MISSING_SOURCE ════');
{
  let threw = false;
  try {
    narration.emit('finding', { agentId: 'agent-1', sessionId: 's', input: 'test' });
  } catch (e) {
    console.log(`  threw: code=${e.code} message=${e.message}`);
    threw = e.code === 'E_MISSING_SOURCE';
  }
  ok(threw, 'P5 missing source throws E_MISSING_SOURCE');
}

// P6 Missing agentId refused E_MISSING_AGENT
console.log('\n════ P6 — Missing agentId refused E_MISSING_AGENT ════');
{
  let threw = false;
  try {
    narration.emit('finding', { source: 'some source', sessionId: 's', input: 'test' });
  } catch (e) {
    console.log(`  threw: code=${e.code} message=${e.message}`);
    threw = e.code === 'E_MISSING_AGENT';
  }
  ok(threw, 'P6 missing agentId throws E_MISSING_AGENT');
}

// P7 No template placeholders left grep { } {{ }}
console.log('\n════ P7 — No template placeholders left in emitted texts ════');
{
  const ctx = { sessionId: 's', agentId: 'a', source: 'src', input: 'input', found: 'found', build: 'build', pattern: 'pattern', current: 1, total: 2 };
  let hasPlaceholder = false;
  for (const type of narration.list()) {
    const event = narration.emit(type, { ...ctx, source: `src-${type}` });
    const text = event.payload.text;
    const hasBrace = text.includes('{') || text.includes('}') || text.includes('{{') || text.includes('}}');
    if (hasBrace) {
      console.log(`  ${type} has placeholder: ${text}`);
      hasPlaceholder = true;
    }
  }
  console.log(`  hasPlaceholder: ${hasPlaceholder} (target false, zero hits)`);
  ok(!hasPlaceholder, 'P7 zero hits for { } {{ }} in all emitted texts');
}

// P8 list() returns exactly 7
console.log('\n════ P8 — list() returns exactly 7 ════');
{
  const list = narration.list();
  console.log(`  list: ${JSON.stringify(list)} length=${list.length}`);
  ok(list.length === 7, `P8 list length 7 (got ${list.length})`);
  const expected = ['acknowledge','recon','finding','decision','progress','correction','completion'];
  for (const t of expected) ok(list.includes(t), `P8 includes ${t}`);
}

console.log(`\n════ SCOPE B PROBE DONE — ${pass} passed, ${fail} failed ════`);
process.exit(fail === 0 ? 0 : 1);
