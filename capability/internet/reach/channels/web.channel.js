// Phase 11 Scope D — WebChannel: the universal fallback (Jina Reader).
//
// can_handle() → true for anything (the registry keeps it LAST so platform
// channels match first). read() fetches https://r.jina.ai/<url> and returns
// markdown text. Anti-bot responses (captcha / Cloudflare challenge) are a
// SPECIFIC error — never returned as content.

import https from 'node:https';
import http from 'node:http';
import { Channel } from './base.channel.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export class AntibotDetectedError extends Error {
  constructor(marker) {
    super(`anti-bot challenge page detected (${marker}) — refusing to return challenge content`);
    this.code = 'ANTIBOT_DETECTED';
    this.marker = marker;
  }
}

export function normalizePublicHttpUrl(raw) {
  const u = String(raw || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; // non-http scheme — attempted as-is, fails honestly
  return `https://${u}`;
}

/** Recognize high-confidence Jina/Cloudflare challenge responses (upstream markers,
 *  plus raw-HTML title variants in case a backend bypasses the markdown renderer). */
export function isAntibotPage(body) {
  const sample = String(body || '').slice(0, 4096).toLowerCase();
  const jinaCaptcha = sample.includes('warning:') && sample.includes('requiring captcha');
  const challengeStructure = [
    'title: just a moment...', '<title>just a moment',
    '## performing security verification', 'performing security verification',
    'title: attention required! | cloudflare', '<title>attention required',
  ].some((m) => sample.includes(m));
  const cloudflareBlock = sample.includes('title: attention required! | cloudflare')
    && (sample.includes('ray id') || sample.includes('/cdn-cgi/challenge-platform/'));
  return (jinaCaptcha && challengeStructure) || cloudflareBlock;
}

/** GET (with redirects) — resolve({status, headers, body, truncated}) | reject(Error). ALWAYS settles. */
export function httpGet(url, { timeoutMs = 15000, maxBytes = 5 * 1024 * 1024, headers = {}, fetchImpl = null } = {}) {
  if (fetchImpl) return fetchImpl(url, { timeoutMs, maxBytes, headers });
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = (/^http:/.test(url) ? http : https).get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/plain, text/markdown, */*', ...headers },
      timeout: timeoutMs,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let next;
        try {
          next = new URL(res.headers.location, url).toString();
        } catch (err) {
          return done(reject, new Error(`bad redirect location "${res.headers.location}" from ${url}`));
        }
        return httpGet(next, { timeoutMs, maxBytes, headers, fetchImpl }).then((v) => done(resolve, v), (e) => done(reject, e));
      }
      const chunks = [];
      let total = 0;
      let overLimit = false;
      res.on('data', (c) => {
        total += c.length;
        if (total <= maxBytes) chunks.push(c);
        else {
          overLimit = true;
          res.destroy(); // 'close' below settles the promise (truncated)
        }
      });
      res.on('end', () => done(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncated: overLimit }));
      res.on('error', (e) => done(reject, overLimit ? { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncated: true } : e));
      res.on('close', () => {
        if (!settled) done(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncated: overLimit });
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); });
    req.on('error', (e) => done(reject, e));
  });
}

export class WebChannel extends Channel {
  name = 'web';
  description = 'any web page via Jina Reader (universal fallback)';
  backends = ['Jina Reader'];
  tier = 0;

  can_handle(_url) {
    return true; // fallback — the registry keeps this channel LAST
  }

  async read(url, cfg = {}) {
    const ordered = this.ordered_backends(cfg);
    const attempts = [];
    for (const backend of ordered.list) {
      if (backend !== 'Jina Reader') {
        attempts.push({ backend, ok: false, error: `${backend}: BACKEND_NOT_FOUND (not implemented for channel "${this.name}")` });
        continue;
      }
      const target = normalizePublicHttpUrl(url);
      const jinaUrl = `https://r.jina.ai/${target}`;
      try {
        const res = await httpGet(jinaUrl, {
          timeoutMs: typeof cfg.get === 'function' ? cfg.get('read_timeout_ms') : 15000,
          maxBytes: typeof cfg.get === 'function' ? cfg.get('max_bytes') : 5 * 1024 * 1024,
          fetchImpl: cfg.fetchImpl,
        });
        if (res.status !== 200) {
          attempts.push({ backend, ok: false, error: `Jina Reader HTTP ${res.status} for ${target}` });
          continue;
        }
        if (isAntibotPage(res.body)) {
          attempts.push({ backend, ok: false, error: 'anti-bot challenge page' });
          const err = new AntibotDetectedError(res.body.slice(0, 120).replace(/\s+/g, ' '));
          err.attempts = attempts;
          throw err;
        }
        this.active_backend = backend;
        return {
          ok: true,
          channel: this.name,
          backend,
          url: target,
          via: jinaUrl,
          bytes: Buffer.byteLength(res.body),
          truncated: !!res.truncated,
          override: ordered.override ? { value: ordered.override, applied: ordered.applied, unknown: !!ordered.unknown } : null,
          attempts,
          content: res.body,
        };
      } catch (err) {
        if (err instanceof AntibotDetectedError) throw err;
        attempts.push({ backend, ok: false, error: err.message });
      }
    }
    const e = new Error(`web channel exhausted its backends: ${attempts.map((a) => a.error).join(' | ')}`);
    e.code = 'ALL_BACKENDS_FAILED';
    e.attempts = attempts;
    throw e;
  }

  async search(query, cfg = {}) {
    // Keyless search: Jina Reader over DuckDuckGo's HTML endpoint.
    const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(query))}`;
    const res = await this.read(target, cfg);
    const results = [...res.content.matchAll(/\[([^\]]{6,140})\]\((https?:\/\/[^)]+)\)/g)]
      .slice(0, 15)
      .map((m) => ({ title: m[1].replace(/\s+/g, ' ').trim(), url: m[2] }));
    return { ok: true, channel: this.name, backend: res.backend, query, results };
  }

  async check(cfg = {}) {
    // REAL probe: a tiny live request through the actual backend path.
    try {
      const res = await httpGet('https://r.jina.ai/https://example.com', { timeoutMs: 8000, maxBytes: 64 * 1024, fetchImpl: cfg.fetchImpl });
      if (res.status === 200 && !isAntibotPage(res.body)) {
        this.active_backend = this.backends[0];
        return { status: 'ok', message: `Jina Reader reachable (HTTP ${res.status}, ${Buffer.byteLength(res.body)} B probe)` };
      }
      this.active_backend = null;
      return { status: 'error', message: `Jina Reader probe returned HTTP ${res.status}` };
    } catch (err) {
      this.active_backend = null;
      return { status: 'error', message: `Jina Reader probe failed: ${err.message}` };
    }
  }
}
