/**
 * JEXI OS — Offline Agent.
 *
 * Detects cloud-provider unavailability and routes suitable tasks to a local
 * LLM backend (Ollama / llama.cpp) when one is configured (OLLAMA_BASE_URL or
 * OLLAMA_HOST). Model warm-up, quantization-aware listing and graceful
 * fallback messaging. If no local backend is configured it reports that
 * clearly instead of pretending.
 */

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || (process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST}` : '');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

function localBackendConfigured() {
  return Boolean(OLLAMA_URL);
}

async function ollamaFetch(p, opts = {}) {
  if (!OLLAMA_URL) return { ok: false, error: 'no local LLM backend configured (set OLLAMA_BASE_URL)' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${OLLAMA_URL}${p}`, { signal: ctrl.signal, ...opts });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `local backend responded ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: `local backend unreachable: ${e.message || e}` };
  }
}

/** Is a local backend available right now? (probe /api/tags, no secrets). */
export async function checkLocalBackend() {
  if (!localBackendConfigured()) {
    return { available: false, configured: false, reason: 'no local LLM backend configured', models: [] };
  }
  const res = await ollamaFetch('/api/tags');
  if (!res.ok) return { available: false, configured: true, reason: res.error, models: [] };
  const models = (res.data.models || []).map((m) => ({ name: m.name, sizeGB: Math.round((m.size || 0) / 1073741824 * 10) / 10, quant: (m.details?.quantization_level) || 'unknown' }));
  return { available: models.length > 0, configured: true, reason: models.length ? 'ok' : 'no models pulled', models };
}

/** List models on the local backend. */
export async function listLocalModels() {
  const status = await checkLocalBackend();
  return status;
}

/** Warm up a model so the first real query is fast (Ollama /api/generate "" ). */
export async function warmupModel(model = DEFAULT_MODEL) {
  if (!OLLAMA_URL) return { ok: false, error: 'no local LLM backend configured (set OLLAMA_BASE_URL)' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'ping', stream: false, options: { num_predict: 1 } }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `warmup failed: ${res.status}` };
    return { ok: true, model, warmed: true };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: `warmup failed: ${e.message || e}` };
  }
}

/** Ask the local backend a question (stream:false, num_predict cap). */
export async function queryLocalLLM(prompt, opts = {}) {
  if (!OLLAMA_URL) {
    return { ok: false, error: 'no local LLM backend configured — set OLLAMA_BASE_URL (e.g. http://localhost:11434)', fallback: 'cloud providers unreachable AND no local backend → please try again later or configure Ollama.' };
  }
  const model = opts.model || DEFAULT_MODEL;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: String(prompt || ''), stream: false, options: { num_predict: Number(opts.maxTokens) || 1024, temperature: Number(opts.temperature) ?? 0.7 } }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `local backend responded ${res.status}`, model };
    const data = await res.json();
    return { ok: true, model, text: String(data.response || '').trim(), evalCount: data.eval_count || 0 };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: `local backend unreachable: ${e.message || e}` };
  }
}

/** Decide routing when cloud providers look unhealthy. */
export function routeDecision(providerSnapshot = []) {
  const rows = Array.isArray(providerSnapshot) ? providerSnapshot : [];
  const configured = rows.filter((r) => r.configured);
  const allDown = configured.length > 0 && configured.every((r) => !r.ok || r.inCooldown);
  const local = localBackendConfigured();
  if (allDown && local) return { route: 'local', reason: 'all cloud providers are down and a local backend is configured — routing locally', offline: true };
  if (allDown && !local) return { route: 'none', reason: 'all cloud providers are down and no local backend is configured', offline: true };
  if (configured.length === 0) return { route: 'none', reason: 'no providers configured and no local backend', offline: false };
  return { route: 'cloud', reason: 'cloud providers are healthy', offline: false };
}
