/**
 * JEXI OS — Phase 28 Scope J — source-partitioned in-process record store.
 * Identity is always (source_id, local identity); active indexes are physically
 * partitioned by source so reads never scan a cross-source collection.
 */
import { createHash } from 'node:crypto';
import { SemanticaError } from '../../../services/semantica/_internal.js';

export const RECORD_TYPES = Object.freeze(['page', 'chunk', 'fact', 'edge']);
const TYPE_SET = new Set(RECORD_TYPES);
const clone = (value) => JSON.parse(JSON.stringify(value));
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export function assertSourceId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) {
    throw new SemanticaError('E_INVALID_ARGUMENT',
      `sourceId must match [a-z0-9][a-z0-9-]{0,31}, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function assertRecordType(value) {
  const singular = typeof value === 'string' && value.endsWith('s') ? value.slice(0, -1) : value;
  if (!TYPE_SET.has(singular)) {
    throw new SemanticaError('E_INVALID_ARGUMENT',
      `record type must be one of ${RECORD_TYPES.join(', ')}, got ${JSON.stringify(value)}`);
  }
  return singular;
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function digest(parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
}

function localIdentity(type, input) {
  if (type === 'page') return nonEmpty(input.slug, 'page.slug');
  if (typeof input.id === 'string' && input.id.trim() !== '') return input.id.trim();
  if (type === 'chunk') {
    return input.chunkId ?? input.chunk_id ?? digest([
      String(input.page_id ?? input.pageId ?? ''),
      String(input.chunk_index ?? input.chunkIndex ?? 0),
      String(input.text ?? input.chunk_text ?? ''),
    ]);
  }
  if (type === 'fact') {
    return digest([
      String(input.entity_slug ?? ''), String(input.kind ?? 'fact'),
      String(input.fact ?? ''), String(input.op_seq ?? input.opSeq ?? 0),
    ]);
  }
  return digest([
    String(input.from ?? ''), String(input.to ?? ''), String(input.verb ?? ''),
    String(input.evidence ?? ''),
  ]);
}

function normalizeRecord(type, sourceId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${type} input must be an object`);
  }
  const localId = nonEmpty(String(localIdentity(type, input)), `${type}.id`);
  const id = `${sourceId}:${type}:${localId}`;
  const record = {
    ...clone(input),
    id,
    source_id: sourceId,
    record_type: type,
    archived: false,
    archived_at: null,
    archive_expires_at: null,
  };
  delete record.sourceId;
  if (type === 'page') record.slug = nonEmpty(input.slug, 'page.slug');
  if (type === 'fact') record.fact = nonEmpty(input.fact, 'fact.fact');
  if (type === 'edge') {
    record.from = nonEmpty(input.from, 'edge.from');
    record.to = nonEmpty(input.to, 'edge.to');
    record.verb = nonEmpty(input.verb, 'edge.verb');
  }
  if (type === 'chunk') {
    record.text = nonEmpty(input.text ?? input.chunk_text, 'chunk.text');
    record.page_id = nonEmpty(input.page_id ?? input.pageId, 'chunk.page_id');
  }
  return record;
}

function emptyTypeMaps() {
  return Object.fromEntries(RECORD_TYPES.map((type) => [type, new Map()]));
}

export function createSourceRegistry() {
  const sources = new Map();
  const byId = new Map();

  function ensure(sourceId, config = {}) {
    const id = assertSourceId(sourceId);
    if (!sources.has(id)) {
      sources.set(id, {
        id,
        config: clone(config ?? {}),
        records: emptyTypeMaps(),
        activeIndex: emptyTypeMaps(),
      });
    }
    return sources.get(id);
  }

  function insert(typeInput, sourceId, input) {
    const type = assertRecordType(typeInput);
    const source = ensure(sourceId);
    const record = normalizeRecord(type, source.id, input);
    if (byId.has(record.id)) {
      throw new SemanticaError('E_ALREADY_EXISTS', `${type} ${record.id} already exists`);
    }
    source.records[type].set(record.id, record);
    const parent = type === 'chunk' ? byId.get(record.page_id) : null;
    if (type !== 'chunk' || (parent?.record_type === 'page' && parent.archived !== true)) {
      source.activeIndex[type].set(record.id, record);
    }
    byId.set(record.id, record);
    return clone(record);
  }

  function find(id) {
    return typeof id === 'string' ? byId.get(id) ?? null : null;
  }

  function deactivate(id) {
    const record = find(id);
    if (!record) return false;
    const source = sources.get(record.source_id);
    source.activeIndex[record.record_type].delete(record.id);
    if (record.record_type === 'page') {
      for (const chunk of source.activeIndex.chunk.values()) {
        if (chunk.page_id === record.id) source.activeIndex.chunk.delete(chunk.id);
      }
    }
    return true;
  }

  function activate(id) {
    const record = find(id);
    if (!record) return false;
    const source = sources.get(record.source_id);
    if (record.record_type === 'chunk') {
      const page = find(record.page_id);
      if (!page || page.archived === true) return false;
    }
    source.activeIndex[record.record_type].set(record.id, record);
    if (record.record_type === 'page') {
      for (const chunk of source.records.chunk.values()) {
        if (chunk.page_id === record.id && chunk.archived !== true) {
          source.activeIndex.chunk.set(chunk.id, chunk);
        }
      }
    }
    return true;
  }

  function remove(id) {
    const record = find(id);
    if (!record) return false;
    const source = sources.get(record.source_id);
    deactivate(record.id);
    source.records[record.record_type].delete(record.id);
    byId.delete(record.id);
    return true;
  }

  function listActive(sourceId, typeInput) {
    const type = assertRecordType(typeInput);
    const source = ensure(sourceId);
    return [...source.activeIndex[type].values()]
      .sort((a, b) => compareText(a.id, b.id)).map(clone);
  }

  function indexSnapshot(sourceId) {
    const source = ensure(sourceId);
    return Object.fromEntries(RECORD_TYPES.map((type) => [
      `${type}s`,
      [...source.activeIndex[type].values()].sort((a, b) => compareText(a.id, b.id)).map(clone),
    ]));
  }

  function sourceSnapshot(sourceId) {
    const source = ensure(sourceId);
    return {
      source_id: source.id,
      config: clone(source.config),
      records: Object.fromEntries(RECORD_TYPES.map((type) => [
        `${type}s`,
        [...source.records[type].values()].sort((a, b) => compareText(a.id, b.id)).map(clone),
      ])),
      index: indexSnapshot(source.id),
    };
  }

  function snapshot() {
    return {
      sources: [...sources.keys()].sort(compareText).map((id) => sourceSnapshot(id)),
    };
  }

  return Object.freeze({
    ensure,
    insert,
    find,
    deactivate,
    activate,
    remove,
    listActive,
    indexSnapshot,
    sourceSnapshot,
    snapshot,
    allRecords: () => [...byId.values()].sort((a, b) => compareText(a.id, b.id)),
    sourceIds: () => [...sources.keys()].sort(compareText),
  });
}
