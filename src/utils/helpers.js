export const getDomain = (url) => {
  try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; }
};
export const getFavicon = (url) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; } catch (e) { return ''; }
};
export const delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * JEXI access key (optional). If the backend was locked with JEXI_API_KEY
 * (recommended on Render), every /api call must carry it as `x-jexi-key`.
 * Stored in localStorage, never sent anywhere except your own backend.
 */
export const getAccessKey = () => localStorage.getItem('jexi_access_key') || '';
export const setAccessKey = (key) => {
  if (key) localStorage.setItem('jexi_access_key', key);
  else localStorage.removeItem('jexi_access_key');
  window.dispatchEvent(new CustomEvent('jexi:access-key', { detail: key || '' }));
};
export const onAccessKeyChange = (cb) => {
  const h = (e) => cb(e.detail || '');
  window.addEventListener('jexi:access-key', h);
  return () => window.removeEventListener('jexi:access-key', h);
};

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

/** fetch() wrapper that attaches the JEXI access key + session headers. */
export const jexiFetch = (url, opts = {}) => {
  const key = getAccessKey();
  const headers = new Headers(opts.headers || {});
  if (key) headers.set('x-jexi-key', key);
  if (!headers.has('x-jexi-session')) headers.set('x-jexi-session', getSessionId());
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
 * Distinguishes the three real failure modes so "the app can't reach the
 * backend" isn't a mystery:
 *  - HTTP 401  → the server is locked (JEXI_API_KEY) and this browser doesn't
 *                have the access key set in Settings → System.
 *  - fetch-level failure → the browser blocked the call (CORS allowlist on
 *    Render) or the backend is unreachable/wrong URL.
 *  - anything else → generic honest message.
 */
export const backendErrorMessage = (error, backendUrl = '') => {
  const m = String((error && error.message) || error || '');
  const statusMatch = m.match(/HTTP (\d{3})/);
  const status = (error && error.status) ? Number(error.status) : (statusMatch ? Number(statusMatch[1]) : 0);
  if (status === 401) {
    return '🔒 The backend is locked. Open Settings → System and paste your JEXI access key (the exact value of JEXI_API_KEY set on Render), then try again.';
  }
  // A fetch that never got a response (no status) fails with TypeError
  // 'Failed to fetch' / 'fetch failed' / 'NetworkError' — that's the
  // browser-level CORS block or an unreachable host. Anything else is a real
  // server response or an unexpected error, handled generically below.
  const looksBlocked = /fetch failed|failed to fetch|networkerror|network error|load failed/i.test(m);
  if (looksBlocked) {
    const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
    return `⚠️ The backend refused this browser's request (CORS) or is unreachable.\n\nFix (Render dashboard → jexi-os-brain → Environment):\n1. Add ${origin || 'your frontend origin'} to CORS_ORIGINS (for GitHub Pages: https://lewiseinstein15-tech.github.io), or clear CORS_ORIGINS to allow all browsers.\n2. Confirm the backend URL in Settings → Server is ${backendUrl || 'https://jexi-os-brain.onrender.com'}.\n3. If the server is locked, also set the access key in Settings → System.`;
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
