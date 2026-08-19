/**
 * B140 — CLIENT RUNTIME (DeepSeek Harness `packages/client/runtime` mirror,
 * JEXI-branded).
 *
 * Browser runtime services: connection status (health polling with state
 * machine), locale resolution (strings from /api/locale with {var}
 * substitution), and a projection store (cached conversation projection
 * snapshots keyed by state version).
 */

import { gatewayFetch } from './gatewayClient.js';

/** Connection state machine: unknown → connecting → online/offline. */
export class ConnectionStatus {
  constructor({ pollMs = 30000, healthUrl = null, onStatus = () => {} } = {}) {
    this.pollMs = pollMs;
    this.healthUrl = healthUrl;
    this.onStatus = onStatus;
    this.state = 'unknown';
    this.lastCheckedAt = null;
    this.timer = null;
  }

  async check() {
    this.state = 'connecting';
    this.onStatus(this.state);
    try {
      const res = await gatewayFetch(this.healthUrl || '/api/health', { timeoutMs: 8000, retries: 0 });
      this.state = res.ok && res.data && res.data.ok !== false ? 'online' : 'offline';
    } catch {
      this.state = 'offline';
    }
    this.lastCheckedAt = Date.now();
    this.onStatus(this.state, this.lastCheckedAt);
    return this.state;
  }

  start() {
    this.check();
    this.timer = setInterval(() => this.check(), this.pollMs);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this;
  }
}

/** Locale resolver backed by /api/locale (falls back to key). */
export class LocaleRuntime {
  constructor({ defaultTag = 'en', fetchStrings = true } = {}) {
    this.defaultTag = defaultTag;
    this.strings = {};
    this.loaded = false;
    if (fetchStrings) this.load().catch(() => {});
  }

  async load(tag = this.defaultTag) {
    try {
      const res = await gatewayFetch(`/api/locale?tag=${encodeURIComponent(tag)}`, { timeoutMs: 10000, retries: 1 });
      if (res.ok && res.data && res.data.strings) this.strings = res.data.strings;
    } catch { /* keep fallback */ }
    this.loaded = true;
    return this.strings;
  }

  /** Resolve one key with {var} substitution. */
  t(key, vars = null) {
    let text = this.strings[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) text = String(text).split(`{${k}}`).join(String(v));
    }
    return text;
  }
}

/** Projection store: cached conversation projections keyed by state version. */
export class ProjectionStore {
  constructor({ base = '/api/sessions', ttlMs = 15000 } = {}) {
    this.base = base;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  /** Fetch (or serve cached) projection for a conversation. */
  async get(convId, { maxChars = 12000, force = false } = {}) {
    const hit = this.cache.get(convId);
    if (!force && hit && Date.now() - hit.at < this.ttlMs) return { ...hit.projection, cached: true };
    try {
      const res = await gatewayFetch(`${this.base}/${encodeURIComponent(convId)}/projection?maxChars=${maxChars}`, { timeoutMs: 10000, retries: 1 });
      if (!res.ok || !res.data || res.data.ok === false) return { ok: false, error: (res.data && res.data.error) || `projection ${res.status}` };
      this.cache.set(convId, { at: Date.now(), projection: res.data });
      return { ...res.data, cached: false };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'projection fetch failed' };
    }
  }

  /** Drop the cache for one conversation (call after appends). */
  invalidate(convId) {
    this.cache.delete(convId);
  }

  clear() { this.cache.clear(); }
}
