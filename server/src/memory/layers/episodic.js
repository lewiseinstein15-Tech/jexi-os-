/**
 * JEXI OS — MEMORY — episodic tier.
 *
 * Past-mission records: what happened, what was tried, what worked/failed.
 * Queryable by content stem (lexical relevance). Never auto-expires; carries
 * provenance in metadata (missionId, outcome, at).
 */
import { MissionIsolation } from '../scope/mission-isolation.js';
import { validateEntry, scoreRelevance } from '../interface/MemoryProvider.js';

export function createEpisodicLayer(backend) {
  return {
    tier: 'episodic',

    async record({ missionId, content, outcome = 'unknown', metadata = {} }) {
      const v = validateEntry({
        missionId, tier: 'episodic', content,
        metadata: { ...metadata, outcome, kind: 'episode' }, createdAt: Date.now(),
      });
      if (!v.ok) throw new Error(v.problems.join('; '));
      await backend.insert(v.entry);
      return v.entry;
    },

    async recall({ missionId, query, limit = 20, minRelevance = 0 } = {}) {
      MissionIsolation.requireMission({ missionId }, 'episodic.recall');
      const rows = await backend.recall({ missionId, tier: 'episodic', limit: Math.max(limit * 3, 20) });
      if (!query) return rows.slice(0, limit);
      const scored = rows.map((r) => ({ entry: r, score: scoreRelevance(query, r) }));
      scored.sort((a, b) => b.score - a.score);
      return scored.filter((s) => s.score >= minRelevance).slice(0, limit).map((s) => s.entry);
    },

    /** All episodes for a mission (audit trail). */
    async forMission({ missionId, limit = 200 } = {}) {
      MissionIsolation.requireMission({ missionId }, 'episodic.forMission');
      return backend.recallAll({ missionId, tier: 'episodic', limit });
    },
  };
}