import { useState, useEffect, useCallback, useRef } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import {
  ensurePhoneNotificationPermission, showPhoneNotification, isNativePlatform,
  notificationKey, isNotificationShown,
} from '../utils/phoneNotify';

/**
 * usePhoneNotifications — turns the backend's Notification Center into REAL
 * phone notifications (B83).
 *
 * Polls /api/notifications every POLL_MS while the app is visible; every
 * UNREAD notification that hasn't been shown on this device yet becomes a
 * phone notification (deduped by id in localStorage). Permission is
 * requested once on mount (Android 13+ system dialog).
 *
 * Also exposes notifyNow(title, body, key) for immediate firing from live
 * events (e.g. a goal just finished in the Goals screen).
 */
const POLL_MS = 20000;

export default function usePhoneNotifications() {
  const [permission, setPermission] = useState(null);
  const [lastShown, setLastShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    if (!isNativePlatform() && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // Native app requests via Capacitor; web requests lazily (avoid
      // interrupting first paint).
      return;
    }
    ensurePhoneNotificationPermission().then((ok) => setPermission(ok));
  }, []);

  const notifyNow = useCallback(async (title, body, key = '') => {
    const shown = await showPhoneNotification(title, body, key);
    if (shown) { shownRef.current += 1; setLastShown(shownRef.current); }
    return shown;
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/notifications?limit=15`);
        if (!res.ok) return;
        const data = await res.json();
        const items = data.notifications || [];
        for (const n of items) {
          if (!n || n.read) continue;
          const key = notificationKey(n);
          if (isNotificationShown(key)) continue;
          const shown = await showPhoneNotification(n.title || 'JEXI', n.body || '', key);
          if (shown) { shownRef.current += 1; setLastShown(shownRef.current); }
        }
      } catch {
        /* backend offline — try again next tick */
      }
    };
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return { permission, notifyNow, shownCount: lastShown };
}
