/**
 * JEXI OS — MEMORY — semantic tier.
 *
 * Learned facts. Newer fact wins on contradiction: writing a fact under the
 * same `subject`/`attribute` key supersedes (marks superseded, stores newest).
 * Facts are mission-scoped but can be surfaced for the same user across
 * missions via `shared` metadata.
 */
import { MissionIsolation } from '../scope/mission-isolation.js';
import { validateEntry, scoreRelevance } from '../interface/MemoryProvider.js';

export function createSemanticLayer(backend) {
  return {
    tier: 'semantic',

    async record({ missionId, subject, attribute = 'fact', value, content, metadata = {} }) {
      MissionIsolation.requireMission({ missionId }, 'semantic.record');
      const text = content ?? `${subject}: ${typeof value === 'string' ? value : JSON.stringify(value)}`;
      // Deterministic key → NEWER FACT WINS (write supersedes, keeps audit copy).
      const stableKey = `semantic::${subject}::${attribute}`;
      const v = validateEntry({
        id: stableKey,
        missionId,
        tier: 'semantic',
        content: text,
        metadata: { ...metadata, subject, attribute, value, kind: 'fact' },
        createdAt: Date.now(),
      });
      if (!v.ok) throw new Error(v.problems.join('; '));
      await backend.insert(v.entry);
      return v.entry;
    },

    async recall({ missionId, query, limit = 20, minRelevance = 0 } = {}) {
      MissionIsolation.requireMission({ missionId }, 'semantic.recall');
      const rows = await backend.recall({ missionId, tier: 'semantic', limit: Math.max(limit * 3, 20) });
      if (!query) return rows.slice(0, limit);
      const scored = rows.map((r) => ({ entry: r, score: scoreRelevance(query, r) }));
      scored.sort((a, b) => b.score - a.score);
      return scored.filter((s) => s.score >= minRelevance).slice(0, limit).map((s) => s.entry);
    },

    async fact({ missionId, subject, attribute = 'fact' }) {
      MissionIsolation.requireMission({ missionId }, 'semantic.fact');
      const row = await backend.byKey(`semantic::${subject}::${attribute}`);
      return row && row.missionId === missionId ? row : null;
    },

    async delete({ missionId, subject, attribute = 'fact' }) {
      MissionIsolation.requireMission({ missionId }, 'semantic.delete');
      await backend.deleteByKey(`semantic::${subject}::${attribute}`);
    },
  };
}