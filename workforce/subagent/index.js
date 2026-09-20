import path from 'node:path';
import { assertInScope } from './family.js';
import { createDiscovery } from './discovery.js';
import { createMessaging } from './messaging.js';
import { createRetention } from './retention.js';
import { assertAgentId, createStorage, error } from './storage.js';

function nowIso(clock) {
  const value = new Date(clock());
  if (Number.isNaN(value.valueOf())) throw error('E_CLOCK');
  return value.toISOString();
}

function normalizeGraph(graph, clock) {
  if (!graph || !Array.isArray(graph.agents)) throw error('E_AGENT_GRAPH');
  const seen = new Set();
  for (const agent of graph.agents) {
    if (!agent || typeof agent !== 'object') throw error('E_AGENT_GRAPH');
    assertAgentId(agent.id);
    if (seen.has(agent.id)) throw error('E_AGENT_GRAPH');
    seen.add(agent.id);
    if (agent.parentId != null) assertAgentId(agent.parentId);
    if (agent.state == null) agent.state = 'live';
    if (!['live', 'evicted'].includes(agent.state)) throw error('E_AGENT_STATE');
    if (agent.role == null) agent.role = 'subagent';
    if (typeof agent.role !== 'string' || !agent.role) throw error('E_AGENT_ROLE');
    if (agent.lastActivityAt == null) agent.lastActivityAt = nowIso(clock);
    if (!Number.isFinite(Date.parse(agent.lastActivityAt))) throw error('E_ACTIVITY_TIME');
  }
}

/**
 * Create one local retained-subagent registry. `graph` remains caller-owned and
 * in-memory; only per-agent envelopes and retained agent records go to disk.
 */
export function createSubagents({
  graph = { agents: [] },
  directory = path.resolve('.jexi/subagents'),
  clock = () => Date.now(),
} = {}) {
  normalizeGraph(graph, clock);
  const storage = createStorage(directory);
  const options = { graph, storage, clock };
  return {
    family: { assertInScope },
    messaging: createMessaging(options),
    retention: createRetention(options),
    discovery: createDiscovery(options),
  };
}

export { assertInScope };
export default createSubagents;
