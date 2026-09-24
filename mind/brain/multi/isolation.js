/**
 * JEXI OS — Phase 28 Scope J — query-plan source isolation.
 * The source partition is selected before index lookup; this module never
 * accepts a conflicting source and never relies on post-filtering results.
 */
import { SemanticaError } from '../../semantica/_internal.js';
import { assertSourceId } from './source.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function declaredQuerySources(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return [];
  const values = [];
  const collect = (value) => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) values.push(...value);
  };
  collect(query.source_id);
  collect(query.sourceId);
  collect(query.source_ids);
  collect(query.sourceIds);
  collect(query.where?.source_id);
  collect(query.where?.sourceId);
  collect(query.where?.source_ids);
  collect(query.where?.sourceIds);
  collect(query.filters?.source_id);
  collect(query.filters?.sourceId);
  collect(query.filters?.source_ids);
  collect(query.filters?.sourceIds);
  collect(query.index?.source_id);
  collect(query.index?.sourceId);
  return values;
}

function hasExplicitEmptySourceList(query) {
  if (!query || typeof query !== 'object') return false;
  return [
    query.source_ids, query.sourceIds,
    query.where?.source_ids, query.where?.sourceIds,
    query.filters?.source_ids, query.filters?.sourceIds,
  ].some((value) => Array.isArray(value) && value.length === 0);
}

export function isolateQuery(query, sourceId) {
  const source = assertSourceId(sourceId);
  if (query !== undefined && query !== null && typeof query !== 'string' &&
      (typeof query !== 'object' || Array.isArray(query))) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'query must be a string or object');
  }
  const input = typeof query === 'string' ? { text: query } : clone(query ?? {});
  const requested = declaredQuerySources(input);
  if (hasExplicitEmptySourceList(input)) {
    throw new SemanticaError('E_SCOPE_MISMATCH', 'an explicit empty source grant fails closed');
  }
  const mismatch = requested.find((candidate) => candidate !== source);
  if (mismatch !== undefined) {
    throw new SemanticaError('E_SCOPE_MISMATCH',
      `query source ${JSON.stringify(mismatch)} is outside scoped source ${JSON.stringify(source)}`);
  }
  delete input.sourceId;
  delete input.sourceIds;
  delete input.source_ids;
  input.source_id = source;
  input.where = { ...(input.where ?? {}) };
  input.filters = { ...(input.filters ?? {}) };
  input.index = { ...(input.index ?? {}) };
  for (const target of [input.where, input.filters, input.index]) {
    delete target.sourceId;
    delete target.sourceIds;
    delete target.source_ids;
    target.source_id = source;
  }
  input.index_partition = source;
  return input;
}

export const isolate = isolateQuery;
