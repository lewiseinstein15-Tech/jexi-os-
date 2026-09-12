/**
 * ARENA ASTRA REBUILD — OllamaProvider (spec Part 6).
 *
 * Ollama is a FIRST-CLASS provider, not a special case: local models on
 * Lewis's own machine speak the same interface as every remote provider.
 *
 *   ReasoningEngine → ModelRouter → OllamaProvider | RemoteProvider | …
 *
 * Config (env):
 *   MODEL_PROVIDER=ollama        put Ollama first on the ladder
 *   OLLAMA_BASE_URL              default http://127.0.0.1:11434
 *   MODEL_NAME / OLLAMA_MODEL    default qwen3
 *   OLLAMA_TIMEOUT_MS            default 120000
 *   OLLAMA_API_KEY               optional (normally unset for local Ollama)
 *
 * JEXI never imports Ollama APIs directly anywhere else — this module is
 * the only place that knows the Ollama HTTP shape.
 */

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3';

export function ollamaConfig() {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    model: process.env.MODEL_NAME || process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120000),
    apiKey: process.env.OLLAMA_API_KEY || '',
    preferred: (process.env.MODEL_PROVIDER || '').toLowerCase() === 'ollama',
  };
}

/** Is Ollama reachable right now? { ok, ms, models?[], error? } */
export async function ollamaHealth({ timeoutMs = 8000 } = {}) {
  const { baseUrl } = ollamaConfig();
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => ({}));
    const models = Array.isArray(body.models) ? body.models.map((m) => m.name).filter(Boolean) : [];
    return { ok: true, ms, models };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 140) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Generate a completion via Ollama (/api/chat — OpenAI-style messages).
 * @param {{ messages: [{role, content}], model?, signal?, timeoutMs? }} opts
 * @returns {{ text, model, ms, provider: 'ollama' }}
 */
export async function ollamaGenerate({ messages, model, signal, timeoutMs } = {}) {
  const cfg = ollamaConfig();
  const useModel = model || cfg.model;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) throw new Error('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const t = setTimeout(() => ctrl.abort(), timeoutMs || cfg.timeoutMs);
  const t0 = Date.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const res = await fetch(`${cfg.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({ model: useModel, messages, stream: false }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    const text = body?.message?.content || '';
    if (!text) throw new Error('empty response');
    return { text, model: useModel, ms: Date.now() - t0, provider: 'ollama' };
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Provider descriptor for the ModelRouter ladder. */
export const OllamaProvider = {
  id: 'ollama',
  kind: 'local',
  config: ollamaConfig,
  health: ollamaHealth,
  generate: ollamaGenerate,
  isPreferred: () => ollamaConfig().preferred,
};
