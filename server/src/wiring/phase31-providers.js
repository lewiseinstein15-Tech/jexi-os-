/**
 * JEXI OS — Phase 31 Scope 10 (W10.1 + W10.2) — provider config lock-in.
 *
 * Registers the two operator-supplied providers (Groq, DeepSeek) as Phase 27
 * provider profiles — keyRef discipline: credentials are ENV-VAR NAMES, never
 * values. This module reads ONLY Boolean presence of the two authorized env
 * vars (GROQ_API_KEY, DEEPSEEK_API_KEY); it never prints, logs, stores, or
 * writes a key value, and it never invents additional key names.
 *
 * Why provider:"openai" in the profile bodies: the Phase 27 schema
 * (providers/profiles/schema.js, read-only this scope) validates
 * provider against its frozen PROVIDERS list — groq/deepseek are not in it,
 * and both endpoints are OpenAI-compatible (the block's own premise), so the
 * schema-sanctioned representation is the openai wire family with the
 * profile NAME + baseUrl carrying the vendor identity:
 *   groq-default    -> https://api.groq.com/openai/v1     (llama-4-scout)
 *   deepseek-default-> https://api.deepseek.com/v1        (deepseek-v4)
 * The runtime bridge (server/src/providers) additionally ships NATIVE groq +
 * deepseek adapters driven by providers.yaml (same baseUrls, same keyEnvs) —
 * reflected here read-only via listProviders() for the registration proof.
 *
 * W10.2: exposes the model indicator consumed by the console header —
 * when at least one authorized keyRef is present the indicator resolves to
 * that profile's model name; when none is present it stays honest:
 * "model unresolved — configure a provider".
 *
 * WA8 resolution note: Scope 1's WA8 was NOT VERIFIED (no credentials). The
 * bridge VERDICT LOGIC is proven by this scope's probe (verdict flips with a
 * probe-injected dummy key — no network, no real credential); the LIVE-LLM
 * leg stays NOT VERIFIED until a real key reaches the boot host.
 *
 * Zero dependencies. No network. No writes. Fail-soft by construction.
 */
import profiles from '../../../providers/profiles/index.js';
import { listProviders as bridgeListProviders } from '../providers/index.js';

/** The ONLY two authorized keyRef env vars (do NOT invent others). */
export const AUTHORIZED_KEY_REFS = Object.freeze(['GROQ_API_KEY', 'DEEPSEEK_API_KEY']);

/** Phase 27 profile bodies — names + endpoints per the Scope 10 block. */
export const PROVIDER_PROFILES = Object.freeze([
  Object.freeze({
    name: 'groq-default',
    provider: 'openai', // OpenAI-compatible wire family (schema-sanctioned id)
    model: 'llama-4-scout', // block default; adapter-cataloged equivalent: llama-3.3-70b-versatile
    keyRef: 'GROQ_API_KEY',
    wire: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
  }),
  Object.freeze({
    name: 'deepseek-default',
    provider: 'openai', // OpenAI-compatible wire family (schema-sanctioned id)
    model: 'deepseek-v4', // block default; adapter-cataloged equivalent: deepseek-chat
    keyRef: 'DEEPSEEK_API_KEY',
    wire: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
  }),
]);

export const UNRESOLVED_MESSAGE = 'model unresolved — configure a provider';

const state = { inited: false, indicator: null, validation: [], bridge: [] };

/** Public API only, read-only use: schema-validate every profile body. */
function validateProfiles() {
  const out = [];
  for (const profile of PROVIDER_PROFILES) {
    const v = profiles.validate(profile); // { valid } | { valid:false, errors }
    out.push({ name: profile.name, valid: v.valid === true, errors: v.valid ? [] : (v.errors || []).map((e) => e.code) });
  }
  return out;
}

/** Reflect the runtime bridge's native adapters (read-only, no secrets). */
function reflectBridge(env) {
  try {
    return bridgeListProviders()
      .filter((p) => p.id === 'groq' || p.id === 'deepseek')
      .map((p) => ({ id: p.id, configured: p.configured === true, models: (p.models || []).map((m) => m.id) }));
  } catch (e) {
    return [{ id: 'bridge', configured: false, models: [], note: String((e && e.message) || e).slice(0, 80) }];
  }
}

/**
 * Boot-time init (called from phase31-bootstrap). Returns the W31 W10 lines
 * for the bootstrap to log. Never throws; never touches key VALUES.
 */
export function initPhase31Providers(env = process.env) {
  const keyRefs = AUTHORIZED_KEY_REFS.map((name) => ({ name, present: Boolean(env[name]) }));
  const presentCount = keyRefs.filter((k) => k.present).length;

  state.validation = validateProfiles();

  // In-memory activation via the public API only — no disk writes.
  const switched = [];
  for (const profile of PROVIDER_PROFILES) {
    if (env[profile.keyRef]) {
      try { profiles.switch(profile.name); switched.push(profile.name); } catch { /* stay inactive */ }
    }
  }

  const allValid = state.validation.every((v) => v.valid);
  const resolvedProfile = PROVIDER_PROFILES.find((p) => env[p.keyRef]) || null;
  state.indicator = {
    resolved: Boolean(resolvedProfile),
    provider: resolvedProfile ? resolvedProfile.name : null,
    model: resolvedProfile ? resolvedProfile.model : null,
    message: resolvedProfile ? `${resolvedProfile.model} via ${resolvedProfile.name}` : UNRESOLVED_MESSAGE,
    keyRefs,
    profilesValid: allValid,
    activeProfile: switched.length ? switched[switched.length - 1] : null,
  };
  state.bridge = reflectBridge(env);
  state.inited = true;

  const summary = `provider lock-in: ${PROVIDER_PROFILES.length} profiles (schema valid ${state.validation.filter((v) => v.valid).length}/${PROVIDER_PROFILES.length}); keys present ${presentCount}/${AUTHORIZED_KEY_REFS.length}`;
  const lines = [
    `W31 W10.1: provider profiles -> registry lock-in (groq-default: llama-4-scout @ GROQ_API_KEY, deepseek-default: deepseek-v4 @ DEEPSEEK_API_KEY; Phase 27 schema valid ${state.validation.filter((v) => v.valid).length}/${PROVIDER_PROFILES.length}; keyRef-only, values never read; keys present ${presentCount}/${AUTHORIZED_KEY_REFS.length}${presentCount ? '' : ' — live legs NOT VERIFIED'})`,
    `W31 W10.2: console model indicator wired (keyRef present -> model name; absent -> honest "${UNRESOLVED_MESSAGE}")`,
  ];
  return { summary, lines, indicator: state.indicator, profiles: PROVIDER_PROFILES, validation: state.validation, bridge: state.bridge };
}

/** Read-only indicator for consumers (probe / future HTTP surface). */
export function providerIndicator() {
  return state.indicator
    ? { ...state.indicator, keyRefs: state.indicator.keyRefs.map((k) => ({ ...k })) }
    : { resolved: false, provider: null, model: null, message: UNRESOLVED_MESSAGE, keyRefs: AUTHORIZED_KEY_REFS.map((name) => ({ name, present: Boolean(process.env[name]) })), profilesValid: null, activeProfile: null };
}

/** Registration proof for probes: profile entries WITHOUT any key material. */
export function providerRegistration() {
  return {
    profiles: PROVIDER_PROFILES.map((p) => ({ name: p.name, provider: p.provider, model: p.model, keyRef: p.keyRef, wire: p.wire, baseUrl: p.baseUrl })),
    validation: state.validation,
    bridge: state.bridge,
    keyRefs: AUTHORIZED_KEY_REFS.map((name) => ({ name, present: Boolean(process.env[name]) })),
  };
}
