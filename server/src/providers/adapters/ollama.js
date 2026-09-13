/**
 * JEXI OS - Provider bridge - Ollama adapter (local, no API key).
 */
import { ChatClientBase } from './chatClientBase.js';

export class OllamaAdapter extends ChatClientBase {
  constructor(cfg, env = process.env) {
    const c = { ...cfg, needsKey: false };
    super({ id: 'ollama', cfg: c, env, adapter: 'openai', wire: 'openai' });
    this.kind = 'local'; // marker: a keyless on-machine backend (resolveLocalProvider)
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
    this.baseUrl = (cfg?.baseUrl ?? env.OLLAMA_HOST ?? 'http://localhost:11434/v1').replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
  }

  /** Operator preference: MODEL_PROVIDER=ollama puts the local lane first. */
  config() {
    return {
      id: this.id,
      kind: this.kind,
      baseUrl: this.baseUrl,
      model: this.modelConfig ? Object.keys(this.modelConfig)[0] : null,
      preferred: (this.env?.MODEL_PROVIDER || process.env.MODEL_PROVIDER || '').toLowerCase() === 'ollama',
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
