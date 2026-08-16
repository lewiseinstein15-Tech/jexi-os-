/**
 * fcmSetup — Firebase Cloud Messaging for the installed APK (B86).
 *
 * - On native (Capacitor) platforms only: request notification permission,
 *   get the device's FCM token, and register it with the backend
 *   (POST /api/push/fcm-token). From then on, every notification is also
 *   delivered by FCM — even when the app is completely closed.
 * - Foreground messages: Android does not show system notifications while
 *   the app is in the foreground, so we listen for incoming messages and
 *   show a LOCAL notification instead (same channel as B83).
 * - Fully best-effort: any failure silently skips FCM; web push + local
 *   notifications still work.
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

export async function setupFcm() {
  try {
    if (!isNativePlatform()) return false;

    // 1) Permission (Android 13+ system dialog).
    const perm = await FirebaseMessaging.requestPermissions();
    if (!perm || perm.receive === 'denied') return false;

    // 2) Foreground messages → local notification (system UI only shows
    //    notifications in background/closed states).
    try {
      await FirebaseMessaging.addListener('messageReceived', (event) => {
        const title = (event.notification && event.notification.title) || 'JEXI';
        const body = (event.notification && event.notification.body) || '';
        const link = (event.data && event.data.link) || '';
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

    // 3) Register the device token with the backend.
    const token = await FirebaseMessaging.getToken();
    if (!token) return false;
    const base = getBackendUrl();
    try {
      await jexiFetch(`${base}/api/push/fcm-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ua: navigator.userAgent || 'android' }),
      });
    } catch (e) { /* server offline — retry next launch */ }
    return true;
  } catch (e) {
    return false;
  }
}
