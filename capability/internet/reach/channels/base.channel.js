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
    const override = cfg && typeof cfg.channelBackend === 'function' ? cfg.channelBackend(this.name) : null;
    if (!override) return { list: candidates, override: null, applied: false };
    const ov = String(override).toLowerCase();
    const idx = candidates.findIndex((b) => b === override || b.toLowerCase() === ov || b.toLowerCase().startsWith(ov));
    if (idx > 0) {
      candidates.unshift(candidates.splice(idx, 1)[0]);
      return { list: candidates, override, applied: true };
    }
    if (idx === 0) return { list: candidates, override, applied: true };
    // unknown override: tried first, fails honestly, chain falls through
    candidates.unshift(override);
    return { list: candidates, override, applied: true, unknown: true };
  }

  /**
   * Drive read() through ordered backends with an honest attempts chain.
   * handlers: { '<backend>': async () => result } — a backend with no handler
   * fails as "not available in this runtime". The override (ordered_backends)
   * is always attempted first. opts.fatal(err) stops the chain immediately
   * (default: AUTH_REQUIRED — a wall must never be bypassed by re-rendering).
   * Throws the terminal error with .attempts attached when nothing serves it.
   */
  async readViaBackends(cfg, handlers, { fatal = null } = {}) {
    const isFatal = fatal || ((err) => err && err.code === 'AUTH_REQUIRED');
    const attempts = [];
    for (const backend of this.ordered_backends(cfg).list) {
      const handler = handlers[backend];
      if (!handler) {
        attempts.push({ backend, ok: false, error: `backend "${backend}" is not available in this runtime (not installed)` });
        continue;
      }
      try {
        const r = await handler();
        this.active_backend = backend;
        return { ...r, backend, attempts };
      } catch (err) {
        attempts.push({ backend, ok: false, error: String(err.message || err).slice(0, 160) });
        if (isFatal(err)) {
          if (!err.attempts) err.attempts = attempts;
          throw err;
        }
      }
    }
    const authish = attempts.some((a) => /login|auth|wall|blocked|log in|sign in/i.test(a.error));
    const e = new Error(`${this.name}: all backends failed — ${attempts.map((a) => `${a.backend}: ${a.error}`).join(' | ')}`.slice(0, 400));
    e.code = authish ? 'AUTH_REQUIRED' : 'BACKEND_UNAVAILABLE';
    e.attempts = attempts;
    throw e;
  }
}
