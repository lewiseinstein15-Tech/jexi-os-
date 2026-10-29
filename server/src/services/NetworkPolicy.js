/**
 * JEXI OS — Phase 3B — EXPLICIT REMOTE FALLBACK POLICY.
 *
 * Phase 3A showed that the keyless legs (`kilo`, `pollinations`) were always
 * "configured", so a routine local-provider failure slid a Director turn to a
 * real third-party endpoint. Hermeticity was therefore an accident of the
 * environment, not a property of the code.
 *
 * This module makes the network boundary an EXPLICIT, testable policy:
 *
 *   JEXI_NETWORK_POLICY=allow-remote   (DEFAULT — unchanged product behavior)
 *     External providers are usable. The ladder keeps its remote rungs and the
 *     keyless floor, exactly as before.
 *
 *   JEXI_NETWORK_POLICY=local-only     (opt-in hermetic / air-gapped mode)
 *     No provider that is not PROVABLY on-machine may be dialed. A local
 *     provider FAILURE never widens the boundary: the turn fails honestly.
 *
 * Two rules the Phase 3A audit made non-negotiable:
 *   1. Locality is decided by ENDPOINT, never by the absence of an API key.
 *      A keyless provider is not automatically local (kilo/pollinations are
 *      keyless AND remote).
 *   2. A per-call `opts.networkPolicy` may only TIGHTEN the environment
 *      policy, never widen it. A provider failure is a provider failure — it
 *      cannot change the selected network policy.
 *
 * Compatibility: the default is `allow-remote`, so nothing changes for an
 * existing deployment. Unknown values fail SAFE to `allow-remote` (the
 * documented default) so a typo cannot silently strand the product; the
 * `policySource` field reports when a value was unrecognized.
 *
 * This module owns no HTTP. It only DECIDES and ACCOUNTS; the provider walk in
 * LLMClient consults it immediately before every dial.
 */

import { resolveModelConfig } from './providers/modelConfig.js';

export const NETWORK_POLICIES = Object.freeze({
  ALLOW_REMOTE: 'allow-remote',
  LOCAL_ONLY: 'local-only',
});

/** The env seam (consistent with JEXI_MODEL_*, JEXI_API_KEY, JEXI_ALLOW_UNLOCKED). */
export const NETWORK_POLICY_ENV = 'JEXI_NETWORK_POLICY';

/** Accepted spellings → canonical policy. A miss is not a policy. */
const POLICY_ALIASES = Object.freeze({
  'allow-remote': NETWORK_POLICIES.ALLOW_REMOTE,
  'allow-remote-fallback': NETWORK_POLICIES.ALLOW_REMOTE,
  remote: NETWORK_POLICIES.ALLOW_REMOTE,
  all: NETWORK_POLICIES.ALLOW_REMOTE,
  default: NETWORK_POLICIES.ALLOW_REMOTE,
  online: NETWORK_POLICIES.ALLOW_REMOTE,
  'local-only': NETWORK_POLICIES.LOCAL_ONLY,
  localonly: NETWORK_POLICIES.LOCAL_ONLY,
  local: NETWORK_POLICIES.LOCAL_ONLY,
  hermetic: NETWORK_POLICIES.LOCAL_ONLY,
  offline: NETWORK_POLICIES.LOCAL_ONLY,
  'air-gapped': NETWORK_POLICIES.LOCAL_ONLY,
  airgapped: NETWORK_POLICIES.LOCAL_ONLY,
  'no-egress': NETWORK_POLICIES.LOCAL_ONLY,
  'no-remote': NETWORK_POLICIES.LOCAL_ONLY,
  'loopback-only': NETWORK_POLICIES.LOCAL_ONLY,
});

/**
 * Providers whose DEFAULT endpoint is on-machine. Membership here is only the
 * first cut — `isLocalProvider` still verifies the ACTUAL endpoint, so a
 * `vllm`/`custom`/`unified` pointed at a remote host is correctly remote.
 * `local` is the internal key `generateContentSafe` uses for its OfflineAgent
 * fallback (always the on-machine adapter).
 */
export const LOCAL_PROVIDER_KEYS = Object.freeze(new Set(['ollama', 'lmstudio', 'vllm', 'custom', 'local']));

/** Canonicalize any accepted spelling. Unknown/empty → null (caller decides). */
export function canonicalPolicy(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  return POLICY_ALIASES[v] || null;
}

/**
 * The effective environment policy. Default `allow-remote`; an unrecognized
 * value also resolves to `allow-remote` but is flagged in `source`.
 */
export function getNetworkPolicy(env = process.env) {
  const raw = env && env[NETWORK_POLICY_ENV];
  const canon = canonicalPolicy(raw);
  if (canon) return canon;
  return NETWORK_POLICIES.ALLOW_REMOTE;
}

/** Detail form for health / diagnostics (never leaks secrets). */
export function networkPolicySnapshot(env = process.env) {
  const raw = env && env[NETWORK_POLICY_ENV];
  const canon = canonicalPolicy(raw);
  return {
    policy: canon || NETWORK_POLICIES.ALLOW_REMOTE,
    env: NETWORK_POLICY_ENV,
    raw: raw == null ? null : String(raw),
    source: !raw ? 'default' : (canon ? 'env' : 'env-unrecognized-defaulted'),
    localOnly: (canon || NETWORK_POLICIES.ALLOW_REMOTE) === NETWORK_POLICIES.LOCAL_ONLY,
  };
}

export function isLocalOnly(env = process.env) {
  return getNetworkPolicy(env) === NETWORK_POLICIES.LOCAL_ONLY;
}

/**
 * Is this URL on-machine? Loopback only: 127.0.0.0/8, ::1, `localhost`, and
 * `*.localhost`. Everything else (including a LAN address such as
 * 192.168.x.x) is remote — a shared LAN model server is still an external
 * request, and local-only must not quietly permit it.
 */
export function isLoopbackUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = String(u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (/^127\./.test(host)) return true; // 127.0.0.0/8
  return false;
}

/** Explicit endpoint overrides (mirrors LLMClient.providerToolConfig). */
const ENDPOINT_OVERRIDES = Object.freeze({
  kilo: 'KILO_API_URL',
  nvidia: 'NVIDIA_API_URL',
  vllm: 'VLLM_BASE_URL',
  ollama: 'OLLAMA_HOST',
});

/**
 * Resolve the endpoint a provider would actually be dialed at. Returns
 * `{ baseUrl, source }` or `null` when no endpoint can be determined.
 * `opts.unified` (a per-call override) takes precedence for `unified`.
 */
export function resolveProviderEndpoint(provider, opts = {}, env = process.env) {
  const key = String(provider || '');
  if (key === 'unified') {
    try {
      const cfg = resolveModelConfig({ opts: opts && opts.unified ? { unified: opts.unified } : null, env });
      if (cfg && cfg.baseUrl) return { baseUrl: cfg.baseUrl, source: 'unified' };
    } catch { /* unconfigured → unknown, handled below */ }
    return null;
  }
  if (key === 'groq') return { baseUrl: 'https://api.groq.com/openai/v1', source: 'default' };
  if (key === 'gemini') return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', source: 'default' };
  if (key === 'openrouter') return { baseUrl: 'https://openrouter.ai/api/v1', source: 'default' };
  if (key === 'huggingface') return { baseUrl: 'https://router.huggingface.co/v1', source: 'default' };
  if (key === 'mistral') return { baseUrl: 'https://api.mistral.ai/v1', source: 'default' };
  if (key === 'deepseek') return { baseUrl: 'https://api.deepseek.com/v1', source: 'default' };
  if (key === 'xai') return { baseUrl: 'https://api.x.ai/v1', source: 'default' };
  if (key === 'cerebras') return { baseUrl: 'https://api.cerebras.ai/v1', source: 'default' };
  if (key === 'deepinfra') return { baseUrl: 'https://api.deepinfra.com/v1/openai', source: 'default' };
  if (key === 'sambanova') return { baseUrl: 'https://api.sambanova.ai/v1', source: 'default' };
  if (key === 'cloudflare') return { baseUrl: 'https://api.cloudflare.com/client/v4', source: 'default' };
  if (key === 'kilo') return { baseUrl: env[ENDPOINT_OVERRIDES.kilo] || 'https://api.kilo.ai/api/openrouter', source: env[ENDPOINT_OVERRIDES.kilo] ? 'override' : 'default' };
  if (key === 'pollinations') return { baseUrl: 'https://gen.pollinations.ai/v1', source: 'default' };
  if (key === 'nvidia') return { baseUrl: env[ENDPOINT_OVERRIDES.nvidia] || 'https://integrate.api.nvidia.com/v1', source: env[ENDPOINT_OVERRIDES.nvidia] ? 'override' : 'default' };
  if (key === 'vllm') {
    const raw = env[ENDPOINT_OVERRIDES.vllm];
    return raw ? { baseUrl: raw, source: 'override' } : { baseUrl: 'http://localhost:8000/v1', source: 'default' };
  }
  if (key === 'ollama') {
    const raw = env[ENDPOINT_OVERRIDES.ollama] || 'http://127.0.0.1:11434';
    return { baseUrl: raw, source: env[ENDPOINT_OVERRIDES.ollama] ? 'override' : 'default' };
  }
  if (key === 'lmstudio') return { baseUrl: 'http://127.0.0.1:1234/v1', source: 'default' };
  if (key === 'local') return { baseUrl: 'http://127.0.0.1:11434', source: 'default' };
  if (key === 'custom') {
    const raw = env.ARCEN_MODEL_BASE_URL || env.CUSTOM_BASE_URL || env.MODEL_BASE_URL || '';
    return raw ? { baseUrl: raw, source: 'override' } : null;
  }
  return null;
}

/**
 * Decide a provider's locality by its ENDPOINT. `'local'` requires a resolved,
 * loopback endpoint; `'remote'` is a resolved non-loopback endpoint; `'unknown'`
 * means no endpoint could be determined (never assumed local).
 */
export function classifyProvider(provider, opts = {}, env = process.env) {
  const endpoint = resolveProviderEndpoint(provider, opts, env);
  if (!endpoint || !endpoint.baseUrl) return 'unknown';
  return isLoopbackUrl(endpoint.baseUrl) ? 'local' : 'remote';
}

/** Locality shorthand used by routing helpers. Unknown is NOT local. */
export function isLocalProvider(provider, opts = {}, env = process.env) {
  return classifyProvider(provider, opts, env) === 'local';
}

/**
 * Does the policy permit this provider? Under `local-only`, only a PROVABLY
 * local endpoint passes; anything remote or unknown is refused. Under
 * `allow-remote`, everything known passes.
 */
export function providerAllowed(provider, { policy, providerEndpoint, env = process.env, opts = {} } = {}) {
  const effective = canonicalPolicy(policy) || getNetworkPolicy(env);
  if (effective === NETWORK_POLICIES.LOCAL_ONLY) {
    const endpoint = providerEndpoint != null
      ? { baseUrl: providerEndpoint }
      : resolveProviderEndpoint(provider, opts, env);
    if (endpoint && endpoint.baseUrl && isLoopbackUrl(endpoint.baseUrl)) {
      return { allowed: true, reason: '', policy: effective };
    }
    const why = endpoint && endpoint.baseUrl ? 'not on-machine' : 'endpoint unknown';
    return { allowed: false, reason: `network policy "local-only" prohibits remote provider "${provider}" (${why})`, policy: effective };
  }
  return { allowed: true, reason: '', policy: effective };
}

/**
 * The policy a single call runs under. A per-call request may only TIGHTEN:
 * requesting `allow-remote` while the environment is `local-only` is ignored.
 * A provider failure can never reach this function — the policy is fixed for
 * the whole walk, which is what stops a failure from overriding it.
 */
export function resolveEffectivePolicy(opts = {}, env = process.env) {
  const envPolicy = getNetworkPolicy(env);
  const requested = canonicalPolicy(opts && opts.networkPolicy);
  if (requested === NETWORK_POLICIES.LOCAL_ONLY) return NETWORK_POLICIES.LOCAL_ONLY;
  return envPolicy;
}

/** Filter a provider list down to what the policy permits (order preserved). */
export function filterProvidersByPolicy(list, { opts = {}, env = process.env } = {}) {
  const policy = resolveEffectivePolicy(opts, env);
  if (policy !== NETWORK_POLICIES.LOCAL_ONLY) return [...(list || [])];
  return (list || []).filter((k) => isLocalProvider(k, opts, env));
}

/* ── attempt accounting + the test/guard seam ────────────────────────────── */

let attemptHook = null;
const policyAudit = [];

/**
 * Register a function called immediately BEFORE any permitted provider dial,
 * with `{ provider, policy, endpoint }`. Tests install a network guard here
 * that throws on a non-loopback endpoint, so an accidental remote request is
 * a loud test failure rather than silent egress. `null` restores the default.
 */
export function __setProviderAttemptHook(fn) {
  attemptHook = typeof fn === 'function' ? fn : null;
}

/** Every policy decision made this process (allowed and refused). */
export function policyAuditLog() {
  return policyAudit.map((r) => ({ ...r }));
}

/** The providers that were actually dialed (policy-permitted attempts). */
export function attemptedProviders() {
  return policyAudit.filter((r) => r.allowed).map((r) => r.provider);
}

/** The providers the policy refused. */
export function refusedProviders() {
  return policyAudit.filter((r) => !r.allowed).map((r) => r.provider);
}

export function __resetPolicyAudit() {
  policyAudit.length = 0;
}

/**
 * Single choke point consulted immediately before every provider dial.
 * Returns `{ allowed, reason, policy, provider, endpoint }` and records the
 * decision. A permitted attempt fires the guard hook (which may throw).
 */
export function beginProviderAttempt(provider, opts = {}, env = process.env) {
  const policy = resolveEffectivePolicy(opts, env);
  const endpoint = resolveProviderEndpoint(provider, opts, env);
  const verdict = providerAllowed(provider, { policy, providerEndpoint: endpoint && endpoint.baseUrl, env, opts });
  const rec = {
    provider: String(provider || ''),
    policy,
    allowed: verdict.allowed,
    reason: verdict.reason,
    endpoint: (endpoint && endpoint.baseUrl) || null,
  };
  policyAudit.push(rec);
  if (rec.allowed && typeof attemptHook === 'function') attemptHook(rec);
  return rec;
}
