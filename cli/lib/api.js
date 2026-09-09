/**
 * JEXI CLI — backend HTTP client (zero deps, global fetch).
 *
 * Talks to a local (or remote) JEXI brain: health, unified model config,
 * NDJSON chat streams, missions, one-time secrets. `fetchImpl` is injectable
 * for offline tests.
 */

export class JexiApi {
  constructor({ baseUrl, session = 'cli', fetchImpl = null } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.session = session;
    this.fetch = fetchImpl || fetch;
  }

  headers(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'x-jexi-session': this.session,
      ...extra,
    };
  }

  async get(path) {
    const res = await this.fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    return this.#asJson(res);
  }

  async post(path, body = {}) {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.#asJson(res);
  }

  async del(path) {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    return this.#asJson(res);
  }

  async #asJson(res) {
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 500) }; }
    return { status: res.status, ok: res.ok, data };
  }

  health() { return this.get('/api/health'); }
  providersCatalog() { return this.get('/api/providers/catalog'); }
  providersActive() { return this.get('/api/providers/active'); }
  configureProvider(body) { return this.post('/api/providers/configure', body); }
  secretsAnswer(body) { return this.post('/api/secrets/answer', body); }
  createMission(body) { return this.post('/api/missions', body); }
  missionSnapshot(id) { return this.get(`/api/missions/${encodeURIComponent(id)}`); }
  missionEvents(id, since = '') { return this.get(`/api/missions/${encodeURIComponent(id)}/events?sinceEventId=${encodeURIComponent(since)}`); }

  /**
   * POST /api/chat and stream NDJSON events to onEvent(evt).
   * Resolves { done: <terminal event|null>, events: count }.
   */
  async chatStream(query, { image = null, onEvent = null, signal = null } = {}) {
    const res = await this.fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(image ? { query, image } : { query }),
      signal,
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      throw new Error(`chat failed (HTTP ${res.status}): ${t.slice(0, 300) || res.statusText}`);
    }
    const parser = new NdjsonParser((evt) => { try { onEvent?.(evt); } catch {} });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.flush();
    return { done: parser.terminal, events: parser.count };
  }
}

/**
 * Incremental NDJSON parser. Remembers the terminal event
 * (type 'done' | 'error' | 'agent.done') for the caller.
 */
export class NdjsonParser {
  constructor(onEvent = null) {
    this.onEvent = onEvent;
    this.buf = '';
    this.count = 0;
    this.terminal = null;
  }

  push(chunk) {
    this.buf += String(chunk || '');
    const lines = this.buf.split('\n');
    this.buf = lines.pop() || '';
    for (const line of lines) this.#handleLine(line);
  }

  flush() {
    if (this.buf.trim()) this.#handleLine(this.buf);
    this.buf = '';
  }

  #handleLine(line) {
    const t = line.trim();
    if (!t) return;
    let evt;
    try { evt = JSON.parse(t); } catch { return; } // partial line — drop honestly
    this.count += 1;
    if (evt && (evt.type === 'done' || evt.type === 'error' || evt.type === 'agent.done')) this.terminal = evt;
    try { this.onEvent?.(evt); } catch { /* consumer must never break the stream */ }
  }
}
