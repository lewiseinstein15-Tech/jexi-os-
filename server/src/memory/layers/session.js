/**
 * JEXI OS — MEMORY — session tier.
 *
 * Current-mission transcript/facts. Survives restart (SQLite), scoped to the
 * mission, no auto-expiry. syncTurn appends each conversation turn here.
 */
import { MissionIsolation } from '../scope/mission-isolation.js';
import { validateEntry } from '../interface/MemoryProvider.js';

export function createSessionLayer(backend) {
  return {
    tier: 'session',

    async write({ missionId, content, metadata = {} }) {
      const v = validateEntry({ missionId, tier: 'session', content, metadata, createdAt: Date.now() });
      if (!v.ok) throw new Error(v.problems.join('; '));
      await backend.insert(v.entry);
      return v.entry;
    },

    async list({ missionId, limit = 200 } = {}) {
      MissionIsolation.requireMission({ missionId }, 'session.list');
      return backend.recallAll({ missionId, tier: 'session', limit });
    },

    /** One conversation turn → one session entry. */
    async syncTurn({ missionId, role, text, at = Date.now(), metadata = {} }) {
      MissionIsolation.requireMission({ missionId }, 'session.syncTurn');
      const v = validateEntry({
        missionId, tier: 'session', content: text, metadata: { ...metadata, role, kind: 'turn' }, createdAt: at,
      });
      if (!v.ok) throw new Error(v.problems.join('; '));
      await backend.insert(v.entry);
      return v.entry;
    },
  };
}