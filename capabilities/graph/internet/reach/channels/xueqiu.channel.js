// Phase 11 Scope E — Xueqiu channel (Tier 0 page reads, API may be cookie-gated — reported honestly).
import { Channel } from './base.channel.js';
import { hostMatches, jsonFetch, siteSearch, probeCheck, FetchFailError } from './_shared.js';
import { WebChannel } from './web.channel.js';

export class XueqiuChannel extends Channel {
  name = 'xueqiu';
  description = 'Xueqiu stock/ticker pages (public pages; API is cookie-gated when it is)';
  backends = ['public-api', 'Jina Reader'];
  tier = 0;

  can_handle(url) {
    return hostMatches(url, ['xueqiu.com']);
  }

  async read(url, cfg = {}) {
    const m = /xueqiu\.com\/(\d{5,})\/(\d{6,})/i.exec(String(url));
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      'public-api': async () => {
        if (!m) throw new FetchFailError('not a xueqiu user/status URL', url);
        const data = await jsonFetch(`https://xueqiu.com/statuses/show.json?id=${m[2]}`, { timeoutMs: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        return { ok: true, channel: this.name, url, content: { id: data.id, user: data.user?.screen_name, text: String(data.description || data.text || '').slice(0, 1500) } };
      },
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 6000) };
      },
    });
  }

  async search(query) {
    return siteSearch(query, 'xueqiu.com', {}, this.name);
  }

  check = probeCheck('https://xueqiu.com/about', (status) => {
    if (status === 200) return { status: 'ok', message: 'public pages reachable (HTTP 200); status API may still be cookie-gated per-read' };
    return { status: 'warn', message: `pages responded HTTP ${status}` };
  }).bind(this);
}
