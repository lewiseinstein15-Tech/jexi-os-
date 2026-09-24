// Phase 11 Scope E — GitHub channel (Tier 0, keyless REST API + Jina fallback).
import { Channel } from './base.channel.js';
import { hostMatches, jsonFetch, probeCheck, FetchFailError } from './_shared.js';
import { WebChannel } from './web.channel.js';

const REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i;

export class GitHubChannel extends Channel {
  name = 'github';
  description = 'GitHub public repos: metadata + search via the keyless REST API';
  backends = ['rest-api', 'Jina Reader'];
  tier = 0;

  can_handle(url) {
    return hostMatches(url, ['github.com', 'gist.github.com']);
  }

  async read(url, cfg = {}) {
    const m = REPO_RE.exec(String(url));
    if (!m) throw new FetchFailError('not a repo URL (owner/repo)', url);
    const [owner, repo] = [m[1], m[2].replace(/#.*$/, '')];
    const web = new WebChannel();
    return this.readViaBackends(cfg, {
      'rest-api': async () => ({
        ok: true, channel: this.name, url,
        content: await (async () => {
          const meta = await jsonFetch(`https://api.github.com/repos/${owner}/${repo}`, { timeoutMs: 10000 });
          return {
            full_name: meta.full_name, description: meta.description, language: meta.language,
            stars: meta.stargazers_count, forks: meta.forks_count, open_issues: meta.open_issues_count,
            license: meta.license?.spdx_id || null, pushed_at: meta.pushed_at, url: meta.html_url,
          };
        })(),
      }),
      'Jina Reader': async () => {
        const r = await web.read(url, cfg);
        return { ok: true, channel: this.name, url, content: r.content.slice(0, 8000) };
      },
    });
  }

  async search(query) {
    const q = encodeURIComponent(String(query));
    const meta = await jsonFetch(`https://api.github.com/search/repositories?q=${q}&per_page=10`, { timeoutMs: 12000 });
    return {
      ok: true, channel: this.name, backend: 'rest-api', query,
      results: meta.items.map((r) => ({ title: r.full_name, url: r.html_url, stars: r.stargazers_count, description: r.description })),
    };
  }

  check = probeCheck('https://api.github.com/rate_limit', (status, body) => {
    if (status === 200) return { status: 'ok', message: `GitHub REST API reachable (rate-limit body ${Buffer.byteLength(body)} B)` };
    return { status: 'warn', message: `API responded HTTP ${status} (rate-limited?)` };
  }).bind(this);
}
