/** JEXI OS — Phase 28 Scope J — fail-closed source read ACL. */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { assertSourceId } from './source.js';
import { declaredQuerySources } from './isolation.js';

const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export function normalizeDeclaredSources(input) {
  const values = input instanceof Set ? [...input] : Array.isArray(input) ? input : [input];
  const unique = new Set();
  for (const value of values) unique.add(assertSourceId(value));
  return [...unique].sort(compareText);
}

export function createAcl(declaredSources) {
  const sources = normalizeDeclaredSources(declaredSources);
  const allowed = new Set(sources);

  function assertRead(sourceId) {
    const source = assertSourceId(sourceId);
    if (!allowed.has(source)) {
      throw new SemanticaError('E_SCOPE_MISMATCH',
        `source ${JSON.stringify(source)} is not in caller read grant [${sources.join(', ')}]`);
    }
    return source;
  }

  function assertQuery(query, fallbackSourceId) {
    const requested = declaredQuerySources(query);
    if (requested.length === 0) return assertRead(fallbackSourceId);
    for (const source of requested) assertRead(source);
    return assertRead(fallbackSourceId);
  }

  return Object.freeze({
    sources: Object.freeze([...sources]),
    canRead: (sourceId) => typeof sourceId === 'string' && allowed.has(sourceId),
    assertRead,
    assertQuery,
  });
}
