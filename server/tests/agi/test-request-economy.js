/**
 * AGI Phase 1 (increments 2–4) — request economy contracts:
 * budgets, response cache, request deduplication. Keyless, deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_DIR = './data/test-agi-economy';

const { TaskBudget, withBudget } = await import('../../src/services/RequestBudget.js');
const { cacheKey, cacheGet, cacheSet, cacheInvalidate, cacheStats, __resetCache } = await import('../../src/services/ResponseCache.js');
const { dedupeInflight, requestIdentity, dedupStats, __resetDedup } = await import('../../src/services/RequestDedup.js');

/* ═══ 1. TASK BUDGETS (spec §13) ═══════════════════════════════════════ */

test('a budget starts open and closes exactly when a limit is hit', () => {
  const b = new TaskBudget({ maxModelCalls: 3, label: 'bench' });
  assert.equal(b.canSpend().ok, true);
  b.consume(); b.consume();
  assert.equal(b.canSpend().ok, true); // 1 left
  b.consume();
  const gate = b.canSpend();
  assert.equal(gate.ok, false);
  assert.match(gate.why, /model calls exhausted/);
  assert.equal(b.remaining().modelCalls, 0);
});

test('token, retry, and wall-clock limits each stop spending with their own reason', () => {
  const t = new TaskBudget({ maxTokens: 100 });
  t.consume({ tokens: 60 });
  assert.equal(t.canSpend({ tokens: 50 }).ok, false); // 40 left < 50 needed
  assert.match(t.canSpend({ tokens: 50 }).why, /token budget/);

  const r = new TaskBudget({ maxRetries: 1 });
  r.consume({ retry: true });
  assert.match(r.canSpend().why, /retry budget/);

  const w = new TaskBudget({ wallClockMs: 0 });
  assert.match(w.canSpend().why, /wall-clock/);
});

test('the first exhaustion reason sticks (never silently resets)', () => {
  const b = new TaskBudget({ maxModelCalls: 1 });
  b.consume();
  b.canSpend();
  assert.match(b.exhaustedReason, /model calls/);
  assert.match(b.canSpend().why, /model calls/);
});

test('withBudget wraps an llm function and counts its calls', async () => {
  const b = new TaskBudget({ maxModelCalls: 2, label: 'wrap' });
  let calls = 0;
  const fn = withBudget(b, async () => { calls += 1; return 'a forty-character answer for token counting!'; });
  await fn();
  await fn();
  assert.equal(calls, 2);
  assert.equal(b.used.modelCalls, 2);
  await assert.rejects(fn(), /Budget exhausted/);
  assert.equal(calls, 2); // the third call never ran
});

/* ═══ 2. RESPONSE CACHE (spec §15) ═════════════════════════════════════ */

test('identical cacheable requests hit; different ones miss', () => {
  __resetCache();
  const k1 = cacheKey({ prompt: 'summarize the plan', system: 's', namespace: 'bench' });
  const k2 = cacheKey({ prompt: 'summarize the OTHER plan', system: 's', namespace: 'bench' });
  cacheSet(k1, 'cached answer');
  assert.equal(cacheGet(k1).value, 'cached answer');
  assert.equal(cacheGet(k2), null);
  assert.equal(cacheStats().hits, 1);
});

test('entries expire after their TTL (no staleness)', () => {
  __resetCache();
  const k = cacheKey({ prompt: 'x', namespace: 'bench' });
  cacheSet(k, 'old', { ttlMs: 50 });
  assert.ok(cacheGet(k, Date.now() + 10)); // still fresh
  assert.equal(cacheGet(k, Date.now() + 100), null); // expired
});

test('cache invalidation removes by key or namespace', () => {
  __resetCache();
  cacheSet(cacheKey({ prompt: 'a', namespace: 'bench' }), 1);
  cacheSet(cacheKey({ prompt: 'b', namespace: 'bench' }), 2);
  assert.equal(cacheInvalidate('bench'), 2); // whole namespace
  cacheSet(cacheKey({ prompt: 'a', namespace: 'bench' }), 3);
  assert.equal(cacheInvalidate(cacheKey({ prompt: 'a', namespace: 'bench' })), 1); // exact key
  assert.equal(cacheStats().entries, 0);
});

test('the cache is bounded (oldest evicted, never grows forever)', () => {
  __resetCache();
  for (let i = 0; i < 205; i++) cacheSet(cacheKey({ prompt: `p${i}`, namespace: 'bench' }), i);
  assert.ok(cacheStats().entries <= 200);
  assert.ok(cacheStats().evictions >= 5);
});

/* ═══ 3. REQUEST DEDUPLICATION (spec §16) ══════════════════════════════ */

test('concurrent identical requests share ONE execution', async () => {
  __resetDedup();
  let executions = 0;
  const fn = () => new Promise((r) => setTimeout(() => { executions += 1; r('shared result'); }, 30));
  const [a, b, c] = await Promise.all([
    dedupeInflight('same-key', fn),
    dedupeInflight('same-key', fn),
    dedupeInflight('same-key', fn),
  ]);
  assert.equal(executions, 1);
  assert.deepEqual([a, b, c], ['shared result', 'shared result', 'shared result']);
  assert.equal(dedupStats().coalesced, 2);
});

test('after the shared call settles, a new identical call is fresh (no staleness)', async () => {
  __resetDedup();
  let executions = 0;
  const fn = async () => { executions += 1; return `run${executions}`; };
  assert.equal(await dedupeInflight('k', fn), 'run1');
  assert.equal(await dedupeInflight('k', fn), 'run2'); // sequential → NOT shared
  assert.equal(executions, 2);
  assert.equal(dedupStats().inFlight, 0);
});

test('a failed shared request rejects for everyone and is not kept in-flight', async () => {
  __resetDedup();
  const fn = async () => { throw new Error('provider down'); };
  const results = await Promise.allSettled([dedupeInflight('bad', fn), dedupeInflight('bad', fn)]);
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.equal(dedupStats().inFlight, 0);
});

test('request identity separates providers, models, prompts, and images', () => {
  const base = { prompt: 'p', system: 's', imageBase64: null, provider: 'groq', model: null, temperature: null };
  assert.equal(requestIdentity(base), requestIdentity({ ...base }));
  assert.notEqual(requestIdentity(base), requestIdentity({ ...base, provider: 'gemini' }));
  assert.notEqual(requestIdentity(base), requestIdentity({ ...base, prompt: 'other' }));
  assert.notEqual(requestIdentity(base), requestIdentity({ ...base, imageBase64: 'data:image/png;base64,AAAA' }));
});

/* ═══ 4. integration with the real generateContent wrapper ═════════════ */

test('the economy layer never changes the honest no-keys failure', async () => {
  const { generateContent } = await import('../../src/services/LLMClient.js');
  // no keys in this environment → the wrapper must still surface the true error
  await assert.rejects(
    generateContent('hello', 'system', null, { cache: true }),
    (e) => /No API keys configured|All AI providers failed/.test(e.message),
  );
  // and a budget that is already exhausted refuses BEFORE any provider walk
  const b = new TaskBudget({ maxModelCalls: 0, label: 'pre-exhausted' });
  await assert.rejects(
    generateContent('hello', 'system', null, { budget: b }),
    (e) => /Budget exhausted/.test(e.message),
  );
});
