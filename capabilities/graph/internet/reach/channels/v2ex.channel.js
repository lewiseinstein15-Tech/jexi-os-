// Phase 11 Scope E — V2EX channel (Tier 0, keyless public API).
import { Channel } from './base.channel.js';
import { hostMatches, jsonFetch, siteSearch, probeCheck, FetchFailError } from './_shared.js';
import { WebChannel } from './web.channel.js';

const TOPIC_RE = /v2ex\.com\/(?:t|go)\/(\d+)/i;

export class V2EXChannel extends Channel {
  name = 'v2ex';
  description = 'V2EX topics via the keyless public API';
  backends = ['public-api', 'Jina Reader'];
  tier = 0;

  can_handle(url) {
    return hostMatches(url, ['v2ex.com']);
  }

  async read(url, cfg = {}) {
    const id = TOPIC_RE.exec(String(url))?.[1];
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      'public-api': async () => {
        if (!id) throw new FetchFailError('no topic id in URL', url);
        const t = await jsonFetch(`https://www.v2ex.com/api/topics/show.json?id=${id}`, { timeoutMs: 10000 });
        const topic = Array.isArray(t) ? t[0] : t;
        if (!topic?.id) throw new FetchFailError('topic not found', url);
        return {
          ok: true, channel: this.name, url,
          content: { id: topic.id, title: topic.title, member: topic.member?.username, replies: topic.replies, content: String(topic.content || '').slice(0, 2000), url: topic.url },
        };
      },
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 6000) };
      },
    });
  }

  async search(query) {
    return siteSearch(query, 'v2ex.com', {}, this.name);
  }

  check = probeCheck('https://www.v2ex.com/api/topics/hot.json', (status) => {
    if (status === 200) return { status: 'ok', message: 'public API reachable (HTTP 200)' };
    return { status: 'warn', message: `public API HTTP ${status}` };
  }).bind(this);
}
