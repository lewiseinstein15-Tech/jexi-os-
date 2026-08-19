/**
 * B139 — LOCALE (DeepSeek Harness `packages/client/locale` mirror,
 * JEXI-branded).
 *
 * UI strings dictionary for JEXI's client surfaces. English is the built-in
 * base; a locale JSON file under DATA_DIR/locale/<tag>.json can override any
 * key. The x-jexi-locale request header selects the tag (default 'en').
 *
 *   t(tag, key, vars?)  → resolved string (falls back to en, then the key)
 *   localeStatus()      → available tags + key counts
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

function localeDir() { return path.join(process.env.DATA_DIR || DATA_DIR, 'locale'); }

/** Base English strings. */
export const BASE_STRINGS = {
  'app.name': 'JEXI OS',
  'app.tagline': 'Your personal AI operating system',
  'chat.placeholder': 'Ask JEXI anything…',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.thinking': 'Thinking…',
  'chat.photo': 'Photo',
  'chat.file': 'File',
  'chat.check': 'Check',
  'nav.home': 'Home',
  'nav.agents': 'Agents',
  'nav.command': 'Command',
  'nav.tasks': 'Tasks',
  'nav.settings': 'Settings',
  'nav.conversations': 'Conversations',
  'nav.projects': 'Projects',
  'nav.skills': 'Skills',
  'nav.research': 'Research',
  'nav.memory': 'Memory',
  'nav.goals': 'Goals',
  'nav.notifications': 'Notifications',
  'settings.security': 'Security',
  'settings.presets': 'Presets',
  'settings.plugins': 'Plugins',
  'settings.permissions': 'Permission Presets',
  'badge.one-mode': 'ONE MODE · JEXI DECIDES',
  'badge.auto': 'AUTO · JEXI DECIDES',
  'feedback.helpful': 'Helpful',
  'feedback.not-helpful': 'Not helpful',
  'error.generic': 'Something went wrong. Try again.',
  'status.online': 'Online',
  'status.offline': 'Offline',
  'update.available': 'Update available',
};

const loaded = new Map(); // tag → strings

/** Load (and cache) one locale file. */
export function loadLocale(tag) {
  const t = String(tag || 'en').toLowerCase();
  if (loaded.has(t)) return loaded.get(t);
  let strings = {};
  try {
    const file = path.join(localeDir(), `${t}.json`);
    if (fs.existsSync(file)) strings = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { /* corrupt file → base only */ }
  loaded.set(t, strings);
  return strings;
}

/** Resolve one string with {var} substitution. */
export function t(tag, key, vars = null) {
  const overrides = loadLocale(tag);
  let text = overrides[key] ?? BASE_STRINGS[key] ?? key;
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) text = String(text).split(`{${k}}`).join(String(v));
  }
  return text;
}

/** Locale status for /api/locale. */
export function localeStatus() {
  let files = [];
  try {
    if (fs.existsSync(localeDir())) {
      files = fs.readdirSync(localeDir()).filter((f) => f.endsWith('.json')).map((f) => ({ tag: f.slice(0, -5), file: path.join(localeDir(), f) }));
    }
  } catch { /* noop */ }
  return {
    ok: true,
    defaultTag: 'en',
    baseKeys: Object.keys(BASE_STRINGS).length,
    loadedTags: [...loaded.keys()],
    files,
    strings: BASE_STRINGS,
  };
}
