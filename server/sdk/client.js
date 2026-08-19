/**
 * B140 — JEXI SDK CLIENT (DeepSeek Harness `packages/sdk/client` mirror,
 * JEXI-branded).
 *
 * Scriptable JEXI client: talk to a JEXI backend (local or the hosted
 * Render brain) from any Node script. Handles the access key, NDJSON chat
 * streams, and error normalization.
 *
 *   import { JexiClient } from './sdk/client.js';
 *   const jexi = new JexiClient({ baseUrl, key });
 *   const answer = await jexi.chat('what time is it in Nairobi?');
 *   const health = await jexi.health();
 *   const tools = await jexi.tools();
 */

const DEFAULT_BASE = 'http://127.0.0.1:3002';

export class JexiClient {
  constructor({ baseUrl = DEFAULT_BASE, key = null, timeoutMs = 60000 } = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    this.key = key || process.env.JEXI_API_KEY || '';
    this.timeoutMs = timeoutMs;
  }

  _headers(extra = {}) {
    return { 'Content-Type': 'application/json', ...(this.key ? { 'x-jexi-key': this.key } : {}), ...extra };
  }

  async _fetch(path, { method = 'GET', body = null, headers = {} } = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this._headers(headers),
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /** GET /api/health */
  async health() {
    return this._fetch('/api/health');
  }

  /** Full tool catalog (registry + plugin tools). */
  async tools() {
    return this._fetch('/api/plugins/inventory');
  }

  /** One chat turn → final answer text (streams internally, returns the summary). */
  async chat(query, { conv = null, persona = null } = {}) {
    const body = { query, ...(conv ? { convId: conv } : {}) };
    const headers = { ...(persona ? { 'x-jexi-persona': persona } : {}) };
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this._headers(headers),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs * 3),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`chat HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    // NDJSON event stream: collect the final done event.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let summary = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'done') summary = ev;
        } catch { /* partial frame */ }
      }
    }
    if (!summary) throw new Error('chat stream ended without a done event');
    if (summary.success === false) throw new Error(summary.error || 'chat failed');
    return summary.summary || '';
  }

  /** List conversations. */
  async conversations() {
    return this._fetch('/api/conversations');
  }
}

/** Tiny smoke check used by the headless CLI --self-test. */
export function sdkSelfCheck() {
  const checks = [];
  const client = new JexiClient({ baseUrl: 'http://127.0.0.1:1' }); // unreachable on purpose
  checks.push({ name: 'sdk client constructed', ok: client.baseUrl === 'http://127.0.0.1:1' });
  checks.push({ name: 'sdk key from env', ok: new JexiClient({}).key === (process.env.JEXI_API_KEY || '') });
  return checks;
}
