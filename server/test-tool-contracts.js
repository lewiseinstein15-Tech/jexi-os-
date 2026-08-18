/**
 * B101 — TOOL CONTRACTS + PER-TOOL TIMEOUTS regression suite
 * (deepseek-harness output-contract + timeout-policy mirror).
 *
 * Proves: every registry tool has an output contract (specific or generic),
 * canonical engine shapes pass + garbage fails, null (routing) is legal,
 * per-tool timeoutMs produces the structured TOOL_TIMEOUT result, plugin
 * tools can declare budgets, and cooperative cancellation aborts engines.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate stores FIRST (config reads env at import).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jexi-tc-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.WORKSPACE_DIR = path.join(TMP, 'ws');

let passed = 0, failedCount = 0;
const ok = (c, n) => { if (c) { passed++; console.log(`  ✅ ${n}`); } else { failedCount++; console.log(`  ❌ ${n}`); } };

const { executeTool, validateToolOutput, hasOutputContract, TOOL_OUTPUT_SCHEMAS, GENERIC_TOOL_OUTPUT } = await import('./src/services/ToolRuntime.js');
const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');
const { createPluginContext, setActivePluginContext } = await import('./src/services/PluginContext.js');

console.log('\n== 1. Every registry tool has an output contract (dsh mandatory output) ==');
ok(TOOL_COUNT === 206, `registry count stable (${TOOL_COUNT})`);
const missing = TOOL_REGISTRY.filter((t) => !hasOutputContract(t.slug)).map((t) => t.slug);
ok(missing.length === 0, `all ${TOOL_COUNT} tools contract-checked (missing: ${missing.slice(0, 5).join(', ') || 'none'})`);
const specific = TOOL_REGISTRY.filter((t) => TOOL_OUTPUT_SCHEMAS[t.slug]).length;
ok(specific >= 35, `specific contracts cover the structured engines (${specific} specific + generic baseline)`);
ok(!!GENERIC_TOOL_OUTPUT, 'generic baseline contract exported');

console.log('\n== 2. Canonical engine shapes pass; garbage fails ==');
const FIXTURES = {
  'web-search': { kind: 'search', query: 'q', results: [{ title: 't', url: 'u', snippet: 's' }] },
  'deep-read': { kind: 'content', url: 'https://x', text: 'body' },
  'pdf-extract': { kind: 'pdf', url: 'https://x.pdf', text: 'text' },
  'trusted-library': { kind: 'books', topic: 't', books: [{ title: 'b', url: 'u' }] },
  'book-fetch': { kind: 'book', url: 'u', text: 't' },
  'news-feed': { kind: 'news', query: 'ai', items: [{ title: 'n', url: 'u', source: 's' }] },
  'memory-recall': { kind: 'memory', query: 'q', matches: [{ label: 'l', text: 't' }] },
  'semantic-search': { kind: 'memory', query: 'q', matches: [] },
  'knowledge-search': { kind: 'knowledge', query: 'q', hits: [] },
  'profile-read': { kind: 'profile', profile: {}, facts: [] },
  'code-run': { kind: 'exec', command: 'ls', output: 'out', success: true },
  'code-write': { kind: 'written', file: 'a.js' },
  'summarize-doc': { kind: 'summary', summary: 's' },
  'video-analyze': { kind: 'video', url: 'u', summary: 's' },
  'video-transcript': { kind: 'transcript', url: 'u', text: 't' },
  'data-crunch': { kind: 'stats', stats: { mean: 1 } },
  'stats-compute': { kind: 'stats', stats: {} },
  'news-feed2': { kind: 'news', query: 'h', items: [] },
};
for (const [slug, shape] of Object.entries(FIXTURES)) {
  const real = TOOL_OUTPUT_SCHEMAS[slug.replace('2', '')] ? slug.replace('2', '') : slug;
  const check = (TOOL_OUTPUT_SCHEMAS[real] || GENERIC_TOOL_OUTPUT).safeParse(shape);
  ok(check.success, `${real} canonical shape passes`);
}
ok(validateToolOutput('web-search', { kind: 'search', query: 'q', results: [] }).ok, 'search shape through validateToolOutput');
ok(validateToolOutput('web-search', { ok: false, error: 'network down' }).ok, 'honest-failure shape tolerated');
ok(validateToolOutput('whatever-tool', { kind: 'anything', data: 1 }).ok, 'generic accepts any plain object');
ok(validateToolOutput('whatever-tool', 'plain string result').ok, 'generic accepts string results');
ok(!validateToolOutput('whatever-tool', 42).ok, 'number result rejected (garbage)');
ok(!validateToolOutput('whatever-tool', [1, 2]).ok, 'array result rejected (garbage)');
ok(!validateToolOutput('whatever-tool', undefined).ok, 'no output rejected');
ok(validateToolOutput('whatever-tool', null).ok, 'null = routing contract, legal');

console.log('\n== 3. Per-tool timeoutMs → structured TOOL_TIMEOUT (dsh timeout-policy) ==');
const pctx = createPluginContext({ services: {} });
pctx.tools.register({
  slug: 'slow-tool', name: 'Slow Tool', timeoutMs: 250,
  handler: async () => { await new Promise((r) => setTimeout(r, 3000)); return { ok: true, data: 'late' }; },
});
pctx.tools.register({
  slug: 'fast-tool', name: 'Fast Tool',
  handler: async () => ({ ok: true, data: 'quick' }),
});
setActivePluginContext(pctx);
const t0 = Date.now();
const tmo = await executeTool({ slug: 'slow-tool', args: {} });
const elapsed = Date.now() - t0;
ok(tmo.ok === false && tmo.code === 'TOOL_TIMEOUT', 'timeout produces structured TOOL_TIMEOUT');
ok(/timed out after 250ms/.test(tmo.error || ''), `message names the budget (${tmo.error})`);
ok(elapsed < 1500, `fired at the deadline, not after completion (${elapsed}ms)`);
const fast = await executeTool({ slug: 'fast-tool', args: {} });
ok(fast.ok === true && fast.result.includes('quick'), 'non-budgeted tools unaffected');

console.log('\n== 4. Registry-declared budgets are sane ==');
const declared = TOOL_REGISTRY.filter((t) => t.timeoutMs);
ok(declared.length >= 25, `long-running tools declare budgets (${declared.length})`);
ok(declared.every((t) => Number.isFinite(t.timeoutMs) && t.timeoutMs > 0), 'all declared budgets are positive finite numbers');
const runCode = TOOL_REGISTRY.find((t) => t.slug === 'run_code');
ok(runCode && runCode.timeoutMs === 240000, 'run_code declares its long budget on the definition (dsh)');

console.log('\n== 5. Cooperative cancellation: aborted signal stops run_code fast ==');
const abortController = new AbortController();
abortController.abort();
const t1 = Date.now();
const aborted = await executeTool({ slug: 'run_code', args: { code: `while (true) {}`, description: 'infinite' }, signal: abortController.signal });
const abortedMs = Date.now() - t1;
ok(abortedMs < 10000, `aborted run_code terminates quickly (${abortedMs}ms)`);
ok(aborted.ok === false, 'aborted program reports failure, never a hang');

console.log('\n== 6. Routed tools (null result) survive the contract gate ==');
const routed = await executeTool({ slug: 'threat-model', args: {} });
ok(routed.ok === true && routed.routed === true, 'registry-only tool routes to its agents (null = routing)');
ok(String(routed.result || '').includes('risk-analyst'), 'routing names the owning agents');

console.log(`\nB101 tool-contracts+timeouts: ${passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
