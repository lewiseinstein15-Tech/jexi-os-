/**
 * JEXI OS — Phase 28 Scope H — frozen MEMORY_VERBS v1 definitions.
 *
 * Exactly five verbs. Adding, removing, reordering, or changing a v1
 * signature is a breaking change and belongs in a v2 protocol module.
 */
export const PROTOCOL_VERSION = '1.0';

export const VERB_NAMES = Object.freeze([
  'recall',
  'remember',
  'entity',
  'synthesize',
  'forget',
]);

export const SURFACES = Object.freeze(['verbs', 'starter', 'full']);

export const VERB_DEFINITIONS = Object.freeze({
  recall: Object.freeze({
    signature: 'recall({ query, opts })',
    required: Object.freeze(['query']),
    delegates: Object.freeze(['brain.search.hybrid', 'brain.hot.recall']),
  }),
  remember: Object.freeze({
    signature: 'remember({ content, kind, sourceId })',
    required: Object.freeze(['content', 'kind', 'sourceId']),
    delegates: Object.freeze(['brain.hot.extract', 'brain.repo.create', 'brain.repo.append']),
  }),
  entity: Object.freeze({
    signature: 'entity({ name })',
    required: Object.freeze(['name']),
    delegates: Object.freeze(['brain.repo.read', 'brain.kg.extract']),
  }),
  synthesize: Object.freeze({
    signature: 'synthesize({ query })',
    required: Object.freeze(['query']),
    delegates: Object.freeze(['brain.repo.compile', 'brain.kg.extract']),
  }),
  forget: Object.freeze({
    signature: 'forget({ id })',
    required: Object.freeze(['id']),
    delegates: Object.freeze(['soft-delete marker; Scope J replacement seam']),
  }),
});

export function isVerb(name) {
  return VERB_NAMES.includes(name);
}
