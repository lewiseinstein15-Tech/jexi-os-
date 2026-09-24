/**
 * JEXI OS — Phase 28 Scope J — multi-source + soft-delete public surface.
 *
 *   const multi = createMultiSource({ now: () => injectedTimestamp });
 *   const scoped = multi.scope('source-a');
 *   scoped.putPage({ slug, ... });
 *   scoped.pages(query);                 // source index selected first
 *   multi.archive(id); multi.recover(id); multi.purge();
 */
import { SemanticaError } from '../../semantica/_internal.js';
import {
  createSourceRegistry, assertSourceId, assertRecordType, RECORD_TYPES,
} from './source.js';
import { isolateQuery, declaredQuerySources } from './isolation.js';
import { createAcl } from './acl.js';
import { createSoftDelete, RECOVERY_WINDOW_MS, PURGE_REASON } from './soft-delete.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function matches(record, query) {
  for (const key of ['id', 'slug', 'entity_slug', 'kind', 'from', 'to', 'verb', 'page_id']) {
    if (query[key] !== undefined && record[key] !== query[key]) return false;
  }
  if (query.text !== undefined) {
    if (typeof query.text !== 'string') {
      throw new SemanticaError('E_INVALID_ARGUMENT', 'query.text must be a string');
    }
    const needle = query.text.toLowerCase();
    const haystack = [
      record.slug, record.title, record.compiledTruth, record.compiled_truth,
      record.fact, record.entity_slug, record.from, record.to, record.verb,
      record.evidence, record.text,
    ].filter((value) => typeof value === 'string').join('\n').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function declaredSourcesOption(sourceId, options) {
  if (Array.isArray(options) || options instanceof Set) return options;
  return options?.declaredSources ?? options?.allowedSources ?? [sourceId];
}

export function createMultiSource({
  now = () => '1970-01-01T00:00:00.000Z',
} = {}) {
  if (typeof now !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'createMultiSource requires now to be a function');
  }
  const registry = createSourceRegistry();
  const auditEvents = [];
  const lifecycle = createSoftDelete({
    registry,
    now,
    recordAudit: (event) => auditEvents.push(clone(event)),
  });

  function scope(sourceId, options = {}) {
    const source = assertSourceId(sourceId);
    const config = !Array.isArray(options) && !(options instanceof Set) ? options?.config ?? {} : {};
    registry.ensure(source, config);
    const acl = createAcl(declaredSourcesOption(source, options));
    acl.assertRead(source);
    let lastPlan = null;

    function plan(query = {}) {
      acl.assertQuery(query, source);
      const isolated = isolateQuery(query, source);
      lastPlan = clone(isolated);
      return isolated;
    }

    function read(typeInput, query = {}) {
      const type = assertRecordType(typeInput);
      const isolated = plan(query);
      return registry.listActive(source, type)
        .filter((record) => matches(record, isolated));
    }

    function assertWriteSource(input) {
      for (const requested of declaredQuerySources(input)) {
        acl.assertRead(requested);
        if (requested !== source) {
          throw new SemanticaError('E_SCOPE_MISMATCH',
            `write source ${JSON.stringify(requested)} is outside scoped source ${JSON.stringify(source)}`);
        }
      }
    }

    function put(typeInput, input) {
      const type = assertRecordType(typeInput);
      assertWriteSource(input);
      if (type === 'edge') {
        for (const explicit of [input?.from_source_id, input?.to_source_id]) {
          if (explicit !== undefined && explicit !== source) {
            throw new SemanticaError('E_SCOPE_MISMATCH',
              `edge endpoint source ${JSON.stringify(explicit)} is outside ${JSON.stringify(source)}`);
          }
        }
        for (const endpoint of [input?.from, input?.to]) {
          const target = registry.find(endpoint);
          if (target && target.source_id !== source) {
            throw new SemanticaError('E_SCOPE_MISMATCH',
              `edge endpoint ${JSON.stringify(endpoint)} belongs to source ${JSON.stringify(target.source_id)}`);
          }
        }
      }
      if (type === 'chunk') {
        const pageId = input?.page_id ?? input?.pageId;
        const page = registry.find(pageId);
        if (!page || page.record_type !== 'page' || page.archived === true) {
          throw new SemanticaError('E_NOT_FOUND',
            `active parent page ${JSON.stringify(pageId)} was not found`);
        }
        if (page.source_id !== source) {
          throw new SemanticaError('E_SCOPE_MISMATCH',
            `chunk page belongs to source ${JSON.stringify(page.source_id)}`);
        }
      }
      return registry.insert(type, source, input);
    }

    const putPage = (input) => put('page', input);
    const putChunk = (input) => put('chunk', input);
    const putFact = (input) => put('fact', input);
    const putEdge = (input) => put('edge', input);
    const pages = (query = {}) => read('page', query);
    const chunks = (query = {}) => read('chunk', query);
    const facts = (query = {}) => read('fact', query);
    const edges = (query = {}) => read('edge', query);
    const page = (slug, query = {}) => pages({ ...query, slug })[0] ?? null;
    const fact = (id, query = {}) => facts({ ...query, id })[0] ?? null;
    const edge = (id, query = {}) => edges({ ...query, id })[0] ?? null;

    return Object.freeze({
      sourceId: source,
      source_id: source,
      declaredSources: Object.freeze([...acl.sources]),
      filter: (query = {}) => clone(plan(query)),
      isolate: (query = {}) => clone(plan(query)),
      query: (type, query = {}) => read(type, query),
      read: (type, query = {}) => read(type, query),
      put,
      write: put,
      putPage,
      putChunk,
      putFact,
      putEdge,
      addPage: putPage,
      addChunk: putChunk,
      addFact: putFact,
      addEdge: putEdge,
      pages,
      chunks,
      facts,
      edges,
      page,
      fact,
      edge,
      getPage: page,
      getFact: fact,
      getEdge: edge,
      indexSnapshot: () => registry.indexSnapshot(source),
      state: () => registry.sourceSnapshot(source),
      lastQuery: () => lastPlan == null ? null : clone(lastPlan),
    });
  }

  const api = {
    scope,
    isolate: (query, sourceId) => clone(isolateQuery(query, sourceId)),
    archive: (id) => lifecycle.archive(id),
    recover: (id) => lifecycle.recover(id),
    purge: () => lifecycle.purge(),
    audit: () => clone(auditEvents),
    snapshot: () => ({ ...registry.snapshot(), audit: clone(auditEvents) }),
    sourceIds: () => registry.sourceIds(),
  };
  return Object.freeze(api);
}

export const createMulti = createMultiSource;
export const multi = createMultiSource();
export default multi;

export {
  createSourceRegistry, assertSourceId, assertRecordType, RECORD_TYPES,
  isolateQuery, declaredQuerySources, createAcl,
  RECOVERY_WINDOW_MS, PURGE_REASON,
};
