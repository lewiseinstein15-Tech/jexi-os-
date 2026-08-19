/**
 * B132 — DSH BATCH suite: tool-goal, checkpoint-policy, atomic-write,
 * telemetry, token-meter, command-feedback.
 *
 * Proves: the goal tools (get/create/update with optimistic revision +
 * honest mismatch errors) execute through the gate; checkpoints are taken
 * amortized and listable; atomic writes are crash-safe (temp+rename);
 * telemetry records + aggregates without secrets; token estimates are sane;
 * command feedback records worked/failed.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-b132-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');
fs.mkdirSync(process.env.WORKSPACE_DIR, { recursive: true });

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { executeTool } = await import('./src/services/ToolRuntime.js');
const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');
const { ctx } = await loadPlugins({ services: {} });
setActivePluginContext(ctx);
const { TOOL_COUNT, TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');

console.log('\n== 1. Goal tools registered + contracts (dsh tool-goal) ==');
ok(TOOL_COUNT === 213, `registry 196 → 205 (${TOOL_COUNT})`);
for (const slug of ['get_goal', 'create_goal', 'update_goal']) {
  ok(TOOL_REGISTRY.some((t) => t.slug === slug), `${slug} registered`);
}

console.log('\n== 2. get_goal → create_goal → update_goal (optimistic revision) ==');
const g0 = await executeTool({ slug: 'get_goal', args: {} });
ok(g0.ok === true && /"goal": null|\"goal\":null/.test(String(g0.result || '')), 'get_goal with no goal returns null (DSH)');
const gc = await executeTool({ slug: 'create_goal', args: { objective: 'build a calculator app', max_goal_rounds: 3 } });
ok(gc.ok === true && /"goal_id": "jexi-active-goal"/.test(String(gc.result || '')), 'create_goal returns goal_id');
ok(/"revision": 1/.test(String(gc.result || '')), 'revision 1');
const g1 = await executeTool({ slug: 'get_goal', args: {} });
ok(/build a calculator/.test(String(g1.result || '')), 'get_goal now returns the objective');
const gu = await executeTool({ slug: 'update_goal', args: { goal_id: 'jexi-active-goal', revision: 1, action: 'edit', objective: 'build a calculator with dark mode' } });
ok(gu.ok === true && /"revision": 2/.test(String(gu.result || '')), 'update with exact revision bumps to 2');
const gBad = await executeTool({ slug: 'update_goal', args: { goal_id: 'jexi-active-goal', revision: 1, action: 'complete' } });
ok(gBad.ok === false && /revision mismatch/.test(gBad.error || ''), 'stale revision fails honestly (DSH optimistic concurrency)');
const gDone = await executeTool({ slug: 'update_goal', args: { goal_id: 'jexi-active-goal', revision: 2, action: 'complete' } });
ok(gDone.ok === true && /"status": "done"/.test(String(gDone.result || '')), 'complete works (status done)');
const gBadAction = await executeTool({ slug: 'update_goal', args: { goal_id: 'jexi-active-goal', revision: 3, action: 'nope' } });
ok(gBadAction.ok === false && /action/.test(gBadAction.error || ''), 'bad action fails honestly');

console.log('\n== 3. Atomic write (crash-safe temp+rename) ==');
const { writeFileAtomic } = await import('./src/services/AtomicWrite.js');
const f = path.join(process.env.DATA_DIR, 'atomic-test.txt');
writeFileAtomic(f, 'hello');
ok(fs.readFileSync(f, 'utf-8') === 'hello', 'atomic write lands');
writeFileAtomic(f, 'world');
ok(fs.readFileSync(f, 'utf-8') === 'world', 'atomic rewrite replaces');
ok(fs.readdirSync(process.env.DATA_DIR).filter((x) => x.includes('.tmp-')).length === 0, 'no temp files left behind');

console.log('\n== 4. Session checkpoints (amortized + listable) ==');
const { maybeCheckpoint, latestCheckpoint, listSessionCheckpoints } = await import('./src/services/SessionCheckpoints.js');
const { appendConversationEvent } = await import('./src/services/SessionConversations.js');
appendConversationEvent('cp-conv', { role: 'user', text: 'build me a thing', kind: 'chat' });
appendConversationEvent('cp-conv', { role: 'jexi', text: 'done', kind: 'chat' });
const cp1 = maybeCheckpoint('cp-conv', { force: true });
ok(!!cp1 && cp1.title.includes('build me a thing'), 'forced checkpoint captures the conversation');
ok(cp1.lastJexi === 'done', 'checkpoint captures the last answer (crash-resume state)');
ok(latestCheckpoint('cp-conv').convId === 'cp-conv', 'latestCheckpoint resolves');
ok(listSessionCheckpoints('cp-conv').length >= 1, 'checkpoints listable');
const cp2 = maybeCheckpoint('cp-conv', { force: true });
ok(!!cp2 && cp2.at >= cp1.at, 'second checkpoint newer');
ok(listSessionCheckpoints('cp-conv').length <= 5, 'rolling cap (max 5)');

console.log('\n== 5. Telemetry (durable, aggregate, no secrets) ==');
const { recordTelemetry, readTelemetry, telemetryStats } = await import('./src/services/Telemetry.js');
recordTelemetry({ latencyMs: 1200, intent: 'code_task', ok: true, toolCalls: 5, providers: ['gemini'], fileCount: 3 });
recordTelemetry({ latencyMs: 300, intent: 'conversation', ok: true, toolCalls: 0 });
recordTelemetry({ latencyMs: 9000, intent: 'research', ok: false, toolCalls: 2 });
const evs = readTelemetry();
ok(evs.length === 3, `telemetry recorded (${evs.length})`);
ok(evs.every((e) => !('query' in e) && !('prompt' in e) && !('key' in e)), 'no prompts/keys in telemetry (safe)');
const st = telemetryStats();
ok(st.total === 3 && st.successRate === 67, `stats aggregate (total ${st.total}, success ${st.successRate}%)`);
ok(st.avgLatencyMs > 0 && st.p95LatencyMs >= st.avgLatencyMs, 'latency stats derived');

console.log('\n== 6. Token meter (deterministic estimate) ==');
const { estimateTokens, underTokenBudget } = await import('./src/services/TokenMeter.js');
const long = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
const est = estimateTokens(long);
ok(est > 500 && est < 2500, `estimate sane for 100 sentences (${est})`);
ok(estimateTokens('') === 0, 'empty → 0');
ok(underTokenBudget('short text', 1000) === true && underTokenBudget(long.repeat(50), 100) === false, 'budget check works');

console.log('\n== 7. Command feedback (dsh command-feedback) ==');
const { addCommandFeedback, listFeedback } = await import('./src/services/FeedbackStore.js');
const cf = addCommandFeedback({ command: '/build todo app', result: 'worked', note: 'preview opened fine' });
ok(cf.ok === true && cf.kind === 'command', 'command feedback recorded');
ok(addCommandFeedback({ command: 'x', result: 'meh' }).ok === false, 'invalid result rejected');
const all = listFeedback();
ok(all.some((x) => x.kind === 'command' && x.result === 'worked'), 'command feedback listed with message feedback');

console.log(`\nB132 dsh-batch: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
