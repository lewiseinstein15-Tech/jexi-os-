/**
 * M17 — D2: benchmark determinism.
 *
 * Defect (M16): five runs of the same dataset + model produced 8/15, 2/15,
 * 1/15, 9/15 and 0/6. The failure signature — tasks that emitted no tool call
 * and looped until timeout, at a different position each run — pointed at a
 * silent provider substitution: LLMClient's keyless ladder (Kilo /
 * Pollinations) could answer for the locked primary and the manifest recorded
 * only a coworker nickname, so the slide was invisible.
 *
 * The fix has two halves, both tested here against the real modules:
 *   1. JEXI_PROVIDER_LOCK reduces the ladder to exactly one provider.
 *   2. Every provider dial is recorded, so a slide is visible in the manifest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { providerOrder } from '../../src/providers/runtime/ProviderRouter.js';
import {
  recordAttempt, providerAttempts, providersThatServed, resetProviderAttempts,
} from '../../src/providers/runtime/ProviderAttempts.js';

test('M17/D2: JEXI_PROVIDER_LOCK reduces the ladder to exactly that provider', () => {
  const prev = process.env.JEXI_PROVIDER_LOCK;
  try {
    process.env.JEXI_PROVIDER_LOCK = 'ollama';
    const order = providerOrder('');
    assert.deepEqual(order, ['ollama'], 'the ladder must be exactly the locked provider');
    assert.ok(!order.includes('kilo'), 'the keyless Kilo leg must not be reachable under a lock');
    assert.ok(!order.includes('pollinations'), 'nor Pollinations');
    assert.ok(!order.includes('groq'), 'nor any keyed remote leg');
  } finally {
    if (prev === undefined) delete process.env.JEXI_PROVIDER_LOCK; else process.env.JEXI_PROVIDER_LOCK = prev;
  }
});

test('M17/D2: the lock survives an intent preference (no lane overrides it)', () => {
  const prev = process.env.JEXI_PROVIDER_LOCK;
  try {
    process.env.JEXI_PROVIDER_LOCK = 'ollama';
    assert.deepEqual(providerOrder('gemini'), ['ollama']);
    assert.deepEqual(providerOrder('code'), ['ollama']);
  } finally {
    if (prev === undefined) delete process.env.JEXI_PROVIDER_LOCK; else process.env.JEXI_PROVIDER_LOCK = prev;
  }
});

test('M17/D2: with no lock the ladder still has its fallback legs', () => {
  const prev = process.env.JEXI_PROVIDER_LOCK;
  try {
    delete process.env.JEXI_PROVIDER_LOCK;
    const order = providerOrder('');
    assert.ok(order.length > 1, 'an unlocked ladder is a ladder');
    assert.ok(order.includes('kilo'), 'the keyless floor is present when unlocked');
  } finally {
    if (prev !== undefined) process.env.JEXI_PROVIDER_LOCK = prev;
  }
});

test('M17/D2: the provider audit trail records what actually served a call', () => {
  resetProviderAttempts();
  recordAttempt({ provider: 'ollama', model: 'llama3.2:3b', ok: true, ms: 900, lane: 'tools' });
  recordAttempt({ provider: 'kilo', model: null, ok: true, ms: 1200, lane: 'plain-text-fallback' });
  recordAttempt({ provider: 'ollama', model: 'llama3.2:3b', ok: false, lane: 'tools', reason: 'HTTP 500' });
  const all = providerAttempts();
  assert.equal(all.length, 3);
  assert.deepEqual(providersThatServed().sort(), ['kilo', 'ollama']);
  // the fallback substitution is explicitly visible, not inferred from a name
  assert.ok(all.some((a) => a.lane === 'plain-text-fallback'), 'a plain-text substitution must be recorded');
});

test('M17/D2: resetting the trail gives each benchmark task its own record', () => {
  resetProviderAttempts();
  recordAttempt({ provider: 'ollama', ok: true, lane: 'tools' });
  assert.equal(providerAttempts().length, 1);
  resetProviderAttempts();
  assert.equal(providerAttempts().length, 0);
});

test('M17/D2: the trail is bounded so a long run cannot grow without limit', () => {
  resetProviderAttempts();
  for (let i = 0; i < 500; i += 1) recordAttempt({ provider: 'ollama', ok: true, lane: 'tools', i });
  assert.ok(providerAttempts().length <= 200, 'the trail is capped');
  // the newest entries survive
  assert.equal(providerAttempts().at(-1).i, 499);
});
