/**
 * phoneNotify — phone notifications for JEXI (B83).
 *
 * The JEXI app (Capacitor/Android) shows a REAL phone notification when a
 * task or goal finishes — even if the app is backgrounded, as long as the
 * JS runtime is alive (local notifications). Falls back to the browser
 * Notification API on the web.
 *
 * Flow:
 *   - ensurePhoneNotificationPermission()  — request POST_NOTIFICATIONS
 *     (Android 13+), create a high-importance channel once.
 *   - showPhoneNotification(title, body, key) — schedule a local notification
 *     with a stable `key`; `key` is remembered in localStorage so the same
 *     notification is never shown twice (polling + live events both call
 *     this, dedupe lives here).
 *   - isNativePlatform() — Capacitor native vs web.
 *
 * Pure helpers (notificationKey / isNotificationShown / markNotificationShown)
 * are exported for unit tests; they don't touch Capacitor.
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const SHOWN_KEY = 'jexi:shown-notifications';
const CHANNEL_ID = 'jexi-tasks';

export function isNativePlatform() {
  try {
    return Boolean(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

/* ---------------- pure dedupe helpers (unit-testable) ---------------- */

export function loadShownKeys(storage = localStorage) {
  try {
    const raw = storage.getItem(SHOWN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveShownKeys(keys, storage = localStorage) {
  try {
    storage.setItem(SHOWN_KEY, JSON.stringify(keys.slice(-200)));
  } catch {
    /* storage full/unavailable — notification still shows, dedupe resets */
  }
}

export function isNotificationShown(key, storage = localStorage) {
  if (!key) return false;
  return loadShownKeys(storage).includes(key);
}

export function markNotificationShown(key, storage = localStorage) {
  if (!key) return;
  const keys = loadShownKeys(storage);
  if (!keys.includes(key)) {
    keys.push(key);
    saveShownKeys(keys, storage);
  }
}

/** Stable key for a notification-center item. */
export function notificationKey(n) {
  return n && n.id ? `nc:${n.id}` : '';
}

/* ---------------- native + web notification firing ---------------- */

/** Request the notification permission (Android 13+ shows a system dialog). */
export async function ensurePhoneNotificationPermission() {
  try {
    if (!isNativePlatform()) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      return;
    }
    const perm = await LocalNotifications.requestPermissions();
    if (perm && perm.display === 'denied') return false;
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'JEXI tasks & goals',
        description: 'Task and goal completion notifications',
        importance: 5,
        visibility: 1,
      });
    } catch {
      /* channel may already exist — fine */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Show a phone notification. `key` dedupes (same key → shown once).
 * Returns true when a notification was actually scheduled/shown.
 */
export async function showPhoneNotification(title, body, key = '', storage = localStorage) {
  if (!title) return false;
  try {
    if (key && isNotificationShown(key, storage)) return false; // already shown
    if (isNativePlatform()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() / 1000) % 2147483647,
            title: String(title).slice(0, 100),
            body: String(body || '').slice(0, 200),
            channelId: CHANNEL_ID,
            smallIcon: 'ic_stat_jexi' === '' ? undefined : undefined, // app icon by default
            sound: undefined,
          },
        ],
      });
    } else {
      // Web fallback (PWA / browser)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(String(title).slice(0, 100), { body: String(body || '').slice(0, 200) });
      } else {
        return false;
      }
    }
    if (key) markNotificationShown(key, storage);
    return true;
  } catch {
    return false;
  }
}
