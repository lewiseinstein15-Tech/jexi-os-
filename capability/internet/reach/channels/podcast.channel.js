// Phase 11 Scope E — Xiaoyuzhou Podcast channel (Tier 1 — public episode pages,
// transcripts/full feed need an app account; reported honestly).
import { Channel } from './base.channel.js';
import { hostMatches, siteSearch, probeCheck, FetchFailError } from './_shared.js';
import { WebChannel } from './web.channel.js';

export class PodcastChannel extends Channel {
  name = 'podcast';
  description = 'Xiaoyuzhou podcast episodes (public episode pages via render; app account needed for full transcripts)';
  backends = ['Jina Reader'];
  tier = 1;

  can_handle(url) {
    return hostMatches(url, ['xiaoyuzhou.fm']);
  }

  async read(url, cfg = {}) {
    const web = new WebChannel();
    const r = await web.read(url, cfg);
    if (/登录|扫码|login/i.test(r.content.slice(0, 1200))) {
      const err = new FetchFailError('episode page gated (login markers in render)', url);
      err.code = 'AUTH_REQUIRED';
      throw err;
    }
    this.active_backend = r.backend;
    return { ok: true, channel: this.name, backend: r.backend, url, content: r.content.slice(0, 6000) };
  }

  async search(query) {
    return siteSearch(query, 'xiaoyuzhou.fm', {}, this.name);
  }

  check = probeCheck('https://www.xiaoyuzhoufm.com/', (status) => {
    if (status === 200) return { status: 'ok', message: 'xiaoyuzhou.fm reachable (HTTP 200); episode pages render via Jina Reader' };
    return { status: 'warn', message: `HTTP ${status}` };
  }).bind(this);
}
