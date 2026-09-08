/**
 * SESSION KEYS — one-time secrets that are NEVER persisted.
 *
 * The user order: no stored GitHub token anywhere (no settings.json, no
 * connectors config, no credentials file). When JEXI needs to push, commit,
 * or ship and no ambient key exists, it asks the user to paste a one-time
 * key in chat. That key lives ONLY in this module's memory: it auto-expires
 * (30 min default), can be forgotten on demand, and a server restart wipes
 * it. No API below ever returns key material — only presence/expiry/uses.
 *
 * Precedence for GitHub auth everywhere is now: session key > env var.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const ASK_TTL_MS = 10 * 60 * 1000;

let githubKey = null; // { value, setAt, expiresAt, uses }
const pendingAsks = new Map(); // conv -> { id, tool, reason, at }

/** Plausibility only (the server is the real judge): printable ASCII, no gaps. */
export function isPlausibleKey(v) {
  return typeof v === 'string' && /^[!-~]{20,300}$/.test(v);
}

export function setGithubKey(value, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!isPlausibleKey(value)) {
    return { ok: false, error: 'that does not look like a key (20-300 printable characters, no spaces) — paste the token itself, nothing else' };
  }
  const now = Date.now();
  githubKey = { value, setAt: now, expiresAt: now + ttlMs, uses: 0 };
  console.info('[SessionKeys] one-time GitHub key received (memory-only, never stored)');
  return { ok: true, expiresInSec: Math.round(ttlMs / 1000) };
}

export function getGithubKey() {
  if (!githubKey) return null;
  if (Date.now() > githubKey.expiresAt) {
    githubKey = null;
    console.info('[SessionKeys] one-time GitHub key expired and was forgotten');
    return null;
  }
  githubKey.uses += 1;
  return githubKey.value;
}

/** Presence without consuming (status badges must not inflate the use count). */
export function githubKeyStatus() {
  if (!githubKey) return { set: false, expiresInSec: 0, uses: 0 };
  if (Date.now() > githubKey.expiresAt) {
    githubKey = null;
    return { set: false, expiresInSec: 0, uses: 0 };
  }
  return { set: true, expiresInSec: Math.max(0, Math.round((githubKey.expiresAt - Date.now()) / 1000)), uses: githubKey.uses };
}

export function forgetGithubKey() {
  const had = !!githubKey;
  githubKey = null;
  if (had) console.info('[SessionKeys] one-time GitHub key forgotten on request');
  return { forgotten: had };
}

/**
 * Park a key request for a conversation. Emits `ask.secret` (the frontend
 * renders the paste card) only when this is a FRESH request — repeats while
 * one is pending return the same id silently so the model can't spam cards.
 */
export function requestGithubKey({ conv = 'default', tool = 'github', reason = '', sendEvent = null } = {}) {
  const key = String(conv || 'default');
  const prev = pendingAsks.get(key);
  if (prev && Date.now() - prev.at < ASK_TTL_MS) return { id: prev.id, fresh: false };
  const id = `gk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  pendingAsks.set(key, { id, tool: String(tool).slice(0, 60), reason: String(reason).slice(0, 200), at: Date.now() });
  if (typeof sendEvent === 'function') {
    try { sendEvent('ask.secret', { conv: key, id, tool: String(tool).slice(0, 60), reason: String(reason).slice(0, 200) }); } catch { /* noop */ }
  }
  return { id, fresh: true };
}

export function pendingGithubAsk(conv = 'default') {
  const p = pendingAsks.get(String(conv || 'default'));
  if (!p || Date.now() - p.at > ASK_TTL_MS) return null;
  return { ...p };
}

/** Consume a paste: the id must match a live request, then the key is held. */
export function answerGithubKey({ conv = 'default', id = '', value = '' } = {}) {
  const key = String(conv || 'default');
  const p = pendingAsks.get(key);
  if (!p || p.id !== id || Date.now() - p.at > ASK_TTL_MS) {
    return { ok: false, error: 'no matching key request (it may have expired) — ask JEXI to try the GitHub step again' };
  }
  const set = setGithubKey(value);
  if (!set.ok) return set;
  pendingAsks.delete(key);
  return { ok: true, expiresInSec: set.expiresInSec };
}

/**
 * One-time migration (user order: the stored token is REMOVED). Deletes any
 * persisted GitHub PAT material: settings.json githubToken +
 * connectors.github.auth.token, credentials.json github/github_token. Writes
 * files back only when something was actually removed. Never logs values.
 */
export function migrateStoredGithubSecrets({
  settingsPath = path.join(process.cwd(), 'settings.json'),
  credentialsPath = path.join(DATA_DIR, 'credentials.json'),
} = {}) {
  const removed = [];
  try {
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (s && typeof s === 'object') {
        if (s.githubToken) { delete s.githubToken; removed.push('settings:githubToken'); }
        if (s.connectors && s.connectors.github && s.connectors.github.auth && s.connectors.github.auth.token) {
          delete s.connectors.github.auth.token; removed.push('settings:connectors.github.auth.token');
        }
        if (removed.length) fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8');
      }
    }
  } catch { /* a broken settings file is not this migration's problem */ }
  const before = removed.length;
  try {
    if (fs.existsSync(credentialsPath)) {
      const c = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
      if (c && typeof c === 'object') {
        for (const k of ['github', 'github_token']) {
          if (c[k]) { delete c[k]; removed.push(`credentials:${k}`); }
        }
        if (removed.length > before) fs.writeFileSync(credentialsPath, JSON.stringify(c, null, 2), 'utf-8');
      }
    }
  } catch { /* same: never crash boot on a broken creds file */ }
  if (removed.length) console.info(`[SessionKeys] removed stored GitHub token material: ${removed.join(', ')} (one-time-paste only now)`);
  return { removed };
}
