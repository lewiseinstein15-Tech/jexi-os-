/**
 * JEXI OS — PROVIDER HEALTH MANAGER (AGI Phase 1, increment 1).
 *
 * The structured, persistent, queryable record of every model provider's
 * health — the layer the existing ProviderRouter (in-memory, proven, B220)
 * has never had:
 *
 *   - a real state vocabulary: healthy | degraded | rate_limited |
 *     unavailable | auth_error | disabled
 *   - an error taxonomy (spec §10): what KIND of failure was it? A 429 is
 *     not an auth error is not a context overflow. Different kinds demand
 *     different responses.
 *   - persistence across restarts (a provider that was rate-limited before
 *     the crash is still cooling when the process comes back)
 *   - sticky auth errors (a bad key must NOT be retried forever)
 *   - a snapshot() for the API-limit dashboard (spec §44)
 *
 * Routing decisions stay with ProviderRouter (fast, proven). This module is
 * the book the router writes into and the dashboard reads from — plus one
 * routing input ProviderRouter lacks: auth_error/disabled providers are
 * skipped outright by `skipForNow()`.
 */

import fs from 'node:fs';
import path from 'node:path';

const HEALTH_FILE = () => path.join(process.env.DATA_DIR || './data', 'provider-health.json');

export const PROVIDER_STATES = ['healthy', 'degraded', 'rate_limited', 'unavailable', 'auth_error', 'disabled'];

/* ── error taxonomy (spec §10) ──────────────────────────────────────────
 * Every provider error maps to exactly one kind; each kind knows whether
 * retrying the SAME provider can help and how long to cool down when it
 * happens. */
const TAXONOMY = [
  { kind: 'RATE_LIMITED', re: /429|rate.?limit|too many requests|resource_exhausted/i, retryable: true, cooldownMs: 30_000, state: 'rate_limited' },
  { kind: 'QUOTA_EXHAUSTED', re: /daily (limit|quota)|monthly (limit|quota)|quota exceeded|quota_exceeded|billing|payment required|402/i, retryable: false, cooldownMs: 6 * 3600_000, state: 'rate_limited' },
  { kind: 'AUTH_ERROR', re: /401|403|unauthorized|forbidden|invalid api key|invalid_api_key|api key not valid|authentication/i, retryable: false, cooldownMs: 3600_000, state: 'auth_error' },
  { kind: 'CONTEXT_TOO_LARGE', re: /context (length|window)|too many tokens|payload too large|413|request too large/i, retryable: false, cooldownMs: 0, state: 'healthy' },
  { kind: 'MODEL_NOT_FOUND', re: /model (not found|not_found|does not exist|decommissioned)|no such model|404/i, retryable: false, cooldownMs: 60_000, state: 'degraded' },
  { kind: 'TIMEOUT', re: /timed? ?out|ETIMEDOUT|deadline/i, retryable: true, cooldownMs: 15_000, state: 'degraded' },
  { kind: 'OVERLOAD', re: /overloaded|capacity|503|service unavailable/i, retryable: true, cooldownMs: 45_000, state: 'degraded' },
  { kind: 'SERVER_ERROR', re: /5\d\d|internal server error|bad gateway|upstream/i, retryable: true, cooldownMs: 20_000, state: 'degraded' },
  { kind: 'NETWORK', re: /ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network|EAI_AGAIN/i, retryable: true, cooldownMs: 20_000, state: 'degraded' },
];

/** Classify a provider error message / status into the taxonomy. Pure. */
export function classifyProviderError(input) {
  const text = String((input && (input.message || input.error || input)) || input || '');
  for (const t of TAXONOMY) if (t.re.test(text)) return { kind: t.kind, retryable: t.retryable, cooldownMs: t.cooldownMs, state: t.state };
  return { kind: 'UNKNOWN', retryable: true, cooldownMs: 10_000, state: 'degraded' };
}

/* ── the manager ─────────────────────────────────────────────────────── */

const state = new Map(); // provider → record
let loaded = false;

function blank(provider) {
  return {
    provider,
    requests: 0, successes: 0, failures: 0, rateLimited: 0, timeouts: 0,
    consecutiveFails: 0,
    successRateEwma: null, latencyEwmaMs: null,
    lastSuccessAt: null, lastFailureAt: null,
    lastErrorKind: null, lastError: null,
    cooldownUntil: 0, cooldownReason: null,
    disabled: false,
  };
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(HEALTH_FILE(), 'utf8'));
    for (const rec of Array.isArray(raw) ? raw : []) {
      if (rec && rec.provider) state.set(rec.provider, { ...blank(rec.provider), ...rec });
    }
  } catch { /* fresh start is fine */ }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(HEALTH_FILE()), { recursive: true });
    const tmp = HEALTH_FILE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...state.values()], null, 2));
    fs.renameSync(tmp, HEALTH_FILE());
  } catch { /* disk issues must never fail a model call */ }
}

function rec(provider) {
  load();
  if (!state.has(provider)) state.set(provider, blank(provider));
  return state.get(provider);
}

/** Record a successful call. */
export function recordProviderCallSuccess(provider, { latencyMs = null, at = Date.now() } = {}) {
  const r = rec(provider);
  r.requests += 1; r.successes += 1; r.consecutiveFails = 0;
  r.lastSuccessAt = new Date(at).toISOString();
  if (Number.isFinite(latencyMs) && latencyMs > 0) {
    r.latencyEwmaMs = r.latencyEwmaMs == null ? Math.round(latencyMs) : Math.round(r.latencyEwmaMs * 0.6 + latencyMs * 0.4);
  }
  const ok = r.successRateEwma == null ? 1 : r.successRateEwma * 0.7 + 1 * 0.3;
  r.successRateEwma = Math.round(ok * 1000) / 1000;
  if (!r.disabled) { r.cooldownUntil = 0; r.cooldownReason = null; }
  persist();
}

/** Record a failed call (classification happens here). */
export function recordProviderCallFailure(provider, error, { at = Date.now(), cooldownMs: overrideMs = null } = {}) {
  const r = rec(provider);
  const c = classifyProviderError(error);
  r.requests += 1; r.failures += 1; r.consecutiveFails += 1;
  r.lastFailureAt = new Date(at).toISOString();
  r.lastErrorKind = c.kind;
  r.lastError = String((error && error.message) || error || '').slice(0, 200);
  if (c.kind === 'RATE_LIMITED' || c.kind === 'QUOTA_EXHAUSTED') r.rateLimited += 1;
  if (c.kind === 'TIMEOUT') r.timeouts += 1;
  const bad = r.successRateEwma == null ? 0 : r.successRateEwma * 0.7 + 0 * 0.3;
  r.successRateEwma = Math.round(bad * 1000) / 1000;

  // cooldowns: explicit override (e.g. a parsed Retry-After) wins, else the
  // taxonomy's default scaled by consecutive failures (capped).
  const scaled = Math.min(c.cooldownMs * Math.min(r.consecutiveFails, 3), 10 * 60_000);
  const ms = overrideMs != null ? overrideMs : scaled;
  if (ms > 0 && !r.disabled) {
    r.cooldownUntil = at + ms;
    r.cooldownReason = c.kind;
  }
  persist();
  return c;
}

/** Explicitly disable/enable a provider (admin action). */
export function setProviderDisabled(provider, disabled) {
  rec(provider).disabled = Boolean(disabled);
  persist();
}

/** Is this provider in a state the walker should skip right now? */
export function skipForNow(provider, now = Date.now()) {
  load();
  const r = state.get(provider);
  if (!r) return false;
  if (r.disabled) return true;
  if (r.cooldownUntil && now < r.cooldownUntil) return true;
  // sticky: auth errors never clear on their own
  if (r.lastErrorKind === 'AUTH_ERROR' && r.consecutiveFails > 0) return true;
  return false;
}

/** Derived state for one provider (spec §12 vocabulary). */
export function providerState(provider, now = Date.now()) {
  load();
  const r = state.get(provider);
  if (!r) return { provider, state: 'healthy', note: 'no data yet' };
  if (r.disabled) return { provider, state: 'disabled', note: 'disabled by admin' };
  if (r.lastErrorKind === 'AUTH_ERROR' && r.consecutiveFails > 0) return { provider, state: 'auth_error', note: r.lastError };
  if (r.cooldownUntil && now < r.cooldownUntil) {
    return { provider, state: (r.cooldownReason === 'RATE_LIMITED' || r.cooldownReason === 'QUOTA_EXHAUSTED') ? 'rate_limited' : 'unavailable', note: `cooling until ${new Date(r.cooldownUntil).toISOString()} (${r.cooldownReason})` };
  }
  if (r.consecutiveFails >= 3) return { provider, state: 'unavailable', note: `${r.consecutiveFails} consecutive failures` };
  if (r.consecutiveFails > 0) return { provider, state: 'degraded', note: `${r.consecutiveFails} recent failure(s)` };
  if (r.requests >= 3 && r.successRateEwma != null && r.successRateEwma < 0.8) return { provider, state: 'degraded', note: `success rate ${r.successRateEwma} over ${r.requests} calls` };
  return { provider, state: 'healthy', note: `success rate ${r.successRateEwma ?? 'n/a'}` };
}

/** Full snapshot for the API-limit dashboard. No secrets. */
export function providerHealthSnapshot(now = Date.now()) {
  load();
  return [...state.values()].map((r) => ({
    ...r,
    ...providerState(r.provider, now),
    cooldownRemainingMs: r.cooldownUntil ? Math.max(0, r.cooldownUntil - now) : 0,
  }));
}

/** Test seam: reset everything. */
export function __resetProviderHealth() {
  state.clear();
  loaded = false;
}
