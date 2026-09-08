/**
 * JEXI OS — Unified provider leg.
 *
 * tryUnified() speaks the PROVIDER_CALLS contract
 *   (prompt, system, imageBase64, opts, errors) → text
 * and routes to the OpenAI-compatible or Anthropic adapter based on the
 * resolved unified config (opts.unified > settings.unified > JEXI_MODEL_*).
 *
 * unifiedToolConfig() feeds the generic native tool loop in LLMClient:
 * OpenAI-adapter providers use the standard REST/SSE lane; Anthropic uses
 * the native adapter with per-round message translation.
 *
 * probeConfig() performs a tiny live call for the configure endpoint and
 * the setup wizard — it is the ONLY place that dials a provider to test a
 * candidate config (never on the hot path).
 */

import { resolveModelConfig } from './modelConfig.js';
import { loadSettings } from '../SettingsManager.js';
import { chatCompletions, listModels } from './openaiCompat.js';
import { anthropicMessages, toAnthropicRequest, fromAnthropicResponse } from './anthropicNative.js';
import { capabilitiesFor, noteProbe } from './capabilities.js';

export const PROVIDER_KEY = 'unified';

/** Resolve config for this call (opts.unified wins, then settings, then env). */
export function configForCall(opts = {}) {
  let settings = null;
  try { settings = loadSettings(); } catch { settings = null; }
  return resolveModelConfig({ settings, opts, env: process.env });
}

function userContent(prompt, imageBase64) {
  if (!imageBase64) return String(prompt || '');
  const dataUrl = String(imageBase64);
  const url = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
  return [
    { type: 'text', text: String(prompt || 'Describe this image.') },
    { type: 'image_url', image_url: { url } },
  ];
}

/**
 * Plain-generation leg for PROVIDER_CALLS. Throws with .code/.provider when
 * the provider fails (the walk records it); returns '' only when unified is
 * not configured (so the walk slides to the legacy legs).
 */
export async function tryUnified(prompt, system, imageBase64, opts = {}, errors = []) {
  const cfg = configForCall(opts);
  if (!cfg) return '';
  const caps = capabilitiesFor(cfg.model);
  const stream = typeof opts.onToken === 'function' && !imageBase64;
  const meta = { provider: PROVIDER_KEY, model: cfg.model, via: cfg.provider };
  try {
    if (cfg.def.adapter === 'anthropic') {
      const out = await anthropicMessages({
        apiKey: cfg.apiKey,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        messages: [{ role: 'user', content: userContent(prompt, imageBase64) }],
        system: system || 'You are JEXI OS, an expert AI operating system.',
        temperature: opts.temperature ?? 0.3,
        stream,
        onToken: stream ? (t) => opts.onToken(t, meta) : null,
        onThink: stream && typeof opts.onThink === 'function' ? (t) => opts.onThink(t, meta) : null,
        meta,
        signal: opts.signal,
      });
      if (imageBase64 && out.text) noteProbe(cfg.model, { vision: true });
      return out.text || '';
    }
    const out = await chatCompletions({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [
        { role: 'system', content: system || 'You are JEXI OS, an expert AI operating system.' },
        { role: 'user', content: userContent(prompt, imageBase64) },
      ],
      temperature: opts.temperature ?? 0.3,
      stream,
      onToken: stream ? (t) => opts.onToken(t, meta) : null,
      onThink: stream && typeof opts.onThink === 'function' ? (t) => opts.onThink(t, meta) : null,
      meta,
      extraHeaders: cfg.def.extraHeaders || {},
      providerLabel: `unified/${cfg.provider}`,
      signal: opts.signal,
    });
    if (imageBase64 && out.text) noteProbe(cfg.model, { vision: true });
    if (out.toolsFallback) noteProbe(cfg.model, { tools: false });
    void caps;
    return out.text || '';
  } catch (e) {
    if (e) e.provider = e.provider || `unified/${cfg.provider}`;
    if (Array.isArray(errors)) errors.push(`unified/${cfg.provider}: ${e.message}`);
    throw e;
  }
}

/**
 * Tool-loop config for LLMClient.providerToolConfig(). Returns null when
 * unified is not configured. OpenAI-adapter providers ride the standard
 * lane ({ key, baseUrl, models }); Anthropic returns a native marker that
 * __chatWithToolsOnce branches on.
 */
export function unifiedToolConfig(opts = {}) {
  const cfg = configForCall(opts);
  if (!cfg) return null;
  if (cfg.def.adapter === 'anthropic') {
    return { key: cfg.apiKey, unifiedNative: 'anthropic', baseUrl: cfg.baseUrl, models: [opts.model || cfg.model] };
  }
  return {
    key: cfg.apiKey || 'not-needed',
    baseUrl: cfg.baseUrl,
    models: [opts.model || cfg.model],
    extraHeaders: cfg.def.extraHeaders || {},
  };
}

/**
 * One native tool round for Anthropic (called from LLMClient's
 * __chatWithToolsOnce branch). Messages are OpenAI-shaped; translation
 * happens here so the generic loop stays provider-neutral.
 */
export async function unifiedAnthropicToolRound({ cfg, model, messages, tools, opts = {} }) {
  const stream = typeof opts.onToken === 'function';
  const meta = { provider: PROVIDER_KEY, model, via: 'anthropic' };
  const reqBody = toAnthropicRequest(messages, tools);
  void reqBody; // translation happens inside anthropicMessages; kept explicit for clarity
  const out = await anthropicMessages({
    apiKey: cfg.apiKey,
    model,
    baseUrl: cfg.baseUrl,
    messages: messages.filter((m) => m.role !== 'system'),
    system: messages.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n\n'),
    tools,
    temperature: opts.temperature ?? 0.3,
    stream,
    onToken: stream ? (t) => opts.onToken(t, meta) : null,
    onThink: stream && typeof opts.onThink === 'function' ? (t) => opts.onThink(t, meta) : null,
    meta,
    signal: opts.signal,
  });
  return { text: out.text || '', toolCalls: out.toolCalls, rawToolCalls: out.rawToolCalls, model };
}

/** Re-export for the LLMClient branch (keeps imports in one place). */
export { fromAnthropicResponse };

/**
 * Probe a candidate config with a tiny live call. Used ONLY by the
 * configure endpoint / setup wizard. Returns
 * { ok, model, provider, latencyMs, models?, capabilities?, error? }.
 */
export async function probeConfig(candidate, { fetchImpl = null, timeoutMs = 25000 } = {}) {
  const t0 = Date.now();
  const provider = String(candidate.provider || '').toLowerCase();
  const baseUrl = String(candidate.baseUrl || '').replace(/\/+$/, '');
  const model = String(candidate.model || '');
  const apiKey = String(candidate.apiKey || '');
  if (provider === 'anthropic') {
    try {
      const out = await anthropicMessages({
        apiKey, model, baseUrl,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        maxTokens: 16, temperature: 0, timeoutMs, fetchImpl,
      });
      return {
        ok: !!out.text, model, provider,
        latencyMs: Date.now() - t0,
        capabilities: capabilitiesFor(model),
        ...(out.text ? {} : { error: 'empty reply' }),
      };
    } catch (e) {
      return { ok: false, model, provider, latencyMs: Date.now() - t0, error: e.message, code: e.code || null };
    }
  }
  // OpenAI-compatible: list models (when available) + one tiny completion.
  let models = null;
  try {
    models = await listModels({ baseUrl, apiKey, fetchImpl, timeoutMs: Math.min(timeoutMs, 12000) });
  } catch { models = null; }
  try {
    const out = await chatCompletions({
      baseUrl, apiKey, model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      temperature: 0, maxTokens: 16, timeoutMs, fetchImpl,
      providerLabel: `probe/${provider}`,
    });
    const found = Array.isArray(models) ? models.includes(model) : null;
    return {
      ok: !!out.text, model, provider,
      latencyMs: Date.now() - t0,
      ...(models ? { models: models.slice(0, 100), modelListed: found } : {}),
      capabilities: capabilitiesFor(model),
      ...(out.text ? {} : { error: 'empty reply' }),
    };
  } catch (e) {
    return {
      ok: false, model, provider, latencyMs: Date.now() - t0,
      error: e.message, code: e.code || null,
      ...(models ? { models: models.slice(0, 100) } : {}),
    };
  }
}
