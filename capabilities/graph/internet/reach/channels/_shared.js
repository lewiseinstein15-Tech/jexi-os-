// Phase 11 Scope E — shared helpers for platform channels.
// Real fetches, honest failures. No placeholder content anywhere.

import { httpGet } from './web.channel.js';

export { httpGet };

export class AuthRequiredError extends Error {
  constructor(platform, detail = '') {
    super(`AUTH_REQUIRED: ${platform} gates this content behind login${detail ? ` (${detail})` : ''}`);
    this.code = 'AUTH_REQUIRED';
  }
}

export class RuntimeMissingError extends Error {
  constructor(backend, detail = '') {
    super(`RUNTIME_MISSING: backend "${backend}" is not installed${detail ? ` — ${detail}` : ''}`);
    this.code = 'RUNTIME_MISSING';
  }
}

export class FetchFailError extends Error {
  constructor(statusOrMessage, url) {
    super(`FETCH_FAILED: ${statusOrMessage} (${url})`);
    this.code = 'FETCH_FAILED';
  }
}

export function hostMatches(url, hosts) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** GET → parsed JSON; throws FetchFailError with status on non-2xx. */
export async function jsonFetch(url, opts = {}) {
  const res = await httpGet(url, opts);
  if (res.status < 200 || res.status >= 300) throw new FetchFailError(`HTTP ${res.status}`, url);
  try {
    return JSON.parse(res.body);
  } catch {
    throw new FetchFailError('response is not JSON', url);
  }
}

/** Naive HTML → text (scripts/styles stripped, tags dropped, entities decoded). */
export function textFromHtml(html, maxLen = 4000) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function loginWallDetected(body, extraMarkers = []) {
  const s = String(body || '').slice(0, 6000).toLowerCase();
  return [
    'sign up to see', 'log in to see', 'log into instagram', 'login • instagram', 'you must log in to continue',
    'authwall', '扫码登录', '登录后', '请登录', 'verify to continue', 'join linkedin',
    ...extraMarkers,
  ].some((m) => s.includes(m));
}

/**
 * Real check probe: GET a probe URL and classify by predicate.
 * okWhen(status, body) → {status:'ok'|'warn'|'error', message}
 */
export function probeCheck(url, okWhen, { timeoutMs = 8000, maxBytes = 256 * 1024 } = {}) {
  return async function realProbe() {
    // Hard-settle guard: a check() can NEVER hang the doctor, even if a host
    // stalls in a way httpGet cannot abort. Always resolves a status object.
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'error', message: `probe timed out after ${timeoutMs}ms (host did not settle)` }), timeoutMs + 2000);
    });
    try {
      const attempt = (async () => {
        const res = await httpGet(url, { timeoutMs, maxBytes });
        return okWhen(res.status, res.body);
      })();
      return await Promise.race([attempt, deadline]);
    } catch (err) {
      return { status: 'error', message: `probe failed: ${String(err.message).slice(0, 120)}` };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Generic site-restricted keyless search (Jina over DuckDuckGo HTML). */
export async function siteSearch(query, site, cfg = {}, channelName = '') {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${site} ${query}`)}`;
  const res = await httpGet(`https://r.jina.ai/${target}`, { timeoutMs: 15000 });
  if (res.status !== 200) throw new FetchFailError(`HTTP ${res.status}`, 'ddg');
  const results = [...res.body.matchAll(/\[([^\]]{6,140})\]\((https?:\/\/[^)]+)\)/g)]
    .filter((m) => m[2].includes(site))
    .slice(0, 10)
    .map((m) => ({ title: m[1].replace(/\s+/g, ' ').trim(), url: m[2] }));
  return { ok: true, channel: channelName, backend: 'Jina Reader', query, results };
}
