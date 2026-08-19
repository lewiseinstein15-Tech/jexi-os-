import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { getBackendUrl, jexiFetch } from './helpers';

const APK_FILENAME = 'jexi-update.apk';

/** True only when running inside the native Android app (not the web site). */
export const isNativeAndroid = () =>
  typeof window !== 'undefined' &&
  !!window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === 'function' &&
  window.Capacitor.isNativePlatform() &&
  window.Capacitor.getPlatform() === 'android';

/** Convert a binary Uint8Array to a base64 string in safe chunks. */
const bytesToBase64 = (bytes) => {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/**
 * Download the newest APK into JEXI's own storage and open the Android
 * package installer directly — no browser download step, so the install
 * prompt appears automatically after the download finishes.
 *
 * Progress callback values:
 *   0–99  : download progress (%)
 *   100   : downloaded, writing to storage
 *   -1    : downloading (total size unknown — indeterminate)
 */
export async function installAndroidUpdate({ onProgress } = {}) {
  const backend = getBackendUrl();
  if (!backend) {
    throw new Error('JEXI Brain address is not configured. Open Settings → Server and set the backend URL, then try again.');
  }

  const res = await jexiFetch(`${backend}/api/update/apk`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) — the update server may still be warming up. Try again in a minute.`);
  }

  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (onProgress) onProgress(total > 0 ? Math.min(99, Math.round((received / total) * 100)) : -1);
  }

  // Concatenate all chunks into one buffer, then base64 for the Filesystem plugin.
  const size = chunks.reduce((n, c) => n + c.byteLength, 0);
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  // B152 — validate the download is a real APK (ZIP magic bytes). A proxy
  // error page or a GitHub hiccup can come back with HTTP 200 — writing that
  // as the APK breaks the install and leaves the user stuck.
  if (size < 4 || all[0] !== 0x50 || all[1] !== 0x4b || all[2] !== 0x03 || all[3] !== 0x04) {
    throw new Error('Downloaded file is not a valid APK (the update server may have returned an error page). Try again in a minute.');
  }

  const base64 = bytesToBase64(all);

  if (onProgress) onProgress(100);

  // Remove any previous update APK first — a stale file can fail the install.
  try {
    await Filesystem.deleteFile({ path: APK_FILENAME, directory: Directory.Cache });
  } catch (e) { /* nothing cached — fine */ }

  await Filesystem.writeFile({
    path: APK_FILENAME,
    data: base64,
    directory: Directory.Cache,
  });

  const { uri } = await Filesystem.getUri({ path: APK_FILENAME, directory: Directory.Cache });

  // Launches the Android package installer. First time, Android asks to allow
  // "install unknown apps" from JEXI OS — the system shows its own dialog.
  try {
  await FileOpener.open({
    filePath: uri,
    contentType: 'application/vnd.android.package-archive',
  });

  } catch (e) {
    throw new Error(`Could not open the installer (${(e && e.message) || 'unknown'}). First time only: Settings → Apps → JEXI OS → "Install unknown apps" → Allow, then tap UPDATE again.`);
  }

  return { uri };
}

/** Fallback for web / non-native: open the direct download link in the browser. */
export const openApkInBrowser = () => {
  window.open(
    'https://github.com/lewiseinstein15-Tech/jexi-os-/releases/latest/download/app-debug.apk',
    '_system',
    'noopener'
  );
};
