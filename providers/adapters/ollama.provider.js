/**
 * JEXI OS — Phase 17 Scope J — OLLAMA PROVIDER (exposure-guarded).
 *
 * The scope named `providers/adapters/ollama.provider.js` as its zone; that
 * path did not exist on `phase-17-arena` (the LIVE runtime adapter is
 * `server/src/providers/adapters/ollama.js`, outside this scope's zone).
 * This module therefore ESTABLISHES the scope-compliant provider here:
 * loopback-by-default, guarded by security/shield/inference-exposure.js.
 *
 * ZONE-OWNER TASKS (recorded, NOT actioned — server/** needs coordination):
 *  1. server/src/providers/adapters/ollama.js — delegate host validation to
 *     security/shield/inference-exposure.js#checkBind (or import
 *     OllamaProvider from here) so OLLAMA_HOST=0.0.0.0 users hit the same
 *     refusal at adapter level.
 *  2. server/index.js — if Ollama is ever spawned/started by the server,
 *     call OllamaProvider#init() (or checkBind) before spawn; wire the
 *     OllamaExposureError refusal into startup failure handling.
 *
 * Semantics (per scope):
 *  - Default bind: 127.0.0.1
 *  - init(): checkBind(host, port)
 *      exposed && ALLOW_OLLAMA_EXPOSED != '1' → throw OllamaExposureError
 *      exposed && ALLOW_OLLAMA_EXPOSED == '1' → WARNING via logger, continue
 *      loopback                                → normal path, no warning
 *  - Startup log on refusal/override:
 *      "Ollama is bound to <host>. To expose, set ALLOW_OLLAMA_EXPOSED=1 and
 *       accept the risk."
 */
import {
  checkBind,
  isExposureAllowed,
  startupNotice,
  OLLAMA_DEFAULT_PORT,
} from '../../security/shield/inference-exposure.js';

/** Thrown when the configured bind is exposed and not explicitly allowed. */
export class OllamaExposureError extends Error {
  constructor(message, verdict) {
    super(message);
    this.name = 'OllamaExposureError';
    this.code = 'E_OLLAMA_EXPOSED';
    this.verdict = verdict; // { exposed, risk, reason } from checkBind
  }
}

const urlHost = (host) => (String(host).includes(':') ? `[${host}]` : host); // bare IPv6 in URLs

export class OllamaProvider {
  /**
   * @param {{host?: string, port?: number, model?: string, baseUrl?: string}} cfg
   * @param {object} [env] - environment surface (defaults to process.env)
   * @param {object} [logger] - needs warn()/error(); defaults to console
   */
  constructor(cfg = {}, env = (typeof process !== 'undefined' ? process.env : {}), logger = console) {
    this.cfg = cfg;
    this.env = env;
    this.logger = logger;
    this.host = cfg.host ?? '127.0.0.1'; // DEFAULT BIND: loopback — the fix
    this.port = Number(cfg.port ?? OLLAMA_DEFAULT_PORT);
    this.model = cfg.model ?? env.OLLAMA_MODEL ?? 'llama3.1';
    this.baseUrl = (cfg.baseUrl ?? `http://${urlHost(this.host)}:${this.port}`).replace(/\/$/, '');
    this.initialized = false;
  }

  /** Exposure verdict for the current config (pure — no I/O). */
  exposure() {
    return checkBind(this.host, this.port);
  }

  /**
   * Gate initialization on bind exposure. Deterministic: reads env at
   * call-time; performs no network I/O.
   * @returns {Promise<OllamaProvider>} this, when started
   * @throws {OllamaExposureError} when exposed without ALLOW_OLLAMA_EXPOSED=1
   */
  async init() {
    const verdict = this.exposure();
    if (verdict.exposed) {
      const line = startupNotice(this.host);
      if (!isExposureAllowed(this.env)) {
        if (typeof this.logger.error === 'function') this.logger.error(line);
        throw new OllamaExposureError(line, verdict);
      }
      if (typeof this.logger.warn === 'function') this.logger.warn(`WARNING: ${line}`);
    }
    this.initialized = true;
    return this;
  }

  config() {
    return {
      id: 'ollama',
      kind: 'local',
      host: this.host,
      port: this.port,
      baseUrl: this.baseUrl,
      model: this.model,
      exposure: this.exposure(),
      exposureAllowed: isExposureAllowed(this.env),
      initialized: this.initialized,
    };
  }

  /** Bounded liveness probe (lists tags); { ok, ms, models?, error? }. */
  async health({ timeoutMs = 8000 } = {}) {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: ctrl.signal });
      const ms = Date.now() - t0;
      if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
      const body = await res.json().catch(() => ({}));
      const models = Array.isArray(body.models)
        ? body.models.map((m) => (typeof m === 'string' ? { name: m } : { name: m.name || '' })).filter((m) => m.name)
        : [];
      return { ok: true, ms, models };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 140) };
    } finally {
      clearTimeout(t);
    }
  }
}

export default { OllamaProvider, OllamaExposureError };
