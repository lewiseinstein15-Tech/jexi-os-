/**
 * JEXI OS — Provider Rate Limiter (free-tier protection).
 *
 * Free API tiers are burst- AND daily-limited (Groq ~1,000 RPD, Gemini
 * ~1,500 RPD / 15 RPM, OpenRouter :free 50 RPD / 20 RPM). Bursts of parallel
 * LLM calls inside one graph run are the #1 way to trip them. This module
 * paces EVERY provider call:
 *
 *   - per-provider MIN INTERVAL  — no two calls to the same provider closer
 *     than `intervalMs` apart (default 1200ms, env RATE_MIN_INTERVAL_MS).
 *   - per-provider PER-MINUTE cap — rolling window (RATE_MAX_PER_MINUTE, 30).
 *   - GLOBAL in-flight cap       — at most `maxInFlight` LLM calls at once
 *     (default 2, RATE_MAX_INFLIGHT) so a parallel fan-out can't burst.
 *   - DAILY budget per provider  — RATE_DAILY_CAP (0 = unlimited); counts are
 *     persisted to DATA_DIR/rate-limits.json so a restart can't reset the day.
 *   - bounded WAIT               — takeSlot() waits up to `maxWaitMs` for a
 *     slot, then reports 'throttled' so the caller slides to the next
 *     provider instead of stalling the task.
 *
 * The ProviderRouter still owns HEALTH (cooldowns after failures); this owns
 * PACING (prevention). Both are read by /api/rate/status.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const STATS_FILE = path.join(DATA_DIR, 'rate-limits.json');

/**
 * Config is read LAZILY at call time so env changes apply without a restart
 * (and tests can control pacing by setting env before calls).
 */
function cfg() {
  return {
    intervalMs: Math.max(50, Number(process.env.RATE_MIN_INTERVAL_MS) || 1200),
    maxPerMinute: Number(process.env.RATE_MAX_PER_MINUTE) || 30,
    dailyCap: Number(process.env.RATE_DAILY_CAP) || 0, // 0 = unlimited
    maxWaitMs: Math.max(500, Number(process.env.RATE_MAX_WAIT_MS) || 20000),
    maxInflight: Math.max(1, Number(process.env.RATE_MAX_INFLIGHT) || 2),
  };
}

/** provider → { lastCallAt, windowStart, windowCount, day, dayCount, waited, throttled } */
const state = new Map();
let inflight = 0;
const inflightWaiters = [];

function loadDaily() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      return parsed;
    }
  } catch { /* fresh */ }
  return {};
}

function persistDaily() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = {};
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    for (const [provider, s] of state) {
      out[provider] = { day, dayCount: s.dayCount };
    }
    fs.writeFileSync(STATS_FILE, JSON.stringify(out, null, 2), 'utf-8');
  } catch { /* memory must never break the pipeline */ }
}

function s(provider) {
  if (!state.has(provider)) {
    const daily = loadDaily();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const prior = daily[provider];
    state.set(provider, {
      lastCallAt: 0,
      windowStart: 0,
      windowCount: 0,
      day: today,
      dayCount: (prior && prior.day === today) ? Number(prior.dayCount) || 0 : 0,
      waited: 0,
      throttled: 0,
    });
  }
  return state.get(provider);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait for a global in-flight slot (bounded). Returns true when acquired. */
async function takeInflight(deadline, maxInflight) {
  if (inflight < maxInflight) {
    inflight += 1;
    return true;
  }
  return new Promise((resolve) => {
    const waiter = () => {
      if (Date.now() > deadline) { resolve(false); return; }
      if (inflight < maxInflight) {
        inflight += 1;
        resolve(true);
      }
    };
    inflightWaiters.push(waiter);
  });
}

function releaseInflight() {
  inflight = Math.max(0, inflight - 1);
  const next = inflightWaiters.shift();
  if (next) next();
}

/**
 * Acquire a rate slot for `provider`. Resolves { ok: true } when the call may
 * proceed, or { ok: false, reason: 'throttled', waitedMs } when the slot could
 * not be acquired within the wait budget (caller should try another provider).
 */
export async function takeSlot(provider) {
  const { intervalMs, maxPerMinute, dailyCap, maxWaitMs, maxInflight } = cfg();
  const key = String(provider || 'unknown');
  const st = s(key);
  const now = Date.now();
  const deadline = now + maxWaitMs;

  // Daily budget (persisted across restarts).
  const today = new Date().toISOString().slice(0, 10);
  if (st.day !== today) {
    st.day = today;
    st.dayCount = 0;
  }
  if (dailyCap > 0 && st.dayCount >= dailyCap) {
    return { ok: false, reason: 'daily-budget', provider: key, cap: dailyCap };
  }

  // Per-minute rolling window.
  if (now - st.windowStart > 60000) {
    st.windowStart = now;
    st.windowCount = 0;
  }
  if (st.windowCount >= maxPerMinute) {
    // If the window cannot roll before the wait budget is gone, throttle
    // immediately (deterministic — no borderline timing race).
    const nowMs = Date.now();
    const untilRoll = st.windowStart + 60000 - nowMs;
    const budget = deadline - nowMs;
    if (untilRoll > budget) {
      st.throttled += 1;
      return { ok: false, reason: 'throttled', provider: key, waitedMs: Math.max(0, deadline - nowMs) };
    }
    await sleep(untilRoll);
    st.windowStart = Date.now();
    st.windowCount = 0;
  }

  // Min interval between calls to the same provider.
  const sinceLast = now - st.lastCallAt;
  if (sinceLast < intervalMs) {
    const waitMs = Math.min(intervalMs - sinceLast, deadline - now);
    if (waitMs > 0) { await sleep(waitMs); st.waited += waitMs; }
    if (Date.now() >= deadline) { st.throttled += 1; return { ok: false, reason: 'throttled', provider: key, waitedMs: maxWaitMs }; }
  }

  // Global in-flight cap.
  const got = await takeInflight(deadline, maxInflight);
  if (!got) { st.throttled += 1; return { ok: false, reason: 'throttled', provider: key, waitedMs: maxWaitMs }; }

  // Slot acquired — book it.
  st.lastCallAt = Date.now();
  st.windowCount += 1;
  st.dayCount += 1;
  persistDaily();
  return { ok: true, provider: key };
}

/** Release the global in-flight slot after a call (success OR failure). */
export function releaseSlot() {
  releaseInflight();
}

/** Live status for /api/rate/status and the Settings panel. */
export function rateLimiterStatus() {
  const out = {};
  for (const [provider, st] of state) {
    out[provider] = {
      lastCallAgoMs: st.lastCallAt ? Date.now() - st.lastCallAt : null,
      windowCount: st.windowCount,
      windowCap: cfg().maxPerMinute,
      dayCount: st.dayCount,
      dayCap: cfg().dailyCap || null,
      waitedMs: st.waited,
      throttledCount: st.throttled,
    };
  }
  const { intervalMs, maxPerMinute, dailyCap, maxInflight, maxWaitMs } = cfg();
  return {
    config: { intervalMs, maxPerMinute, dailyCap: dailyCap || null, maxInflight, maxWaitMs },
    inflight,
    providers: out,
  };
}

/** Reset (tests / admin). */
export function resetRateLimiter() {
  state.clear();
  inflight = 0;
  inflightWaiters.length = 0;
}
