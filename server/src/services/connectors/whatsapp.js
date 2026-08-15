/**
 * WHATSAPP CONNECTOR — Meta's WhatsApp Cloud API.
 *
 *   health_check()  GET  https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}
 *                   ?fields=display_phone_number,verified_name,quality_rating,id
 *                   → 200 with the real phone-number profile = key + number valid.
 *   send()          POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
 *                   { messaging_product, recipient_type, to, type: 'text', text: { body } }
 *                   → 200 { messages: [{ id }] }
 *   webhook         GET  /webhooks/connectors/whatsapp  (Meta verification handshake)
 *                   POST /webhooks/connectors/whatsapp  (inbound messages, HMAC-verified)
 *
 * Env: WHATSAPP_ACCESS_TOKEN, PHONE_NUMBER_ID, APP_SECRET (webhook HMAC),
 *      VERIFY_TOKEN (webhook handshake).
 */
import axios from 'axios';
import crypto from 'crypto';
import { loadSettings } from '../SettingsManager.js';

export const GRAPH_API = 'https://graph.facebook.com';
export const GRAPH_VERSION = 'v21.0';

export function getWhatsAppEnv() {
  const s = loadSettings();
  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN || s.whatsappToken || '',
    phoneNumberId: process.env.PHONE_NUMBER_ID || '',
    appSecret: process.env.APP_SECRET || '',
    verifyToken: process.env.VERIFY_TOKEN || s.whatsappVerifyToken || '',
  };
}

/** Masked credential info — presence + source only, never values. */
export function whatsappEnvInfo() {
  const env = getWhatsAppEnv();
  const info = (name, value) => {
    if (!value) return { configured: false, source: 'none' };
    if (process.env[name]) return { configured: true, source: 'env' };
    return { configured: true, source: 'settings' };
  };
  return {
    token: info('WHATSAPP_ACCESS_TOKEN', env.token),
    phoneNumberId: info('PHONE_NUMBER_ID', env.phoneNumberId),
    appSecret: info('APP_SECRET', env.appSecret),
    verifyToken: info('VERIFY_TOKEN', env.verifyToken),
    envVars: ['WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'APP_SECRET', 'VERIFY_TOKEN'],
  };
}

/** Exact Meta message payload (pure — exported for tests). */
export function buildWhatsAppMessage({ to, body } = {}) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to || '').replace(/\D/g, ''),
    type: 'text',
    text: { body: String(body || '') },
  };
}

/**
 * health_check() — REAL call to Meta's Graph API for the phone number's
 * profile. 200 = token + number are live. Never PASSes on env presence alone.
 */
export async function healthCheck() {
  const env = getWhatsAppEnv();
  if (!env.token) return { status: 'BLOCKED', ok: false, reason: 'WHATSAPP_ACCESS_TOKEN is not set' };
  if (!env.phoneNumberId) return { status: 'BLOCKED', ok: false, reason: 'PHONE_NUMBER_ID is not set' };
  try {
    const res = await axios.get(`${GRAPH_API}/${GRAPH_VERSION}/${env.phoneNumberId}`, {
      params: { fields: 'display_phone_number,verified_name,quality_rating,id' },
      headers: { Authorization: `Bearer ${env.token}` },
      timeout: 15000,
    });
    const p = res.data || {};
    return {
      status: 'PASS',
      ok: true,
      detail: `Meta Graph API ${GRAPH_VERSION} OK — ${p.verified_name || p.display_phone_number || p.id} (quality: ${p.quality_rating || 'n/a'})`,
      profile: p,
    };
  } catch (e) {
    const status = e.response ? e.response.status : 'network';
    const msg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    return { status: 'FAIL', ok: false, detail: `Graph API ${status}: ${msg}` };
  }
}

/**
 * send() — one real WhatsApp text message. to must be the recipient's number
 * in international format (digits only or +). Returns Meta's raw response
 * including the message id.
 */
export async function send({ to, body } = {}) {
  if (!to) return { ok: false, error: 'to (recipient WhatsApp number) is required', code: 'BAD_REQUEST' };
  if (!body) return { ok: false, error: 'body (message text) is required', code: 'BAD_REQUEST' };
  const env = getWhatsAppEnv();
  if (!env.token) return { ok: false, error: 'WHATSAPP_ACCESS_TOKEN is not set', code: 'MISSING_KEY' };
  if (!env.phoneNumberId) return { ok: false, error: 'PHONE_NUMBER_ID is not set', code: 'MISSING_KEY' };
  const payload = buildWhatsAppMessage({ to, body });
  try {
    const res = await axios.post(`${GRAPH_API}/${GRAPH_VERSION}/${env.phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    return {
      ok: true,
      messageId: res.data && res.data.messages && res.data.messages[0] && res.data.messages[0].id,
      raw: res.data,
    };
  } catch (e) {
    const status = e.response ? e.response.status : 'network';
    const msg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    return { ok: false, error: `Graph API ${status}: ${msg}`, code: 'SEND_FAILED', status };
  }
}

/**
 * Webhook verification handshake (Meta GET). mode must be 'subscribe' and
 * verifyToken must equal VERIFY_TOKEN. env overridable for tests.
 */
export function verifyWebhook({ mode, verifyToken, challenge } = {}, env = getWhatsAppEnv()) {
  if (mode === 'subscribe' && verifyToken && verifyToken === env.verifyToken) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/**
 * Verify the x-hub-signature-256 header over the RAW body with APP_SECRET.
 * timingSafeEqual — no short-circuit on length mismatch leaks nothing.
 */
export function verifySignature(rawBody, signatureHeader, env = getWhatsAppEnv()) {
  if (!env.appSecret || !signatureHeader || !rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', env.appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * receive() — parse Meta's inbound webhook payload into a flat shape.
 * Throws on malformed JSON; returns { received: false } for non-message
 * payloads (statuses, echo, etc.).
 */
export function receive(rawBody) {
  const obj = typeof rawBody === 'string'
    ? JSON.parse(rawBody)
    : Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString('utf8')) : rawBody;
  const entry = obj.entry && obj.entry[0];
  const change = entry && entry.changes && entry.changes[0];
  const value = change && change.value;
  const messages = (value && value.messages) || [];
  const msg = messages[0];
  if (!msg) {
    return {
      received: false,
      reason: (value && value.statuses) ? 'status update (no inbound message)' : 'no message in payload',
      raw: obj,
    };
  }
  return {
    received: true,
    from: msg.from || '',
    to: (value && value.metadata && value.metadata.phone_number_id) || '',
    text: (msg.text && msg.text.body) || '',
    messageId: msg.id || '',
    timestamp: msg.timestamp ? Number(msg.timestamp) : null,
    type: msg.type || 'text',
    raw: obj,
  };
}
