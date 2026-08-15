/**
 * JEXI OS — WhatsApp Connector (Build 56).
 *
 * Meta WhatsApp Business Cloud API. Real wire format:
 *   send      → POST https://graph.facebook.com/{version}/{phone_number_id}/messages
 *   auth      → GET  https://graph.facebook.com/{version}/{phone_number_id}
 *   receive   → webhook POST with X-Hub-Signature-256 (HMAC-SHA256 over the
 *               RAW body using the app secret) + the GET hub.challenge
 *               verification handshake Meta requires.
 *
 * Credentials (env wins over Settings-stored values):
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET,
 *   WHATSAPP_VERIFY_TOKEN, WHATSAPP_API_VERSION (default v21.0)
 *
 * B57: the un-prefixed names (PHONE_NUMBER_ID, APP_SECRET, VERIFY_TOKEN)
 * are accepted as fallbacks for the WHATSAPP_* forms, so Render setups that
 * already export the short names work unchanged.
 */

import { Connector, ConnectorConfig, ConnectorError, ERROR_CODES, httpJson, createHmacSha256 } from './ConnectorBase.js';
import { ConnectorRegistry } from './ConnectorRegistry.js';

export class WhatsAppConnector extends Connector {
  static toolName = 'whatsapp';
  static toolLabel = 'WhatsApp';

  get defaultBaseUrl() { return 'https://graph.facebook.com'; }
  get apiVersion() { return this.config.auth.apiVersion || 'v21.0'; }
  get phoneNumberId() { return this.config.auth.phoneNumberId || ''; }

  /** Resolve auth: environment first, then the stored settings config. */
  resolveAuth() {
    const env = {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || '',
      appSecret: process.env.WHATSAPP_APP_SECRET || process.env.APP_SECRET || '',
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || '',
      apiVersion: process.env.WHATSAPP_API_VERSION || this.config.auth.apiVersion || 'v21.0',
    };
    // Env wins ONLY when actually set — an unset env var must never clobber
    // a configured value.
    const merged = { ...this.config.auth };
    for (const [k, v] of Object.entries(env)) if (v) merged[k] = v;
    return merged;
  }

  assertAuth(auth) {
    if (!auth.accessToken) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'WhatsApp is not configured — set WHATSAPP_ACCESS_TOKEN (and WHATSAPP_PHONE_NUMBER_ID / PHONE_NUMBER_ID)', { provider: this.label });
    if (!auth.phoneNumberId) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'WhatsApp is not configured — set WHATSAPP_PHONE_NUMBER_ID / PHONE_NUMBER_ID', { provider: this.label });
  }

  /** Actually call the Graph API — a key being present is not enough. */
  async authenticate() {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    const { data } = await httpJson(
      `${this.baseUrl}/${auth.apiVersion || this.apiVersion}/${auth.phoneNumberId}?fields=id,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` }, provider: 'WhatsApp Graph API', timeout: this.requestTimeoutMs }
    );
    if (!data || !data.id) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'WhatsApp auth returned a response without a phone-number id', { provider: this.label, cause: data });
    }
    return true;
  }

  /**
   * send(payload):
   *   { to: '15551234567', type: 'text', text: 'Hello' }
   *   { to, type: 'template', template: { name, language, components? } }
   *   { to, type: 'media', media: { kind: 'image'|'audio'|'document'|'video'|'sticker', link, caption? } }
   * Returns the provider's real response (wamid etc).
   */
  async send(payload = {}) {
    const auth = this.resolveAuth();
    this.assertAuth(auth);
    const { to, type = 'text', text, template, media } = payload;
    if (!to) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'WhatsApp send requires "to" (E.164 number)', { provider: this.label });

    let body;
    if (type === 'template') {
      if (!template || !template.name) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'WhatsApp template send requires template.name', { provider: this.label });
      body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: { name: template.name, language: { code: template.language || 'en_US' }, ...(template.components ? { components: template.components } : {}) } };
    } else if (type === 'media') {
      if (!media || !media.kind || !media.link) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'WhatsApp media send requires media.kind + media.link', { provider: this.label });
      body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: media.kind, [media.kind]: { link: media.link, ...(media.caption ? { caption: media.caption } : {}) } };
    } else {
      if (!text) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'WhatsApp text send requires payload.text', { provider: this.label });
      body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: String(text) } };
    }

    const { status, data } = await httpJson(
      `${this.baseUrl}/${auth.apiVersion || this.apiVersion}/${auth.phoneNumberId}/messages`,
      { method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' }, body, provider: 'WhatsApp Graph API', timeout: this.requestTimeoutMs }
    );
    if (!data || !data.messages) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'WhatsApp send returned a response without a message id', { status, provider: this.label, cause: data });
    }
    return { ok: true, provider: 'whatsapp', wamid: data.messages[0] && data.messages[0].id, status };
  }

  /* ------------------------- webhook / receive ------------------------- */

  /** Meta verification handshake: GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… */
  handleWebhookVerification(query = {}) {
    if (query['hub.mode'] !== 'subscribe') return { verified: false, reason: 'hub.mode is not subscribe' };
    const auth = this.resolveAuth();
    if (query['hub.verify_token'] !== auth.verifyToken) return { verified: false, reason: 'hub.verify_token mismatch' };
    return { verified: true, challenge: query['hub.challenge'] || '' };
  }

  /**
   * Verify X-Hub-Signature-256 = HMAC-SHA256(appSecret, rawBody) hex.
   * Accepts the raw signature string OR the full headers object (the webhook
   * dispatcher passes headers; the tests pass the bare string).
   */
  verifyWebhookSignature(rawBody, signatureHeader) {
    const auth = this.resolveAuth();
    if (!auth.appSecret) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'WhatsApp webhook verification needs WHATSAPP_APP_SECRET', { provider: this.label });
    const sig = typeof signatureHeader === 'string'
      ? signatureHeader
      : (signatureHeader && (signatureHeader['x-hub-signature-256'] || signatureHeader['x-hub-signature'])) || '';
    if (!sig) return false;
    const expected = createHmacSha256(auth.appSecret, rawBody);
    const provided = String(sig).replace(/^sha256=/, '');
    return expected === provided;
  }

  /** Parse a standard WhatsApp webhook payload into normalized events. */
  normalizeInbound(body) {
    const events = [];
    const entries = (body && body.entry) || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const to = value.metadata && value.metadata.phone_number_id;
        const contacts = (value.contacts || []).map((c) => c.wa_id);
        for (const msg of value.messages || []) {
          let content = '';
          let media = null;
          if (msg.type === 'text' && msg.text) content = msg.text.body || '';
          else if (msg.type === 'button' && msg.button) content = msg.button.text || '';
          else if (msg.type === 'interactive' && msg.interactive && msg.interactive.button_reply) content = msg.interactive.button_reply.title || '';
          else if (msg.type && msg[msg.type]) media = { type: msg.type, id: msg[msg.type].id || null };
          events.push({
            id: msg.id || null,
            provider: 'whatsapp',
            from: msg.from || null,
            to: to || null,
            contactWaId: contacts[0] || null,
            type: msg.type || 'unknown',
            text: content,
            media,
            timestamp: msg.timestamp ? Number(msg.timestamp) * 1000 : null,
            raw: msg,
          });
        }
      }
    }
    return events;
  }

  /** receive(): normalize a webhook payload (or [] for a status update). */
  async receive(inbound) {
    return this.normalizeInbound(inbound || {});
  }

  static sendSchema() {
    return {
      to: { type: 'string', required: true, desc: 'Recipient in E.164 format, e.g. 15551234567' },
      type: { type: 'string', desc: "Message type: 'text' (default), 'template' or 'media'" },
      text: { type: 'string', desc: 'Body text (required when type=text)' },
      template: { type: 'object', desc: '{ name, language?, components? } — required when type=template' },
      media: { type: 'object', desc: '{ kind: image|audio|document|video|sticker, link, caption? } — required when type=media' },
    };
  }
}

export function registerWhatsAppConnector(config) {
  return ConnectorRegistry.register('whatsapp', new WhatsAppConnector(config instanceof ConnectorConfig ? config : new ConnectorConfig(config)));
}
