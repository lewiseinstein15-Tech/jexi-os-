import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { getBackendUrl } from './helpers';

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

  const res = await fetch(`${backend}/api/update/apk`, { cache: 'no-store' });
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
  const base64 = bytesToBase64(all);

  if (onProgress) onProgress(100);

  await Filesystem.writeFile({
    path: APK_FILENAME,
    data: base64,
    directory: Directory.Cache,
  });

  const { uri } = await Filesystem.getUri({ path: APK_FILENAME, directory: Directory.Cache });

  // Launches the Android package installer. First time, Android asks to allow
  // "install unknown apps" from JEXI OS — the system shows its own dialog.
  await FileOpener.open({
    filePath: uri,
    contentType: 'application/vnd.android.package-archive',
  });

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
