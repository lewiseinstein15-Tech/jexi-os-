/**
 * JEXI OS — Offline Agent.
 *
 * Detects cloud-provider unavailability and routes suitable tasks to a local
 * LLM backend (a keyless on-machine adapter registered in providers/) when one
 * is configured. Model warm-up, quantization-aware listing and graceful
 * fallback messaging. If no local backend is configured it reports that
 * clearly instead of pretending.
 *
 * This module NEVER names a provider or endpoint: it asks the providers/
 * public API for "the local backend" and delegates all HTTP to the adapter.
 */

import { resolveLocalProvider } from '../providers/index.js';

const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const NO_BACKEND = 'no local LLM backend configured — set OLLAMA_BASE_URL (e.g. http://localhost:11434)';

function localAdapter() {
  return resolveLocalProvider();
}

const DEFAULT_BASE = 'http://localhost:11434/v1';
function localBackendConfigured() {
  const p = localAdapter();
  if (!p) return false;
  try {
    if (typeof p.isConfigured === 'function' && !p.isConfigured()) return false;
    // Only count as configured when the operator pointed at a NON-default
    // local endpoint (env / config), never the built-in placeholder.
    const base = p.baseUrl || p.baseURL?.() || '';
    return base !== DEFAULT_BASE && Boolean(base);
  } catch { return false; }
}

/** Is a local backend available right now? (bounded probe, no secrets). */
export async function checkLocalBackend() {
  const p = localAdapter();
  if (!p || !localBackendConfigured()) {
    return { available: false, configured: false, reason: 'no local LLM backend configured', models: [] };
  }
  try {
    if (p.health && typeof p.health === 'function') {
      const h = await p.health({ timeoutMs: 8000 });
      if (!h.ok) return { available: false, configured: true, reason: h.error || 'local backend unreachable', models: [] };
      const models = (h.models || []).map((m) => (typeof m === 'string' ? { name: m } : { name: m.name, sizeGB: m.sizeGB, quant: m.quant }));
      return { available: models.length > 0, configured: true, reason: models.length ? 'ok' : 'no models pulled', models };
    }
    // No health probe on the adapter — report it as configured but unprobed.
    return { available: true, configured: true, reason: 'ok', models: [] };
  } catch (e) {
    return { available: false, configured: true, reason: String(e?.message || e).slice(0, 120), models: [] };
  }
}

/** List models on the local backend. */
export async function listLocalModels() {
  return checkLocalBackend();
}

/** Warm up a model so the first real query is fast (one-token completion). */
export async function warmupModel(model = DEFAULT_MODEL) {
  const p = localAdapter();
  if (!p) return { ok: false, error: NO_BACKEND };
  try {
    if (p.generate && typeof p.generate === 'function') {
      const out = await p.generate({ messages: [{ role: 'user', content: 'ping' }], model, timeoutMs: 60_000 }).catch(() => null);
      if (out) return { ok: true, model: out.model || model, warmed: true };
    }
    const r = await p.chat({ messages: [{ role: 'user', content: 'ping' }], model, timeoutMs: 60_000 }).catch(() => null);
    if (r && r.content !== undefined) return { ok: true, model: model, warmed: true };
    return { ok: false, error: 'warmup failed: adapter returned nothing' };
  } catch (e) {
    return { ok: false, error: `warmup failed: ${e.message || e}` };
  }
}

/** Ask the local backend a question (bounded, no secrets). */
export async function queryLocalLLM(prompt, opts = {}) {
  const p = localAdapter();
  if (!p) {
    return { ok: false, error: NO_BACKEND, fallback: 'cloud providers unreachable AND no local backend → please try again later or configure a local model.' };
  }
  const model = opts.model || DEFAULT_MODEL;
  try {
    const r = await p.chat({
      messages: [{ role: 'user', content: String(prompt || '') }],
      model,
      max_tokens: Number(opts.maxTokens) || 1024,
      temperature: Number(opts.temperature ?? 0.7),
      timeoutMs: 90_000,
    }).catch((e) => { throw e; });
    const text = String(r?.content ?? '').trim();
    return { ok: text.length > 0, model, text, evalCount: r?.usage?.outputTokens ?? 0 };
  } catch (e) {
    return { ok: false, error: `local backend unreachable: ${e.message || e}`, model };
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
