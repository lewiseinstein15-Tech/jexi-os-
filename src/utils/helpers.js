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

/** fetch() wrapper that attaches the JEXI access key header when one is set. */
export const jexiFetch = (url, opts = {}) => {
  const key = getAccessKey();
  const headers = new Headers(opts.headers || {});
  if (key) headers.set('x-jexi-key', key);
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
