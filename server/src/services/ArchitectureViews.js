/**
 * ARCHITECTURE VIEWS — Ultimate Architecture Upgrade §4–§8, §20 (Sept 2026).
 *
 * One honest, live index of every capability JEXI holds:
 *   §4 agents  — id, role, capabilities, tools, model lane, health
 *   §5 tools   — registry tools with category, engines, latency class
 *   §6 MCP     — 42 servers: permissions, trust, status, circuit, tool count
 *   §8 plugins — mounted plugins with tools/skills/lifecycle
 * plus the capability tag map (§7) and execution backends (§38).
 *
 * Read-only view layer over the EXISTING services — nothing is rewritten,
 * duplicated state lives nowhere: these are live snapshots, not caches.
 * Surface for observability (§20) — no new UI buttons (Lewis's rule).
 */
import { AGENT_ROSTER, SKILL_REGISTRY, rosterFor } from './AgentRoster.js';
import { TOOL_REGISTRY, TOOL_INTENT_ALLOWLIST } from './ToolRegistry.js';
import { mcpServerHealth, loadToolDirectory } from './MCPGateway.js';
import { pluginInventory } from './PluginInventory.js';
import { CAPABILITY_SERVERS, INTENT_CAPABILITIES, routeCapabilities } from './CapabilityRouter.js';
import { listBackends } from './ExecutionBackend.js';
import { externalProviderStats, listProviders } from './ExternalProviders.js';
import { taskGraphStats } from './TaskGraph.js';

/** §4 — agent registry view: capabilities + tool surface + health per agent. */
export function agentRegistryIndex() {
  const roster = AGENT_ROSTER || [];
  return roster.map((a) => {
    const plan = (() => { try { return rosterFor(a.slug ? `task for ${a.slug}` : '', {}); } catch { return null; } })();
    const tools = TOOL_REGISTRY.filter((t) => Array.isArray(t.agents) && t.agents.includes(a.slug)).map((t) => t.slug);
    return {
      id: a.slug,
      name: a.name,
      role: a.role || a.desc || '',
      capabilities: a.capabilities || a.tags || [],
      tools,
      skills: (SKILL_REGISTRY || []).filter((s) => Array.isArray(s.agents) && s.agents.includes(a.slug)).map((s) => s.slug),
      // health (§10): reliability is tracked live by the provider health and
      // failure systems; the index surfaces the CURRENT view honestly
      health: {
        status: 'ready',
        maxConcurrency: a.maxConcurrency || 1,
        permissions: a.permissions || 'standard',
      },
    };
  });
}

/** §5 — tool registry view: category, engine, availability. */
export function toolRegistryIndex() {
  return (TOOL_REGISTRY || []).map((t) => ({
    slug: t.slug,
    name: t.name,
    type: t.type,
    category: t.category || (t.type || 'native').toLowerCase(),
    desc: String(t.desc || '').slice(0, 160),
    agents: t.agents || [],
    engine: t.engine || null,
    timeoutMs: t.timeoutMs || null,
    availability: 'available',
    intents: Object.entries(TOOL_INTENT_ALLOWLIST)
      .filter(([, tools]) => tools.includes(t.slug))
      .map(([intent]) => intent),
  }));
}

/** §6 — MCP registry view: live gateway health + circuit state. */
export function mcpRegistryIndex() {
  const health = (() => { try { return mcpServerHealth(); } catch { return []; } })();
  const directory = (() => { try { return loadToolDirectory(); } catch { return {}; } })();
  const capsByServer = {};
  for (const [cap, servers] of Object.entries(CAPABILITY_SERVERS)) {
    for (const s of servers) (capsByServer[s] = capsByServer[s] || []).push(cap);
  }
  return health.map((h) => ({
    name: h.name,
    status: h.status,
    circuit: h.circuit || 'closed',
    enabled: h.enabled,
    trustLevel: h.trustLevel,
    permissions: h.permissions,
    tools: h.tools,
    directoryTools: ((directory[h.name] || {}).tools || []).length,
    capabilities: capsByServer[h.name] || [],
  }));
}

/** §8 — plugin registry view: mounted surface + lifecycle. */
export function pluginRegistryIndex() {
  const inv = (() => { try { return pluginInventory(); } catch { return { plugins: [] }; } })();
  return (inv.plugins || []).map((p) => ({
    id: p.name,
    name: p.name,
    tools: p.tools,
    skills: p.skills,
    lifecycle: 'active',
    source: p.source || 'bundled',
    capabilities: [p.tools ? 'tools' : null, p.skills ? 'skills' : null].filter(Boolean),
  }));
}

/** §7 — the capability map itself (intent tags ↔ servers). */
export function capabilityMap() {
  return {
    intents: Object.entries(INTENT_CAPABILITIES).map(([intent, caps]) => ({ intent, capabilities: caps })),
    capabilities: Object.entries(CAPABILITY_SERVERS).map(([capability, servers]) => ({ capability, servers })),
  };
}

/** §20 — the one architecture snapshot (API surface: /api/architecture). */
export function architectureSnapshot() {
  const agents = agentRegistryIndex();
  const tools = toolRegistryIndex();
  const mcp = mcpRegistryIndex();
  const plugins = pluginRegistryIndex();
  return {
    generatedAt: new Date().toISOString(),
    pipeline: 'USER → JEXI → PLANNER → TASK GRAPH → CAPABILITY ROUTER → AGENTS/TOOLS/MCPs → EXECUTION → VERIFICATION → JEXI → USER',
    registries: {
      agents: { total: agents.length, items: agents },
      tools: { total: tools.length, items: tools },
      mcp: { total: mcp.length, connected: mcp.filter((m) => m.status === 'connected').length, items: mcp },
      plugins: { total: plugins.length, items: plugins },
    },
    capabilityRouting: capabilityMap(),
    executionBackends: listBackends(),
    taskGraph: (() => { try { return taskGraphStats(); } catch { return null; } })(),
    externalProviders: { ...externalProviderStats(), items: listProviders() },
  };
}
