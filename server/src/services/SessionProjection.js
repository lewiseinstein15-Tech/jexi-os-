/**
 * B136 — SESSION PROJECTION (DeepSeek Harness `packages/session/session-projection`
 * + `session-projection-cache` mirror, JEXI-branded).
 *
 * Project a conversation log into a BOUNDED context view with a char budget:
 * newest events are retained verbatim, older events are dropped with an
 * explicit `dropped` count + marker so the model knows the view is a
 * projection, and the whole projection is cached (TTL + invalidate-on-append)
 * so hot chat paths never re-read the log.
 *
 *   projectSession(convId, { maxChars, roleFilter }) → {
 *     events, chars, dropped, stateVersion, note
 *   }
 *
 * The projection is what the model sees as "this conversation so far": a
 * budgeted, newest-first view with a stable state version (last seq), exactly
 * DSH's read-side projection contract.
 */

import { loadConversationEvents } from './SessionConversations.js';

const cache = new Map(); // convId → { at, version, projection }
const CACHE_TTL_MS = 10_000;
let lastInvalidated = 0;

/** Invalidate one conversation's cached projection (call on append). */
export function invalidateProjection(convId) {
  cache.delete(String(convId || ''));
  lastInvalidated = Date.now();
}

/**
 * Project one conversation into a bounded view.
 * @param {object} o { convId, maxChars = 12000, roleFilter = null }
 * @returns {{ok, convId, events, chars, dropped, stateVersion, note, cached?}}
 */
export function projectSession({ convId, maxChars = 12000, roleFilter = null } = {}) {
  const id = String(convId || '');
  if (!id) return { ok: false, error: 'convId required' };

  const events = loadConversationEvents(id, 2000);
  const stateVersion = events.length ? events[events.length - 1].seq : -1;

  // Cache hit: same state version + fresh.
  const hit = cache.get(id);
  if (hit && hit.version === stateVersion && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.projection, cached: true };
  }

  const visible = roleFilter ? events.filter((e) => roleFilter.includes(e.role)) : events;

  const out = [];
  let chars = 0;
  for (let i = visible.length - 1; i >= 0; i--) {
    const e = visible[i];
    const line = `${e.role === 'user' ? 'You' : 'JEXI'}: ${String(e.text || '').replace(/\s+/g, ' ').trim()}`;
    const cost = line.length + 2;
    if (chars + cost > maxChars && out.length > 0) break;
    out.unshift(line);
    chars += cost;
  }
  const dropped = Math.max(0, visible.length - out.length);
  const projection = {
    ok: true,
    convId: id,
    events: out,
    chars,
    dropped,
    stateVersion,
    note: dropped > 0
      ? `[Projected view: ${dropped} earlier ${dropped === 1 ? 'turn' : 'turns'} were dropped to fit the context budget (${chars}/${maxChars} chars).]`
      : `[Full conversation view: ${out.length} turns, ${chars} chars.]`,
  };
  cache.set(id, { at: Date.now(), version: stateVersion, projection });
  return projection;
}

/** Rendered prompt block for one conversation's projection. */
export function projectedConversationBlock(convId, { maxChars = 6000, roleFilter = ['user', 'jexi'] } = {}) {
  const p = projectSession({ convId, maxChars, roleFilter });
  if (!p.ok || p.events.length === 0) return '';
  return `\n\n[This conversation so far (${p.stateVersion >= 0 ? `state ${p.stateVersion}` : 'new'}):\n${p.events.join('\n')}\n${p.note}]`;
}

/** Cache stats for diagnostics. */
export function projectionCacheStats() {
  return { entries: cache.size, lastInvalidatedAt: lastInvalidated };
}
