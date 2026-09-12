/**
 * PHASE 2 — SCOPE B — Tool calling normalization.
 *
 * Every tool call, regardless of provider, lands in the same ToolCall shape.
 * The agent loop never sees provider-specific tool-call formats.
 *
 * Explicitly asked for run:
 *   node --test --test-reporter=spec tests/agi/test-worker-router.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const tools = await import('../../src/tools/index.js');
const bridge = await import('../../src/providers/index.js');
const {
  ToolCall, ToolResult, registerToolBatch, makeExecutor, runToolCalls, validateCall,
} = tools;
const { NormalizedResponse } = bridge;

/* ═══ MOCK PROVIDERS ═══════════════════════════════════════════════════════ */

function openAIProviderToolCall() {
  // OpenAI wire shape: { id, type, function: { name, arguments: string } }
  return { id: 'call_zyx987', type: 'function', function: { name: 'fs_read', arguments: '{"path":"README.md"}' } };
}

function anthropicProviderToolCall() {
  // Anthropic wire shape: { id, type: 'tool_use', name, input }
  return { id: 'toolu_abc123', type: 'tool_use', name: 'fs_read', input: { path: 'README.md' } };
}

const bothShapes = [openAIProviderToolCall(), anthropicProviderToolCall()];

/* ═══ 1. Both provider formats normalize to the SAME ToolCall shape ═══════ */

test('OpenAI and Anthropic tool calls normalize to IDENTICAL ToolCall', () => {
  const [openai, anthropic] = bothShapes;
  const a = ToolCall.from(openai);
  const b = ToolCall.from(anthropic);
  assert.ok(a instanceof ToolCall);
  assert.ok(b instanceof ToolCall);
  assert.deepEqual(a.name, b.name, 'names match');
  assert.deepEqual(a.arguments, b.arguments, 'arguments (already parse-identical)');
  assert.equal(a.name, 'fs_read');
  assert.deepEqual(a.arguments, { path: 'README.md' });
  assert.equal(typeof a.id, 'string');
  assert.ok(a.id.length > 0);
});

test('NormalizedResponse from either provider yields normalized tool_calls', () => {
  const r = new NormalizedResponse({
    content: '',
    tool_calls: bothShapes,
    finish_reason: 'tool_calls',
  });
  const calls = r.tool_calls;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'fs_read');
  assert.equal(calls[1].name, 'fs_read');
  assert.deepEqual(calls[0].arguments, calls[1].arguments);
  assert.equal(r.finish_reason, 'tool_calls');
});

/* ═══ 2. A tool registered once works with BOTH providers ════════════════ */

test('one registration serves both providers through the executor', async () => {
  const unreg = registerToolBatch([
    { name: 'fs_read', description: 'read a file', riskLevel: 'low', runtimeRing: 0, idempotent: true,
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  ]);
  try {
    const exec = makeExecutor({
      engines: { fs_read: async ({ path }) => ({ path, size: 100 }) },
      permissions: { allowedTools: ['fs_read'] },
    });
    const results = [];
    for (const shape of bothShapes) {
      results.push(await exec.execute(ToolCall.from(shape)));
    }
    assert.equal(results.length, 2);
    for (const r of results) {
      assert.equal(r.ok, true, 'both provider calls executed');
      assert.equal(r.name, 'fs_read');
      assert.deepEqual(r.result, { path: 'README.md', size: 100 });
    }
  } finally { unreg(); }
});

test('schema validation rejects a bad argument from EITHER provider', () => {
  const unreg = registerToolBatch([
    { name: 'fs_write', description: 'write file', riskLevel: 'medium', runtimeRing: 1,
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  ]);
  try {
    const exec = makeExecutor({
      engines: { fs_write: async () => ({ ok: true }) },
      permissions: { allowedTools: ['fs_write'] },
    });
    const badOpenAI = ToolCall.from({ id: 'x', type: 'function', function: { name: 'fs_write', arguments: '{"path":"/tmp/x"}' } });
    const badAnthropic = ToolCall.from({ id: 'y', type: 'tool_use', name: 'fs_write', input: { path: '/tmp/x' } });
    for (const bad of [badOpenAI, badAnthropic]) {
      const v = validateCall(bad);
      assert.equal(v.valid, false, `missing content → invalid from ${bad.id}`);
      assert.match(v.errors[0], /content/);
    }
  } finally { unreg(); }
});

/* ═══ 3. Permission gate is deny-by-default ══════════════════════════════ */

test('deny-by-default: ungranted tool call is refused', async () => {
  const unreg = registerToolBatch([
    { name: 'fs_read', description: 'read a file', riskLevel: 'low', runtimeRing: 0,
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  ]);
  try {
    const exec = makeExecutor({
      engines: { fs_read: async () => ({ ok: true }) },
      permissions: {}, // empty grants → deny-by-default
    });
    const r = await exec.execute(ToolCall.from(bothShapes[0]));
    assert.equal(r.ok, false);
    assert.match(r.error?.message ?? '', /deny-by-default|permission denied/);
  } finally { unreg(); }
});

test('risk guard blocks high-risk tool under a low sandbox', async () => {
  const unreg = registerToolBatch([
    { name: 'gh_pr_create', description: 'create github pr', riskLevel: 'high', runtimeRing: 2,
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, sideEffects: ['github'] },
  ]);
  try {
    const exec = makeExecutor({
      engines: { gh_pr_create: async () => ({ ok: true }) },
      permissions: { allowedTools: ['gh_pr_create'], maxRisk: 'critical' }, // let risk-guard assess the ring
      risk: { sandboxRing: 'container' }, // ring 2 tool vs ring 1 sandbox
    });
    const r = await exec.execute(ToolCall.from({ id: 'g', name: 'gh_pr_create', arguments: { title: 'x' } }));
    assert.equal(r.ok, false);
    assert.match(r.error?.message ?? '', /ring/);
  } finally { unreg(); }
});

/* ═══ 4. Agent-loop integration ═════════════════════════════════════════ */

test("runToolCalls executes a full response's calls and feeds results back", async () => {
  const unreg = registerToolBatch([
    { name: 'mem_store', description: 'store fact', riskLevel: 'low', runtimeRing: 1, idempotent: true,
      parameters: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] } },
  ]);
  try {
    const memory = new Map();
    const exec = makeExecutor({
      engines: { mem_store: async ({ key, value }, ctx) => { ctx.memory.set(key, value); return { stored: key }; } },
      permissions: { allowedTools: ['mem_store'] },
    });
    const response = new NormalizedResponse({
      content: '',
      tool_calls: [
        openAIProviderToolCall().function.name === 'fs_read'
          ? { id: 'c1', type: 'function', function: { name: 'mem_store', arguments: '{"key":"k1","value":42}' } }
          : bothShapes[0],
        { id: 'c2', type: 'tool_use', name: 'mem_store', input: { key: 'k2', value: 'hello' } },
      ],
      finish_reason: 'tool_calls',
    });
    const results = await runToolCalls(response, exec, { memory });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok && r instanceof ToolResult));
    assert.equal(memory.get('k1'), 42);
    assert.equal(memory.get('k2'), 'hello');
    // results feed back to provider as tool blocks
    const anthropicBlock = results[0].toProvider('anthropic');
    assert.equal(anthropicBlock.type, 'tool_result');
    assert.ok(anthropicBlock.tool_use_id);
    const openaiBlock = results[1].toProvider('openai');
    assert.equal(openaiBlock.role, 'tool');
    assert.ok(openaiBlock.tool_call_id);
  } finally { unreg(); }
});