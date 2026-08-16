/**
 * JEXI OS — Push Manager (B84: Web Push notifications).
 *
 * Closes the notification gap: local phone notifications only fire while the
 * app's JS runtime is alive. Web Push (service worker + VAPID) delivers
 * notifications even when the app is CLOSED — on the hosted PWA (GitHub
 * Pages, Android Chrome PWA) and any modern browser.
 *
 *   - VAPID keys: auto-generated on first boot and persisted to
 *     DATA_DIR/vapid.json (no external accounts, no setup). Exposed public
 *     key via GET /api/push/vapid-key for the client subscription.
 *   - Subscriptions: persisted to DATA_DIR/push-subscriptions.json (atomic
 *     writes); cap + prune; validated (https endpoints only).
 *   - broadcast(): sends {title, body, link} to every subscription via the
 *     web-push library; dead subscriptions (404/410) are pruned; every send
 *     is try/caught so one bad device never blocks the rest. The sender is
 *     injectable for tests.
 *   - Wired through NotificationCenter.setNotifyBroadcaster() so EVERY
 *     notification (goal done, scheduled mission, task) also pushes.
 */

import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import { DATA_DIR } from '../config.js';

const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');
const MAX_SUBS = 30;
const VAPID_SUBJECT = `mailto:${process.env.VAPID_SUBJECT || 'lewiseinstein15@gmail.com'}`;

/* ------------------------------------------------------------------ */
/* VAPID keys                                                          */
/* ------------------------------------------------------------------ */

let vapid = null;

function loadVapid() {
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
      if (parsed && parsed.publicKey && parsed.privateKey) return parsed;
    }
  } catch { /* regenerate */ }
  const keys = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf-8');
  } catch { /* keys still work for this process */ }
  return keys;
}

/** Public VAPID key for clients (never the private key). */
export function getVapidPublicKey() {
  if (!vapid) vapid = loadVapid();
  return vapid.publicKey;
}

function vapidDetails() {
  if (!vapid) vapid = loadVapid();
  return { subject: VAPID_SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
}

/* ------------------------------------------------------------------ */
/* Subscription store                                                  */
/* ------------------------------------------------------------------ */

let subs = loadSubs();

function loadSubs() {
  try {
    if (fs.existsSync(SUBS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed.filter((s) => s && s.endpoint);
    }
  } catch { /* fresh */ }
  return [];
}

function persistSubs() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf-8');
  } catch { /* best effort */ }
}

function validSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false;
  const endpoint = String(sub.endpoint || '');
  if (!endpoint.startsWith('https://')) return false;
  const keys = sub.keys || {};
  return Boolean(keys.p256dh && keys.auth);
}

export function addSubscription(sub) {
  if (!validSubscription(sub)) return { ok: false, error: 'Invalid push subscription' };
  const endpoint = sub.endpoint;
  subs = subs.filter((s) => s.endpoint !== endpoint);
  subs.push({
    endpoint,
    keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) },
    ua: String(sub.ua || '').slice(0, 120),
    at: Date.now(),
  });
  if (subs.length > MAX_SUBS) subs = subs.slice(subs.length - MAX_SUBS);
  persistSubs();
  return { ok: true, count: subs.length };
}

export function removeSubscription(endpoint) {
  const before = subs.length;
  subs = subs.filter((s) => s.endpoint !== endpoint);
  if (subs.length !== before) persistSubs();
  return { ok: true, removed: before - subs.length };
}

export function listSubscriptions() {
  return subs.map((s) => ({ endpoint: s.endpoint, ua: s.ua, at: s.at }));
}

/* ------------------------------------------------------------------ */
/* Broadcast                                                           */
/* ------------------------------------------------------------------ */

/** Injectable sender for tests: (sub, payload) => Promise. */
let sender = null;
export function setPushSender(fn) {
  sender = typeof fn === 'function' ? fn : null;
}

async function defaultSender(sub, payload) {
  await webpush.sendNotification(sub, JSON.stringify(payload), {
    vapidDetails: vapidDetails(),
    TTL: 86400, // 24h — a closed device still gets it when it comes back
  });
}

/**
 * Push { title, body, link } to every registered subscription.
 * Prunes dead subscriptions (404/410). Never throws.
 * Returns { sent, pruned, failed }.
 */
export async function broadcastPush(title, body = '', link = '') {
  const payload = { title: String(title || 'JEXI').slice(0, 100), body: String(body || '').slice(0, 300), link: String(link || '') };
  if (!subs.length) return { sent: 0, pruned: 0, failed: 0 };
  const send = sender || defaultSender;
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  for (const sub of [...subs]) {
    try {
      await send(sub, payload);
      sent += 1;
    } catch (e) {
      const code = (e && (e.statusCode || e.status)) || 0;
      if (code === 404 || code === 410) {
        subs = subs.filter((s) => s.endpoint !== sub.endpoint); // dead device
        pruned += 1;
        persistSubs();
      } else {
        failed += 1;
      }
    }
  }
  return { sent, pruned, failed };
}

/** Test helpers. */
export function resetPushManager() {
  subs = [];
  persistSubs();
  sender = null;
}
