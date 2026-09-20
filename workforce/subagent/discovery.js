export function createDiscovery({ graph, storage }) {
  return {
    list() {
      // The active graph takes precedence for resident agents. Retained records
      // also appear if an agent is not currently resident in this graph.
      const agents = new Map();
      for (const id of storage.ids()) agents.set(id, storage.read(id).agent);
      for (const agent of graph.agents) agents.set(agent.id, agent);
      return [...agents.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(agent => ({
          id: agent.id,
          parentId: agent.parentId ?? null,
          state: agent.state === 'live' ? 'live' : 'evicted',
          lastActivityAt: agent.lastActivityAt,
          role: agent.role,
        }));
    },
  };
}
