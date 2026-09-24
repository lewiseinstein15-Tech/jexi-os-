/**
 * B141 — THEME (DeepSeek Harness `packages/client/ui-theme` mirror,
 * JEXI-branded).
 *
 * Tiny theme module: reads/writes a persisted theme key ('dark'|'light'),
 * applies it to <html data-theme>, and notifies subscribers.
 */

const KEY = 'jexi_theme';

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; }
}

export function setTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, t); } catch { /* noop */ }
  applyTheme(t);
  return t;
}

export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  try {
    document.documentElement.setAttribute('data-theme', t);
  } catch { /* noop */ }
  return t;
}

export function initTheme() {
  return applyTheme(getTheme());
}
