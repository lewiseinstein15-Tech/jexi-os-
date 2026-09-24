// Phase 11 Scope E — WeChat Articles channel (Tier 2 platform, but mp.weixin.qq.com
// ARTICLE pages are publicly readable — reads work, account needed only to publish).
import { Channel } from './base.channel.js';
import { hostMatches, textFromHtml, httpGet, siteSearch, probeCheck, FetchFailError } from './_shared.js';
import { WebChannel } from './web.channel.js';

export class WeChatChannel extends Channel {
  name = 'wechat';
  description = 'WeChat official-account articles (mp.weixin.qq.com) — public article pages, real text extraction';
  backends = ['direct-fetch', 'Jina Reader'];
  tier = 2;

  can_handle(url) {
    return hostMatches(url, ['mp.weixin.qq.com']);
  }

  async read(url, cfg = {}) {
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      'direct-fetch': async () => {
        const res = await httpGet(String(url), { timeoutMs: 12000 });
        if (res.status !== 200 || !/<title>/i.test(res.body)) throw new FetchFailError(`HTTP ${res.status} or no <title>`, url);
        const title = (/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(res.body)?.[1] || '').trim();
        const meta = /var msg_desc = ['"]([\s\S]*?)['"]/.exec(res.body)?.[1] || '';
        const account = /var nickname = ['"]([\s\S]*?)['"]|id="js_name"[^>]*>\s*([^<]+)</.exec(res.body)?.[1] || /id="js_name"[^>]*>\s*([^<]+)</.exec(res.body)?.[2] || '';
        return {
          ok: true, channel: this.name, url,
          content: { title: title.slice(0, 200), account: account.trim(), description: meta.slice(0, 400), text: textFromHtml(res.body, 5000) },
        };
      },
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 6000) };
      },
    });
  }

  async search(query) {
    return siteSearch(query, 'mp.weixin.qq.com', {}, this.name);
  }

  check = probeCheck('https://mp.weixin.qq.com/', (status) => {
    if (status === 200) return { status: 'ok', message: 'mp.weixin.qq.com reachable (HTTP 200) — article pages are publicly readable' };
    return { status: 'warn', message: `HTTP ${status}` };
  }).bind(this);
}
