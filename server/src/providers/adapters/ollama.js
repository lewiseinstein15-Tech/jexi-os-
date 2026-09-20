/**
 * JEXI OS - Provider bridge - Ollama adapter (local, no API key).
 *
 * ZONE-OWNER ITEM 2 — CANONICAL EXPOSURE GUARD.
 * This runtime adapter is now the single enforcement point for the Phase 17
 * Scope J Ollama exposure rule. It delegates bind classification to
 * security/shield/inference-exposure.js#checkBind and refuses to serve on a
 * non-loopback bind unless ALLOW_OLLAMA_EXPOSED=1 (strict opt-in).
 * The standalone duplicate (providers/adapters/ollama.provider.js) was
 * REMOVED in the same commit — its contract (init()/exposure()/config()/
 * health(), OllamaExposureError with code E_OLLAMA_EXPOSED) lives here now.
 *
 * Enforcement semantics (identical to the removed checker):
 *   init(): checkBind(host, port)
 *     exposed && ALLOW_OLLAMA_EXPOSED != '1' → logger.error(notice), throw
 *     exposed && ALLOW_OLLAMA_EXPOSED == '1' → logger.warn(WARNING: notice)
 *     loopback                               → silent success
 *   chat()/stream() lazily call init() on first use, so a misconfigured
 *   OLLAMA_HOST=0.0.0.0 refuses at the first real model call (the ladder
 *   then slides to the remote rungs) instead of crashing registry startup.
 */
import { ChatClientBase } from './chatClientBase.js';
import {
  checkBind,
  isExposureAllowed,
  startupNotice,
  OLLAMA_DEFAULT_PORT,
} from '../../../../security/shield/inference-exposure.js';

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

export class OllamaAdapter extends ChatClientBase {
  constructor(cfg, env = process.env, logger = console) {
    const c = { ...cfg, needsKey: false };
    super({ id: 'ollama', cfg: c, env, adapter: 'openai', wire: 'openai' });
    this.kind = 'local'; // marker: a keyless on-machine backend (resolveLocalProvider)
    this.logger = logger;
    this.capabilities = {
      toolCalling: true,
      codeReasoning: 'medium',
      longContext: 128_000,
      vision: false,
      streaming: true,
      structuredOutput: true,
    };
    this.modelConfig = {
      'llama3.1': { contextWindow: 128000, maxOutput: 8192, priceInPer1M: 0, priceOutPer1M: 0 },
    };

    // Effective endpoint: explicit baseUrl → OLLAMA_HOST → host/port cfg →
    // DEFAULT BIND: 127.0.0.1 (loopback). OLLAMA_HOST may arrive bare
    // ('0.0.0.0:11434') or as a full URL.
    const rawBase = cfg?.baseUrl ?? env?.OLLAMA_HOST ?? null;
    if (rawBase) {
      this.baseUrl = String(rawBase).replace(/\/$/, '');
    } else {
      const h = cfg?.host ?? '127.0.0.1';
      const p = Number(cfg?.port ?? OLLAMA_DEFAULT_PORT);
      this.baseUrl = `http://${urlHost(h)}:${p}/v1`;
    }
    const u = new URL(/^https?:\/\//i.test(this.baseUrl) ? this.baseUrl : `http://${this.baseUrl}`);
    this.host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets for checkBind
    this.port = Number(u.port || OLLAMA_DEFAULT_PORT);

    this.headers = { 'Content-Type': 'application/json' };
    this.initialized = false;
  }

  /** Exposure verdict for the effective bind (pure — no I/O). */
  exposure() {
    return checkBind(this.host, this.port);
  }

  /**
   * Gate serving on bind exposure. Deterministic: reads env at call-time;
   * performs no network I/O.
   * @returns {OllamaAdapter} this, when started
   * @throws {OllamaExposureError} when exposed without ALLOW_OLLAMA_EXPOSED=1
   */
  init() {
    const verdict = this.exposure();
    if (verdict.exposed) {
      const line = startupNotice(this.host);
      if (!isExposureAllowed(this.env)) {
        if (typeof this.logger?.error === 'function') this.logger.error(line);
        throw new OllamaExposureError(line, verdict);
      }
      if (typeof this.logger?.warn === 'function') this.logger.warn(`WARNING: ${line}`);
    }
    this.initialized = true;
    return this;
  }

  /** Lazy runtime enforcement — first real use pays the guard. */
  ensureInit() {
    if (!this.initialized) this.init();
  }

  async chat(request) {
    this.ensureInit();
    return super.chat(request);
  }

  async *stream(request) {
    this.ensureInit();
    yield* super.stream(request);
  }

  /** Operator preference: MODEL_PROVIDER=ollama puts the local lane first. */
  config() {
    return {
      id: this.id,
      kind: this.kind,
      host: this.host,
      port: this.port,
      baseUrl: this.baseUrl,
      model: this.modelConfig ? Object.keys(this.modelConfig)[0] : null,
      preferred: (this.env?.MODEL_PROVIDER || process.env.MODEL_PROVIDER || '').toLowerCase() === 'ollama',
      exposure: this.exposure(),
      exposureAllowed: isExposureAllowed(this.env),
      initialized: this.initialized,
    };
  }

  isPreferred() {
    return (this.env?.MODEL_PROVIDER || process.env.MODEL_PROVIDER || '').toLowerCase() === 'ollama';
  }

  /** Bounded liveness probe (lists tags); { ok, ms, models?, error? }. */
  async health({ timeoutMs = 8000 } = {}) {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/v1$/, '')}/api/tags`, { signal: ctrl.signal });
      const ms = Date.now() - t0;
      if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
      const body = await res.json().catch(() => ({}));
      const models = Array.isArray(body.models) ? body.models.map((m) => (typeof m === 'string' ? { name: m } : { name: m.name || '', sizeGB: m.size ? Math.round(m.size / 1073741824 * 10) / 10 : undefined, quant: m.details?.quantization_level || 'unknown' })).filter((m) => m.name) : [];
      return { ok: true, ms, models };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 140) };
    } finally {
      clearTimeout(t);
    }
  }
}
