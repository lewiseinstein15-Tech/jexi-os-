/**
 * JEXI OS — MEMORY — MemoryProvider contract (Hermes `memory_provider.py`
 * pattern: one abstract interface, swappable backends).
 *
 * A MemoryProvider is the persistence contract every memory backend (SQLite
 * today, others later) satisfies. It is deliberately narrow:
 *   store/recall — the workhorse primitives
 *   syncTurn      — record one conversation turn into the session tier
 *   prefetch      — pull the N most relevant entries within a token budget
 *   shutdown      — release the backend
 *
 * Mission isolation is enforced by the kernel — every query/prefix MUST carry
 * a missionId (see scope/mission-isolation.js). It is never trusted to callers.
 *
 * @typedef {'working'|'session'|'episodic'|'semantic'} MemoryTier
 *
 * @typedef {object} MemoryEntry
 * @property {string} id
 * @property {string} missionId
 * @property {MemoryTier} tier
 * @property {string} content
 * @property {number[]} [embedding]
 * @property {Record<string, unknown>} [metadata]
 * @property {number} createdAt   — epoch ms
 * @property {number} [expiresAt] — epoch ms; working-tier entries auto-expire
 *
 * @typedef {object} MemoryQuery
 * @property {string} missionId
 * @property {MemoryTier|MemoryTier[]} [tier]
 * @property {string} [query]
 * @property {number} [limit=20]
 *
 * @typedef {object} ConversationTurn
 * @property {string} missionId
 * @property {string} role     — 'user' | 'assistant' | 'tool' | 'system'
 * @property {string} text
 * @property {number} [at]     — epoch ms
 * @property {Record<string, unknown>} [metadata]
 *
 * @typedef {object} MemoryContext
 * @property {string} missionId
 * @property {string} [query]
 * @property {MemoryTier|MemoryTier[]} [tier]
 * @property {number} [tokenBudget=2048]
 *
 * @typedef {object} MemoryProvider
 * @property {(entry: MemoryEntry) => Promise<MemoryEntry>} store
 * @property {(query: MemoryQuery) => Promise<MemoryEntry[]>} recall
 * @property {(turn: ConversationTurn) => Promise<void>} syncTurn
 * @property {(context: MemoryContext) => Promise<MemoryEntry[]>} prefetch
 * @property {() => Promise<void>} shutdown
 */

export const MEMORY_TIERS = Object.freeze(['working', 'session', 'episodic', 'semantic']);

const TOKEN_CHARS = 4; // ~4 chars/token for English prose (estimate only)

/** Rough but honest token estimate — never a claim of exact tokenization. */
export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / TOKEN_CHARS));
}

/** Cosine similarity over equal-length embedding vectors. 0 when unusable. */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Lexical relevance fallback (deterministic, zero model calls): distinctive-token overlap. */
export function tokenOverlap(query, content) {
  const q = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (!q.length) return 0;
  const words = new Set(
    String(content ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
  let hits = 0;
  for (const w of q) if (words.has(w)) hits++;
  return hits / q.length;
}

/** Relevance score for an entry against a query/stem: embeddings when present, else lexical overlap. */
export function scoreRelevance(stem, entry) {
  const q = typeof stem === 'string' ? { query: stem } : stem;
  const queryText = q?.query ?? '';
  const entryText = entry?.content ?? '';
  if (!queryText) return 0;
  const qEmb = Array.isArray(q?.embedding) ? q.embedding : null;
  const eEmb = Array.isArray(entry?.embedding) ? entry.embedding : null;
  if (qEmb && eEmb) return cosineSimilarity(qEmb, eEmb);
  return tokenOverlap(queryText, entryText);
}

/**
 * Validate an incoming MemoryEntry. Returns normalized entry (id auto-set,
 * defaults applied) or a problems list. Metadata must be JSON-serializable.
 */
export function validateEntry(raw) {
  const problems = [];
  const e = { ...(raw ?? {}) };
  if (!e || typeof e !== 'object') return { ok: false, problems: ['entry must be an object'] };
  if (!e.missionId || typeof e.missionId !== 'string') problems.push('missionId is required');
  if (!MEMORY_TIERS.includes(e.tier)) problems.push(`tier must be one of ${MEMORY_TIERS.join('|')}`);
  if (typeof e.content !== 'string' || !e.content.trim()) problems.push('content must be a non-empty string');
  if (e.metadata !== undefined && (typeof e.metadata !== 'object' || e.metadata === null || Array.isArray(e.metadata))) {
    problems.push('metadata must be a plain object');
  }
  if (e.embedding !== undefined && (!Array.isArray(e.embedding) || e.embedding.some((n) => typeof n !== 'number'))) {
    problems.push('embedding must be an array of numbers');
  }
  if (problems.length) return { ok: false, problems };
  e.id = e.id ?? `${e.tier}-${e.missionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  e.metadata = e.metadata ?? {};
  e.createdAt = e.createdAt ?? Date.now();
  return { ok: true, entry: e };
}

/**
 * Validate a query/context. Mission isolation: missionId is MANDATORY —
 * the kernel refuses mission-less reads.
 */
export function validateQuery(query, label = 'query') {
  if (!query || typeof query !== 'object') return { ok: false, problems: [`${label} must be an object`] };
  if (!query.missionId || typeof query.missionId !== 'string') {
    return { ok: false, problems: [`${label}.missionId is required — kernel isolation`] };
  }
  return { ok: true };
}