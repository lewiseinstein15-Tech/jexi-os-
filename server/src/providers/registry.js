/**
 * JEXI OS — Provider bridge — registry.
 *
 * Builds adapters for every provider declared in providers.yaml and exposes
 * listProviders() / getProvider() / listModels(). The /model command and the
 * kernel read ONLY through this registry — no names in business logic.
 */

import { readFileSync, accessSync } from 'node:fs';
import { loadProviderConfig } from './config/loader.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { GoogleAdapter } from './adapters/google.js';
import { DeepSeekAdapter } from './adapters/deepseek.js';
import { GroqAdapter } from './adapters/groq.js';
import { MistralAdapter } from './adapters/mistral.js';
import { OpenRouterAdapter } from './adapters/openrouter.js';
import { OllamaAdapter } from './adapters/ollama.js';

const FACTORIES = {
  openai: (cfg, env) => new OpenAIAdapter(cfg, env),
  anthropic: (cfg, env) => new AnthropicAdapter(cfg, env),
  google: (cfg, env) => new GoogleAdapter(cfg, env),
  deepseek: (cfg, env) => new DeepSeekAdapter(cfg, env),
  groq: (cfg, env) => new GroqAdapter(cfg, env),
  mistral: (cfg, env) => new MistralAdapter(cfg, env),
  openrouter: (cfg, env) => new OpenRouterAdapter(cfg, env),
  ollama: (cfg, env) => new OllamaAdapter(cfg, env),
};

/** Adapter id → component that implements the LLMProvider contract. */
export const ADAPTER_IDS = Object.keys(FACTORIES);

let instances = null;

/**
 * Settings.json keys (written by the Settings panel) are layered on top of
 * process.env so the bridge sees the same configured keys as the runtime's
 * key resolver — Settings UI keys and env keys both count as configured.
 */
function envWithSettings(env = process.env) {
  const merged = { ...env };
  try {
    const settingsPath = joinPath(process.cwd(), 'settings.json');
    accessSync(settingsPath);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) || {};
    for (const [k, v] of Object.entries(settings)) {
      if (typeof v === 'string' && v && /(KEY|TOKEN)$/.test(k) && !(k.toUpperCase() in merged)) {
        merged[k.toUpperCase()] = v;
      }
    }
  } catch { /* no settings.json — env-only */ }
  return merged;
}
function joinPath(...parts) { return parts.filter(Boolean).join('/'); }

export function buildRegistry(env = process.env) {
  const cfg = loadProviderConfig();
  const mergedEnv = envWithSettings(env);
  const out = [];
  for (const [id, factory] of Object.entries(FACTORIES)) {
    const providerCfg = (cfg.providers ?? {})[id];
    if (providerCfg && providerCfg.enabled === false) continue;
    const adapter = factory(providerCfg ?? {}, mergedEnv);
    out.push(adapter);
  }
  return out;
}

export function registry(env = process.env) {
  if (!instances) instances = buildRegistry(env);
  return instances;
}

export function getProvider(id, env = process.env) {
  return registry(env).find((p) => p.id === id) ?? null;
}

export function listProviders(env = process.env) {
  return registry(env).map((p) => ({
    id: p.id,
    configured: p.isConfigured(),
    models: p.listModels ? p.listModels() : [],
  }));
}

export function listModels(providerId, env = process.env) {
  const p = getProvider(providerId, env);
  return p ? p.listModels() : [];
}

/** For tests: reset the cached registry and rebuild with the given env. */
export function _reset(env = process.env) {
  instances = buildRegistry(env);
  return instances;
}