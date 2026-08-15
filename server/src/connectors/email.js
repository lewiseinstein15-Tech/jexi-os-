/**
 * JEXI OS — Email Connector (Build 61: Resend outbound + inbound + reply).
 *
 * B56 shipped this connector on SendGrid, but the SendGrid account was
 * rejected during provider vetting — JEXI does not use SendGrid at all. B57
 * replaced it with Resend for sending. B61 adds the full inbound loop:
 *
 *   send     → POST https://api.resend.com/emails
 *   auth     → GET  https://api.resend.com/domains   (real call, never just
 *              "variable exists")
 *   receive  → Resend INBOUND webhook (email.received), verified with the
 *              Svix signature scheme (svix-id / svix-timestamp /
 *              svix-signature + RESEND_WEBHOOK_SECRET). B64 FIX: Resend signs
 *              with HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`
 *              using the base64-decoded secret after the whsec_ prefix — the
 *              B61 build wrongly used Ed25519 and rejected every real
 *              delivery (HTTP 403), which the first real Resend event proved.
 *              Now matches Svix's documented scheme exactly. The webhook only
 *              carries metadata, so the full body is fetched from the
 *              Received-emails API (GET /emails/{email_id}) and normalized
 *              into the internal message shape.
 *   reply    → respond to a specific inbound email on the SAME thread:
 *              "Re: <subject>", In-Reply-To + References threading headers,
 *              quoted original, reply_to set to our receiving address so the
 *              conversation keeps coming back to JEXI.
 *
 * Credentials (env wins over the Settings-stored value):
 *   RESEND_API_KEY          — required (outbound + fetching received emails)
 *   RESEND_WEBHOOK_SECRET   — required for inbound webhooks (Svix verify)
 *   RESEND_FROM             — optional verified sender for outbound
 *   RESEND_RECEIVING_ADDRESS — optional "inbox" address (our receiving
 *              domain) used as the From when replying; when unset the reply
 *              From falls back to the address the original was sent TO.
 *   JEXI_CREATOR_EMAIL      — the sender JEXI recognizes as her creator
 *              (default lewiseinstein15@gmail.com — Lewis). Inbound emails
 *              from this address carry creator: true and get creator-aware
 *              tone/priority in the auto-reply loop (B66).
 */

/**
 * B66 — creator recognition. The sender JEXI treats as her creator (owner):
 * lewiseinstein15@gmail.com by default (Lewis), overridable via env.
 * Safety: this ONLY changes tone/priority — it never bypasses any approval,
 * permission, or safety logic (those live in ToolRuntime/RiskGuard and apply
 * identically to every sender).
 */
export const CREATOR_EMAIL = process.env.JEXI_CREATOR_EMAIL || 'lewiseinstein15@gmail.com';

/** Normalize "Name <addr>" / "addr" → bare lowercase address. */
export function bareAddress(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  const addr = m ? m[1] : String(from || '');
  return addr.trim().toLowerCase();
}

/** True when an inbound From belongs to JEXI's creator (Lewis by default). */
export function isCreatorEmail(from) {
  const wanted = bareAddress(CREATOR_EMAIL);
  if (!wanted) return false;
  return bareAddress(from) === wanted;
}

import crypto from 'crypto';
import { Connector, ConnectorConfig, ConnectorError, ERROR_CODES, httpJson, assertAsciiSecret } from './ConnectorBase.js';
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

/* ------------------------------------------------------------------ */
/* Svix webhook verification (used by Resend's email.received events). */
/* ------------------------------------------------------------------ */

/**
 * Verify a Svix-signed webhook body using only Node's crypto (no `svix`
 * dependency), per Svix's official manual-verification scheme — which is
 * exactly what Resend uses:
 *
 *   signed_content = `${svix-id}.${svix-timestamp}.${rawBody}`   (raw body)
 *   key            = base64-decode(secret after the `whsec_` prefix)
 *   expected       = base64(HMAC-SHA256(key, signed_content))
 *
 * and match it against each `v1,<sig>` entry in svix-signature with a
 * constant-time comparison. The svix-timestamp must be within
 * `toleranceSeconds` of now (Svix default 5 minutes) to block replay.
 *
 * B64 FIX: B61 shipped an Ed25519 verifier (misread of the Svix scheme)
 * that passed self-generated round-trips but rejected every real Resend
 * delivery with HTTP 403. This matches Svix's documented HMAC scheme and is
 * regression-tested against Svix's own published example signature.
 */
export function verifySvixSignature(secret, rawBody, headers = {}, { toleranceSeconds = 300 } = {}) {
  return verifySvixSignatureDetailed(secret, rawBody, headers, { toleranceSeconds }).ok;
}

/** Like verifySvixSignature but returns { ok, reason } so rejections are diagnosable. */
export function verifySvixSignatureDetailed(secret, rawBody, headers = {}, { toleranceSeconds = 300 } = {}) {
  const seedRaw = String(secret || '').replace(/^whsec_/, '').trim();
  if (!seedRaw) return { ok: false, reason: 'no signing secret configured (RESEND_WEBHOOK_SECRET)' };
  let key;
  try { key = Buffer.from(seedRaw, 'base64'); } catch (e) { return { ok: false, reason: 'signing secret is not valid base64' }; }
  if (!key || !key.length) return { ok: false, reason: 'signing secret is empty after base64 decode' };

  const svixId = headers['svix-id'];
  const svixTs = headers['svix-timestamp'];
  const svixSig = headers['svix-signature'];
  if (!svixId) return { ok: false, reason: 'missing svix-id header' };
  if (!svixTs) return { ok: false, reason: 'missing svix-timestamp header' };
  if (!svixSig) return { ok: false, reason: 'missing svix-signature header' };

  const ts = Number(svixTs);
  if (!Number.isFinite(ts)) return { ok: false, reason: `svix-timestamp "${svixTs}" is not a number` };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) {
    return { ok: false, reason: `svix-timestamp ${ts} is outside the ${toleranceSeconds}s tolerance (now ${now})` };
  }

  const signedContent = `${svixId}.${svixTs}.${rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');
  // svix-signature may carry several signatures: "v1,<sig1> v1,<sig2>"
  const entries = String(svixSig).split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    if (constantTimeEqual(expected, sig)) return { ok: true, reason: 'signature verified (HMAC-SHA256)' };
  }
  return { ok: false, reason: 'no svix v1 signature matched the HMAC-SHA256 expected value' };
}

/** Constant-time ASCII comparison for base64 signatures (length check leaks only length). */
function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Extract one header from Resend's received-email response. Real shape
 * (B65 fix, per api-reference/emails/retrieve-received-email): headers is an
 * OBJECT with lowercase keys, e.g. { "message-id": "<…>", references: "<…>" }.
 * The B61 mock shape ([{name, value}]) is also tolerated for tests/back-compat.
 */
function headerValue(headers, name) {
  if (!headers) return null;
  const wanted = String(name).toLowerCase();
  if (Array.isArray(headers)) {
    const found = headers.find((h) => h && String(h.name || '').toLowerCase() === wanted);
    return found ? found.value : null;
  }
  if (typeof headers === 'object') {
    return headers[wanted] != null ? headers[wanted] : (headers[name] != null ? headers[name] : null);
  }
  return null;
}

export class ResendConnector extends Connector {
  static toolName = 'email';
  static toolLabel = 'Email';

  get defaultBaseUrl() { return 'https://api.resend.com'; }

  resolveAuth() {
    const env = {
      apiKey: process.env.RESEND_API_KEY || '',
      from: process.env.RESEND_FROM || '',
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET || '',
      receivingAddress: process.env.RESEND_RECEIVING_ADDRESS || '',
    };
    // Env wins ONLY when actually set — an unset env var must never clobber
    // a configured value.
    const merged = { ...this.config.auth };
    for (const [k, v] of Object.entries(env)) if (v) merged[k] = v;
    assertAsciiSecret(merged.apiKey, 'RESEND_API_KEY');
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

  /** Health: real domains call + inbound-readiness note (Svix secret present). */
  async healthCheck() {
    let note = '';
    try {
      const auth = this.resolveAuth();
      note = auth.webhookSecret ? 'inbound ready (Svix secret set)' : 'inbound needs RESEND_WEBHOOK_SECRET';
      const ok = await this.authenticate();
      return { status: ok ? 'ok' : 'error', detail: ok ? `authenticated with the provider · ${note}` : 'authentication failed' };
    } catch (e) {
      return { status: 'error', detail: (e && e.message) || String(e), code: e && e.code };
    }
  }

  /**
   * send(payload):
   *   { from?: "Name <email>" | { email, name? }, to: 'a@b.c' | ['a@b.c'] | [{email}],
   *     subject, text?, html?, reply_to?, headers? }
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
      ...(payload.reply_to ? { reply_to: payload.reply_to } : {}),
      ...(payload.headers && typeof payload.headers === 'object' ? { headers: payload.headers } : {}),
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

  /** Svix-signed inbound webhook (email.received). Returns true when valid. */
  verifyWebhookSignature(rawBody, headers = {}) {
    const auth = this.resolveAuth();
    if (!auth.webhookSecret) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'Resend webhook verification needs RESEND_WEBHOOK_SECRET', { provider: this.label });
    return verifySvixSignature(auth.webhookSecret, rawBody, headers);
  }

  /** B64 — detailed variant for diagnosable rejections: { ok, reason }. */
  verifyWebhookSignatureResult(rawBody, headers = {}) {
    const auth = this.resolveAuth();
    if (!auth.webhookSecret) return { ok: false, reason: 'RESEND_WEBHOOK_SECRET is not set' };
    return verifySvixSignatureDetailed(auth.webhookSecret, rawBody, headers);
  }

  /**
   * Fetch the full received email (webhook events carry metadata only).
   * B65 FIX: the Received-emails endpoint is GET /emails/receiving/:email_id
   * — B61 used /emails/:email_id (the SENT-email endpoint), which 404s for
   * received ids, so the body was never fetched (silently swallowed by
   * receive()). Matches api-reference/emails/retrieve-received-email.
   */
  async fetchEmail(emailId) {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    if (!emailId) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'fetchEmail requires an email id', { provider: this.label });
    const { data } = await httpJson(`${this.baseUrl}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${auth.apiKey}` },
      provider: 'Resend API',
      timeout: this.requestTimeoutMs,
    });
    return data || null;
  }

  /**
   * Normalize ONE inbound webhook event into the internal message shape.
   * The `email.received` event carries metadata only (per Resend's current
   * docs: "Webhooks do not include the email body, headers, or attachments…
   * You must call the Received emails API"); callers that want the body call
   * fetchEmail() and pass the result as `full`.
   */
  normalizeInboundEvent(ev, full) {
    const data = (ev && ev.data) || {};
    const f = full || {};
    const headers = f.headers || data.headers || [];
    const messageId = f.message_id || headerValue(headers, 'Message-ID') || data.message_id || null;
    const inReplyTo = headerValue(headers, 'In-Reply-To') || null;
    const references = headerValue(headers, 'References') || null;
    const to = Array.isArray(f.to) ? f.to : Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []);
    const isReceived = ev.type === 'email.received';
    // B65: Resend's received-email response carries text/html at TOP LEVEL
    // (the B61 mock's body:{} nesting was wrong — tolerate both).
    const text = f.text || (f.body && f.body.text) || (data.body && data.body.plain) || null;
    const html = f.html || (f.body && f.body.html) || null;
    const from = f.from || data.from || null;
    // B66 — creator recognition: emails from JEXI's creator (Lewis) are
    // flagged so the reply loop and any consumer can treat them with the
    // right tone/priority. Pure metadata — no approval/safety bypass.
    return {
      id: f.id || data.email_id || null,
      provider: 'resend',
      type: isReceived ? 'inbound' : (ev.type || ev.event || 'unknown'),
      from,
      creator: isCreatorEmail(from),
      to,
      subject: f.subject || data.subject || null,
      text,
      html,
      messageId,
      inReplyTo,
      references,
      timestamp: (f.created_at || data.created_at) ? new Date(String(f.created_at || data.created_at)).toISOString() : null,
      raw: ev,
    };
  }

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

  /** receive(): normalize inbound webhook payload(s), fetching bodies. */
  async receive(inbound) {
    if (!inbound) return [];
    const list = Array.isArray(inbound) ? inbound : [inbound];
    const events = [];
    for (const ev of list) {
      if (ev.type === 'email.received') {
        let full = null;
        try { full = await this.fetchEmail((ev.data && ev.data.email_id) || ev.email_id); } catch (e) { /* keep metadata-only event */ }
        events.push(this.normalizeInboundEvent(ev, full));
      } else {
        // Delivery/bounce/drop events — classify honestly, never as deliveries.
        events.push(this.normalizeInboundEvent(ev, null));
      }
    }
    return events;
  }

  /* ------------------------------ reply ------------------------------ */

  /**
   * reply(payload): respond to a specific inbound email on the same thread.
   *   { email_id: string, to?: string, subject?: string, text: string,
   *     html?: string, quoteOriginal?: boolean (default true), from?: string }
   *
   * When email_id is given the original is fetched: sender becomes the To,
   * our receiving address becomes the From, the subject gets a "Re:" prefix,
   * In-Reply-To / References are set from the original Message-ID, and the
   * original body is quoted (optional). Returns Resend's real message id.
   */
  async reply(payload = {}) {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    const { email_id, to, subject, text, html, quoteOriginal = true, from } = payload;
    if (!email_id && !to) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email reply requires email_id (to fetch the original) or to', { provider: this.label });
    if (!text && !html) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email reply requires text or html', { provider: this.label });

    let original = null;
    if (email_id) original = await this.fetchEmail(email_id);

    const headersList = original && original.headers;
    const originalMsgId = (original && (original.message_id || headerValue(headersList, 'Message-ID'))) || null;
    const originalRefs = (original && headerValue(headersList, 'References')) || '';
    const origSubject = String((original && original.subject) || subject || '');

    // Clean subject: strip an existing "Re:"/"Fwd:" prefix, then add one "Re:".
    const clean = origSubject.replace(/^(re|fwd?|aw|sv|antw):\s*/i, '');
    const finalSubject = subject || (clean ? `Re: ${clean}` : 'Re: your message');

    // To = original sender (unless overridden). From chain: explicit from →
    // RESEND_FROM (verified sender) → RESEND_RECEIVING_ADDRESS (when set to a
    // VERIFIED domain) → Resend's documented test sender. B65 fix: the
    // resend.app receiving address must NOT be the From — that domain is not
    // verified for sending, so it 403s (proven live). Thread continuity is
    // preserved via reply_to instead.
    const toAddr = to || (original && original.from) || '';
    if (!toAddr) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Email reply could not resolve the original sender', { provider: this.label });
    const originalRecipient = Array.isArray(original && original.to) && original.to.length ? original.to[0] : null;
    const fromAddr = from || auth.from || auth.receivingAddress || 'JEXI OS <onboarding@resend.dev>';

    // Threading headers: continue the same thread, not a new one.
    const headers = {};
    if (originalMsgId) {
      headers['In-Reply-To'] = originalMsgId;
      headers.References = (originalRefs ? `${originalRefs} ` : '') + originalMsgId;
    }

    let finalText = text;
    // B65: quote the original from top-level text/html (real Resend shape);
    // tolerate the old nested body shape for back-compat.
    const origBody = original && (original.text || original.html || (original.body && (original.body.text || original.body.html)) || '');
    if (quoteOriginal && original && origBody) {
      const quoted = String(origBody).split('\n').map((l) => `> ${l}`).join('\n');
      finalText = `${text}\n\n${quoted}`;
    }

    const body = {
      from: fromAddr,
      to: [toAddr],
      subject: finalSubject,
      headers,
      ...(finalText ? { text: String(finalText) } : {}),
      ...(html ? { html: String(html) } : {}),
      // Replies keep coming to our receiving address (thread continuity).
      ...(originalRecipient ? { reply_to: originalRecipient } : {}),
    };

    const { status, data } = await httpJson(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.apiKey}`, 'Content-Type': 'application/json' },
      body,
      provider: 'Resend API',
      timeout: this.requestTimeoutMs,
    });
    if (!data || !data.id) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'Resend reply returned a response without an email id', { status, provider: this.label, cause: data });
    }
    return { ok: true, provider: 'resend', message_id: data.id, status, subject: finalSubject, in_reply_to: originalMsgId };
  }

  static sendSchema() {
    return {
      from: { type: 'string', desc: 'Sender "Name <email>" (falls back to RESEND_FROM / defaultFrom)' },
      to: { type: 'array', desc: 'Recipient email(s): string, array of strings, or [{ email }]' },
      subject: { type: 'string', required: true, desc: 'Email subject' },
      text: { type: 'string', desc: 'Plain-text body' },
      html: { type: 'string', desc: 'Optional HTML body' },
      reply_to: { type: 'string', desc: 'Reply-To address (thread continuity)' },
    };
  }
}

export function registerEmailConnector(config) {
  return ConnectorRegistry.register('email', new ResendConnector(config instanceof ConnectorConfig ? config : new ConnectorConfig(config)));
}
