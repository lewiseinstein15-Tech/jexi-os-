/**
 * JEXI OS — Email Connector (Build 57: SendGrid → Resend).
 *
 * B56 shipped this connector on SendGrid, but the SendGrid account was
 * rejected during provider vetting — JEXI does not use SendGrid at all. This
 * build replaces it with Resend (same connector contract, no new deps):
 *
 *   send    → POST https://api.resend.com/emails
 *             { from: "Name <email>", to: ["a@b.com"], subject, html | text }
 *             → 200 { "id": "uuid" }        (schema confirmed against
 *               https://resend.com/docs/api-reference/emails/send-email)
 *   auth    → GET  https://api.resend.com/domains   (200 = key valid;
 *             a REAL call — never just "variable exists")
 *   receive → Resend delivery webhook (JSON events: email.delivered /
 *             email.bounced / email.dropped / email.complained / email.sent)
 *             normalized into the internal message shape.
 *
 * Credentials: RESEND_API_KEY (env wins over the Settings-stored value);
 * optional RESEND_FROM for a verified sender (defaults to Resend's built-in
 * onboarding@resend.dev, which works for testing).
 */

import { Connector, ConnectorConfig, ConnectorError, ERROR_CODES, httpJson } from './ConnectorBase.js';
import { ConnectorRegistry } from './ConnectorRegistry.js';

/** Normalize a from value: "Name <email>" | { email, name? } → Resend string. */
export function normalizeFrom(from, fallback) {
  if (!from) return fallback || '';
  if (typeof from === 'string') return from.trim();
  if (from.email) return from.name ? `${from.name} <${from.email}>` : String(from.email).trim();
  return '';
}

/** Normalize to: string | array of {email} | array of strings → string[]. */
export function normalizeTo(to) {
  const list = Array.isArray(to) ? to : [to];
  return list.map((t) => (typeof t === 'string' ? t.trim() : (t && t.email) || '')).filter(Boolean);
}

export class ResendConnector extends Connector {
  static toolName = 'email';
  static toolLabel = 'Email';

  get defaultBaseUrl() { return 'https://api.resend.com'; }

  resolveAuth() {
    const env = { apiKey: process.env.RESEND_API_KEY || '', from: process.env.RESEND_FROM || '' };
    // Env wins ONLY when actually set — an unset env var must never clobber
    // a configured value.
    const merged = { ...this.config.auth };
    for (const [k, v] of Object.entries(env)) if (v) merged[k] = v;
    return merged;
  }

  assertAuth(auth) {
    if (!auth.apiKey) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'Email is not configured — set RESEND_API_KEY', { provider: this.label });
  }

  /** Actually call Resend — verify the key against GET /domains (200 = valid). */
  async authenticate() {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    let status;
    let data;
    try {
      ({ status, data } = await httpJson(`${this.baseUrl}/domains`, {
        headers: { Authorization: `Bearer ${auth.apiKey}` },
        provider: 'Resend API',
        timeout: this.requestTimeoutMs,
      }));
    } catch (e) {
      // B58: a send-only ("Sending access") key gets 401 on GET /domains even
      // though POST /emails works — surface the real cause instead of a bare
      // "auth failed".
      if (e instanceof ConnectorError && e.code === ERROR_CODES.AUTH_FAILED) {
        throw new ConnectorError(ERROR_CODES.AUTH_FAILED, 'Resend rejected the key on GET /domains (HTTP 401) — if this key was created with "Sending access", regenerate it with Full access (sending already works; the domains check needs Full access)', { status: 401, provider: this.label });
      }
      throw e;
    }
    if (!data || !Array.isArray(data.data)) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'Resend auth returned a response without a domains list', { status, provider: this.label, cause: data });
    }
    return status === 200;
  }

  /**
   * send(payload):
   *   { from?: "Name <email>" | { email, name? }, to: 'a@b.c' | ['a@b.c'] | [{email}],
   *     subject, text?, html? }
   * Returns { ok: true, provider: 'resend', message_id } — Resend's real
   * response body id.
   */
  async send(payload = {}) {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    // From-chain: payload.from → RESEND_FROM → settings defaultFrom → Resend's
    // documented test sender (works without a verified domain for testing).
    const from = normalizeFrom(payload.from, auth.from || this.config.auth.defaultFrom) || 'JEXI OS <onboarding@resend.dev>';
    const to = normalizeTo(payload.to);
    if (!to.length) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email send requires to', { provider: this.label });
    if (!payload.subject) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email send requires subject', { provider: this.label });
    if (!payload.text && !payload.html) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email send requires text or html', { provider: this.label });

    const body = {
      from,
      to,
      subject: String(payload.subject),
      ...(payload.text ? { text: String(payload.text) } : {}),
      ...(payload.html ? { html: String(payload.html) } : {}),
    };

    const { status, data } = await httpJson(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.apiKey}`, 'Content-Type': 'application/json' },
      body,
      provider: 'Resend API',
      timeout: this.requestTimeoutMs,
    });
    if (!data || !data.id) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'Resend send returned a response without an email id', { status, provider: this.label, cause: data });
    }
    return { ok: true, provider: 'resend', message_id: data.id, status };
  }

  /* ------------------------- webhook / receive ------------------------- */

  /**
   * Classify Resend delivery webhook events — bounces/drops/complaints are
   * NEVER reported as deliveries. Accepts one webhook body or an array.
   * Resend event types: email.sent | email.delivered | email.delivery_delayed
   * | email.complained | email.bounced | email.opened | email.clicked |
   * email.dropped.
   */
  handleEvents(eventList) {
    const events = Array.isArray(eventList) ? eventList : [eventList];
    const outcome = { delivered: [], bounced: [], dropped: [], complained: [], sent: [], other: [] };
    for (const ev of events) {
      const type = ev.type || (ev.event ? `email.${ev.event}` : '');
      const data = ev.data || {};
      const base = {
        email: data.to || ev.email || null,
        id: data.email_id || ev.id || null,
        timestamp: data.created_at || ev.timestamp ? new Date(String(data.created_at || ev.timestamp)).toISOString() : null,
      };
      if (type === 'email.delivered') outcome.delivered.push(base);
      else if (type === 'email.bounced') outcome.bounced.push({ ...base, reason: data.bounce?.description || data.reason || null, type: data.bounce?.category || null });
      else if (type === 'email.dropped') outcome.dropped.push({ ...base, reason: data.dropped?.description || data.reason || null });
      else if (type === 'email.complained') outcome.complained.push(base);
      else if (type === 'email.sent' || type === 'email.opened' || type === 'email.clicked' || type === 'email.delivery_delayed') outcome.sent.push({ ...base, event: type });
      else outcome.other.push({ ...base, event: type });
    }
    return outcome;
  }

  /** Normalize a Resend webhook body → internal event shape (array). */
  normalizeInbound(body) {
    if (!body) return [];
    const events = [];
    const list = Array.isArray(body) ? body : [body];
    for (const ev of list) {
      const data = ev.data || {};
      events.push({
        id: data.email_id || null,
        provider: 'resend',
        type: ev.type || ev.event || 'unknown',
        from: data.from || null,
        to: data.to || null,
        subject: data.subject || null,
        text: (data.body && data.body.plain) || null,
        timestamp: data.created_at ? new Date(data.created_at).toISOString() : null,
        raw: ev,
      });
    }
    return events;
  }

  /** receive(): normalize a webhook payload into events. */
  async receive(inbound) {
    return this.normalizeInbound(inbound || {});
  }

  static sendSchema() {
    return {
      from: { type: 'string', desc: 'Sender "Name <email>" (falls back to RESEND_FROM / defaultFrom)' },
      to: { type: 'array', desc: 'Recipient email(s): string, array of strings, or [{ email }]' },
      subject: { type: 'string', required: true, desc: 'Email subject' },
      text: { type: 'string', desc: 'Plain-text body' },
      html: { type: 'string', desc: 'Optional HTML body' },
    };
  }
}

export function registerEmailConnector(config) {
  return ConnectorRegistry.register('email', new ResendConnector(config instanceof ConnectorConfig ? config : new ConnectorConfig(config)));
}
