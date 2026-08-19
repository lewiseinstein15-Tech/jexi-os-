/**
 * B143 — CLIENT MODULES (DeepSeek Harness `packages/client/runtime` client
 * folder + `client/modules` mirror, JEXI-branded).
 *
 * Browser runtime modules: slots, sessions, workspaces, conversation event
 * registry, time-zone resolution, and the ordered baseline helper — the
 * client-side counterparts of the server runtime services.
 */

import { gatewayFetch } from './gatewayClient.js';

/** Slot registry: named UI slots with disposers (dsh SlotRegistry). */
export class SlotRegistry {
  constructor() {
    this.slots = new Map();
  }

  /** Register one slot. Returns a disposer. Throws on duplicate id. */
  register(id, entry) {
    if (this.slots.has(id)) throw new Error(`slot "${id}" already registered`);
    this.slots.set(id, entry || {});
    return () => this.slots.delete(id);
  }

  get(id) { return this.slots.get(id); }
  list() { return [...this.slots.entries()].map(([id, entry]) => ({ id, ...entry })); }
  has(id) { return this.slots.has(id); }
  clear() { this.slots.clear(); }
}

/** Session runtime: list/create conversations through the gateway. */
export class SessionRuntime {
  constructor({ base = '/api/conversations', cacheMs = 10000 } = {}) {
    this.base = base;
    this.cacheMs = cacheMs;
    this.cache = { at: 0, data: null };
  }

  async list({ force = false } = {}) {
    if (!force && this.cache.data && Date.now() - this.cache.at < this.cacheMs) return this.cache.data;
    try {
      const res = await gatewayFetch(this.base, { timeoutMs: 10000, retries: 1 });
      if (res.ok) {
        this.cache = { at: Date.now(), data: res.data };
        return res.data;
      }
      return { ok: false, error: (res.data && res.data.error) || `sessions ${res.status}` };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'sessions fetch failed' };
    }
  }

  invalidate() { this.cache = { at: 0, data: null }; }
}

/** Workspace runtime: the workspace entity + containment check. */
export class WorkspaceRuntime {
  constructor({ base = '/api/workspace/entity' } = {}) {
    this.base = base;
    this.entity = null;
  }

  async refresh() {
    try {
      const res = await gatewayFetch(this.base, { timeoutMs: 10000, retries: 1 });
      if (res.ok) this.entity = res.data;
      return this.entity;
    } catch { return this.entity; }
  }

  /** Client-side containment mirror of pathInWorkspace. */
  pathInWorkspace(p, root) {
    const norm = (x) => String(x || '').replace(/\/+$/, '').replace(/^\/+/, '');
    const target = norm(p);
    const r = norm(root || (this.entity && this.entity.workspaceRoot));
    if (!target || !r) return false;
    if (target === r) return true;
    return target.startsWith(`${r}/`);
  }
}

/** Conversation event registry: typed handlers for streamed chat events. */
export class ConversationEventRegistry {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, data) {
    const s = this.handlers.get(type);
    if (s) for (const fn of s) { try { fn(data); } catch { /* a handler must never break the stream */ } }
  }

  /** Feed one NDJSON chat event (type-tagged). */
  feed(ev) {
    if (ev && typeof ev.type === 'string') this.emit(ev.type, ev);
    else this.emit('raw', ev);
  }
}

/** Time-zone resolution (dsh client time-zone): Intl-based, env-overridable. */
export function resolveTimeZone(override = null) {
  if (override && typeof override === 'string' && override.trim()) return override.trim().slice(0, 64);
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch { return 'UTC'; }
}

/** Ordered baseline: keep a stable ordered list, deduping by id (dsh ordered-baseline). */
export class OrderedBaseline {
  constructor({ max = 200 } = {}) {
    this.items = [];
    this.max = max;
  }

  /** Push an item to the end (dedupe by id). Returns the new index. */
  push(item) {
    const id = item && item.id !== undefined ? item.id : item;
    const existing = this.items.findIndex((x) => (x && x.id !== undefined ? x.id : x) === id);
    if (existing >= 0) this.items.splice(existing, 1);
    this.items.push(item);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    return this.items.length - 1;
  }

  remove(id) {
    const idx = this.items.findIndex((x) => (x && x.id !== undefined ? x.id : x) === id);
    if (idx < 0) return false;
    this.items.splice(idx, 1);
    return true;
  }

  list() { return [...this.items]; }
  clear() { this.items = []; }
}
