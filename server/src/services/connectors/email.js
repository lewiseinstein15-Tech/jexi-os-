/**
 * EMAIL CONNECTOR — Resend (replaces the abandoned SendGrid plan; SendGrid's
 * account was rejected during vetting, so no SendGrid code ever shipped here —
 * this is the email connector built fresh on Resend).
 *
 * API (confirmed against https://resend.com/docs/api-reference/emails/send-email):
 *   POST https://api.resend.com/emails
 *     Authorization: Bearer RESEND_API_KEY
 *     Content-Type: application/json
 *     { "from": "Name <email>", "to": ["a@b.c"], "subject": "...", "html": "..." | "text": "..." }
 *   → 200 { "id": "uuid" }
 *
 * health_check() makes a REAL authenticated call (GET /domains) — a valid key
 * returns 200 with the account's domains; an invalid key returns 401. It never
 * reports PASS just because the variable exists.
 *
 * Env: RESEND_API_KEY (required), RESEND_FROM (optional — must be a sender
 * Resend has verified; defaults to Resend's built-in onboarding@resend.dev,
 * which works for testing).
 */
import axios from 'axios';
import { loadSettings } from '../SettingsManager.js';

export const RESEND_API = 'https://api.resend.com';
export const RESEND_API_KEY_ENV = 'RESEND_API_KEY';
export const DEFAULT_FROM = 'JEXI OS <onboarding@resend.dev>';

/** Same precedence as every other credential: env first, then settings.json. */
export function getResendKey() {
  return process.env.RESEND_API_KEY || loadSettings().resendKey || '';
}

/** Masked credential info for /api/connectors status — never the key value. */
export function resendEnvInfo() {
  const key = getResendKey();
  if (!key) return { configured: false, source: 'none', envVars: ['RESEND_API_KEY'] };
  if (process.env.RESEND_API_KEY) return { configured: true, source: 'env', envVars: ['RESEND_API_KEY'] };
  return { configured: true, source: 'settings', envVars: ['RESEND_API_KEY'] };
}

/**
 * Build the exact Resend request body (pure, exported so tests + the live
 * script can assert the shape without a network call).
 */
export function buildResendPayload({ from, to, subject, html, text } = {}) {
  const payload = {
    from: from || process.env.RESEND_FROM || DEFAULT_FROM,
    to: Array.isArray(to) ? to.map(String) : [String(to)],
    subject: String(subject),
  };
  if (html) payload.html = String(html);
  if (text) payload.text = String(text);
  return payload;
}

/**
 * health_check() — REAL call to Resend's API. 200 = key valid; anything else
 * is reported verbatim. Returns { status: 'PASS'|'FAIL'|'BLOCKED', ... }.
 */
export async function healthCheck() {
  const key = getResendKey();
  if (!key) {
    return { status: 'BLOCKED', ok: false, reason: 'RESEND_API_KEY is not set (Render env or Settings → Email)' };
  }
  try {
    const res = await axios.get(`${RESEND_API}/domains`, {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 15000,
    });
    const data = (res.data && res.data.data) || [];
    const domains = Array.isArray(data)
      ? data.map((d) => d && d.name).filter(Boolean)
      : [];
    return {
      status: 'PASS',
      ok: true,
      detail: `Resend API responded 200 — key is valid, ${domains.length} domain(s) configured`,
      domains,
    };
  } catch (e) {
    const status = e.response ? e.response.status : 'network';
    const msg = (e.response && e.response.data && (e.response.data.message || e.response.data.name))
      || e.message;
    return { status: 'FAIL', ok: false, detail: `Resend API ${status}: ${msg}` };
  }
}

/**
 * send() — real email via Resend. Returns Resend's actual response (message id).
 * Throws nothing — failures come back as { ok: false, error }.
 */
export async function send({ to, from, subject, html, text } = {}) {
  if (!to) return { ok: false, error: 'to (recipient email) is required', code: 'BAD_REQUEST' };
  if (!subject || (!html && !text)) {
    return { ok: false, error: 'subject and html (or text) are required', code: 'BAD_REQUEST' };
  }
  const key = getResendKey();
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set', code: 'MISSING_KEY' };
  const payload = buildResendPayload({ from, to, subject, html, text });
  try {
    const res = await axios.post(`${RESEND_API}/emails`, payload, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    return { ok: true, messageId: res.data && res.data.id, raw: res.data };
  } catch (e) {
    const status = e.response ? e.response.status : 'network';
    const msg = (e.response && e.response.data && (e.response.data.message || e.response.data.name))
      || e.message;
    return { ok: false, error: `Resend API ${status}: ${msg}`, code: 'SEND_FAILED', status };
  }
}

/**
 * receive() — parse a Resend delivery/webhook event into a flat shape.
 * (Resend webhooks are optional; this parses the documented payload so the
 * connector surface is complete.)
 */
export function receive(rawBody) {
  const obj = typeof rawBody === 'string'
    ? JSON.parse(rawBody)
    : Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString('utf8')) : rawBody;
  const type = obj.type || obj.event || 'unknown';
  const data = obj.data || {};
  return {
    type,
    email: { id: data.email_id || data.id || '', to: data.to || '', from: data.from || '', subject: data.subject || '' },
    createdAt: obj.created_at || data.created_at || null,
    raw: obj,
  };
}
