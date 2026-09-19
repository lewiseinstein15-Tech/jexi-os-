// Phase 11 Scope E — Twitter/X channel (Tier 1).
// Backend chain: syndication API (keyless tweet-result) → nitter (RUNTIME_MISSING
// unless a NITTER_INSTANCE is configured) → Jina Reader (login walls honestly).
import { Channel } from './base.channel.js';
import { hostMatches, jsonFetch, siteSearch, probeCheck, FetchFailError, AuthRequiredError } from './_shared.js';
import { WebChannel, isAntibotPage } from './web.channel.js';

const TWEET_RE = /(?:twitter\.com|x\.com)\/([^/]+)\/status(?:es)?\/(\d+)/i;

export class TwitterChannel extends Channel {
  name = 'twitter';
  description = 'Twitter/X tweets via keyless syndication, optional nitter, Jina fallback';
  backends = ['syndication', 'nitter', 'Jina Reader'];
  tier = 1;

  can_handle(url) {
    return hostMatches(url, ['twitter.com', 'x.com', 't.co']);
  }

  async read(url, cfg = {}) {
    const m = TWEET_RE.exec(String(url));
    if (!m) throw new FetchFailError('not a tweet URL (user/status/id)', url);
    const id = m[2];
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      syndication: async () => {
        const data = await jsonFetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=a`, { timeoutMs: 10000 });
        return {
          ok: true, channel: this.name, url,
          content: {
            id: data.id, author: data.user?.screen_name, text: String(data.text || '').slice(0, 1000),
            createdAt: data.created_at, favorites: data.favorite_count, conversation: data.conversation_id,
          },
        };
      },
      nitter: async () => {
        const nitterHost = (typeof cfg.get === 'function' && cfg.get('nitter_instance')) || process.env.NITTER_INSTANCE;
        if (!nitterHost) {
          const e = new Error('RUNTIME_MISSING: no NITTER_INSTANCE configured');
          e.code = 'RUNTIME_MISSING';
          throw e;
        }
        const { httpGet } = await import('./_shared.js');
        const res = await httpGet(`https://${nitterHost}/${m[1]}/status/${id}`, { timeoutMs: 10000 });
        if (res.status !== 200) throw new Error(`HTTP ${res.status} from ${nitterHost}`);
        return { ok: true, channel: this.name, url, content: { id, raw: res.body.slice(0, 4000) } };
      },
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        if (isAntibotPage(r.content) || /log (in|into)|sign (up|in) (now )?to (see|view)/i.test(r.content.slice(0, 1500))) {
          throw new AuthRequiredError('twitter/x', 'wall markers in fallback render — refusing to return it as content');
        }
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 4000) };
      },
    });
  }

  async search(query) {
    return siteSearch(query, 'x.com', {}, this.name);
  }

  check = probeCheck('https://cdn.syndication.twimg.com/tweet-result?id=1585841080431321088&lang=en&token=a', (status) => {
    if (status === 200) return { status: 'ok', message: 'syndication endpoint live (HTTP 200)' };
    if (status === 403 || status === 404) return { status: 'warn', message: `syndication reachable but gated for probes (HTTP ${status}) — reads may still work on real tweet ids` };
    return { status: 'warn', message: `syndication HTTP ${status}` };
  }).bind(this);
}
