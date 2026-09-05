/**
 * AGI Phase 1 (increment 1) — ProviderHealthManager contracts.
 * Deterministic, keyless. node --test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = './data/test-agi-provider-health';

// start from a clean slate every run (the chain does not wipe test data)
try { fs.rmSync(path.join(process.env.DATA_DIR, 'provider-health.json'), { force: true }); } catch { /* fine */ }

const {
  classifyProviderError, PROVIDER_STATES,
  recordProviderCallSuccess, recordProviderCallFailure,
  setProviderDisabled, skipForNow, providerState, providerHealthSnapshot,
  __resetProviderHealth,
} = await import('../../src/services/ProviderHealth.js');

/* ═══ 1. error taxonomy (spec §10) ═════════════════════════════════════ */

test('a 429 is RATE_LIMITED, retryable, with a cooldown', () => {
  const c = classifyProviderError('HTTP 429 Too Many Requests');
  assert.equal(c.kind, 'RATE_LIMITED');
  assert.equal(c.retryable, true);
  assert.ok(c.cooldownMs > 0);
});

test('quota exhaustion is NOT retryable and cools down for hours', () => {
  const c = classifyProviderError('daily quota exceeded — upgrade your plan');
  assert.equal(c.kind, 'QUOTA_EXHAUSTED');
  assert.equal(c.retryable, false);
  assert.ok(c.cooldownMs >= 3600_000);
});

test('a bad key is AUTH_ERROR and not retryable', () => {
  const c = classifyProviderError('401 unauthorized: invalid api key');
  assert.equal(c.kind, 'AUTH_ERROR');
  assert.equal(c.retryable, false);
});

test('context overflow is its own kind (retrying the same request cannot help)', () => {
  const c = classifyProviderError('request too large: context length exceeded');
  assert.equal(c.kind, 'CONTEXT_TOO_LARGE');
  assert.equal(c.retryable, false);
  assert.equal(c.cooldownMs, 0); // the provider is fine — the request was too big
});

test('timeouts, overload, 5xx, and network errors are classified separately', () => {
  assert.equal(classifyProviderError('ETIMEDOUT after 30000ms').kind, 'TIMEOUT');
  assert.equal(classifyProviderError('503 service overloaded').kind, 'OVERLOAD');
  assert.equal(classifyProviderError('500 internal server error').kind, 'SERVER_ERROR');
  assert.equal(classifyProviderError('fetch failed: ECONNREFUSED').kind, 'NETWORK');
  assert.equal(classifyProviderError('something novel').kind, 'UNKNOWN');
});

/* ═══ 2. state transitions (spec §12) ══════════════════════════════════ */

test('a fresh provider is healthy; success keeps it healthy with latency EMA', () => {
  __resetProviderHealth();
  assert.equal(providerState('groq').state, 'healthy');
  recordProviderCallSuccess('groq', { latencyMs: 800 });
  recordProviderCallSuccess('groq', { latencyMs: 1200 });
  const s = providerState('groq');
  assert.equal(s.state, 'healthy');
  const snap = providerHealthSnapshot().find((p) => p.provider === 'groq');
  assert.equal(snap.requests, 2);
  assert.equal(snap.latencyEwmaMs, 960); // 800*0.6 + 1200*0.4
  assert.ok(snap.lastSuccessAt);
});

test('a rate-limited provider enters rate_limited and cools down — then recovers', () => {
  __resetProviderHealth();
  const now = Date.now();
  recordProviderCallFailure('gemini', 'HTTP 429 rate limit exceeded', { at: now });
  assert.equal(providerState('gemini', now).state, 'rate_limited');
  assert.equal(skipForNow('gemini', now + 1000), true); // still cooling
  assert.equal(skipForNow('gemini', now + 31_000), false); // 30s cooldown expired
  assert.equal(providerState('gemini', now + 31_000).state !== 'rate_limited', true);
});

test('an auth error is STICKY — it never clears on its own', () => {
  __resetProviderHealth();
  recordProviderCallFailure('openrouter', '401 unauthorized: invalid api key');
  assert.equal(providerState('openrouter').state, 'auth_error');
  assert.equal(skipForNow('openrouter', Date.now() + 48 * 3600_000), true); // still skipped two days later
  recordProviderCallSuccess('openrouter'); // only a real success (new key) clears it
  assert.equal(providerState('openrouter').state, 'healthy');
});

test('consecutive failures scale the cooldown (no retry storms)', () => {
  __resetProviderHealth();
  const now = Date.now();
  const c1 = recordProviderCallFailure('deepseek', 'HTTP 503', { at: now });
  const r1 = providerHealthSnapshot().find((p) => p.provider === 'deepseek');
  const firstCooldown = r1.cooldownUntil - now;
  assert.equal(c1.kind, 'OVERLOAD');
  recordProviderCallFailure('deepseek', 'HTTP 503', { at: now });
  recordProviderCallFailure('deepseek', 'HTTP 503', { at: now });
  const r3 = providerHealthSnapshot().find((p) => p.provider === 'deepseek');
  const thirdCooldown = r3.cooldownUntil - now;
  assert.ok(thirdCooldown > firstCooldown); // scaled up
  assert.ok(thirdCooldown <= 10 * 60_000); // but capped
});

test('three consecutive failures mark the provider unavailable', () => {
  __resetProviderHealth();
  for (let i = 0; i < 3; i++) recordProviderCallFailure('cerebras', 'fetch failed');
  assert.equal(providerState('cerebras').state, 'unavailable');
});

test('disabled providers are skipped and reported as disabled', () => {
  __resetProviderHealth();
  setProviderDisabled('mistral', true);
  assert.equal(skipForNow('mistral'), true);
  assert.equal(providerState('mistral').state, 'disabled');
  setProviderDisabled('mistral', false);
  assert.equal(providerState('mistral').state, 'healthy');
});

test('retry-after overrides are honored (spec §10)', () => {
  __resetProviderHealth();
  const now = Date.now();
  recordProviderCallFailure('groq', '429 rate limit', { at: now, cooldownMs: 46_800 }); // "Please retry in 46.8s"
  const r = providerHealthSnapshot().find((p) => p.provider === 'groq');
  assert.equal(r.cooldownUntil - now, 46_800);
  assert.equal(skipForNow('groq', now + 46_000), true);
  assert.equal(skipForNow('groq', now + 47_000), false);
});

/* ═══ 3. persistence ═══════════════════════════════════════════════════ */

test('health survives a restart (records persist to disk)', async () => {
  __resetProviderHealth();
  // unique names so records from earlier tests cannot pollute this check
  recordProviderCallFailure('restart-a', 'HTTP 429');
  recordProviderCallSuccess('restart-b', { latencyMs: 500 });
  // simulate a restart: drop the in-memory state, keep the file
  __resetProviderHealth();
  const snap = providerHealthSnapshot();
  const a = snap.find((p) => p.provider === 'restart-a');
  const b = snap.find((p) => p.provider === 'restart-b');
  assert.equal(a.lastErrorKind, 'RATE_LIMITED'); // reloaded from disk
  assert.equal(b.requests, 1);
  assert.equal(b.latencyEwmaMs, 500);
});

/* ═══ 4. snapshot is dashboard-shaped and secret-free ══════════════════ */

test('the snapshot carries every dashboard field and no secrets', () => {
  __resetProviderHealth();
  recordProviderCallSuccess('groq', { latencyMs: 300 });
  const snap = providerHealthSnapshot();
  const s = snap[0];
  for (const f of ['provider', 'state', 'requests', 'successes', 'failures', 'rateLimited', 'latencyEwmaMs', 'successRateEwma', 'lastSuccessAt', 'lastFailureAt', 'lastErrorKind', 'cooldownRemainingMs']) {
    assert.ok(f in s, `missing ${f}`);
  }
  assert.ok(!JSON.stringify(snap).match(/sk-[a-zA-Z0-9]{10,}|ghp_|AIza/));
  assert.ok(PROVIDER_STATES.includes(s.state));
});
