// Phase 11 Scope E — Bilibili channel (Tier 1: bili-cli preferred, keyless public API as fallback).
import { Channel } from './base.channel.js';
import { hostMatches, jsonFetch, siteSearch, probeCheck, FetchFailError, RuntimeMissingError } from './_shared.js';
import { execFileSync } from 'node:child_process';
import { WebChannel } from './web.channel.js';

const BVID_RE = /bilibili\.com\/video\/(BV[\w]+)/i;

export class BilibiliChannel extends Channel {
  name = 'bilibili';
  description = 'Bilibili videos: bili-cli preferred (videos/transcripts), keyless view API fallback (metadata)';
  backends = ['bili-cli', 'public-api', 'Jina Reader'];
  tier = 1;

  can_handle(url) {
    return hostMatches(url, ['bilibili.com', 'b23.tv']);
  }

  async read(url, cfg = {}) {
    const bvid = BVID_RE.exec(String(url))?.[1];
    if (!bvid) throw new FetchFailError('no BV id in URL', url);
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      // 1. bili-cli — real binary probe, honest RUNTIME_MISSING
      'bili-cli': async () => {
        const { execFileSync } = await import('node:child_process');
        let biliBin = null;
        try { biliBin = execFileSync('which', ['bili'], { encoding: 'utf8' }).trim(); } catch { /* not installed */ }
        if (!biliBin) {
          const e = new Error('RUNTIME_MISSING: bili-cli not installed');
          e.code = 'RUNTIME_MISSING';
          throw e;
        }
        const out = execFileSync(biliBin, ['info', bvid], { encoding: 'utf8', timeout: 30000 });
        return { ok: true, channel: this.name, url, content: { bvid, raw: out.slice(0, 4000) } };
      },
      // 2. keyless view API (metadata only)
      'public-api': async () => {
        const data = await jsonFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { timeoutMs: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (data?.code !== 0) throw new FetchFailError(`api code ${data.code}: ${data.message}`, 'bilibili api');
        return {
          ok: true, channel: this.name, url,
          content: { bvid, title: data.data.title, owner: data.data.owner?.name, views: data.data.stat?.view, durationSec: data.data.duration, desc: String(data.data.desc || '').slice(0, 800) },
        };
      },
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 4000) };
      },
    });
  }

  async search(query) {
    return siteSearch(query, 'bilibili.com', {}, this.name);
  }

  check = probeCheck('https://api.bilibili.com/x/web-interface/zone', (status) => {
    if (status === 200) return { status: 'ok', message: 'keyless view API reachable (HTTP 200); bili-cli not required for metadata reads' };
    return { status: 'warn', message: `API HTTP ${status}` };
  }).bind(this);
}
