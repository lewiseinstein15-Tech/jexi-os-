/**
 * fcmSetup — Firebase Cloud Messaging for the installed APK (B86/B87).
 *
 * - On native (Capacitor) platforms only: request notification permission,
 *   get the device's FCM token, and register it with the backend
 *   (POST /api/push/fcm-token). From then on every notification is also
 *   delivered by FCM — even when the app is completely closed.
 * - RETRIES with backoff: registration used to run exactly once at boot, so
 *   a transient failure (Play Services warming up, network) meant the device
 *   never registered. Now it retries (5s / 10s / 25s / 60s) and again every
 *   time the app returns to the foreground — until it succeeds.
 * - DIAGNOSTICS: every failure is reported to the backend
 *   (POST /api/push/diag) so the owner can see exactly why from the server.
 * - Foreground messages → local notification (Android only shows system
 *   notifications in background/closed states).
 * - Fully best-effort; web push + local notifications still work regardless.
 */

import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getBackendUrl, jexiFetch } from './helpers';

export function isNativePlatform() {
  try {
    return Boolean(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

async function reportDiag(step, error = '', permission = '') {
  try {
    const base = getBackendUrl();
    if (!base) return;
    const res = await jexiFetch(`${base}/api/push/diag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step: String(step).slice(0, 60),
        error: String(error).slice(0, 300),
        platform: isNativePlatform() ? 'native' : 'web',
        permission: String(permission || '').slice(0, 40),
        ua: typeof navigator !== 'undefined' ? String(navigator.userAgent).slice(0, 120) : '',
      }),
    });
    if (res && !res.ok) throw new Error(`diag ${res.status}`);
  } catch { /* diag must never break anything */ }
}

/**
 * One registration attempt. Returns true on success; throws on transient
 * failures (so the retry loop can retry); returns false on permanent ones
 * (permission denied).
 */
export async function setupFcmOnce() {
  if (!isNativePlatform()) return false;

  // 1) Permission (Android 13+ shows a system dialog on first call).
  let perm;
  try {
    perm = await FirebaseMessaging.requestPermissions();
  } catch (e) {
    await reportDiag('permission-error', e.message);
    throw e;
  }
  const receive = perm && perm.receive;
  if (receive === 'denied') {
    await reportDiag('permission-denied', '', receive);
    return false; // permanent — user must enable in system settings
  }

  // 2) Foreground messages → local notification.
  try {
    await FirebaseMessaging.addListener('messageReceived', (event) => {
      const title = (event.notification && event.notification.title) || 'JEXI';
      const body = (event.notification && event.notification.body) || '';
      LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Date.now() / 1000) % 2147483647,
          title: String(title).slice(0, 100),
          body: String(body || '').slice(0, 200),
          channelId: 'jexi-tasks',
        }],
      }).catch(() => {});
    });
  } catch (e) { /* listener optional */ }

  // 3) Get + register the FCM token.
  let token;
  try {
    token = await FirebaseMessaging.getToken();
  } catch (e) {
    await reportDiag('get-token-error', e.message, receive);
    throw e;
  }
  if (!token) {
    await reportDiag('empty-token', '', receive);
    throw new Error('empty FCM token');
  }
  const base = getBackendUrl();
  if (!base) {
    await reportDiag('no-backend-url', '', receive);
    return false;
  }
  try {
    const res = await jexiFetch(`${base}/api/push/fcm-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ua: (navigator.userAgent || 'android').slice(0, 120) }),
    });
    if (!res || !res.ok) {
      let body = '';
      try { body = await res.text(); } catch { /* noop */ }
      throw new Error(`register HTTP ${res ? res.status : '?'} ${body.slice(0, 120)}`);
    }
  } catch (e) {
    await reportDiag('register-error', e.message, receive);
    throw e;
  }
  await reportDiag('registered', '', receive);
  return true;
}

let running = false;
let stopped = false;

/**
 * Registration loop: retry with backoff until success, and retry again
 * whenever the app returns to the foreground. Idempotent (safe to call
 * from multiple triggers).
 */
export async function setupFcm() {
  if (running) return false;
  running = true;
  try {
    const delays = [0, 5000, 10000, 25000, 60000, 120000];
    for (const d of delays) {
      if (stopped) return false;
      if (d) await new Promise((r) => setTimeout(r, d));
      try {
        const ok = await setupFcmOnce();
        if (ok) return true;
        if (stopped) return false;
        // permission denied → permanent; stop retrying
        return false;
      } catch {
        /* transient — retry after next delay */
      }
    }
    return false;
  } finally {
    running = false;
  }
}

/** Retry on foreground (visibilitychange to visible). */
export function armFcmForegroundRetry() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setupFcm().catch(() => {});
    }
  });
}
