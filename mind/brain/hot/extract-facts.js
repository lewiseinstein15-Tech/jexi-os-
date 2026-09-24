/**
 * JEXI OS — Phase 28 Scope F — per-turn fact extraction pipeline.
 *
 * Declared decision tree:
 *   cosine >= 0.95  -> duplicate, skip classifier (cheap fast-path)
 *   otherwise call injected contradiction classifier when available
 *   classifier failure/unavailable + cosine >= 0.92 -> duplicate fallback
 *   classifier failure/unavailable + cosine <  0.92 -> independent insert
 *
 * Extraction and classification providers are injected. No network client.
 */
import { SemanticaError } from '../../../services/semantica/_internal.js';
import { ruleBased, cosine } from '../index/index.js';
import { assertFactKind } from './kinds.js';

export const COSINE_FAST_PATH = 0.95;
export const CLASSIFIER_FALLBACK = 0.92;
export const HOT_QUEUE_CAP = 100;
export const RULE_BASED_EXTRACTION_LABEL = 'rule-based — LLM extraction NOT VERIFIED';

const KIND_RULES = Object.freeze([
  ['commitment', /\b(i|we)\s+(will|shall|promise|commit(?:ted)?|plan(?:ned)?\s+to|intend(?:ed)?\s+to|must)\b/i],
  ['preference', /\b(prefer|preferred|like|liked|dislike|disliked|favorite|favourite|would rather)\b/i],
  ['belief', /\b(i|we)\s+(believe|think|feel|suspect|expect)|\b(in my view|my belief|my opinion)\b/i],
  ['event', /\b(today|yesterday|tomorrow|met|attended|visited|happened|launched|started|ended|arrived|left)\b|\b\d{4}-\d{2}-\d{2}\b/i],
]);

function inferKind(sentence) {
  for (const [kind, pattern] of KIND_RULES) if (pattern.test(sentence)) return kind;
  return 'fact';
}

function splitSentences(text) {
  return String(text).split(/\n+|(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

export const ruleBasedExtractor = Object.freeze({
  name: 'rule-based',
  label: RULE_BASED_EXTRACTION_LABEL,
  available: () => true,
  async extract(turn) {
    return splitSentences(turn.text).map((sentence) => ({
      fact: sentence,
      kind: inferKind(sentence),
      evidence: sentence,
    }));
  },
});

function providerAvailable(provider) {
  if (!provider || typeof provider !== 'object' || typeof provider.name !== 'string' || provider.name === '' ||
      typeof provider.extract !== 'function') return false;
  if (typeof provider.available === 'function') {
    try { return provider.available() === true; } catch { return false; }
  }
  if (provider.available === false) return false;
  return true;
}

export function resolveExtractorBackend({ backend = 'rule-based', provider } = {}) {
  if (backend && typeof backend === 'object' && typeof backend.extract === 'function') {
    return {
      name: backend.name || 'injected',
      label: backend.label || `provider — ${backend.name || 'injected'}`,
      available: typeof backend.available === 'function' ? () => backend.available() === true : () => true,
      extract: (turn) => backend.extract(turn),
    };
  }
  if (backend === 'rule-based') return ruleBasedExtractor;
  if (backend === 'provider') {
    if (!providerAvailable(provider)) {
      throw new SemanticaError('E_PROVIDER_UNAVAILABLE',
        'no fact-extraction provider configured; refusing to fake LLM extraction — use rule-based explicitly');
    }
    return {
      name: `provider:${provider.name}`,
      label: `provider — ${provider.name}`,
      available: () => true,
      extract: (turn) => provider.extract(turn),
    };
  }
  throw new SemanticaError('E_UNKNOWN_BACKEND',
    `unknown fact extractor backend ${JSON.stringify(backend)}; known: rule-based, provider (or injected object)`);
}

/** Bounded FIFO of pending, not-yet-recorded candidate facts. */
export function createBoundedFactQueue(cap = HOT_QUEUE_CAP) {
  if (!Number.isInteger(cap) || cap <= 0) {
    throw new SemanticaError('E_INVALID_ARGUMENT', 'fact queue cap must be a positive integer');
  }
  const pending = [];
  const dropped = [];
  return {
    push(candidate) {
      if (pending.length >= cap) dropped.push(pending.shift());
      pending.push(candidate);
      return { size: pending.length, dropped: dropped.length ? dropped[dropped.length - 1] : null };
    },
    drain() { return pending.splice(0, pending.length); },
    snapshot() { return pending.map((item) => ({ ...item })); },
    dropped() { return dropped.map((item) => ({ ...item })); },
    get size() { return pending.length; },
    cap,
  };
}

function normalizeCandidate(candidate, index) {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.fact !== 'string' || candidate.fact.trim() === '') {
    throw new SemanticaError('E_BACKEND_CONTRACT', `extractor result ${index} must carry non-empty fact`);
  }
  const kind = assertFactKind(candidate.kind);
  return {
    fact: candidate.fact.trim(),
    kind,
    evidence: typeof candidate.evidence === 'string' && candidate.evidence.trim() !== ''
      ? candidate.evidence.trim() : candidate.fact.trim(),
    ...(typeof candidate.contradicts === 'string' ? { contradicts: candidate.contradicts } : {}),
  };
}

async function embedText(embedder, text) {
  const vectors = await embedder.embed([text]);
  if (!Array.isArray(vectors) || !Array.isArray(vectors[0]) || vectors.length !== 1) {
    throw new SemanticaError('E_BACKEND_CONTRACT', 'hot-memory embedder must return one numeric vector per text');
  }
  return vectors[0];
}

function classifierAvailable(classifier) {
  if (!classifier || typeof classifier.classify !== 'function') return false;
  if (typeof classifier.available === 'function') {
    try { return classifier.available() === true; } catch { return false; }
  }
  if (classifier.available === false) return false;
  return true;
}

function validClassifierDecision(result, candidates) {
  if (!result || typeof result !== 'object') return null;
  if (result.decision === 'independent') return { decision: 'independent', reason: 'classifier' };
  const matchedId = result.matchedId ?? result.matched_id ?? result.supersedesId ?? result.supersedes_id;
  if (typeof matchedId !== 'string' || !candidates.some((candidate) => candidate.id === matchedId)) return null;
  if (result.decision === 'duplicate') return { decision: 'duplicate', matchedId, reason: 'classifier' };
  if (result.decision === 'supersede') return { decision: 'supersede', matchedId, reason: 'classifier' };
  return null;
}

/** Pure orchestration decision plus the computed embedding. */
export async function classifyCandidate(candidate, existing, {
  embedder = ruleBased,
  classifier,
  fastThreshold = COSINE_FAST_PATH,
  fallbackThreshold = CLASSIFIER_FALLBACK,
} = {}) {
  const embedding = await embedText(embedder, candidate.fact);
  const ranked = existing
    .filter((fact) => Array.isArray(fact.embedding))
    .map((fact) => ({ ...fact, similarity: cosine(embedding, fact.embedding) }))
    .sort((a, b) => (b.similarity - a.similarity) || (a.id < b.id ? -1 : 1));
  const top = ranked[0];
  if (!top) return { decision: 'independent', reason: 'no_candidates', embedding, similarity: 0 };

  if (top.similarity >= fastThreshold) {
    return { decision: 'duplicate', matchedId: top.id, reason: 'cosine_fast_path', embedding, similarity: top.similarity };
  }

  if (classifierAvailable(classifier)) {
    try {
      const result = validClassifierDecision(await classifier.classify({
        candidate: { fact: candidate.fact, kind: candidate.kind },
        candidates: ranked.slice(0, 5).map(({ embedding: _embedding, ...fact }) => fact),
      }), ranked);
      if (result) return { ...result, embedding, similarity: top.similarity };
    } catch {
      // Deliberately fall through to the declared 0.92 cosine fallback.
    }
  }

  if (top.similarity >= fallbackThreshold) {
    return { decision: 'duplicate', matchedId: top.id, reason: 'cosine_fallback', embedding, similarity: top.similarity };
  }
  return { decision: 'independent', reason: 'cosine_fallback', embedding, similarity: top.similarity };
}

/**
 * Extract one turn. Durable writes are delegated to callbacks so this module
 * owns pipeline policy while index.js owns storage/audit state.
 */
export async function extractFacts(turn, {
  backend = ruleBasedExtractor,
  embedder = ruleBased,
  classifier,
  queueCap = HOT_QUEUE_CAP,
  existingFacts,
  recordFact,
} = {}) {
  const raw = await backend.extract(turn);
  if (!Array.isArray(raw)) {
    throw new SemanticaError('E_BACKEND_CONTRACT', `fact extractor ${backend.name} must return an array`);
  }
  const queue = createBoundedFactQueue(queueCap);
  raw.forEach((candidate, index) => queue.push(normalizeCandidate(candidate, index)));

  const facts = [];
  const decisions = [];
  for (const candidate of queue.drain()) {
    const existing = existingFacts();
    let decision;
    if (candidate.contradicts) {
      decision = {
        decision: 'supersede', matchedId: candidate.contradicts,
        reason: 'extractor_explicit', embedding: await embedText(embedder, candidate.fact), similarity: 0,
      };
    } else {
      decision = await classifyCandidate(candidate, existing, { embedder, classifier });
    }
    decisions.push({ fact: candidate.fact, decision: decision.decision, reason: decision.reason, similarity: decision.similarity });
    if (decision.decision === 'duplicate') continue;
    const fact = await recordFact(candidate, decision.embedding, decision.decision === 'supersede' ? decision.matchedId : undefined);
    facts.push(fact);
  }
  return { facts, dropped: queue.dropped(), decisions };
}
