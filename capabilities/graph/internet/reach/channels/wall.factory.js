// Phase 11 Scope E — factory for login-walled Tier-2 channels.
// A wall channel REALLY attempts reads (Jina render) and honestly reports
// AUTH_REQUIRED when the platform serves its login wall — never placeholder
// content. Per-platform specifics (hosts, wall markers) live in each channel.

import { Channel } from './base.channel.js';
import { hostMatches, loginWallDetected, siteSearch, AuthRequiredError } from './_shared.js';
import { WebChannel } from './web.channel.js';

export function makeWallChannel({ name, description, hosts, wallMarkers = [] }) {
  return class extends Channel {
    name = name;
    description = description;
    backends = ['Jina Reader'];
    tier = 2;

    can_handle(url) {
      return hostMatches(url, hosts);
    }

    async read(url, cfg = {}) {
      const web = new WebChannel();
      return this.readViaBackends(cfg, {
        'Jina Reader': async () => {
          const r = await web.read(url, cfg);
          if (loginWallDetected(r.content, wallMarkers)) {
            throw new AuthRequiredError(name, 'login wall detected in the rendered page — refusing to return it as content');
          }
          return { ok: true, channel: name, url, content: r.content.slice(0, 6000) };
        },
      });
    }

    async search(query) {
      return siteSearch(query, hosts[0], {}, name);
    }
  };
}

export { loginWallDetected };
