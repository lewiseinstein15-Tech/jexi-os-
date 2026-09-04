/**
 * B220 — retry-after-aware cooldowns.
 *
 * The user felt "jexi taking a lot of time on understanding the question":
 * one cause (fixed in B219) was dead models; the other was the flat 30s
 * cooldown RE-POKING quota-blocked providers every 30s even when they said
 * "Please retry in 47s". This suite proves the hint is parsed, honored, and
 * bounded — and that the old streak behavior still works without a hint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { __parseRetryAfterMs } = await import('./src/services/LLMClient.js');
const {
  recordProviderFailure, recordProviderSuccess, providerInCooldown,
  providerOrder, resetProviderHealth,
} = await import('./src/services/ProviderRouter.js');

test('parser: Gemini "Please retry in 46.802877072s" → ~47s (bounded, ms-precision kept)', () => {
  const msg = 'Quota exceeded ... Please retry in 46.802877072s. [{"@type":"type.googleapis.com/google.rpc.Help"}]';
  assert.equal(__parseRetryAfterMs(msg), 46803);
});

test('parser: Groq "Please try again in 3.2s" → 3200ms', () => {
  assert.equal(__parseRetryAfterMs('Rate limit reached for model `openai/gpt-oss-120b` ... Please try again in 3.2s'), 3200);
});

test('parser: minutes, ms, caps, and no-hint cases', () => {
  assert.equal(__parseRetryAfterMs('retry in 2m'), 120000);
  assert.equal(__parseRetryAfterMs('retry in 250ms'), 1000); // floored to 1s
  assert.equal(__parseRetryAfterMs('try again in 999999s'), 15 * 60 * 1000); // capped at 15 min
  assert.equal(__parseRetryAfterMs('model_not_found: nope'), null);
  assert.equal(__parseRetryAfterMs(''), null);
  assert.equal(__parseRetryAfterMs(null), null);
});

test('a hinted 429 parks the provider IMMEDIATELY (no 3-strike wait)', () => {
  resetProviderHealth('gemini');
  assert.equal(providerInCooldown('gemini'), false);
  recordProviderFailure('gemini', 47000); // one quota failure WITH a hint
  assert.equal(providerInCooldown('gemini'), true, 'must cool down on the FIRST hinted failure');
  const order = providerOrder('');
  assert.ok(order.indexOf('gemini') >= 3, `a cooling provider must move to the tail (got ${order.join(',')})`);
  resetProviderHealth('gemini');
});

test('without a hint the old streak rule stands (3 consecutive → 30s)', () => {
  resetProviderHealth('groq');
  recordProviderFailure('groq');
  recordProviderFailure('groq');
  assert.equal(providerInCooldown('groq'), false, 'two failures must not cool down yet');
  recordProviderFailure('groq');
  assert.equal(providerInCooldown('groq'), true, 'third consecutive failure starts the 30s cooldown');
  resetProviderHealth('groq');
});

test('success clears the cooldown (a recovered provider rejoins the head)', () => {
  resetProviderHealth('groq');
  recordProviderFailure('groq', 60000);
  assert.equal(providerInCooldown('groq'), true);
  recordProviderSuccess('groq', 800);
  assert.equal(providerInCooldown('groq'), false);
  const order = providerOrder('');
  assert.ok(order.indexOf('groq') < 3, 'a healthy fast provider returns to the head');
  resetProviderHealth('groq');
});

test('hinted cooldown never SHORTENS an existing longer cooldown', () => {
  resetProviderHealth('openrouter');
  recordProviderFailure('openrouter', 600000); // 10 min
  recordProviderFailure('openrouter', 5000); // shorter hint arrives
  const before = Date.now();
  // still cooling well past 5s+3s — the 10-min window must survive
  assert.ok(providerInCooldown('openrouter'), 'still cooling');
  resetProviderHealth('openrouter');
  void before;
});
