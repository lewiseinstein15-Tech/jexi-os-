/**
 * JEXI OS — tools — web domain.
 *
 * fetch (URL read) + search. Executors are injected; the definitions are
 * always registered so capability surfaces remain stable.
 */

import { defineTool } from '../../interface/ToolDefinition.js';
import { registerToolBatch } from '../../registry/ToolRegistry.js';
import { extractContent } from '../../../services/Extractor.js';
import { aggregateSearch } from '../../../services/SearchEngine.js';
import { convert as htmlToText } from 'html-to-text';

async function fetchHtmlRaw(url, maxBytes = 400000) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JEXI-OS/1.0)' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf)).slice(0, maxBytes);
  return text;
}

export function registerWebTools() {
  const fetch = defineTool({
    name: 'web_fetch', description: 'Fetch a URL and return its visible text.',
    riskLevel: 'medium', runtimeRing: 2,
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    sideEffects: ['network'], idempotent: true,
    failureTypes: ['network_error', 'http_error'],
  });
  const search = defineTool({
    name: 'web_search', description: 'Search the web and return ranked snippets.',
    riskLevel: 'medium', runtimeRing: 2,
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
    sideEffects: ['network'], idempotent: true,
    failureTypes: ['network_error'],
  });
  const unreg = registerToolBatch([fetch, search]);

  const engines = {
    web_fetch: async ({ url }, ctx = {}) => {
      const target = String(url || '');
      let out = null;
      try {
        out = await extractContent(target);
      } catch (e) {
        if (/too short|no readable/i.test(String((e && e.message) || ''))) {
          const html = await fetchHtmlRaw(target);
          out = htmlToText(html, { wordwrap: 130 });
        } else {
          throw e;
        }
      }
      const text = (out && typeof out === 'object' && out.content !== undefined) ? out.content : out;
      return { ok: true, fetched: true, url: target, text: String(text ?? '').slice(0, (ctx.maxChars ?? 8000)) };
    },
    web_search: async ({ query, limit }, ctx = {}) => {
      const articles = await aggregateSearch(String(query || ''), null, { __providers: ctx.providers });
      return {
        ok: true,
        query,
        results: (articles || []).slice(0, Number(limit) || 5).map((a) => ({ title: a.title, url: a.link || a.url, snippet: String(a.snippet || a.content || '').slice(0, 260) })),
      };
    },
  };
  return { unreg, engines };
}