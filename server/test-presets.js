/**
 * B102 — AGENT PRESETS + SESSION TRACE regression suite
 * (deepseek-harness agent-presets + web session explorer mirror).
 *
 * Proves: the four preset mappings (standard/ptc/minimal/creator) resolve
 * correctly, unknown values fall back safely, and buildTrace assembles the
 * durable event log + compaction checkpoints into a replayable view.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-presets-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { resolvePreset, presetFromHeader, presetFlavor, PRESETS, DEFAULT_PRESET } = await import('./src/services/PresetManager.js');
const { buildTrace, traceEventLabel, isTraceCompaction } = await import('./src/services/SessionTrace.js');
const { appendEvent } = await import('./src/services/EventLog.js');
const { appendConversationEvent } = await import('./src/services/SessionConversations.js');
const { compactNow } = await import('./src/services/CompactionEngine.js');

console.log('\n== 1. Preset resolution (dsh standard/ptc/minimal/creator) ==');
ok(PRESETS.standard.mode === 'agent' && PRESETS.standard.codeMode === false, 'standard → native tools only');
ok(PRESETS.ptc.mode === 'agent' && PRESETS.ptc.codeMode === true, 'ptc → code mode on');
ok(PRESETS.minimal.mode === 'normal' && PRESETS.minimal.codeMode === false, 'minimal → direct answers');
ok(PRESETS.creator.mode === 'agent' && PRESETS.creator.codeMode === true, 'creator → code mode on');
ok(typeof PRESETS.creator.flavor === 'string' && PRESETS.creator.flavor.length > 20, 'creator carries a flavor line');
ok(PRESETS.standard.flavor === '' && PRESETS.minimal.flavor === '', 'standard/minimal carry no flavor');
ok(resolvePreset('standard').label === 'Standard', 'resolvePreset by name');
ok(resolvePreset('PTC').codeMode === true, 'case-insensitive resolution');
ok(resolvePreset('nonsense') === PRESETS[DEFAULT_PRESET], 'unknown preset → safe default (ptc)');
ok(resolvePreset('') === PRESETS[DEFAULT_PRESET], 'empty header → safe default');
ok(presetFromHeader('creator').mode === 'agent', 'presetFromHeader parses the request header');
ok(presetFlavor('creator').includes('Creator mode'), 'presetFlavor returns the flavor line');

console.log('\n== 2. Session trace: durable events + compaction checkpoints ==');
const CONV = 'trace-conv';
appendEvent('user_message', { source: 'chat', conversation: CONV, text: 'hello trace' }, CONV);
appendEvent('tool_call', { tool: 'web-search', args: { query: 'deepseek harness' }, tier: 'read' }, CONV);
appendEvent('tool_result', { tool: 'web-search', ok: true, durationMs: 812 }, CONV);
appendEvent('tool_call', { tool: 'deep-read', args: { url: 'https://x' }, tier: 'read' }, CONV);
appendEvent('tool_result', { tool: 'deep-read', ok: false, error: 'HTTP 403' }, CONV);
appendEvent('coworker_call', { coworker: 'researcher', provider: 'groq', model: 'llama' }, CONV);
appendEvent('coworker_result', { coworker: 'researcher', ok: true, mode: 'tool_calling', toolCalls: 2 }, CONV);
appendEvent('error', { component: 'chat', message: 'recoverable stream drop' }, CONV);

// a real compaction checkpoint (injected summarizer, no LLM needed)
for (let i = 0; i < 60; i++) {
  appendConversationEvent(CONV, { role: 'user', text: `trace q ${i}: ${'question about systems '.repeat(12)}`, kind: 'chat' });
  appendConversationEvent(CONV, { role: 'jexi', text: `trace a ${i}: ${'detailed answer with examples '.repeat(28)}`, kind: 'chat' });
}
const injected = () => Promise.resolve('<compacted-summary>\n## Primary Request and Intent\n- trace test\n## Key Technical Concepts\n- none\n## Files and Code\n- none\n## Errors and Fixes\n- none\n## Pending Jobs\n- none\n## Decisions and Preferences\n- none\n</compacted-summary>');
const cr = await compactNow(CONV, { summarizer: injected });
ok(cr && cr.compacted === true, 'fixture conversation compacted');

const trace = buildTrace(CONV, { limit: 300 });
ok(Array.isArray(trace.events) && trace.events.length >= 8, `trace carries the durable events (${trace.events.length})`);
ok(trace.events.some((e) => e.type === 'tool_call' && e.payload.tool === 'web-search'), 'tool_call event present with payload');
ok(trace.events.some((e) => e.type === 'tool_result' && e.payload.ok === true && e.payload.durationMs === 812), 'tool_result event with real outcome');
ok(trace.events.some((e) => e.type === 'tool_result' && e.payload.ok === false && e.payload.error === 'HTTP 403'), 'failed tool result recorded honestly');
ok(trace.events.some((e) => e.type === 'user_message'), 'user_message present');
ok(trace.events.some((e) => e.type === 'coworker_call'), 'coworker_call present');
ok(trace.events.some((e) => e.type === 'context_compaction'), 'compaction is a first-class trace event');
ok(trace.compaction.length === 1 && trace.compaction[0].shadowed.events >= 60, 'compaction checkpoint list populated');
ok(trace.counts.tool_call === 2 && trace.counts.tool_result === 2, 'per-type counts derived');
ok(trace.summary && trace.summary.id === CONV, 'conversation summary attached');
ok(typeof trace.lastActivity === 'number', 'lastActivity timestamp present');
ok(traceEventLabel('tool_call') === 'Tool call', 'human labels for the UI');
ok(isTraceCompaction('context_compaction') === true && isTraceCompaction('tool_call') === false, 'compaction marker detection');

// trace is per-session: another conversation's trace is empty
const other = buildTrace('other-conv');
ok(other.events.length === 0 && other.compaction.length === 0, 'traces are namespaced per conversation');

console.log(`\nB102 presets+trace: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
