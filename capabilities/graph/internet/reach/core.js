// Phase 11 Scope D — reach core: read/search routing over the channel registry.

import { ALL_CHANNELS, route } from './channels/index.js';
import { ReachConfig } from './config.js';

/**
 * Read a URL. Routing: first channel whose can_handle(url) is true; the
 * decision (channel + why) is part of the result. Config/env overrides flow
 * through the channel's ordered_backends.
 */
export async function read(url, { config = null, channels = ALL_CHANNELS, fetchImpl = undefined } = {}) {
  const cfg = config || new ReachConfig();
  const decision = route(url, channels);
  if (!decision.channel) {
    const err = new Error(`no channel can handle ${url}`);
    err.code = 'NO_CHANNEL';
    throw err;
  }
  const channel = decision.channel;
  // Keep cfg's prototype (channelBackend/get/sourceOf) — a bare {...cfg}
  // spread would silently drop override resolution when fetchImpl is injected.
  const readCfg = fetchImpl !== undefined ? Object.assign(Object.create(Object.getPrototypeOf(cfg)), cfg, { fetchImpl }) : cfg;
  const result = await channel.read(url, readCfg);
  return {
    ...result,
    routing: { url: String(url), channel: channel.name, backend: channel.active_backend, reason: decision.reason },
  };
}

/**
 * Search across channels that implement search; per-channel failure isolates.
 */
export async function search(query, { config = null, channels = ALL_CHANNELS } = {}) {
  const cfg = config || new ReachConfig();
  const out = [];
  for (const ch of channels) {
    try {
      const r = await ch.search(query, cfg);
      if (r && r.ok) out.push(r);
    } catch (err) {
      out.push({ ok: false, channel: ch.name, error: err.message });
    }
  }
  return { ok: out.some((r) => r.ok), query, results: out };
}
