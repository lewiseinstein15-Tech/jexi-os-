/**
 * JEXI OS — MEMORY subsystem (Phase 4, Scope A).
 *
 * Hermes-style provider interface + SQLite backend + four tiers
 * (working/session/episodic/semantic), mission isolation enforced by the
 * kernel. Built OVER the existing STRONG memory core (MemoryLayers,
 * WorldModel, MemoryLifecycle) — nothing replaced.
 *
 *   const { createMemorySystem, openMemorySystem } = await import('./memory/index.js');
 *   const mem = await openMemorySystem({ file: 'data/memory.db' });
 *   await mem.layers.working.write({ missionId, content: '…' });
 *   const hits = await mem.recall({ missionId, query: '…', tiers: ['semantic'] });
 *   await mem.shutdown();
 */
import { estimateTokens, scoreRelevance } from './interface/MemoryProvider.js';
import { createWorkingLayer } from './layers/working.js';
import { createSessionLayer } from './layers/session.js';
import { createEpisodicLayer } from './layers/episodic.js';
import { createSemanticLayer } from './layers/semantic.js';
import { openSqliteMemoryBackend } from './backends/sqlite.js';
import { MissionIsolation } from './scope/mission-isolation.js';
// ZONE-OWNER ITEM 3 — Phase 17 D upgrade modules, now WIRED into recall/prefetch:
import { createHybridIndex } from '../../../memory/hybrid-search.js';
import { advanceEntry, isArchived } from '../../../memory/lifecycle.js';
import { noteRetrieval } from '../../../memory/confidence.js';

const ORDERED_TIERS = ['working', 'session', 'episodic', 'semantic'];

export function createMemorySystem(backend, options = {}) {
  if (!backend || !backend.insert || !backend.byKey) {
    throw new Error('createMemorySystem requires a MemoryProvider backend (see backends/sqlite.js)');
  }
  const layers = {
    working: createWorkingLayer(backend, options.working),
    session: createSessionLayer(backend),
    episodic: createEpisodicLayer(backend),
    semantic: createSemanticLayer(backend),
  };

  async function store(entry) {
    // Route to the right layer by tier.
    if (entry?.tier === 'working') return layers.working.write(entry);
    if (entry?.tier === 'session') return layers.session.write(entry);
    if (entry?.tier === 'episodic') return layers.episodic.record({ missionId: entry.missionId, content: entry.content, outcome: entry.metadata?.outcome, metadata: entry.metadata });
    if (entry?.tier === 'semantic') return layers.semantic.record({ missionId: entry.missionId, subject: entry.metadata?.subject ?? 'fact', attribute: entry.metadata?.attribute ?? 'fact', value: entry.content, metadata: entry.metadata });
    throw new Error(`store: unknown tier ${entry?.tier}`);
  }

  /**
   * ZONE-OWNER ITEM 3 — Phase 17 D upgrade, applied on READ:
   *   1. lifecycle advance() on every backend row (uses the STORED
   *      retrievalCount — the never-accessed aging rule stays honest);
   *   2. ARCHIVED rows are excluded from retrieval (hybrid-search discipline);
   *   3. hybrid re-rank (BM25 + vector, RRF) when a query text is present —
   *      E_NO_RESULTS falls back to the legacy scoreRelevance ordering;
   *   4. caller marks the rows it ACTUALLY returns via markRetrieved()
   *      (noteRetrieval: weight-0 discipline — retrieval bookkeeping never
   *      raises the confidence score).
   */
  async function rerankRows(rows, queryText) {
    const now = Date.now();
    const advanced = rows.map((r) => advanceEntry(r, { now }));
    const live = advanced.filter((r) => !isArchived(r));
    let ordered = live;
    if (queryText && live.length) {
      const index = await createHybridIndex(live);
      const res = await index.search(String(queryText), { topK: live.length });
      if (res.results?.length) {
        ordered = res.results.map((x) => x.entry);
      } else {
        // no BM25/vector signal — legacy relevance ordering, never a guess-free drop
        ordered = live
          .map((row) => ({ row, score: scoreRelevance(queryText, row) }))
          .sort((a, b) => b.score - a.score)
          .map((x) => x.row);
      }
    }
    return { rows: ordered, now, archivedOut: advanced.length - live.length };
  }

  /** Retrieval bookkeeping for rows actually returned + persist (best-effort upsert). */
  async function markRetrieved(rows, now = Date.now()) {
    const out = rows.map((r) => noteRetrieval(r, { now }));
    await Promise.all(out.map((r) => Promise.resolve().then(() => backend.insert(r)).catch(() => { /* read path never fails on bookkeeping */ })));
    return out;
  }

  async function recall(query) {
    MissionIsolation.requireMission(query, 'recall');
    const tiers = Array.isArray(query?.tier) ? query.tier : query?.tier ? [query.tier] : ORDERED_TIERS;
    const out = [];
    for (const tier of tiers) {
      const rows = await backend.recall({ missionId: query.missionId, tier, limit: query.limit ?? 20 });
      out.push(...rows);
    }
    const { rows, now } = await rerankRows(out, query.query);
    return markRetrieved(rows, now);
  }

  async function prefetch(context = {}) {
    MissionIsolation.requireMission(context, 'prefetch');
    const budget = context.tokenBudget ?? 2048;
    const tiers = Array.isArray(context?.tier) ? context.tier : context?.tier ? [context.tier] : ORDERED_TIERS;
    const collected = [];
    for (const tier of tiers) {
      const rows = await backend.recall({ missionId: context.missionId, tier, limit: 60 });
      collected.push(...rows);
    }
    // Phase 17 D: hybrid re-rank (was: raw per-tier scoreRelevance sort)
    const { rows: ranked, now } = await rerankRows(collected, context.query);
    const picked = [];
    let used = 0;
    for (const row of ranked) {
      const cost = estimateTokens(row.content);
      if (used + cost > budget) continue; // respect token budget
      picked.push(row);
      used += cost;
    }
    return markRetrieved(picked, now);
  }

  async function syncTurn(turn) {
    MissionIsolation.requireMission(turn, 'syncTurn');
    return layers.session.syncTurn(turn);
  }

  async function shutdown() {
    await backend.close?.();
  }

  return {
    backend,
    layers,
    store,
    recall,
    prefetch,
    syncTurn,
    shutdown,
    /** Kernel-scoped execution: every op inside inherits `missionId`. */
    withMission: (missionId, fn) => MissionIsolation.withMission(missionId, fn),
  };
}

/** Open a memory system: SQLite when available, else an in-memory fallback. */
export async function openMemorySystem({ file = ':memory:' } = {}) {
  const backend = await openSqliteMemoryBackend({ file });
  return createMemorySystem(backend);
}

export { MissionIsolation } from './scope/mission-isolation.js';
export { SqliteMemoryBackend, openSqliteMemoryBackend } from './backends/sqlite.js';