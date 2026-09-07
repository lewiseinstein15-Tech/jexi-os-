/**
 * LIVE TRACE — tool_use event contract regression suite.
 *
 * Proves: every executeTool call emits tool_use/running FIRST and exactly
 * one tool_use/success|error completion AFTER — in order, with the same id,
 * even on refused/unknown tools (no silent gaps in the transcript). Shape:
 * { type:'tool_use', id, tool: Bash|Read|Edit, status, duration_ms,
 *   summary, detail }.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-trace-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { executeTool } = await import('./src/services/ToolRuntime.js');

const shapeOk = (e) =>
  e && e.type === 'tool_use' && typeof e.id === 'string' && e.id.length > 0 &&
  ['Bash', 'Read', 'Edit'].includes(e.tool) &&
  ['running', 'success', 'error'].includes(e.status) &&
  typeof e.duration_ms === 'number' &&
  typeof e.summary === 'string' && e.summary.length > 0 &&
  typeof e.detail === 'string';

// 1. refused-by-allowlist tool: running → error, same id, no gap
{
  const seen = [];
  const r = await executeTool({ slug: 'web-search', args: { query: 'x' }, intent: 'conversation', sendEvent: (t, d) => seen.push({ type: t, ...d }) });
  const trace = seen.filter((e) => e.type === 'tool_use');
  ok(r && r.ok === false, 'allowlist-refused tool returns ok:false');
  ok(trace.length === 2, `refused tool emits exactly 2 tool_use events (got ${trace.length})`);
  ok(trace[0] && trace[0].status === 'running' && trace[1] && trace[1].status === 'error', 'refused tool: running FIRST, error AFTER');
  ok(trace[0] && trace[1] && trace[0].id === trace[1].id, 'running + completion share one id');
  ok(trace.every(shapeOk), 'refused tool events match the schema shape');
  ok(trace[1].duration_ms >= 0 && /used (Bash|Read|Edit)/.test(trace[0].summary), 'completion carries duration_ms, summary reads "used <Tool>"');
}

// 2. unknown tool: running → error (a gap here would strand a spinner)
{
  const seen = [];
  await executeTool({ slug: 'no-such-tool-xyz', args: {}, sendEvent: (t, d) => seen.push({ type: t, ...d }) });
  const trace = seen.filter((e) => e.type === 'tool_use');
  ok(trace.length === 2 && trace[0].status === 'running' && trace[1].status === 'error', 'unknown tool: running → error, no gap');
  ok(trace[0].id === trace[1].id && trace.every(shapeOk), 'unknown tool events share id + match shape');
}

// 3. no sendEvent: tracing is fail-open, tool still runs
{
  const r = await executeTool({ slug: 'no-such-tool-xyz', args: {} });
  ok(r && r.ok === false && /Unknown tool/.test(String(r.error || '')), 'missing sendEvent: tool still executes, nothing throws');
}

console.log(`\nTRACE-EVENTS: ${passed} passed, ${failedCount} failed.`);
process.exit(failedCount ? 1 : 0);
