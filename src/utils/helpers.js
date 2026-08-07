export const getDomain = (url) => {
  try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; }
};
export const getFavicon = (url) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; } catch (e) { return ''; }
};
export const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
