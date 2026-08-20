/**
 * pushSubscribe — register the app for Web Push (B84).
 *
 * Called once after the app boots (main.jsx). Registers the service worker,
 * requests notification permission (browser prompts), subscribes via the
 * Push API with the backend's VAPID public key, and stores the subscription
 * server-side. From then on, notifications arrive even when the app is
 * closed. Fully best-effort: any failure (unsupported browser, HTTP-only,
 * permission denied) silently skips push — local notifications still work.
 */

import { getBackendUrl, jexiFetch } from './helpers';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function setupPushSubscription() {
  try {
    if (typeof window === 'undefined') return false;
    // B153 — native APK: FCM handles push; a service worker on the local
    // origin adds stale-cache risk with zero benefit.
    if (typeof window !== 'undefined' && window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return false;

    const base = getBackendUrl();
    const swUrl = `${window.location.origin}${import.meta.env.BASE_URL || '/'}sw.js`;

    const reg = await navigator.serviceWorker.register(swUrl);
    await navigator.serviceWorker.ready;

    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') return false;
    }

    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // Keep the server in sync even across re-deploys (cheap upsert).
      try {
        const res = await jexiFetch(`${base}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: existing.endpoint,
            keys: { p256dh: btoa(String.fromCharCode(...new Uint8Array(existing.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(existing.getKey('auth')))) },
            ua: navigator.userAgent,
          }),
        });
        if (res && !res.ok) throw new Error(`subscribe HTTP ${res.status}`);
      } catch (e) { /* server offline — will resubscribe later */ }
      return true;
    }

    const keyRes = await jexiFetch(`${base}/api/push/vapid-key`);
    if (!keyRes.ok) return false;
    const { publicKey } = await keyRes.json();
    if (!publicKey) return false;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const body = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))),
      },
      ua: navigator.userAgent,
    };
    const res = await jexiFetch(`${base}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res || !res.ok) return false;
    return true;
  } catch (e) {
    return false; // never break the app over push
  }
}
