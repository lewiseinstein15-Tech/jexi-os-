/**
 * B139 — CLIENT HMR (DeepSeek Harness `packages/client/hmr` mirror,
 * JEXI-branded).
 *
 * Hot module reload events: config/settings/persona/preset changes are
 * published as `hmr/update` events on the SSE downlink (debounced), so the
 * frontend can refresh its settings view without a full reload. The server
 * keeps a tiny event ring (last N events) for late subscribers.
 */

const ring = []; // { at, type, key }
const MAX_RING = 50;

let broadcast = null; // (event) => void — set by index.js to the SSE broadcaster

/** Record an HMR event and broadcast it (debounced by the caller). */
export function publishHmrEvent(type, key, detail = null) {
  const ev = { at: Date.now(), type: String(type || 'update').slice(0, 40), key: String(key || '').slice(0, 80), ...(detail !== null ? { detail } : {}) };
  ring.push(ev);
  if (ring.length > MAX_RING) ring.shift();
  try {
    if (typeof broadcast === 'function') broadcast({ ...ev, type: 'hmr' });
  } catch { /* noop */ }
  return ev;
}

/** Set the SSE broadcaster (wired in index.js). */
export function setHmrBroadcaster(fn) {
  broadcast = fn;
}

/** Recent HMR events for late subscribers. */
export function recentHmrEvents(limit = 20) {
  return ring.slice(-Math.max(1, Math.min(Number(limit) || 20, MAX_RING)));
}

/** HMR status for /api/hmr. */
export function hmrStatus() {
  return { ok: true, events: recentHmrEvents(20), count: ring.length, connected: typeof broadcast === 'function' };
}
