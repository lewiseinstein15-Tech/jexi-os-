/**
 * B139 — CLIENT CONNECTION (DeepSeek Harness `packages/client/connection`
 * mirror, JEXI-branded).
 *
 * Browser↔server RPC bridge facts: the /api trust fence (only loopback +
 * declared trusted hosts may serve the API), request-body size caps with a
 * headroom check for image payloads, and an event-downlink helper over the
 * existing /api/events SSE surface (dsh websocket-downlink analog, SSE
 * instead of WebSocket for the free tier).
 *
 *   checkTrustedHost(host, trustedHosts)  → { ok, reason? }
 *   resolveBodyCap(maxBytes, imageBytes)  → capped request body budget
 *   buildEventDownlink(baseUrl, handlers) → SSE consumer with reconnect
 */

/** Whether a Host header is loopback. */
export function isLoopbackHost(host) {
  const h = String(host || '');
  return /^(127\.|localhost|\[::1\]|::1)/i.test(h);
}

/** Canonical authority check: exact host:port, or port-less host. */
export function isTrustedAuthority(host, trustedHosts = []) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  for (const entry of trustedHosts) {
    const e = String(entry || '').toLowerCase();
    if (h === e) return true;
    if (e.indexOf(':') === -1 && h.startsWith(`${e}:`)) return true;
  }
  return false;
}

/**
 * The /api trust fence: refuse requests whose Host is neither loopback nor a
 * declared trusted host (a 0.0.0.0 deployment must declare its names).
 */
export function checkTrustedHost(host, trustedHosts = []) {
  if (isLoopbackHost(host)) return { ok: true, loopback: true };
  if (isTrustedAuthority(host, trustedHosts)) return { ok: true, loopback: false, trusted: true };
  return { ok: false, reason: `Host "${host}" is not loopback nor a declared trusted host — refusing the API request.` };
}

/**
 * Resolve the request-body budget: at least the declared cap, and large
 * enough for base64 image payloads when an image limit is configured
 * (dsh image-body capacity check).
 */
export function resolveBodyCap({ maxBytes = 30 * 1024 * 1024, imageBytes = null } = {}) {
  const headroom = 1024 * 1024;
  if (imageBytes) {
    const required = Math.ceil(imageBytes * 4 / 3) + headroom;
    if (maxBytes < required) {
      return { ok: false, error: `maxRequestBodyBytes (${maxBytes}) must be at least ${required} for the configured image limit (${imageBytes})` };
    }
  }
  return { ok: true, maxBytes };
}

/**
 * SSE event downlink with auto-reconnect (dsh websocket-downlink analog).
 * @param {object} o { url, onEvent, onStatus?, reconnectMs?, maxRetries? }
 * @returns {{ close(): void, state: () => string }}
 */
export function buildEventDownlink({ url, onEvent, onStatus = () => {}, reconnectMs = 5000, maxRetries = Infinity }) {
  let closed = false;
  let retries = 0;
  let state = 'idle';
  let es = null;
  let timer = null;

  const setState = (s) => { state = s; try { onStatus(s, retries); } catch { /* noop */ } };

  const connect = () => {
    if (closed) return;
    setState('connecting');
    try {
      es = new EventSource(url);
    } catch {
      scheduleReconnect();
      return;
    }
    es.onopen = () => { retries = 0; setState('open'); };
    es.onmessage = (ev) => {
      try { onEvent(JSON.parse(ev.data || '{}')); } catch { try { onEvent({ type: 'raw', data: ev.data }); } catch { /* noop */ } }
    };
    es.onerror = () => {
      try { es.close(); } catch { /* noop */ }
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    retries += 1;
    if (retries > maxRetries) { setState('closed'); return; }
    setState('reconnecting');
    timer = setTimeout(connect, reconnectMs * Math.min(retries, 5));
  };

  const close = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (es) { try { es.close(); } catch { /* noop */ } }
    setState('closed');
  };

  return { close, state: () => state };
}
