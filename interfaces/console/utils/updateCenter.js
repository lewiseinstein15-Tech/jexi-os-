/**
 * B179 — UPDATE CENTER (the whole update system, rebuilt simple).
 *
 * The old system (useUpdateChecker + useApkInstaller + updateInstaller +
 * UpdateBanner, 415 lines across 4 files) misbehaved on update. This is the
 * replacement — small, stateless where possible, and UNABLE to break chat:
 *
 *   checkForUpdate()   → { available, tag, url, notes } | null (silent fail)
 *   downloadAndInstall(onProgress) → installs via the Android package
 *                        installer (zip-magic validated); on ANY failure
 *                        returns { fallbackUrl } so the UI can offer the
 *                        browser download instead — never a dead end.
 *
 * Why it can't break the app anymore:
 *  - No state hooks, no intervals in App — the banner checks once on boot
 *    and only when the user taps "check again".
 *  - Every failure path ends in the direct GitHub release link (works in
 *    any browser, forever).
 *  - The chat never waits on it: the check is fire-and-forget.
 */

import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { getBackendUrl, jexiFetch } from './helpers';

const REPO = 'lewiseinstein15-Tech/jexi-os-';
/** Direct permanent link — always the newest APK, no login. */
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/app-debug.apk`;
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGES_BASE = 'https://lewiseinstein15-Tech.github.io/jexi-os-';

/** The installed build (baked at CI time), e.g. 'apk-build-216'. '' = web. */
export const INSTALLED_TAG = (import.meta.env.VITE_APP_VERSION || '').trim();

const buildNumber = (tag) => {
  const m = String(tag || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

/** Latest release info from GitHub (backend proxy fallback). Silent fail. */
export async function checkForUpdate() {
  if (!INSTALLED_TAG) return null; // web build — always current, never nag
  let tag = '';
  try {
    const r = await fetch(`${RELEASE_API}?t=${Date.now()}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.ok) tag = String((await r.json()).tag_name || '');
  } catch { /* offline / rate-limited — try the backend probe */ }
  if (!tag) {
    try {
      const r = await jexiFetch(`${getBackendUrl()}/api/update/version`, { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        tag = String(d.tag || d.tag_name || '');
      }
    } catch { /* both lanes failed — no banner, chat unaffected */ }
  }
  if (!tag) return null;
  const mine = buildNumber(INSTALLED_TAG);
  const latest = buildNumber(tag);
  if (!latest || latest <= mine) return null;
  return { available: true, tag, url: APK_URL, notes: `build #${latest} is available — you have #${mine}.` };
}

/** True only inside the native Android app. */
export const isNativeAndroid = () =>
  typeof window !== 'undefined'
  && !!window.Capacitor
  && typeof window.Capacitor.isNativePlatform === 'function'
  && window.Capacitor.isNativePlatform()
  && window.Capacitor.getPlatform() === 'android';

const bytesToBase64 = (bytes) => {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/**
 * Download the newest APK through the backend proxy (follows redirects,
 * avoids WebView CORS) and hand it to the Android installer.
 * Progress: 0–99 download %, 100 = opening installer.
 * Returns { ok:true } | { ok:false, fallbackUrl, error }.
 */
export async function downloadAndInstall(onProgress = () => {}) {
  if (!isNativeAndroid()) return { ok: false, error: 'Updates install on the Android app.', fallbackUrl: APK_URL };
  let chunks = [];
  let received = 0;
  try {
    const res = await jexiFetch(`${getBackendUrl()}/api/update/apk`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)));
    }
    const size = chunks.reduce((n, c) => n + c.byteLength, 0);
    const all = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    // must be a real APK (ZIP magic) — an error page would brick the install
    if (size < 4 || all[0] !== 0x50 || all[1] !== 0x4b || all[2] !== 0x03 || all[3] !== 0x04) {
      throw new Error('downloaded file is not a valid APK');
    }
    onProgress(100);
    try { await Filesystem.deleteFile({ path: 'jexi-update.apk', directory: Directory.Cache }); } catch { /* none yet */ }
    await Filesystem.writeFile({
      path: 'jexi-update.apk',
      directory: Directory.Cache,
      data: bytesToBase64(all),
    });
    const { uri } = await Filesystem.getUri({ path: 'jexi-update.apk', directory: Directory.Cache });
    await FileOpener.open({ filePath: uri, contentType: 'application/vnd.android.package-archive' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'update failed', fallbackUrl: APK_URL };
  }
}

/**
 * B179 — BRAIN DISCOVERY: where does the server live? Old APKs have an old
 * brain URL baked in; if it ever dies, the app asks the website (always
 * current) for brain.json and self-heals — updates can never strand an
 * installed app again.
 */
export async function discoverBrainUrl() {
  try {
    const res = await fetch(`${PAGES_BASE}/brain.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const cfg = await res.json();
    const url = String(cfg && cfg.brain || '').replace(/\/$/, '');
    if (!/^https?:\/\//.test(url)) return null;
    const ping = await fetch(`${url}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(9000) });
    return ping.ok ? url : null;
  } catch { return null; }
}

/** Set the brain URL (used by boot self-heal + Settings). */
export function setBrainUrl(url) {
  const clean = String(url || '').replace(/\/$/, '');
  if (clean) localStorage.setItem('jexi_backend_url', clean);
  else localStorage.removeItem('jexi_backend_url');
  window.dispatchEvent(new CustomEvent('jexi:backend-url', { detail: clean }));
}
