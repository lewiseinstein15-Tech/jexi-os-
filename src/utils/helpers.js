export const getDomain = (url) => {
  try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; }
};
export const getFavicon = (url) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; } catch (e) { return ''; }
};
export const delay = (ms) => new Promise(r => setTimeout(r, ms));



/**
 * Stable per-browser session id (Build 48, P5). The backend keys its
 * per-conversation state (pending runs, persisted results) by the
 * `x-jexi-session` header; without it every client from the same IP shares
 * one conversation and dropped-stream recovery would mix sessions.
 */
export const setSessionId = (id) => {
  if (id) localStorage.setItem('jexi_session_id', id);
  else localStorage.removeItem('jexi_session_id');
};

export const getSessionId = () => {
  let id = localStorage.getItem('jexi_session_id');
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('jexi_session_id', id);
  }
  return id;
};

/** fetch() wrapper that attaches session + timezone headers (backend is open, no key). */
export const jexiFetch = (url, opts = {}) => {
  const headers = new Headers(opts.headers || {});
  if (!headers.has('x-jexi-session')) headers.set('x-jexi-session', getSessionId());
  // B104 — the user's real timezone rides every request so JEXI always
  // knows the local date/time (dsh time-context).
  if (!headers.has('x-jexi-tz')) {
    try {
      const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
      headers.set('x-jexi-tz', tz);
    } catch (e) { headers.set('x-jexi-tz', 'UTC'); }
  }
  return fetch(url, { ...opts, headers });
};

/**
 * Backend base URL, resolved in this order:
 *  1. localStorage override (settable in Settings / the Virtual Desktop tab)
 *  2. VITE_JEXI_BACKEND_URL (build-time env on Vercel/Render static)
 *  3. '' → same origin (Vite dev proxy or a reverse proxy)
 */
export const getBackendUrl = () =>
  localStorage.getItem('jexi_backend_url') || import.meta.env.VITE_JEXI_BACKEND_URL || '';

export const BACKEND_URL_EVENT = 'jexi:backend-url';

/**
 * Turn a failed backend call into an actionable, user-facing message.
 * Distinguishes the real failure modes so "the app can't reach the
 * backend" isn't a mystery:
 *  - HTTP 429 → rate-limited: too many requests at once, wait a minute.
 *  - fetch-level failure → the browser blocked the call (CORS allowlist on
 *    Render) or the backend is unreachable/wrong URL.
 *  - anything else → generic honest message.
 */
export const backendErrorMessage = (error, backendUrl = '') => {
  const m = String((error && error.message) || error || '');
  const statusMatch = m.match(/HTTP (\d{3})/);
  const status = (error && error.status) ? Number(error.status) : (statusMatch ? Number(statusMatch[1]) : 0);
  if (status === 429) {
    return '⏳ JEXI is rate-limited right now (too many requests at once). Wait about a minute and try again — nothing is broken, she is just busy.';
  }
  // A fetch that never got a response (no status) fails with TypeError
  // 'Failed to fetch' / 'fetch failed' / 'NetworkError' — that's the
  // browser-level CORS block or an unreachable host. Anything else is a real
  // server response or an unexpected error, handled generically below.
  const looksBlocked = /fetch failed|failed to fetch|networkerror|network error|load failed/i.test(m);
  if (looksBlocked) {
    const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
    return `⚠️ The backend refused this browser's request (CORS) or is unreachable.\n\nFix (Render dashboard → jexi-brain-image → Environment):\n1. Add ${origin || 'your frontend origin'} to CORS_ORIGINS (for GitHub Pages: https://lewiseinstein15-tech.github.io), or clear CORS_ORIGINS to allow all browsers.\n2. Confirm the backend URL in Settings → Server is ${backendUrl || 'https://jexi-brain-image.onrender.com'}.`;
  }
  return `⚠ The connection to the backend dropped (${m || 'network error'}). The work may still be running on the server — wait a moment, then ask me to continue from where it stopped.`;
};

/** Set the backend URL at runtime and notify every listener (no reload needed). */
export const setBackendUrl = (url) => {
  const clean = (url || '').trim().replace(/\/$/, '');
  if (clean) localStorage.setItem('jexi_backend_url', clean);
  else localStorage.removeItem('jexi_backend_url');
  window.dispatchEvent(new CustomEvent(BACKEND_URL_EVENT, { detail: clean }));
  return clean;
};

/** Subscribe to backend URL changes; returns an unsubscribe function. */
export const onBackendUrlChange = (callback) => {
  const handler = (e) => callback(e.detail || '');
  window.addEventListener(BACKEND_URL_EVENT, handler);
  return () => window.removeEventListener(BACKEND_URL_EVENT, handler);
};
