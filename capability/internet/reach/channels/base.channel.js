// Phase 11 Scope D — the channel contract (Agent-Reach ABC, JS port).
//
// A channel represents one platform. Semantics ported from upstream:
//   - backends[] is ORDERED — backends[0] is preferred, rest are fallbacks
//   - check() must REALLY probe (a binary on PATH is not health) and set
//     active_backend to whatever actually serves the channel right now
//   - ordered_backends(cfg) applies the `<channel>_backend` config key /
//     `<CHANNEL>_BACKEND` env override by moving the named backend to the
//     front; an unknown override is still honored as FIRST ATTEMPT so the
//     user's intent is visible — that attempt fails honestly and the chain
//     falls through to the working backends

export class Channel {
  name = '';
  description = '';
  backends = [];     // ordered candidates — backends[0] = preferred
  tier = 0;          // 0 = zero-config, 1 = free key, 2 = needs setup
  active_backend = null;

  can_handle(_url) {
    throw new Error(`${this.constructor.name}.can_handle() not implemented`);
  }

  async read(_url, _cfg) {
    throw new Error(`${this.constructor.name}.read() not implemented`);
  }

  async search(_query, _cfg) {
    throw new Error(`${this.constructor.name}.search() not implemented`);
  }

  /**
   * Real health probe. Returns { status, message }, status one of
   * 'ok' | 'warn' | 'off' | 'error'. MUST set this.active_backend.
   */
  async check(_cfg) {
    this.active_backend = this.backends[0] || null;
    return { status: 'ok', message: this.backends.join(', ') || 'built-in' };
  }

  /** Candidate backends in probe order, honoring the config/env override. */
  ordered_backends(cfg) {
    const candidates = [...this.backends];
    const override = cfg ? cfg.channelBackend(this.name) : null;
    if (!override) return { list: candidates, override: null, applied: false };
    const idx = candidates.findIndex((b) => b === override || b.startsWith(override));
    if (idx > 0) {
      candidates.unshift(candidates.splice(idx, 1)[0]);
      return { list: candidates, override, applied: true };
    }
    if (idx === 0) return { list: candidates, override, applied: true };
    // unknown override: tried first, fails honestly, chain falls through
    candidates.unshift(override);
    return { list: candidates, override, applied: true, unknown: true };
  }
}
