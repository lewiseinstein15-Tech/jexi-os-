/**
 * JEXI OS — Notification Center (roadmap stage 23 remainder: notifications).
 *
 * Recurring missions already exist (TaskScheduler → TaskManager). This is the
 * other half: a notification center so JEXI can tell the user when something
 * finished, failed or needs attention — surfaced as a bell in the UI.
 * Notifications persist to DATA_DIR/notifications.json (ring, newest 50).
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'notifications.json');
const MAX = 50;

let items = load();

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) { /* fresh */ }
  return [];
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) { console.error('[Notifications] persist error:', e.message); }
}

/** Add a notification. kinds: info | success | warn | error. */
export function notify({ title, body = '', kind = 'info', link = '' }) {
  const n = {
    id: `n-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    title: String(title || 'Notification').slice(0, 120),
    body: String(body || '').slice(0, 400),
    kind: ['info', 'success', 'warn', 'error'].includes(kind) ? kind : 'info',
    link: String(link || ''),
    time: Date.now(),
    read: false,
  };
  items.unshift(n);
  if (items.length > MAX) items = items.slice(0, MAX);
  persist();
  return n;
}

/** Newest first, with a read state. */
export function listNotifications(limit = 50) {
  return items.slice(0, limit).map((n) => ({ ...n }));
}

export function unreadCount() {
  return items.filter((n) => !n.read).length;
}

export function markAllRead() {
  for (const n of items) n.read = true;
  persist();
  return { success: true };
}

export function markRead(id) {
  const n = items.find((x) => x.id === id);
  if (n) { n.read = true; persist(); }
  return { success: Boolean(n) };
}

export function clearNotifications() {
  items = [];
  persist();
  return { success: true };
}
