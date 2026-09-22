/**
 * JEXI OS — Phase 28 Scope H — frozen MEMORY_VERBS v1 public surface.
 *
 * All five operations are async and always resolve to the same envelope shape;
 * dependency/validation failures are values, never raw throws to verb callers.
 */
import { SemanticaError } from '../../semantica/_internal.js';
import { extract as extractGraph } from '../kg/index.js';
import { FACT_KINDS } from '../hot/index.js';
import { KIND_DIRS } from '../repo/index.js';
import { failureEnvelope, successEnvelope } from './envelope.js';
import { errorContract, normalizeError } from './errors.js';
import { isVerb, VERB_DEFINITIONS, VERB_NAMES } from './verbs.js';
import { versionInfo } from './versioning.js';

const PAGE_KINDS = new Set(Object.keys(KIND_DIRS));
const FACT_KIND_SET = new Set(FACT_KINDS);
const SYNTHESIS_STOP = new Set(['about', 'after', 'before', 'from', 'have', 'into', 'know', 'summarize', 'that', 'the', 'their', 'them', 'these', 'this', 'what', 'with']);
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const clone = (value) => JSON.parse(JSON.stringify(value));

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function plain(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${field} must be an object`);
  }
  return value;
}

function delegate(value, method, label) {
  if (!value || typeof value[method] !== 'function') {
    throw new SemanticaError('E_DELEGATE_UNAVAILABLE', `${label} is unavailable`);
  }
  return value[method].bind(value);
}

function sourcePage(sourceId) {
  const match = sourceId.match(/^([^/]+)\/([^/]+)$/);
  if (match && PAGE_KINDS.has(match[1])) return { kind: match[1], slug: match[2] };
  const slug = sourceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'memory';
  return { kind: 'originals', slug };
}

function resolvePage(repo, name) {
  const pages = delegate(repo, 'list', 'brain.repo.list')();
  const lower = name.toLowerCase();
  const pathHit = pages.find((page) => `${page.kind}/${page.slug}`.toLowerCase() === lower);
  const slugHit = pages.find((page) => page.slug.toLowerCase() === lower);
  const titleHit = pages.find((page) => page.title.toLowerCase() === lower);
  const suffixHits = pages.filter((page) => page.slug.toLowerCase().endsWith(lower))
    .sort((a, b) => compareText(`${a.kind}/${a.slug}`, `${b.kind}/${b.slug}`));
  return pathHit || slugHit || titleHit || suffixHits[0] || null;
}

function queryTokens(query) {
  return [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) || [])]
    .filter((token) => token.length >= 3 && !SYNTHESIS_STOP.has(token));
}

function synthesisPages(repo, query) {
  const tokens = queryTokens(query);
  return delegate(repo, 'list', 'brain.repo.list')().map((page) => {
    const title = page.title.toLowerCase();
    const body = `${page.kind}/${page.slug} ${page.title} ${page.compiledTruth}`.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (body.includes(token) ? 1 : 0), 0) +
      (title === query.toLowerCase() ? 10 : 0);
    return { page, score };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || compareText(`${a.page.kind}/${a.page.slug}`, `${b.page.kind}/${b.page.slug}`))
    .slice(0, 8).map((entry) => entry.page);
}

function uniqueEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.verb}\0${edge.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => compareText(`${a.from}\0${a.to}\0${a.verb}\0${a.evidence}`, `${b.from}\0${b.to}\0${b.verb}\0${b.evidence}`));
}

export function createMemoryProtocol({
  search,
  hot,
  repo,
  now = () => '1970-01-01T00:00:00Z',
  opSeq = () => 0,
  daySeq = () => 0,
  sessionId = 'memory-verbs-v1',
  softDelete,
} = {}) {
  const deletionMarks = new Map();

  async function execute(verb, operation) {
    try {
      const data = await operation();
      return successEnvelope(verb, data);
    } catch (error) {
      return failureEnvelope(verb, normalizeError(error));
    }
  }

  const api = {
    recall(input = {}) {
      return execute('recall', async () => {
        const query = nonEmpty(input?.query, 'recall.query');
        const opts = plain(input?.opts, 'recall.opts');
        const hybrid = delegate(search, 'hybrid', 'brain.search.hybrid');
        const recallHot = delegate(hot, 'recall', 'brain.hot.recall');
        const searched = await hybrid(query, {
          topK: opts.topK,
          budgetTokens: opts.budgetTokens,
        });
        const facts = recallHot({
          sourceId: opts.sourceId ?? 'default',
          since: opts.since,
          kind: opts.kind,
          sessionId: opts.sessionId,
        });
        return {
          query,
          results: searched.results,
          facts,
          budgetUsed: searched.budgetUsed,
          droppedCount: searched.droppedCount,
        };
      });
    },

    remember(input = {}) {
      return execute('remember', async () => {
        const content = nonEmpty(input?.content, 'remember.content');
        const kind = nonEmpty(input?.kind, 'remember.kind');
        const sourceId = nonEmpty(input?.sourceId, 'remember.sourceId');
        if (!FACT_KIND_SET.has(kind)) {
          throw new SemanticaError('E_INVALID_ARGUMENT', `remember.kind must be one of: ${FACT_KINDS.join(', ')}`);
        }
        const extractHot = delegate(hot, 'extract', 'brain.hot.extract');
        const listPages = delegate(repo, 'list', 'brain.repo.list');
        const createPage = delegate(repo, 'create', 'brain.repo.create');
        const appendPage = delegate(repo, 'append', 'brain.repo.append');
        const stamp = nonEmpty(now(), 'protocol now()');
        const sequence = opSeq();
        const day = daySeq();
        if (!Number.isInteger(sequence) || sequence < 0 || !Number.isInteger(day) || day < 0) {
          throw new SemanticaError('E_INVALID_ARGUMENT', 'protocol opSeq/daySeq must be non-negative integers');
        }
        const facts = await extractHot({
          text: content, sourceId, sessionId, opSeq: sequence, daySeq: day, kind,
        });
        const ref = sourcePage(sourceId);
        const exists = listPages().some((page) => page.kind === ref.kind && page.slug === ref.slug);
        const page = exists
          ? appendPage(ref.kind, ref.slug, { entry: content, when: stamp })
          : createPage(ref.kind, ref.slug, {
              title: sourceId,
              compiledTruth: content,
              tags: ['memory-protocol'],
              now: stamp,
            });
        return {
          content,
          kind,
          sourceId,
          facts,
          page: { kind: page.kind, slug: page.slug, action: exists ? 'appended' : 'created' },
        };
      });
    },

    entity(input = {}) {
      return execute('entity', async () => {
        const name = nonEmpty(input?.name, 'entity.name');
        const found = resolvePage(repo, name);
        if (!found) throw new SemanticaError('E_UNKNOWN_ENTITY', `unknown entity ${JSON.stringify(name)}`);
        const read = delegate(repo, 'read', 'brain.repo.read');
        const page = read(found.kind, found.slug);
        const graph = extractGraph(page);
        return { page, edges: graph.edges };
      });
    },

    synthesize(input = {}) {
      return execute('synthesize', async () => {
        const query = nonEmpty(input?.query, 'synthesize.query');
        const compile = delegate(repo, 'compile', 'brain.repo.compile');
        const pages = synthesisPages(repo, query);
        if (pages.length === 0) throw new SemanticaError('E_NOT_FOUND', `no pages match synthesize.query ${JSON.stringify(query)}`);
        const sources = pages.map((page) => {
          const compiled = compile(page.kind, page.slug);
          const graph = extractGraph(page);
          return {
            pageId: `${page.kind}/${page.slug}`,
            title: page.title,
            compiledTruth: compiled.compiledTruth,
            timeline: compiled.timeline,
            edges: graph.edges,
          };
        });
        return {
          query,
          answer: sources.map((source) => `${source.title}: ${source.compiledTruth}`).join('\n'),
          sources: sources.map((source) => source.pageId),
          evidence: sources,
          edges: uniqueEdges(sources.flatMap((source) => source.edges)),
        };
      });
    },

    forget(input = {}) {
      return execute('forget', async () => {
        const id = nonEmpty(input?.id, 'forget.id');
        const reason = 'requested through MEMORY_VERBS v1';
        if (typeof softDelete === 'function') {
          const result = await softDelete({ id, reason });
          return { id, reason, status: 'soft_deleted', result: clone(result ?? {}) };
        }
        const existing = deletionMarks.get(id);
        if (existing) return clone(existing);
        const mark = {
          id,
          reason,
          status: 'marked_for_deletion',
          pendingScope: 'J',
        };
        deletionMarks.set(id, mark);
        return clone(mark);
      });
    },

    version: () => versionInfo(),

    call(verb, args = {}) {
      if (!isVerb(verb)) {
        return Promise.resolve(failureEnvelope(verb, errorContract(
          'E_UNKNOWN_VERB',
          `unknown MEMORY_VERBS v1 verb ${JSON.stringify(verb)}; expected: ${VERB_NAMES.join(', ')}`,
          false,
        )));
      }
      return api[verb](args);
    },
  };

  return Object.freeze(api);
}

export const protocol = createMemoryProtocol();

export { PROTOCOL_VERSION, SURFACES, VERB_DEFINITIONS, VERB_NAMES, isVerb } from './verbs.js';
export {
  BASE_ENVELOPE_KEYS, SUCCESS_ENVELOPE_KEYS, ERROR_ENVELOPE_KEYS, ERROR_KEYS,
  successEnvelope, failureEnvelope, inspectEnvelope,
} from './envelope.js';
export { ERROR_CODES, errorContract, normalizeError, protocolFailure } from './errors.js';
export {
  VERSIONING_POLICY, versionInfo, enforceEnvelope, extendData, frozenVerbNames,
} from './versioning.js';
export { assertConformantEnvelope, assertFrozenDefinitions, runConformance } from './conformance.js';
