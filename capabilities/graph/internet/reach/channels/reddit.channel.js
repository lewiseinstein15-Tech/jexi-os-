// Phase 11 Scope E — Reddit channel (Tier 0, public JSON + Jina fallback).
import { Channel } from './base.channel.js';
import { hostMatches, jsonFetch, probeCheck, loginWallDetected, AuthRequiredError, FetchFailError } from './_shared.js';
import { WebChannel } from './web.channel.js';

export class RedditChannel extends Channel {
  name = 'reddit';
  description = 'Reddit public posts + search via the keyless .json endpoints';
  backends = ['public-json', 'Jina Reader'];
  tier = 0;

  can_handle(url) {
    return hostMatches(url, ['reddit.com', 'redd.it', 'old.reddit.com']);
  }

  async read(url, cfg = {}) {
    const clean = String(url).split('?')[0].replace(/\/$/, '');
    const path = clean.replace(/^https?:\/\/(?:www\.|old\.)?reddit\.com/i, '');
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      'public-json': async () => {
        const data = await jsonFetch(`https://www.reddit.com${path}.json?limit=1`, { timeoutMs: 10000, headers: { Accept: 'application/json' } });
        const post = data?.data?.children?.[0]?.data;
        if (!post) throw new FetchFailError('empty listing', url);
        return {
          ok: true, channel: this.name, url,
          content: {
            title: post.title, subreddit: post.subreddit_name_prefixed, author: post.author,
            score: post.score, comments: post.num_comments, selftext: String(post.selftext || '').slice(0, 2000),
            url: `https://www.reddit.com${post.permalink}`,
          },
        };
      },
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        if (loginWallDetected(r.content, ['blocked by network security', "you've been blocked", 'log in to your reddit account'])) {
          throw new AuthRequiredError('reddit', 'fallback render is a block/login page — refusing to return it as content');
        }
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 8000) };
      },
    });
  }

  async search(query) {
    const data = await jsonFetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=10`, { timeoutMs: 12000 });
    return {
      ok: true, channel: this.name, backend: 'public-json', query,
      results: (data?.data?.children || []).map((c) => ({
        title: c.data.title, url: `https://www.reddit.com${c.data.permalink}`,
        subreddit: c.data.subreddit_name_prefixed, score: c.data.score,
      })),
    };
  }

  check = probeCheck('https://www.reddit.com/r/all.json?limit=1', (status) => {
    if (status === 200) return { status: 'ok', message: 'public JSON reachable (HTTP 200)', backend: 'public-json' };
    if (status === 403 || status === 429) return { status: 'warn', message: `public JSON rate-limited/blocked (HTTP ${status}) — Jina fallback remains` };
    return { status: 'error', message: `HTTP ${status} from public JSON` };
  }).bind(this);
}
