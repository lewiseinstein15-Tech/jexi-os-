/**
 * JEXI OS — Phase 28 Scope F — fact taxonomy + hot-memory public surface.
 *
 *   const hot = createHotMemory({ nowDay: () => injectedDaySeq });
 *   await hot.extract({ text, sourceId, sessionId, opSeq, daySeq });
 *   hot.recall({ since?, kind?, sourceId? });
 *   hot.meta({ sessionId, sourceId }) -> { brain_hot_memory: { facts } }
 *   hot.supersessions(factId);
 *   hot.decay(fact) -> { score };
 *
 * No wall clock. Fact ids, ordering, decay, and "today" all derive from
 * injected content/op/day sequences. Supersession never deletes either fact.
 */
import { createHash } from 'node:crypto';
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { ruleBased } from '../index/index.js';
import { FACT_KINDS, assertFactKind } from './kinds.js';
import { HALFLIFE_DAYS, decay as decayAtDay } from './decay.js';
import { recallFacts, recallToday as renderToday, formatRecallMarkdown } from './recall.js';
import { createMcpMeta, allowListHash } from './mcp-meta.js';
import { createSupersessionAudit } from './supersession.js';
import {
  resolveExtractorBackend, extractFacts,
  COSINE_FAST_PATH, CLASSIFIER_FALLBACK, HOT_QUEUE_CAP,
  RULE_BASED_EXTRACTION_LABEL, createBoundedFactQueue, classifyCandidate,
} from './extract-facts.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const nonEmpty = (value, what) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${what} must be a non-empty string`);
  }
  return value;
};
const integer = (value, what) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', `${what} must be a non-negative integer operation/day sequence`);
  }
  return value;
};

function factId({ sourceId, sessionId, opSeq, kind, fact }) {
  return 'fact-' + createHash('sha256')
    .update(`${sourceId}\0${sessionId}\0${opSeq}\0${kind}\0${fact}`, 'utf8')
    .digest('hex').slice(0, 16);
}

async function embedOne(embedder, text) {
  const vectors = await embedder.embed([text]);
  if (!Array.isArray(vectors) || vectors.length !== 1 || !Array.isArray(vectors[0])) {
    throw new SemanticaError('E_BACKEND_CONTRACT', 'hot-memory embedder must return one numeric vector per input');
  }
  return vectors[0];
}

export function createHotMemory({
  backend = 'rule-based',
  provider,
  embedder = ruleBased,
  classifier,
  nowDay = () => 0,
  queueCap = HOT_QUEUE_CAP,
  metaTopK = 10,
} = {}) {
  if (!embedder || typeof embedder.embed !== 'function') {
    throw new SemanticaError('E_BACKEND_CONTRACT', 'hot-memory embedder must expose embed(texts)');
  }
  if (typeof nowDay !== 'function') {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'nowDay must be an injected function returning an integer day sequence');
  }
  const extractorBackend = resolveExtractorBackend({ backend, provider });
  const records = [];
  const byId = new Map();
  const embeddings = new Map();
  const audit = createSupersessionAudit();
  let last = { dropped: [], decisions: [] };

  const recall = (opts = {}) => recallFacts(records, opts);
  const metaSurface = createMcpMeta({ recall, topK: metaTopK });

  async function record(input, { embedding } = {}) {
    if (!input || typeof input !== 'object') {
      throw new SemanticaError('E_INVALID_ARGUMENT', 'hot.record requires a fact object');
    }
    const fact = nonEmpty(input.fact, 'fact').trim();
    const kind = assertFactKind(input.kind);
    const sourceId = nonEmpty(input.sourceId ?? input.source_id ?? 'default', 'sourceId');
    const sessionId = nonEmpty(input.sessionId ?? input.session_id ?? 'default', 'sessionId');
    const opSeq = integer(input.opSeq ?? input.op_seq, 'opSeq');
    const createdDay = integer(input.createdDay ?? input.created_day ?? nowDay(), 'createdDay');
    const evidence = typeof input.evidence === 'string' && input.evidence.trim() !== '' ? input.evidence.trim() : fact;
    const confidence = input.confidence === undefined ? 1 : Number(input.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new SemanticaError('E_INVALID_ARGUMENT', 'fact confidence must be between 0 and 1');
    }
    const contradicts = input.contradicts ?? input.supersedesId ?? input.supersedes_id;
    let target;
    if (contradicts !== undefined) {
      target = byId.get(contradicts);
      if (!target || target.source_id !== sourceId) {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'supersession target must exist in the same source_id');
      }
    }
    // ui/decision-layer-rendering (Part 2) — optional STRUCTURED chat-turn
    // payload. The chat bridge (BrainRecall.brainHotWriteTurn) passes the
    // full turn {user, assistant, ts, sessionId} so downstream consumers can
    // read who said what and when without parsing the composed fact string.
    // Pure metadata: everything is passed IN by the caller — this store stays
    // wall-clock-free and generates nothing itself.
    const turnMeta = input.turn && typeof input.turn === 'object' && !Array.isArray(input.turn)
      ? {
          user: typeof input.turn.user === 'string' ? input.turn.user.slice(0, 400) : '',
          assistant: typeof input.turn.assistant === 'string' ? input.turn.assistant.slice(0, 400) : '',
          ts: typeof input.turn.ts === 'string' ? input.turn.ts : '',
          sessionId: typeof input.turn.sessionId === 'string' ? input.turn.sessionId : sessionId,
        }
      : null;

    // IDs are content-addressed WITH source/session/op sequence. Callers may
    // not inject an id that collides across source boundaries.
    const id = factId({ sourceId, sessionId, opSeq, kind, fact });
    if (byId.has(id)) return clone(byId.get(id));
    const vector = embedding ?? await embedOne(embedder, fact);
    const row = {
      id,
      fact,
      kind,
      evidence,
      source_id: sourceId,
      session_id: sessionId,
      op_seq: opSeq,
      created_day: createdDay,
      confidence,
      superseded_by: null,
      ...(turnMeta ? { turn: turnMeta } : {}),
    };
    records.push(row);
    byId.set(id, row);
    embeddings.set(id, vector);

    if (target) {
      target.superseded_by = id;
      audit.record({
        factId: target.id,
        supersededBy: id,
        sourceId,
        opSeq,
        evidence: input.supersessionEvidence ?? evidence,
      });
    }
    metaSurface.invalidate(sourceId, sessionId);
    return clone(row);
  }

  return {
    async extract(turn) {
      if (!turn || typeof turn !== 'object') {
        throw new SemanticaError('E_INVALID_ARGUMENT', 'hot.extract(turn): turn must be an object');
      }
      const normalized = {
        ...turn, // preserve provider-specific turn metadata without trusting it for scope/time
        text: nonEmpty(turn.text, 'turn.text'),
        sourceId: nonEmpty(turn.sourceId ?? turn.source_id ?? 'default', 'turn.sourceId'),
        sessionId: nonEmpty(turn.sessionId ?? turn.session_id ?? 'default', 'turn.sessionId'),
        opSeq: integer(turn.opSeq ?? turn.op_seq, 'turn.opSeq'),
        daySeq: integer(turn.daySeq ?? turn.day_seq ?? nowDay(), 'turn.daySeq'),
      };
      let available = false;
      try { available = extractorBackend.available() === true; } catch { available = false; }
      if (!available) {
        throw new SemanticaError('E_PROVIDER_UNAVAILABLE', `fact extractor ${extractorBackend.name} is unavailable; extraction not faked`);
      }
      const result = await extractFacts(normalized, {
        backend: extractorBackend,
        embedder,
        classifier,
        queueCap,
        existingFacts: () => records
          .filter((fact) => fact.source_id === normalized.sourceId && fact.superseded_by === null)
          .map((fact) => ({ ...fact, embedding: embeddings.get(fact.id) })),
        recordFact: (candidate, embedding, supersedesId) => record({
          ...candidate,
          sourceId: normalized.sourceId,
          sessionId: normalized.sessionId,
          opSeq: normalized.opSeq,
          createdDay: normalized.daySeq,
          ...(supersedesId ? { contradicts: supersedesId } : {}),
        }, { embedding }),
      });
      last = { dropped: result.dropped, decisions: result.decisions };
      return result.facts;
    },

    record,
    recall,
    recallToday: ({ midnightSeq, sourceId = 'default', kind } = {}) =>
      renderToday(records, { midnightSeq, sourceId, kind }),
    meta: (opts) => metaSurface.get(opts),
    metaCacheSize: () => metaSurface.size(),
    supersessions: (id) => audit.forFact(id),
    decay(fact) {
      const day = integer(nowDay(), 'nowDay()');
      return decayAtDay(fact, { nowDay: day });
    },

    /** Audit/debug surfaces; clones prevent callers mutating durable state. */
    facts: ({ sourceId = 'default' } = {}) => recall({ sourceId }),
    lastExtraction: () => clone(last),
    extractor: () => ({ backend: extractorBackend.name, label: extractorBackend.label }),
    get size() { return records.length; },
  };
}

/** Process-local deterministic default: day sequence 0, explicit rule backend. */
export const hot = createHotMemory();

export { FACT_KINDS, assertFactKind } from './kinds.js';
export { HALFLIFE_DAYS } from './decay.js';
export { recallFacts, recallToday, formatRecallMarkdown } from './recall.js';
export { createMcpMeta, allowListHash, HOT_META_CACHE_CAP } from './mcp-meta.js';
export { createSupersessionAudit } from './supersession.js';
export {
  COSINE_FAST_PATH, CLASSIFIER_FALLBACK, HOT_QUEUE_CAP,
  RULE_BASED_EXTRACTION_LABEL, createBoundedFactQueue, classifyCandidate,
  resolveExtractorBackend, ruleBasedExtractor,
} from './extract-facts.js';
