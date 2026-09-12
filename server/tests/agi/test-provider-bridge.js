/**
 * PHASE 2 — SCOPE A — Provider bridge tests.
 *
 * Verifies the provider bridge contract independently of live keys:
 *  - NormalizedResponse / NormalizedToolCall canonical shapes
 *  - capability resolution picks a satisfying provider+model
 *  - fallback chain: first provider fails (rate-limited) → second succeeds
 *  - error classification: auth / rate-limit / context-overflow / transient
 *  - cost optimizer picks the cheapest satisfying model
 *  - transform layer unifies OpenAI vs Anthropic tool-call shapes
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const bridge = await import('../../src/providers/index.js');
const {
  NormalizedResponse, NormalizedToolCall, ClassifiedError,
  classifyError, resolveCapability, tryChain, cheapestSatisfying,
  normalizeResponse, normalizeToolCall, shouldRetry,
  getProvider, registry,
} = bridge;

/* ═══ 1. Canonical shapes ═════════════════════════════════════════════════ */

test('NormalizedResponse canonical shape', () => {
  const r = new NormalizedResponse({
    content: 'hello',
    tool_calls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'a.js' } }],
    finish_reason: 'tool_calls',
    usage: { inputTokens: 10, outputTokens: 5, totalCost: 0.001 },
  });
  assert.equal(r.content, 'hello');
  assert.equal(r.tool_calls[0].name, 'read_file');
  assert.equal(r.tool_calls[0].arguments.path, 'a.js');
  assert.equal(r.finish_reason, 'tool_calls');
  assert.equal(r.usage.inputTokens, 10);
});

test('NormalizedToolCall.from handles OpenAI string arguments', () => {
  const tc = NormalizedToolCall.from({
    id: 'call_abc',
    function: { name: 'read_file', arguments: '{"path":"x.js"}' },
  });
  assert.equal(tc.id, 'call_abc');
  assert.equal(tc.name, 'read_file');
  assert.deepEqual(tc.arguments, { path: 'x.js' });
});

test('OpenAI wire response normalizes to canonical shape', () => {
  const raw = {
    choices: [{
      message: { role: 'assistant', content: 'let me check', tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{"dir":"src"}' } },
      ] },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 50, completion_tokens: 10 },
  };
  const r = normalizeResponse(raw, { id: 'openai' });
  assert.equal(r.content, 'let me check');
  assert.equal(r.finish_reason, 'tool_calls');
  assert.equal(r.tool_calls[0].name, 'ls');
  assert.deepEqual(r.tool_calls[0].arguments, { dir: 'src' });
  assert.equal(r.usage.inputTokens, 50);
});

test('Anthropic wire response normalizes to canonical shape', () => {
  const raw = {
    content: [
      { type: 'thinking', thinking: 'reasoning text here' },
      { type: 'text', text: 'I will look' },
      { type: 'tool_use', id: 'toolu_01', name: 'grep', input: { pattern: 'x' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 30, output_tokens: 8 },
  };
  const r = normalizeResponse(raw, { id: 'anthropic' });
  assert.equal(r.finish_reason, 'tool_calls');
  assert.equal(r.tool_calls[0].id, 'toolu_01');
  assert.equal(r.tool_calls[0].name, 'grep');
  assert.deepEqual(r.tool_calls[0].arguments, { pattern: 'x' });
  assert.equal(r.content, 'I will look');
  assert.equal(r.reasoning, 'reasoning text here');
});

test('OpenAI and Anthropic tool calls normalize to IDENTICAL shape', () => {
  const openai = normalizeToolCall({ id: 'call_1', function: { name: 'read', arguments: '{"p":"a"}' } });
  const anthropic = normalizeToolCall({ id: 'toolu_1', name: 'read', input: { p: 'a' } });
  assert.equal(openai.name, anthropic.name);
  assert.deepEqual(openai.arguments, anthropic.arguments);
  assert.ok(openai.id);
  assert.ok(anthropic.id);
});

/* ═══ 2. Error classification ════════════════════════════════════════════ */

test('error classifier detects rate limits, auth, context overflow', () => {
  const rate = classifyError({ message: '429 too many requests - retry after 5s', status: 429 }, 'groq');
  assert.equal(rate.type, 'rate_limit');
  assert.equal(rate.retryable, true);

  const auth = classifyError({ message: 'invalid api key provided', status: 401 }, 'openai');
  assert.equal(auth.type, 'auth');
  assert.equal(auth.retryable, false);

  const ctx = classifyError({ message: 'This model\'s maximum context length is 128000 tokens' }, 'anthropic');
  assert.equal(ctx.type, 'context_overflow');
  assert.equal(ctx.retryable, true);

  const trans = classifyError(new Error('fetch failed: socket hang up'), 'openrouter');
  assert.equal(trans.type, 'transient');
  assert.equal(trans.retryable, true);
});

test('shouldRetry respects attempt count and backoff', () => {
  const err = ClassifiedError.rateLimit('slow down', { retryAfterMs: 2000 });
  assert.equal(shouldRetry(err, { attempt: 1 }).shouldRetry, true);
  assert.equal(shouldRetry(err, { attempt: 1 }).delayMs, 2000);
  assert.equal(shouldRetry(err, { attempt: 3 }).shouldRetry, false);
});

/* ═══ 3. Capability router ═══════════════════════════════════════════════ */

test('capability router selects provider+model satisfying the profile', () => {
  const providers = registry();
  const available = providers.map((p) => ({ providerId: p.id, provider: p }));
  const res = resolveCapability(
    { requires: ['code_reasoning', 'cheap'], preferredTier: 'medium' },
    available,
    { taskClass: 'cheap' },
  );
  // With no keys configured, router should still pick a config-eligible provider
  // by walking the chain and skipping unconfigured — if ALL are unconfigured it
  // falls to null. The unit-level contract is tested directly below with mocks.
  assert.ok(res === null || res.providerId && res.model, 'resolution is well-formed');
});

test('capability router with mocking: provider must be configured + satisfy', () => {
  const configured = {
    providerId: 'mock', provider: {
      isConfigured: () => true,
      listModels: () => [
        { id: 'small', codeReasoning: 'medium', toolCalling: true, vision: false, contextWindow: 64000 },
      ],
    },
  };
  const res = resolveCapability({ requires: ['tool_calling'], preferredTier: 'small' }, [configured], { chain: ['mock'] });
  assert.equal(res.providerId, 'mock');
  assert.equal(res.model, 'small');
});

/* ═══ 4. Fallback chain ══════════════════════════════════════════════════ */

test('fallback chain walks to next provider when first fails', async () => {
  const failing = {
    chat: async () => { const e = new Error('rate limit exceeded'); e.status = 429; throw e; },
  };
  const working = {
    chat: async () => new NormalizedResponse({ content: 'ok', finish_reason: 'stop' }),
  };
  const result = await tryChain(
    { messages: [{ role: 'user', content: 'hi' }] },
    [{ providerId: 'first', provider: failing }, { providerId: 'second', provider: working }],
  );
  assert.equal(result.providerId, 'second');
  assert.equal(result.response.content, 'ok');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].status, 'fail');
  assert.equal(result.attempts[0].errorType, 'rate_limit');
});

test('fallback chain does NOT hide invalid-request bugs', async () => {
  const bad = { chat: async () => { const e = new Error('400 invalid parameter'); e.status = 400; throw e; } };
  const working = { chat: async () => new NormalizedResponse({ content: 'should not run' }) };
  await assert.rejects(
    tryChain({ messages: [] }, [{ providerId: 'bad', provider: bad }, { providerId: 'ok', provider: working }]),
    (err) => err instanceof ClassifiedError && err.type === 'invalid_request',
  );
});

/* ═══ 5. Cost optimizer ══════════════════════════════════════════════════ */

test('cheapestSatisfying picks the cheapest model that satisfies', () => {
  const candidates = [
    { providerId: 'a', models: [
      { id: 'expensive', codeReasoning: 'strong', toolCalling: true, priceInPer1M: 10, priceOutPer1M: 30 },
    ] },
    { providerId: 'b', models: [
      { id: 'cheap', codeReasoning: 'strong', toolCalling: true, priceInPer1M: 0.2, priceOutPer1M: 0.6 },
      { id: 'very-cheap', codeReasoning: 'weak', toolCalling: false, priceInPer1M: 0.05, priceOutPer1M: 0.1 },
    ] },
  ];
  const best = cheapestSatisfying({ requires: ['tool_calling', 'code_reasoning'] }, candidates);
  assert.equal(best.providerId, 'b');
  assert.equal(best.model, 'cheap');
});

/* ═══ 6. Registry / config ═══════════════════════════════════════════════ */

test('registry exposes all 8 providers with contract surface', () => {
  const providers = registry();
  const ids = providers.map((p) => p.id).sort();
  assert.deepEqual(ids, ['anthropic', 'deepseek', 'google', 'groq', 'mistral', 'ollama', 'openai', 'openrouter']);
  for (const p of providers) {
    assert.equal(typeof p.chat, 'function');
    assert.equal(typeof p.stream, 'function');
    assert.equal(typeof p.countTokens, 'function');
    assert.equal(typeof p.estimateCost, 'function');
    assert.equal(typeof p.listModels, 'function');
    assert.equal(typeof p.isConfigured, 'function');
    assert.ok(p.capabilities, 'capabilities table present');
  }
});

test('provider without key reports isConfigured false except local ollama', () => {
  const providers = registry();
  const nonLocal = providers.filter((p) => p.id !== 'ollama');
  for (const p of nonLocal) assert.equal(p.isConfigured(), false, `${p.id} should be unconfigured`);
  const ollama = getProvider('ollama');
  assert.equal(ollama.isConfigured(), true, 'ollama needs no key');
});