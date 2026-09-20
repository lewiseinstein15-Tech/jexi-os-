import { copyJson, error, recordFor } from './storage.js';

const DEFAULT_IDLE_MS = 30 * 60 * 1000;

function iso(clock) {
  const value = new Date(clock());
  if (Number.isNaN(value.valueOf())) throw error('E_CLOCK');
  return value.toISOString();
}

function find(graph, id) {
  return graph.agents.find(agent => agent.id === id);
}

export function createRetention({ graph, storage, clock }) {
  return {
    persist(agentId) {
      const agent = find(graph, agentId);
      if (!agent) throw error('E_AGENT_NOT_FOUND');
      return storage.locked(() => {
        const state = recordFor(storage, agent);
        const persistedAt = iso(clock);
        state.agent = copyJson(agent);
        state.persistedAt = persistedAt;
        storage.write(agentId, state);
        return { persistedAt };
      });
    },

    restore(agentId) {
      return storage.locked(() => {
        const state = storage.read(agentId);
        if (!state) return { restored: false };
        const restored = { ...state.agent, state: 'live', lastActivityAt: iso(clock) };
        state.agent = copyJson(restored);
        state.persistedAt = iso(clock);
        storage.write(agentId, state);
        const position = graph.agents.findIndex(agent => agent.id === agentId);
        if (position === -1) graph.agents.push(restored);
        else graph.agents[position] = restored;
        return { restored: true, state: copyJson(restored) };
      });
    },

    evictIdle(thresholdMs = DEFAULT_IDLE_MS) {
      if (!Number.isFinite(thresholdMs) || thresholdMs < 0) throw error('E_IDLE_THRESHOLD');
      const now = clock();
      if (!Number.isFinite(now)) throw error('E_CLOCK');
      return storage.locked(() => {
        const evicted = [];
        for (const agent of graph.agents) {
          if (agent.state !== 'live') continue;
          const lastActivity = Date.parse(agent.lastActivityAt);
          if (!Number.isFinite(lastActivity)) throw error('E_ACTIVITY_TIME');
          if (now - lastActivity <= thresholdMs) continue;

          // The durable evicted record is fsynced before the in-memory graph is
          // changed. Eviction is retention, not deletion.
          const state = recordFor(storage, agent);
          const retained = { ...agent, state: 'evicted' };
          state.agent = copyJson(retained);
          state.persistedAt = iso(clock);
          storage.write(agent.id, state);
          agent.state = 'evicted';
          evicted.push(agent.id);
        }
        return { evicted };
      });
    },
  };
}

export { DEFAULT_IDLE_MS };
