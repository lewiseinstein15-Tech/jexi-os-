/**
 * JEXI OS — Phase 9 Scope I — ships layer (AISStream).
 *
 * Zone: intelligence/layers/**. Transport doctrine per the Scope A
 * registry itself: AISStream is a WSS stream (wss://stream.aisstream.io)
 * gated by an API key — it is DELIBERATELY NOT registered in the HTTP
 * trust pipeline (registered-urls.js, "marine (AIS)" note: "the HTTP
 * broker would refuse it, and that refusal is correct").
 *
 * HONEST ABSENCE (this scope): without a key the layer throws
 * E_MISSING_KEY with the specific reason; with a key it still refuses to
 * fabricate data because the WSS subscription client is not wired in this
 * scope (zone-owner task). This layer NEVER produces simulated points.
 */

import { LayerError } from './_shared.js';

const SOURCE = 'AISStream.io (global AIS vessel positions, WSS stream)';
const REGISTRATION_NOTE =
  'AISStream is deliberately NOT registered in the HTTP trust pipeline ' +
  '(registered-urls.js "marine (AIS)" note) — a WSS stream is outside the brokered ' +
  'HTTPS transport, and the refusal is correct';

export default {
  id: 'ships',
  label: 'Ships (AIS)',
  tier: 1,
  keyless: false,
  source: {
    name: SOURCE,
    url: 'https://www.aisstream.io/',
    license: 'AISStream — free API key required; data subject to their terms',
  },

  /**
   * Vessel positions from the AISStream WSS stream.
   *
   * @param {{ apiKey?: string }} [opts]
   * @throws LayerError E_MISSING_KEY when no key is configured (the ONLY
   *   honest outcome without one); E_LAYER_UNAVAILABLE when a key exists
   *   but the WSS client is not wired (zone-owner task). Never returns
   *   fabricated points.
   */
  async fetch(opts = {}) {
    const apiKey = opts.apiKey ?? process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
      throw new LayerError(
        'E_MISSING_KEY',
        'AISStream requires an API key for its wss:// stream (set opts.apiKey or AISSTREAM_API_KEY). ' +
          `${REGISTRATION_NOTE}. No key configured — no vessel data can be fetched, and none is fabricated.`,
        { cause: { code: 'E_MISSING_KEY', message: 'AISSTREAM_API_KEY not set' } },
      );
    }
    throw new LayerError(
      'E_LAYER_UNAVAILABLE',
      'an AISSTREAM_API_KEY is configured, but the WSS subscription client is not wired in this scope ' +
        '(no websocket dependency is available in the layer zone). ' +
        `${REGISTRATION_NOTE}. Zone-owner task: wire the WSS client behind this layer. ` +
        'No vessel data is fabricated in the meantime.',
    );
  },

  /**
   * Real availability probe — no network call can honestly succeed here
   * (no key, and the stream is deliberately unregistered in the HTTP
   * pipeline), so check() reports the credential gate specifically.
   */
  async check() {
    if (!process.env.AISSTREAM_API_KEY) {
      return {
        status: 'unauthorized',
        message: 'E_MISSING_KEY: AISStream requires an API key for its wss:// stream; none is configured. ' +
          `${REGISTRATION_NOTE}.`,
      };
    }
    return {
      status: 'unavailable',
      message: 'key present but the WSS subscription client is not wired in this scope — ' +
        `${REGISTRATION_NOTE}. Zone-owner task: wire the WSS client.`,
    };
  },
};
