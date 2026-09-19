// Phase 11 Scope E — RSS channel (Tier 0, stdlib XML item extraction).
import { Channel } from './base.channel.js';
import { httpGet, probeCheck, FetchFailError } from './_shared.js';

export class RSSChannel extends Channel {
  name = 'rss';
  description = 'RSS/Atom feeds: direct fetch + stdlib item extraction (any host)';
  backends = ['direct-fetch'];
  tier = 0;

  can_handle(url) {
    let u = String(url);
    try {
      const p = new URL(u);
      u = `${p.hostname}${p.pathname}`; // query/hash must not break suffix tests
    } catch { /* not absolute — test as given */ }
    if (/\.(xml|rss|atom)$/i.test(u)) return true;
    return /\/(feed|feeds|rss|atom)(\/|$)/i.test(u);
  }

  async read(url) {
    const res = await httpGet(String(url), { timeoutMs: 12000 });
    if (res.status !== 200) throw new FetchFailError(`HTTP ${res.status}`, url);
    const items = parseFeed(res.body).slice(0, 20);
    if (items.length === 0) throw new FetchFailError('no RSS <item>/<entry> elements found — not a feed?', url);
    this.active_backend = 'direct-fetch';
    return { ok: true, channel: this.name, backend: 'direct-fetch', url, content: { feedTitle: feedTitle(res.body), items } };
  }

  async search(_query) {
    throw new FetchFailError('search is not defined for arbitrary feeds (read a feed URL instead)', 'rss');
  }

  check = probeCheck('https://feeds.bbci.co.uk/news/rss.xml', (status, body) => {
    if (status === 200 && parseFeed(body).length > 0) {
      return { status: 'ok', message: `feed fetch + parse verified (${parseFeed(body).length} items from probe feed)` };
    }
    if (status === 200) return { status: 'warn', message: 'probe feed fetched but 0 items parsed' };
    return { status: 'warn', message: `probe feed HTTP ${status}` };
  }).bind(this);
}

function feedTitle(xml) {
  return (/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(String(xml))?.[1] || '').trim().slice(0, 140);
}

function parseFeed(xml) {
  const out = [];
  const blocks = [...String(xml).matchAll(/<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi)];
  for (const b of blocks.slice(0, 25)) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i').exec(b[0]);
      return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    };
    const link = /<link[^>]*href="([^"]+)"/i.exec(b[0])?.[1]
      || /<link[^>]*>([\s\S]*?)<\/link>/i.exec(b[0])?.[1]?.trim()
      || '';
    const title = pick('title');
    if (title || link) {
      out.push({ title, link, published: pick('pubDate') || pick('updated') || pick('published'), summary: (pick('description') || pick('summary') || pick('content')).slice(0, 240) });
    }
  }
  return out;
}
