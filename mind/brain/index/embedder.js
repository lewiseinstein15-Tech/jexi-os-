/**
 * JEXI OS — Phase 28 Scope B — embedding provider interface + backend choice.
 *
 * Backends are pluggable: 'rule-based' (default, honest fallback, labeled)
 * or a real provider backend (injected callable; refuses when unconfigured —
 * never fakes). resolveBackend() is the single choice point.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import * as ruleBased from './backends/rule-based.js';
import { createProviderBackend, isProviderAvailable } from './backends/provider.js';

/**
 * resolveBackend({ backend?, provider? }) -> backend object
 *   backend: 'rule-based' (default) | 'provider' | backend object
 */
export function resolveBackend({ backend = 'rule-based', provider } = {}) {
  if (typeof backend === 'object' && backend !== null && typeof backend.embed === 'function') return backend;
  if (backend === 'rule-based') return ruleBased.default;
  if (backend === 'provider') return createProviderBackend({ provider });
  throw new SemanticaError('E_UNKNOWN_BACKEND', `unknown embedding backend ${JSON.stringify(backend)}; known: rule-based, provider (or an injected { embed } object)`);
}

/**
 * embed(chunks, { backend }) -> { backend, label, dim, vectors: [{ chunkId, vector }] }
 * Accepts sync or async backend.embed (awaits either).
 */
export async function embed(chunks, { backend = 'rule-based', provider } = {}) {
  if (!Array.isArray(chunks) || chunks.some((c) => !c || typeof c.chunkId !== 'string' || typeof c.text !== 'string')) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'embed(chunks): chunks must be [{ chunkId, text, … }]');
  }
  const b = resolveBackend({ backend, provider });
  const vectors = await b.embed(chunks.map((c) => c.text));
  if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
    throw new SemanticaError('E_BACKEND_CONTRACT', `backend ${b.name} returned ${Array.isArray(vectors) ? vectors.length : typeof vectors} vectors for ${chunks.length} chunks`);
  }
  return {
    backend: b.name, label: b.label, dim: b.dim,
    vectors: chunks.map((c, i) => ({ chunkId: c.chunkId, vector: vectors[i] })),
  };
}

export { isProviderAvailable };
