/**
 * JEXI OS — Email Connector (Build 56).
 *
 * SendGrid via REST (chosen over SMTP/IMAP so the server needs no new
 * dependencies and no socket plumbing):
 *   send    → POST https://api.sendgrid.com/v3/mail/send (202 Accepted)
 *   auth    → GET  https://api.sendgrid.com/v3/scopes
 *   receive → Inbound Parse webhook (multipart/form-data) normalized into the
 *             internal message shape; the Event Webhook (JSON array) is
 *             handled distinctly so bounces/drops/failures are never reported
 *             as deliveries.
 *
 * Credentials: SENDGRID_API_KEY (env wins over the Settings-stored value).
 */

import { Connector, ConnectorConfig, ConnectorError, ERROR_CODES, httpJson } from './ConnectorBase.js';
import { ConnectorRegistry } from './ConnectorRegistry.js';

/**
 * Minimal multipart/form-data parser (SendGrid Inbound Parse posts
 * multipart). Extracts named text fields + flags binary attachments.
 * Dependency-free and unit-tested against a realistic payload.
 */
export function parseMultipartForm(body, contentType) {
  const m = String(contentType || '').match(/boundary=([^;]+)/i);
  if (!m) return { fields: {}, attachments: [] };
  const boundary = m[1].trim().replace(/^"|"$/g, '');
  const parts = String(body).split(`--${boundary}`);
  const fields = {};
  const attachments = [];
  for (const part of parts) {
    if (!part.includes('\r\n\r\n') && !part.includes('\n\n')) continue;
    const sep = part.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const idx = part.indexOf(sep);
    const head = part.slice(0, idx);
    const raw = part.slice(idx + sep.length).replace(/\r\n$/, '');
    const nameMatch = head.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const filenameMatch = head.match(/filename="([^"]+)"/);
    if (filenameMatch) { attachments.push({ name, filename: filenameMatch[1] }); continue; }
    fields[name] = raw;
  }
  return { fields, attachments };
}

export class SendGridConnector extends Connector {
  static toolName = 'email';
  static toolLabel = 'Email';

  get defaultBaseUrl() { return 'https://api.sendgrid.com'; }

  resolveAuth() {
    const env = { apiKey: process.env.SENDGRID_API_KEY || '' };
    // Env wins ONLY when actually set — an unset env var must never clobber
    // a configured value.
    const merged = { ...this.config.auth };
    for (const [k, v] of Object.entries(env)) if (v) merged[k] = v;
    return merged;
  }

  assertAuth(auth) {
    if (!auth.apiKey) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'Email is not configured — set SENDGRID_API_KEY', { provider: this.label });
  }

  /** Actually call SendGrid — verify the key against /v3/scopes. */
  async authenticate() {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    const { status } = await httpJson(`${this.baseUrl}/v3/scopes`, { headers: { Authorization: `Bearer ${auth.apiKey}` }, provider: 'SendGrid API' });
    return status === 200;
  }

  /**
   * send(payload):
   *   { from: { email, name? }, to: [{ email, name? }] | 'a@b.com',
   *     subject, text, html?, attachments?: [{ filename, content: base64, type? }] }
   * Returns { ok: true, message_id } — SendGrid answers 202 with an empty
   * body, so the id comes from the X-Message-Id header.
   */
  async send(payload = {}) {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    const from = payload.from || this.config.auth.defaultFrom;
    if (!from || !from.email) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email send requires from.email (or configure defaultFrom)', { provider: this.label });
    const tos = Array.isArray(payload.to) ? payload.to : [{ email: payload.to }];
    if (!tos.length || !tos[0].email) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email send requires to', { provider: this.label });
    if (!payload.subject) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email send requires subject', { provider: this.label });

    const body = {
      personalizations: [{ to: tos }],
      from,
      subject: String(payload.subject),
      content: [
        { type: 'text/plain', value: String(payload.text || '') },
        ...(payload.html ? [{ type: 'text/html', value: String(payload.html) }] : []),
      ],
      ...(Array.isArray(payload.attachments) && payload.attachments.length
        ? { attachments: payload.attachments.map((a) => ({ content: a.content, filename: a.filename, ...(a.type ? { type: a.type } : {}) })) }
        : {}),
    };

    const res = await withTimeoutSafe(
      fetch(`${this.baseUrl}/v3/mail/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      this.requestTimeoutMs
    );
    const messageId = (res.headers && res.headers.get && res.headers.get('x-message-id')) || null;
    if (res.status === 401) throw new ConnectorError(ERROR_CODES.AUTH_FAILED, 'SendGrid auth failed (HTTP 401)', { provider: this.label });
    if (res.status === 429) throw new ConnectorError(ERROR_CODES.RATE_LIMITED, 'SendGrid rate-limited (HTTP 429)', { status: 429, provider: this.label });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, `SendGrid failed (HTTP ${res.status}): ${raw.slice(0, 300)}`, { status: res.status, provider: this.label });
    }
    return { ok: true, provider: 'sendgrid', message_id: messageId, status: res.status };
  }

  /* ------------------------- webhook / receive ------------------------- */

  /** Distinguish bounce/drop/failure from delivery (SendGrid Event Webhook). */
  handleEvents(eventList) {
    const events = Array.isArray(eventList) ? eventList : [];
    const outcome = { delivered: [], bounced: [], dropped: [], failed: [], other: [] };
    for (const ev of events) {
      const base = { email: ev.email, timestamp: ev.timestamp ? new Date(Number(ev.timestamp) * 1000).toISOString() : null };
      if (ev.event === 'delivered') outcome.delivered.push(base);
      else if (ev.event === 'bounce') outcome.bounced.push({ ...base, reason: ev.reason || null, type: ev.type || null });
      else if (ev.event === 'dropped') outcome.dropped.push({ ...base, reason: ev.reason || null });
      else if (ev.event === 'failed') outcome.failed.push({ ...base, reason: ev.reason || null, response: ev.response || null });
      else outcome.other.push({ ...base, event: ev.event });
    }
    return outcome;
  }

  /** Normalize an inbound-parse payload ({ fields, attachments }) → message. */
  normalizeInbound({ fields = {}, attachments = [] } = {}) {
    return [{
      id: fields['Message-Id'] || fields.message_id || null,
      provider: 'sendgrid',
      from: fields.from || null,
      to: fields.to || null,
      subject: fields.subject || null,
      text: fields.text || null,
      html: fields.html || null,
      attachments: attachments.map((a) => ({ filename: a.filename })),
      spamReport: fields.spam_report || null,
      timestamp: fields.timestamp ? new Date(Number(fields.timestamp) * 1000).toISOString() : null,
    }];
  }

  async receive(inbound) {
    if (Array.isArray(inbound)) return this.handleEvents(inbound); // event webhook
    if (inbound && (inbound.fields || inbound.body)) {
      if (inbound.body && !inbound.fields) {
        return this.normalizeInbound(parseMultipartForm(inbound.body, inbound.contentType));
      }
      return this.normalizeInbound(inbound);
    }
    return [];
  }

  static sendSchema() {
    return {
      from: { type: 'object', desc: '{ email, name? } sender (falls back to configured defaultFrom)' },
      to: { type: 'array', desc: '[{ email, name? }] recipients (or a single email string)' },
      subject: { type: 'string', required: true, desc: 'Email subject' },
      text: { type: 'string', desc: 'Plain-text body' },
      html: { type: 'string', desc: 'Optional HTML body' },
      attachments: { type: 'array', desc: '[{ filename, content (base64), type? }]' },
    };
  }
}

/** fetch + timeout that rethrows as a classified ConnectorError. */
async function withTimeoutSafe(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ConnectorError(ERROR_CODES.TIMEOUT, `SendGrid request timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    throw new ConnectorError(ERROR_CODES.NETWORK, `Network error talking to SendGrid: ${(e && e.message) || String(e)}`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

export function registerEmailConnector(config) {
  return ConnectorRegistry.register('email', new SendGridConnector(config instanceof ConnectorConfig ? config : new ConnectorConfig(config)));
}
