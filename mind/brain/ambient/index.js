/**
 * JEXI OS — Phase 28 Scope G — retrieval reflex + ambient recall public API.
 *
 *   const { reflex, ambient } = createBrainAmbient({ repo, edges, catalog, hot });
 *   reflex.point(turn, context) -> pointers[]
 *   reflex.escalate(pointer, { level: 1|2|3 })
 *   ambient.pack({ entities, budgetTokens, includePrivate? })
 *   ambient.delta({ since?, sessionId, includePrivate? })
 *   ambient.boundary(sessionId, { phase, entities?, budgetTokens? })
 *
 * Zero LLM, no wall clock. World-visible by default; private data appears only
 * when includePrivate === true.
 */
import { createPointerLayer, mergeEntities } from './reflex/pointer.js';
import { createContextPack } from './ambient/context-pack.js';
import { createDelta } from './ambient/delta.js';
import { createBoundary } from './ambient/boundary.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function repoCatalog(repo) {
  if (!repo || typeof repo.list !== 'function') return [];
  return repo.list().map((page) => ({
    name: page.title,
    slug: `${page.kind}/${page.slug}`,
    summary: page.compiledTruth,
    tags: page.tags,
    page,
  }));
}

function values(input) {
  const result = typeof input === 'function' ? input() : input;
  return Array.isArray(result) ? result : [];
}

export function createBrainAmbient({
  repo,
  edges,
  catalog = [],
  facts = [],
  threads = [],
  changes = [],
  hot,
  sourceId = 'default',
  maxPointers,
  catalogSource,
} = {}) {
  const allEntities = () => mergeEntities([...repoCatalog(repo), ...values(catalog)]);
  const allFacts = () => {
    const configured = values(facts);
    const hotFacts = hot && typeof hot.recall === 'function' ? hot.recall({ sourceId }) : [];
    return [...configured, ...hotFacts]
      .filter((fact, index, all) => all.findIndex((other) =>
        (other.id && fact.id ? other.id === fact.id : JSON.stringify(other) === JSON.stringify(fact))) === index)
      .map(clone);
  };
  const allThreads = () => values(threads).map(clone);

  const pointerLayer = createPointerLayer({ repo, catalog: values(catalog), edges, maxPointers, catalogSource });
  const pack = createContextPack({ getEntities: allEntities, getFacts: allFacts, getThreads: allThreads });
  const deltaRuntime = createDelta({ changes });
  const boundaryRuntime = createBoundary({ pack });

  return {
    reflex: {
      point: (turn, context) => pointerLayer.point(turn, context),
      escalate: (pointer, opts) => pointerLayer.escalate(pointer, opts),
    },
    ambient: {
      pack,
      delta: (opts) => deltaRuntime.delta(opts),
      boundary: (sessionId, opts) => boundaryRuntime.boundary(sessionId, opts),
      publish: (change) => deltaRuntime.publish(change),
      cursor: (sessionId, opts) => deltaRuntime.cursor(sessionId, opts),
      banked: (sessionId) => boundaryRuntime.banked(sessionId),
    },
  };
}

const defaults = createBrainAmbient();
export const reflex = defaults.reflex;
export const ambient = defaults.ambient;

export { createPointerLayer, normalizeEntity, mergeEntities } from './reflex/pointer.js';
export {
  DEFAULT_MAX_POINTERS, MIN_SUBSTANTIVE_TOKENS, POINTER_INSTRUCTION,
  JUDGMENT_RULE, isSubstantiveTurn, alreadyInContext, shouldPoint,
} from './reflex/policy.js';
export {
  createContextPack, estimatePackTokens, PACK_PRIORITY, DEFAULT_PACK_BUDGET_TOKENS,
} from './ambient/context-pack.js';
export { createDelta } from './ambient/delta.js';
export { createBoundary, MAX_STANDING_ENTITIES } from './ambient/boundary.js';
