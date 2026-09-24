/**
 * JEXI OS — Phase 28 Scope B — real embedding provider backend.
 *
 * Wraps a configured embedding provider (e.g. zeroentropy zembed-1 via the
 * gateway, or any { name, dim, embed(texts) -> Promise<number[][]> } shape).
 * The provider callable is INJECTED — this module never imports a network
 * client. If no provider is configured/available the backend refuses with
 * E_PROVIDER_UNAVAILABLE; it NEVER falls back silently and NEVER fakes
 * vectors (the caller chooses the rule-based backend explicitly).
 */
import { SemanticaError } from '../../../../services/semantica/_internal.js';

export const NAME = 'provider';

/** True when a config carries a usable injected provider. */
export function isProviderAvailable(config) {
  return Boolean(
    config && typeof config.provider === 'object' && config.provider !== null &&
    typeof config.provider.embed === 'function' &&
    typeof config.provider.dim === 'number' && config.provider.dim > 0 &&
    typeof config.provider.name === 'string' && config.provider.name.length > 0,
  );
}

/** Build the provider backend from config; refuses when unavailable. */
export function createProviderBackend(config) {
  if (!isProviderAvailable(config)) {
    throw new SemanticaError('E_PROVIDER_UNAVAILABLE',
      'no embedding provider configured (expected config.provider = { name, dim, embed(texts) }); refusing to fake embeddings — use the rule-based backend explicitly');
  }
  const { provider } = config;
  return {
    name: `provider:${provider.name}`,
    label: `provider — ${provider.name} (${provider.dim}-dim)`,
    dim: provider.dim,
    /** async: real providers are network calls. */
    embed: (texts) => provider.embed(texts),
    available: () => true,
  };
}
