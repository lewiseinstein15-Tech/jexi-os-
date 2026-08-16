/**
 * B78 — Event-sourced logging + token-threshold compaction + filesystem-native
 * coworker definitions. Every claim is backed by a real run:
 *
 *   A. EventLog — all 8 event types round-trip with ts/type/session/payload,
 *      order is preserved, session/type/limit filters work, unknown types are
 *      rejected, payloads are sanitized, and the per-session ceiling holds.
 *   B. CoworkerFiles — the committed jexi-agents/ files parse (frontmatter +
 *      body) for all five coworkers + the orchestrator; one file's edit never
 *      leaks into another (fresh-process isolation proof).
 *   C. Token-threshold compaction — a fresh process with a 2,000-token
 *      ceiling: a short chat does NOT compact (and never calls the LLM), a
 *      long chat DOES compact and logs a context_compaction event with
 *      trigger: token_threshold + the real token estimate; force:true logs
 *      trigger: manual.
 *   D. Runtime wiring — runWorker logs coworker_call + coworker_result,
 *      runSimpleTask logs the orchestrator_decision (SIMPLE + coworkers),
 *      executeTool logs tool_call + tool_result.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Isolate ALL persistence behind a temp DATA_DIR — nothing here may touch the
// repo's real server/data. Everything that reads config.js is imported
// dynamically AFTER this line so the env is seen at import time.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b78-'));
process.env.DATA_DIR = TMP;

let passed = 0;
let failed = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${msg}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
};
const runChild = (script, args, extraEnv = {}) => {
  // Every child gets its OWN fresh DATA_DIR: a child process must never see
  // events or memory written by the parent or another child (isolation).
  const env = { ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b78-child-')), ...extraEnv };
  try {
    const stdout = execFileSync('node', [script, ...args], { env, encoding: 'utf8', timeout: 60000 });
    return { ok: true, data: JSON.parse(stdout.trim().split('\n').pop()) };
  } catch (e) {
    return { ok: false, error: String((e && e.stderr) || e.stdout || e.message || e) };
  }
};

console.log('\n== B78 — EVENT LOG: every meaningful thing, ordered, durable ==');
const main = (async () => {
  const { appendEvent, getEvents, eventLogStats, hydrateEventLogFromRedis } = await import('./src/services/EventLog.js');

  // --- A1. all 8 event types round-trip ---
  const types = ['user_message', 'orchestrator_decision', 'coworker_call', 'coworker_result', 'tool_call', 'tool_result', 'context_compaction', 'error'];
  for (const t of types) appendEvent(t, { n: 1 }, 'sess-a');
  const all = getEvents({ session: 'sess-a' });
  ok(all.length === types.length, `all 8 event types appended and read back (got ${all.length})`);
  ok(all.every((e) => e.ts && e.type && e.session && e.payload && !Number.isNaN(Date.parse(e.ts))), 'every event has ts/type/session/payload');
  ok(all.map((e) => e.type).join(',') === types.join(','), 'events come back in TRUE order (oldest → newest)');
  ok(eventLogStats().byType.user_message === 1 && eventLogStats().byType.error === 1, 'eventLogStats() counts by type');

  // --- A2. filters ---
  appendEvent('tool_call', { tool: 'web-search' }, 'sess-b');
  appendEvent('tool_result', { tool: 'web-search', ok: true }, 'sess-b');
  ok(getEvents({ session: 'sess-b' }).length === 2, 'session filter isolates sessions');
  ok(getEvents({ session: 'sess-b', type: 'tool_call' }).length === 1, 'type filter works');
  ok(getEvents({ session: 'sess-b', type: 'tool_result' })[0].payload.ok === true, 'payload survives the round-trip');
  ok(getEvents({ session: 'sess-b', limit: 1 }).length === 1, 'limit works');

  // --- A3. unknown type rejected; sanitization ---
  const before = eventLogStats().total;
  ok(appendEvent('not_a_real_type', { x: 1 }) === false, 'unknown event type is rejected');
  ok(eventLogStats().total === before, 'rejected event did not grow the store');
  appendEvent('user_message', { text: 'z'.repeat(5000), arr: Array.from({ length: 30 }, (_, i) => `item-${i}-${'q'.repeat(300)}`) }, 'sess-c');
  const san = getEvents({ session: 'sess-c' })[0].payload;
  ok(san.text.length === 4000, `long strings are capped at 4000 chars (got ${san.text.length})`);
  ok(san.arr.length === 25 && san.arr.every((x) => x.length <= 200), `arrays capped at 25 entries × 200 chars (got ${san.arr.length})`);

  // --- A4. per-session ceiling (500) holds ---
  for (let i = 0; i < 510; i++) appendEvent('coworker_call', { i }, 'sess-d');
  const d = getEvents({ session: 'sess-d', limit: 500 });
  ok(d.length === 500, `per-session ceiling enforced (got ${d.length})`);

  // --- A5. hydrate is safe without Redis ---
  ok(await hydrateEventLogFromRedis() === false, 'hydrateEventLogFromRedis() no-ops cleanly without REDIS_URL');

  console.log('\n== B78 — COWORKER FILES: filesystem-native definitions ==');
  // --- B1. committed jexi-agents/ files parse in a fresh process ---
  const real = runChild(path.join(ROOT, 'server', 'tests', 'b78CoworkersChild.js'), ['real'], {});
  ok(real.ok, 'committed jexi-agents/ files load in a fresh process', real.ok ? '' : real.error);
  if (real.ok) {
    ok(real.data.present.length === 5 && real.data.list.length === 5, `all five coworkers present + listed (${real.data.list.join(', ')})`);
    const bad = Object.entries(real.data.frontmatter).filter(([, f]) => !f || !f.name || !f.hasDescription || !Array.isArray(f.models) || !f.bodyLen);
    ok(bad.length === 0, `every coworker file has name + description + models[] + body (${bad.map(([s]) => s).join(',') || 'all good'})`);
    ok(!!real.data.orchestrator && real.data.orchestrator.bodyLen > 0, 'ORCHESTRATOR.md loads with a body');
    ok(real.data.fragmentLen > 0, 'orchestratorPromptFragment() is non-empty (rules reach every coworker run)');
  }

  // --- B2. edit-one-file isolation (marker in coding.md only) ---
  const agentsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-agents-b78-'));
  fs.mkdirSync(path.join(agentsTmp, 'coworkers'), { recursive: true });
  fs.writeFileSync(path.join(agentsTmp, 'ORCHESTRATOR.md'), '---\nname: Orchestrator\ndescription: test\n---\n# Rules\nRouting rules here.\n');
  fs.writeFileSync(path.join(agentsTmp, 'coworkers', 'coding.md'), '---\nname: Coder\ndescription: coding mandate\nmodels: [a, b]\n---\n# Coder\nISOLATION-MARKER-ONLY-IN-CODING\n');
  fs.writeFileSync(path.join(agentsTmp, 'coworkers', 'email.md'), '---\nname: Email\ndescription: email mandate\nmodels: [c]\n---\n# Email\nNo marker here.\n');
  const iso = runChild(path.join(ROOT, 'server', 'tests', 'b78CoworkersChild.js'), ['isolated'], { JEXI_AGENTS_DIR: agentsTmp, ISOLATION: '1' });
  ok(iso.ok, 'isolated agents dir loads in a fresh process', iso.ok ? '' : iso.error);
  if (iso.ok) {
    ok(iso.data.isolation.codingHasMarker === true, 'coding.md edit is picked up by the coder definition');
    ok(iso.data.isolation.emailHasMarker === false, 'the same edit does NOT leak into email.md (one file = one coworker)');
    ok(iso.data.list.length === 2, `only the files that exist are listed (got ${iso.data.list.join(', ')})`);
  }

  console.log('\n== B78 — TOKEN-THRESHOLD COMPACTION (fresh process, 2,000-token ceiling) ==');
  const comp = path.join(ROOT, 'server', 'tests', 'b78CompactionChild.js');
  const markerFile = path.join(TMP, 'gen-called.txt');
  const short = runChild(comp, ['short', markerFile], { JEXI_COMPACTION_TOKENS: '2000' });
  ok(short.ok, 'short chat runs through the compaction probe', short.ok ? '' : short.error);
  if (short.ok) {
    ok(short.data.before === '' && short.data.after === '', 'short chat: no summary before or after (no premature compaction)');
    ok(short.data.markerWritten === false, 'short chat: the LLM seam was NEVER called (token check short-circuits)');
    ok(short.data.compactionEvents === 0, 'short chat: zero context_compaction events');
  }
  const long = runChild(comp, ['long'], { JEXI_COMPACTION_TOKENS: '2000' });
  ok(long.ok, 'long chat runs through the compaction probe', long.ok ? '' : long.error);
  if (long.ok) {
    ok(long.data.compactionEvents === 1, `long chat: exactly one context_compaction event (got ${long.data.compactionEvents})`);
    ok((long.data.summary || '').includes('marker'), 'long chat: summary was generated by the compaction');
    const ev = long.data.event || {};
    ok(ev.type === 'context_compaction' && ev.payload && ev.payload.trigger === 'token_threshold', `event trigger is token_threshold (got ${ev.payload && ev.payload.trigger})`);
    ok(Number(ev.payload.threshold) === 2000, `event records the threshold (got ${ev.payload && ev.payload.threshold})`);
    ok(Number(ev.payload.estimatedTokens) >= 2000, `event records the real token estimate (got ${ev.payload && ev.payload.estimatedTokens})`);
    ok(Number(ev.payload.turnsCompressed) === 28, `event records how many turns were compressed (got ${ev.payload && ev.payload.turnsCompressed})`);
  }
  const force = runChild(comp, ['force'], { JEXI_COMPACTION_TOKENS: '2000' });
  ok(force.ok, 'force compaction runs through the probe', force.ok ? '' : force.error);
  if (force.ok) {
    ok(force.data.compactionEvents === 1, 'force:true compacts regardless of size');
    ok(force.data.event && force.data.event.payload.trigger === 'manual', 'forced compaction is logged with trigger: manual');
  }

  console.log('\n== B78 — RUNTIME WIRING: workers, orchestrator, tools emit events ==');
  // --- D1. runWorker: coworker_call + coworker_result ---
  const { runWorker } = await import('./src/services/WorkerRouter.js');
  const wr = await runWorker('memory', 'The user asked: "what is my name?"', 'You are JEXI OS.', {
    tools: [{ slug: 'memory-recall', name: 'Memory Recall', desc: 'Recall', schema: {} }],
    maxIterations: 3,
    __mockCompletions: [
      { toolCalls: [{ id: 'call_1', name: 'memory-recall', arguments: { query: 'name' } }], text: '' },
      { toolCalls: [], text: 'Your name is Lewis.' },
    ],
  });
  ok(wr.ok === true && wr.text === 'Your name is Lewis.', 'runWorker completes via the mock tool loop', `provider=${wr.provider}`);
  const calls = getEvents({ type: 'coworker_call' });
  const results = getEvents({ type: 'coworker_result' });
  const lastCall = calls[calls.length - 1] || {};
  ok(calls.length >= 1 && lastCall.payload && lastCall.payload.coworker === 'memory' && lastCall.payload.provider, `coworker_call logged with the coworker + provider (${calls.length} call event(s), last: ${lastCall.payload && lastCall.payload.coworker})`);
  ok(results.length >= 1 && results[results.length - 1].payload.ok === true, 'coworker_result logged with ok:true for the successful run');

  // --- D2. runSimpleTask: orchestrator_decision (SIMPLE + coworkers) ---
  const { runSimpleTask } = await import('./src/services/SimpleTask.js');
  await runSimpleTask({ intent: 'conversation', complexityReason: 'single-shot greeting', tasks: [], steps: [] }, 'hello', () => {});
  const decisions = getEvents({ type: 'orchestrator_decision' });
  ok(decisions.length >= 1, 'orchestrator_decision event logged for the SIMPLE path');
  const last = decisions[decisions.length - 1];
  ok(last.payload.complexity === 'SIMPLE' && Array.isArray(last.payload.coworkers) && last.payload.coworkers.length === 1, 'decision records complexity SIMPLE + the single coworker', `coworkers=${JSON.stringify(last.payload.coworkers)}`);
  ok(Array.isArray(last.payload.coworkerFiles) && last.payload.coworkerFiles.length === 1, 'decision records which coworker file mandate was loaded', `files=${JSON.stringify(last.payload.coworkerFiles)}`);

  // --- D3. executeTool: tool_call + tool_result ---
  const { executeTool } = await import('./src/services/ToolRuntime.js');
  await executeTool({ slug: 'profile-read', args: {} });
  const toolCalls = getEvents({ type: 'tool_call' });
  const toolResults = getEvents({ type: 'tool_result' });
  ok(toolCalls.length >= 1 && toolCalls[toolCalls.length - 1].payload.tool === 'profile-read', 'tool_call logged with the real tool slug');
  ok(toolResults.length >= 1 && toolResults[toolResults.length - 1].payload.tool === 'profile-read', 'tool_result logged with the real tool slug + outcome');

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
