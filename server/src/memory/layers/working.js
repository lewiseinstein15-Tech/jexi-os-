/**
 * JEXI OS — MEMORY — working tier.
 *
 * Current-task scratchpad. Writes persist (SQLite), but entries auto-expire
 * after `ttlMs` (default 30 min) — the working tier is ephemeral by design.
 * Only the current mission sees its own working memory.
 */
import { MissionIsolation } from '../scope/mission-isolation.js';
import { validateEntry } from '../interface/MemoryProvider.js';

export const WORKING_DEFAULT_TTL_MS = 30 * 60 * 1000;

export function createWorkingLayer(backend, { ttlMs = WORKING_DEFAULT_TTL_MS } = {}) {
  return {
    tier: 'working',
    async write({ missionId, content, metadata = {}, ttlMs: overrideTtl }) {
      const effectiveTtl = overrideTtl ?? ttlMs;
      const v = validateEntry({ missionId, tier: 'working', content, metadata, createdAt: Date.now(), expiresAt: Date.now() + effectiveTtl });
      if (!v.ok) throw new Error(v.problems.join('; '));
      await backend.insert(v.entry);
      return v.entry;
    },

    async list({ missionId, limit = 50 } = {}) {
      MissionIsolation.requireMission({ missionId }, 'working.list');
      const rows = await backend.recall({ missionId, tier: 'working', limit });
      return rows;
    },

    async expire({ missionId }) {
      // Backend recall filters expired rows; purge physically.
      MissionIsolation.requireMission({ missionId }, 'working.expire');
      const removed = await backend.purgeExpired();
      return { removed, note: 'expired working-tier entries purged' };
    },
  };
}