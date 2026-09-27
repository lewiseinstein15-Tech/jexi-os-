#!/usr/bin/env node
/**
 * JEXI OS — Phase 5 P5-3 hook — log-tool-result (PostToolUse, WARN).
 *
 * Runs after every tool call completes. Logs the outcome line the kernel
 * shows in the hook log: tool name + ok/fail + duration-ish payload digest.
 * Warn-level: never blocks. Keeps the hook log honest about what actually
 * executed without any extra transport.
 *
 * Stdin context (JSON): { event, tool, args, result, sessionId, agentId }
 */

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => resolve(buf));
});

let ctx = {};
try { ctx = JSON.parse(raw || '{}'); } catch { /* empty context */ }

const tool = String(ctx?.tool ?? '(unknown tool)');
const result = ctx?.result ?? null;
const ok = result && typeof result === 'object' ? result.ok !== false : Boolean(result);
const digest = (() => {
  try { return JSON.stringify(result ?? null).slice(0, 120); } catch { return '(unserializable result)'; }
})();

console.log(`[log-tool-result] ${ok ? 'OK' : 'FAIL'} ${tool} → ${digest}`);
process.exit(0); // warn-level: always allow
