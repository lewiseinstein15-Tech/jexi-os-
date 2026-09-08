/**
 * JEXI OS — Unified Model Configuration (the ONE-secret model).
 *
 * The whole product runs on ONE model credential:
 *
 *   JEXI_MODEL_PROVIDER   e.g. groq | openai | anthropic | deepseek |
 *                         openrouter | gemini | ollama | custom | …
 *   JEXI_MODEL_API_KEY    the provider API key (empty for local providers)
 *   JEXI_MODEL_NAME       the model id (e.g. deepseek-chat, qwen3, …)
 *   JEXI_MODEL_BASE_URL   optional override — required for provider=custom
 *
 * The same four fields can be configured at runtime (Settings / setup
 * wizard) and are stored as `settings.unified = { provider, apiKey, model,
 * baseUrl }`. Precedence per call: explicit opts > settings > environment.
 *
 * This module never logs or returns key material except through maskConfig().
 */

import { getProviderDef } from './catalog.js';
import { loadSettings } from '../SettingsManager.js';

export const UNIFIED_ENVS = {
  provider: 'JEXI_MODEL_PROVIDER',
  apiKey: 'JEXI_MODEL_API_KEY',
  model: 'JEXI_MODEL_NAME',
  baseUrl: 'JEXI_MODEL_BASE_URL',
};

const norm = (v) => String(v ?? '').trim();

function readEnvUnified(env = process.env) {
  return {
    provider: norm(env[UNIFIED_ENVS.provider]),
    apiKey: norm(env[UNIFIED_ENVS.apiKey]),
    model: norm(env[UNIFIED_ENVS.model]),
    baseUrl: norm(env[UNIFIED_ENVS.baseUrl]),
  };
}

function readSettingsUnified(settings) {
  const u = (settings && settings.unified) || {};
  return {
    provider: norm(u.provider),
    apiKey: norm(u.apiKey),
    model: norm(u.model),
    baseUrl: norm(u.baseUrl),
  };
}

/**
 * Resolve the effective unified config. Returns null when nothing usable is
 * configured (the legacy provider cascade then applies unchanged).
 *
 * @param {{ settings?: object, opts?: object, env?: object }} args
 * @returns {null | { provider, apiKey, model, baseUrl, source, def }}
 */
export function resolveModelConfig({ settings = null, opts = null, env = process.env } = {}) {
  const fromOpts = opts && opts.unified
    ? {
        provider: norm(opts.unified.provider),
        apiKey: norm(opts.unified.apiKey),
        model: norm(opts.unified.model),
        baseUrl: norm(opts.unified.baseUrl),
      }
    : null;
  const candidates = [
    fromOpts ? { ...fromOpts, source: 'opts' } : null,
    { ...readSettingsUnified(settings), source: 'settings' },
    { ...readEnvUnified(env), source: 'env' },
  ].filter(Boolean);

  for (const c of candidates) {
    if (!c.provider && !c.apiKey && !c.model && !c.baseUrl) continue; // empty slot
    const def = getProviderDef(c.provider);
    if (!def) continue; // unknown provider id — try the next source
    const baseUrl = c.baseUrl || def.defaultBaseUrl;
    const model = c.model || (def.modelHints[0] || '');
    if (!baseUrl) continue; // e.g. custom without a URL — not usable
    if (!model) continue;
    if (def.needsKey && !c.apiKey) continue; // key-required provider, no key
    return {
      provider: def.id,
      apiKey: c.apiKey,
      model,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      source: c.source,
      def,
    };
  }
  return null;
}

/** Cheap sync check for routing order (env first, then the settings file). */
export function isUnifiedConfigured(settings = null) {
  if (resolveModelConfig({ settings: null, env: process.env })) return true;
  try {
    const s = settings || loadSettings();
    return !!resolveModelConfig({ settings: s, env: {} });
  } catch {
    return false;
  }
}

/**
 * Validate a candidate config (used by the configure endpoint BEFORE any
 * probe or save). Returns { ok, errors[], normalized? }.
 */
export function validateModelConfig(input = {}) {
  const errors = [];
  const provider = norm(input.provider).toLowerCase();
  const def = getProviderDef(provider);
  if (!provider) errors.push('provider is required');
  else if (!def) errors.push(`unknown provider "${input.provider}"`);
  const baseUrl = norm(input.baseUrl) || (def ? def.defaultBaseUrl : '');
  if (!baseUrl) errors.push(`baseUrl is required for provider "${provider || '?'}"`);
  else if (!/^https?:\/\/.+/i.test(baseUrl)) errors.push('baseUrl must be an http(s) URL');
  const model = norm(input.model) || (def && def.modelHints[0]) || '';
  if (!model) errors.push('model is required');
  const apiKey = norm(input.apiKey);
  if (def && def.needsKey && !apiKey) errors.push(`an API key is required for ${def.label}`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    normalized: { provider: def.id, apiKey, model, baseUrl: baseUrl.replace(/\/+$/, '') },
  };
}

/**
 * Merge partial updates over an existing unified config (key is sticky:
 * omitting apiKey keeps the stored one; empty string clears it only when
 * `clearKey: true` is passed).
 */
export function mergeUnifiedConfig(existing = {}, patch = {}) {
  const merged = {
    provider: norm(patch.provider) || norm(existing.provider),
    model: norm(patch.model) || norm(existing.model),
    baseUrl: norm(patch.baseUrl) || norm(existing.baseUrl),
    apiKey: patch.clearKey === true ? '' : (norm(patch.apiKey) || norm(existing.apiKey)),
  };
  return merged;
}

/** Masked view for API responses / logs — NEVER contains key material. */
export function maskConfig(cfg) {
  if (!cfg) return { configured: false };
  const key = String(cfg.apiKey || '');
  return {
    configured: true,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    source: cfg.source || 'unknown',
    hasKey: key.length > 0,
    keyLast4: key.length >= 4 ? `…${key.slice(-4)}` : (key ? '…' : ''),
  };
}

/** Last-4 helper for status endpoints that only hold a raw key. */
export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  return k.length >= 4 ? `…${k.slice(-4)}` : '…';
}
