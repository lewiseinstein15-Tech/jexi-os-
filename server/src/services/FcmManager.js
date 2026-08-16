/**
 * JEXI OS — FCM Manager (B86: closed-app push for the installed APK).
 *
 * Sends notifications to the installed Android app via Firebase Cloud
 * Messaging (HTTP v1). Complements web push (PWA) and local notifications:
 * FCM delivers even when the app is completely closed/killed.
 *
 *   - Service account: resolved from (1) FIREBASE_SERVICE_ACCOUNT env var
 *     (full JSON — Render supports multiline env vars), (2) a local file
 *     server/firebase-service-account.json (gitignored), or (3)
 *     GOOGLE_APPLICATION_CREDENTIALS path. Without one, FCM is off and the
 *     rest of JEXI is unaffected.
 *   - OAuth access tokens: minted from the service account (RS256 JWT),
 *     cached, refreshed ~10 min before expiry. Injectable token fetcher for
 *     tests.
 *   - Device tokens: persisted to DATA_DIR/fcm-tokens.json (atomic writes,
 *     capped); register / unregister / list.
 *   - broadcastFcm(): sends {title, body, link} to every device token;
 *     dead tokens (404 NOT_FOUND / UNREGISTERED) pruned; per-token try/catch.
 *     Injectable sender for tests.
 *   - FREE: FCM itself has no cost; only a Firebase project (Spark plan) is
 *     needed, and these keys are it.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config.js';

const TOKENS_FILE = path.join(DATA_DIR, 'fcm-tokens.json');
const MAX_TOKENS = 30;
const SERVICE_ACCOUNT_FILE = path.join(process.cwd(), 'firebase-service-account.json');

/* ------------------------------------------------------------------ */
/* Service account + OAuth token                                       */
/* ------------------------------------------------------------------ */

let serviceAccount = null;
let accessToken = null;
let accessTokenExp = 0;

export function resolveServiceAccount() {
  if (serviceAccount) return serviceAccount;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8'));
    } else if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
      serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf-8'));
    }
  } catch (e) {
    serviceAccount = null;
  }
  return serviceAccount;
}

export function isFcmConfigured() {
  const sa = resolveServiceAccount();
  return Boolean(sa && sa.client_email && sa.private_key && sa.project_id);
}

function jwtFromServiceAccount(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key).toString('base64url');
  return `${header}.${claims}.${sig}`;
}

/** Injectable OAuth token fetcher: (assertion) => Promise<string>. */
let tokenFetcher = null;
export function setFcmTokenFetcher(fn) {
  tokenFetcher = typeof fn === 'function' ? fn : null;
}

async function defaultTokenFetcher(assertion) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const d = await res.json();
  if (!res.ok || !d.access_token) throw new Error(`FCM OAuth failed: ${res.status} ${d.error_description || d.error || ''}`);
  return d.access_token;
}

/** Cached access token (refresh ~10 min before expiry). Never throws (returns null). */
export async function getFcmAccessToken() {
  try {
    const sa = resolveServiceAccount();
    if (!sa) return null;
    if (accessToken && Date.now() < accessTokenExp - 10 * 60 * 1000) return accessToken;
    const fetchToken = tokenFetcher || defaultTokenFetcher;
    const token = await fetchToken(jwtFromServiceAccount(sa));
    accessToken = token;
    accessTokenExp = Date.now() + 55 * 60 * 1000;
    return token;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Device token store                                                  */
/* ------------------------------------------------------------------ */

let tokens = loadTokens();

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed.filter((t) => t && t.token);
    }
  } catch { /* fresh */ }
  return [];
}

function persistTokens() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
  } catch { /* best effort */ }
}

export function addFcmToken(token, ua = '') {
  if (!token || typeof token !== 'string' || token.length < 20) return { ok: false, error: 'Invalid FCM token' };
  tokens = tokens.filter((t) => t.token !== token);
  tokens.push({ token, ua: String(ua || '').slice(0, 120), at: Date.now() });
  if (tokens.length > MAX_TOKENS) tokens = tokens.slice(tokens.length - MAX_TOKENS);
  persistTokens();
  return { ok: true, count: tokens.length };
}

export function removeFcmToken(token) {
  const before = tokens.length;
  tokens = tokens.filter((t) => t.token !== token);
  if (tokens.length !== before) persistTokens();
  return { ok: true, removed: before - tokens.length };
}

export function listFcmTokens() {
  return tokens.map((t) => ({ token: String(t.token).slice(0, 24) + '…', ua: t.ua, at: t.at }));
}

export function fcmStatus() {
  const sa = resolveServiceAccount();
  return {
    configured: isFcmConfigured(),
    projectId: sa ? sa.project_id : null,
    deviceTokens: tokens.length,
  };
}

/* ------------------------------------------------------------------ */
/* Broadcast                                                           */
/* ------------------------------------------------------------------ */

/** Injectable sender for tests: (token, payload) => Promise (throws on failure). */
let sender = null;
export function setFcmSender(fn) {
  sender = typeof fn === 'function' ? fn : null;
}

async function defaultSender(token, payload) {
  const access = await getFcmAccessToken();
  if (!access) throw new Error('FCM not configured');
  const sa = resolveServiceAccount();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { link: payload.link || '' },
        android: { priority: 'high', ttl: '86400s' },
      },
    }),
  });
  if (!res.ok) {
    const err = new Error(`FCM send failed: ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
}

/**
 * Push to every registered device token. Prunes dead tokens
 * (404 NOT_FOUND / UNREGISTERED). Never throws.
 * Returns { sent, pruned, failed }.
 */
export async function broadcastFcm(title, body = '', link = '') {
  if (!isFcmConfigured() || !tokens.length) return { sent: 0, pruned: 0, failed: 0, disabled: !isFcmConfigured() };
  const payload = { title: String(title || 'JEXI').slice(0, 100), body: String(body || '').slice(0, 300), link: String(link || '') };
  const send = sender || defaultSender;
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  for (const entry of [...tokens]) {
    try {
      await send(entry.token, payload);
      sent += 1;
    } catch (e) {
      const code = (e && (e.statusCode || e.status)) || 0;
      if (code === 404 || code === 400 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(String(e && e.message))) {
        tokens = tokens.filter((t) => t.token !== entry.token); // dead device
        pruned += 1;
        persistTokens();
      } else {
        failed += 1;
      }
    }
  }
  return { sent, pruned, failed };
}

/** Test helpers. */
export function resetFcmManager() {
  tokens = [];
  persistTokens();
  sender = null;
  tokenFetcher = null;
  accessToken = null;
  accessTokenExp = 0;
  serviceAccount = null;
}
