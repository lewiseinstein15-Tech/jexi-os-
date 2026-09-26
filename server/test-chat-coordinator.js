/**
 * GAP 3 (fix/chat-wiring-completion) — COMPLEX-LANE COORDINATOR BRAIN RECALL
 * proof. Deterministic, headless, ZERO network, ZERO model calls.
 *
 * Proves:
 *   T-a  the real Orchestrator.wrapCase one-shot: the FIRST specialist node
 *        to run receives its query extended with the brain-recall block
 *        (the coordinator prompt), and the SECOND node receives the
 *        original query untouched — the block never reaches sub-agents.
 *   T-b  the coordinator prompt string contains the seeded brain fact.
 *   T-c  an empty brainContext changes nothing (fail-soft).
 *   T-d  the log narration fires exactly once for the coordinator.
 *
 * Run: node test-chat-coordinator.js   (exit 0 = all green)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-coord-test-data-'));
process.env.JEXI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-coord-test-home-'));
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
};

const { initPhase31Wiring, wiring } = await import('./src/wiring/phase31-bootstrap.js');
const { brainHotWriteTurn } = await import('./src/services/BrainRecall.js');
const { orchestrator } = await import('./src/services/Orchestrator.js');

initPhase31Wiring({ sessionId: 'coordinator-test' });
await brainHotWriteTurn({ sessionId: 'coord-session', userMessage: 'our release codename is Blue Heron', assistantAnswer: 'Recorded — Blue Heron.' });
console.log('\n== GAP 3 — COMPLEX-LANE COORDINATOR BRAIN RECALL ==');

// Build a REAL wrapCase node around a body that captures what it received.
const received = [];
const logs = [];
const node = orchestrator.wrapCase('testCoordinatorNode', async ({ query }) => { received.push(query); });

const mkState = () => ({
  query: 'plan the release for our project',
  brainContext: '', // filled below from the REAL bridge
  context: { results: { success: true }, sendEvent: (type, data) => logs.push(data?.message || ''), opts: {} },
  plan: {},
  intermediateResults: {}, // wrapCase writes the node result here post-body
});
const state = mkState();
state.brainContext = await (await import('./src/services/BrainRecall.js')).brainRecallBlock({ sessionId: 'coord-session', query: 'plan the release' });
ok(state.brainContext.includes('Blue Heron'), 'T-b precondition: the brain block carries the seeded fact (Blue Heron)');

// Run 1 — the coordinator (first node) must receive the block.
await node(state);
ok(received.length === 1 && received[0].includes('plan the release for our project') && received[0].includes('Blue Heron'),
  'GAP3/T-a: the FIRST specialist node receives its query EXTENDED with the brain block (coordinator prompt)');
console.log('  --- coordinator prompt excerpt (raw) ---');
for (const line of String(received[0]).split('\n').slice(0, 6)) console.log(`  | ${line.slice(0, 110)}`);

// Run 2 — the next node must see the ORIGINAL query (one-shot, not every sub-agent).
await node(state);
ok(received.length === 2 && received[1] === 'plan the release for our project',
  'GAP3/T-a: the SECOND node sees the original query untouched (block never reaches sub-agents)');

// Narration: exactly one coordinator-feed log line.
const feedLogs = logs.filter((m) => String(m).includes('Coordinator prompt carries brain context'));
ok(feedLogs.length === 1 && /testCoordinatorNode leads/.test(feedLogs[0]),
  'GAP3/T-d: the coordinator-feed narration fired exactly once, naming the lead node');
console.log(`  | log: ${feedLogs[0]}`);

// Fail-soft: no brainContext → the prompt is the raw query, byte-for-byte.
const state2 = mkState();
state2.context.coordinatorFed = false;
state2.brainContext = '';
const node2 = orchestrator.wrapCase('testNoBrainNode', async ({ query }) => { received.push(query); });
await node2(state2);
ok(received[received.length - 1] === 'plan the release for our project',
  'GAP3/T-c: empty brainContext → zero prompt changes (fail-soft)');

console.log(`\n== RESULT: ${passed} passed, ${failed} failed ==`);
process.exit(failed ? 1 : 0);
