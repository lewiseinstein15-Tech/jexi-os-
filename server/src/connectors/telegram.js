/**
 * JEXI OS — Telegram Connector (Build 56).
 *
 * "Others" target picked for the connector pattern: Telegram Bot API.
 *   auth    → GET  https://api.telegram.org/bot<token>/getMe
 *   send    → POST /bot<token>/sendMessage | sendPhoto | sendDocument
 *   receive → webhook POST (verified by X-Telegram-Bot-Api-Secret-Token) or
 *             getUpdates long-polling; both normalized to the same shape.
 *
 * Credentials: TELEGRAM_BOT_TOKEN, TELEGRAM_SECRET_TOKEN (webhook only).
 */

import { Connector, ConnectorConfig, ConnectorError, ERROR_CODES, httpJson } from './ConnectorBase.js';
import { ConnectorRegistry } from './ConnectorRegistry.js';

export class TelegramConnector extends Connector {
  static toolName = 'telegram';
  static toolLabel = 'Telegram';

  get defaultBaseUrl() { return 'https://api.telegram.org'; }

  resolveAuth() {
    const env = {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      secretToken: process.env.TELEGRAM_SECRET_TOKEN || '',
    };
    // Env wins ONLY when actually set — an unset env var must never clobber
    // a configured value.
    const merged = { ...this.config.auth };
    for (const [k, v] of Object.entries(env)) if (v) merged[k] = v;
    return merged;
  }

  get botUrl() {
    const auth = this.resolveAuth();
    return `${this.baseUrl}/bot${auth.botToken}`;
  }

  /** Actually call the Bot API — getMe returns the bot identity or 401. */
  async authenticate() {
    const auth = this.resolveAuth();
    if (!auth.botToken) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'Telegram is not configured — set TELEGRAM_BOT_TOKEN', { provider: this.label });
    const { data } = await httpJson(`${this.botUrl}/getMe`, { provider: 'Telegram Bot API', timeout: this.requestTimeoutMs });
    if (!data || data.ok !== true || !data.result) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'Telegram getMe returned an unexpected shape', { provider: this.label, cause: data });
    }
    return true;
  }

  /**
   * send(payload):
   *   { chat_id, text, parse_mode? }                        → sendMessage
   *   { chat_id, photo: url|file_id, caption? }             → sendPhoto
   *   { chat_id, document: url|file_id, caption? }          → sendDocument
   */
  async send(payload = {}) {
    const { chat_id, text, photo, document, caption, parse_mode } = payload;
    if (chat_id === undefined || chat_id === null) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Telegram send requires chat_id', { provider: this.label });

    let method;
    let body;
    if (photo) { method = 'sendPhoto'; body = { chat_id, photo, ...(caption ? { caption } : {}) }; }
    else if (document) { method = 'sendDocument'; body = { chat_id, document, ...(caption ? { caption } : {}) }; }
    else {
      if (!text) throw new ConnectorError(ERROR_CODES.PROVIDER_ERROR, 'Telegram send requires text (or photo/document)', { provider: this.label });
      method = 'sendMessage';
      body = { chat_id, text: String(text), ...(parse_mode ? { parse_mode } : {}) };
    }

    const { status, data } = await httpJson(`${this.botUrl}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, provider: 'Telegram Bot API', timeout: this.requestTimeoutMs });
    if (!data || data.ok !== true || !data.result) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'Telegram send returned an unexpected shape', { status, provider: this.label, cause: data });
    }
    return { ok: true, provider: 'telegram', method, message_id: data.result.message_id, status };
  }

  /* ------------------------- webhook / receive ------------------------- */

  /** Webhook verification: X-Telegram-Bot-Api-Secret-Token header match. */
  verifyWebhookSecret(headers = {}) {
    const auth = this.resolveAuth();
    if (!auth.secretToken) throw new ConnectorError(ERROR_CODES.NOT_CONFIGURED, 'Telegram webhook verification needs TELEGRAM_SECRET_TOKEN', { provider: this.label });
    return headers['x-telegram-bot-api-secret-token'] === auth.secretToken;
  }

  /** Normalize a Bot API update into the internal event shape. */
  normalizeInbound(update) {
    if (!update) return [];
    const msg = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
    if (!msg) return [];
    return [{
      id: String(update.update_id != null ? update.update_id : ''),
      provider: 'telegram',
      chat: msg.chat ? { id: msg.chat.id, type: msg.chat.type, title: msg.chat.title || null } : null,
      from: msg.from ? { id: msg.from.id, username: msg.from.username || null, first_name: msg.from.first_name || null } : null,
      type: msg.text != null ? 'text' : msg.photo ? 'photo' : msg.document ? 'document' : 'other',
      text: msg.text || msg.caption || '',
      date: msg.date ? new Date(Number(msg.date) * 1000).toISOString() : null,
      raw: msg,
    }];
  }

  /** Poll getUpdates (offset-based) — returns normalized events. */
  async receive(inbound) {
    if (inbound && inbound.update_id !== undefined) return this.normalizeInbound(inbound);
    if (inbound && Array.isArray(inbound)) return inbound.flatMap((u) => this.normalizeInbound(u));
    if (inbound && inbound.body) return this.normalizeInbound(inbound.body);
    // Poll mode: no inbound argument → call getUpdates.
    const offset = Number((inbound && inbound.offset) || 0);
    const { data } = await httpJson(`${this.botUrl}/getUpdates?timeout=0${offset ? `&offset=${offset}` : ''}`, { provider: 'Telegram Bot API', timeout: this.requestTimeoutMs });
    if (!data || data.ok !== true) {
      throw new ConnectorError(ERROR_CODES.MALFORMED_RESPONSE, 'Telegram getUpdates returned an unexpected shape', { provider: this.label, cause: data });
    }
    return (data.result || []).flatMap((u) => this.normalizeInbound(u));
  }

  static sendSchema() {
    return {
      chat_id: { type: 'number', required: true, desc: 'Telegram chat/user id' },
      text: { type: 'string', desc: 'Message text (sendMessage)' },
      parse_mode: { type: 'string', desc: 'Markdown | HTML (optional)' },
      photo: { type: 'string', desc: 'Photo URL or file_id (sendPhoto)' },
      document: { type: 'string', desc: 'Document URL or file_id (sendDocument)' },
      caption: { type: 'string', desc: 'Caption for photo/document' },
    };
  }
}

export function registerTelegramConnector(config) {
  return ConnectorRegistry.register('telegram', new TelegramConnector(config instanceof ConnectorConfig ? config : new ConnectorConfig(config)));
}
