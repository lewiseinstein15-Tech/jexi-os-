// Phase 11 Scope E — YouTube channel (Tier 0, keyless oEmbed + Jina fallback).
import { Channel } from './base.channel.js';
import { hostMatches, jsonFetch, siteSearch, probeCheck, FetchFailError } from './_shared.js';
import { WebChannel } from './web.channel.js';

const VIDEO_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i;

export class YouTubeChannel extends Channel {
  name = 'youtube';
  description = 'YouTube video metadata via keyless oEmbed (transcripts need yt-dlp — honest about it)';
  backends = ['oembed', 'Jina Reader'];
  tier = 0;

  can_handle(url) {
    return hostMatches(url, ['youtube.com', 'youtu.be', 'm.youtube.com']);
  }

  async read(url, cfg = {}) {
    const id = VIDEO_RE.exec(String(url))?.[1];
    if (!id) throw new FetchFailError('no video id in URL', url);
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      oembed: async () => {
        const meta = await jsonFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, { timeoutMs: 10000 });
        return {
          ok: true, channel: this.name, url,
          content: { videoId: id, title: meta.title, author: meta.author_name, thumbnail: meta.thumbnail_url, note: 'metadata only — transcript extraction needs yt-dlp (RUNTIME_MISSING here)' },
        };
      },
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 6000) };
      },
    });
  }

  async search(query) {
    return siteSearch(query, 'youtube.com', {}, this.name);
  }

  check = probeCheck('https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json', (status) => {
    if (status === 200) return { status: 'ok', message: 'oEmbed endpoint reachable (HTTP 200)' };
    return { status: 'warn', message: `oEmbed responded HTTP ${status}` };
  }).bind(this);
}
