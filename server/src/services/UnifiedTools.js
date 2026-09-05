/**
 * JEXI OS — UNIFIED TOOL ABSTRACTION (AGI Phase 3).
 *
 * Every tool — native, MCP, browser/computer — appears through ONE interface
 * (spec §21):
 *
 *   Tool { id, description, schema, source, permissions, risk, timeoutMs,
 *          cost, verification, execute(args, opts) }
 *
 * The planner reasons about capabilities, not implementations. Execution is
 * REAL for every source:
 *   - native  → ToolRuntime.executeTool (the proven, permission-profiled path)
 *   - mcp     → MCPGateway.invokeMcpTool (registry + boundary + audit)
 *   - computer→ ComputerOps.runBrowserRound (observe→act→verify browser round)
 *
 * Nothing here hard-codes request→tool mappings; discovery stays with
 * ToolDiscovery, which now sees MCP tools in the same shape.
 */

import { TOOL_REGISTRY } from './ToolRegistry.js';
import { executeTool } from './ToolRuntime.js';
import { toolPermissionsFor } from './director/Permissions.js';
import { mcpToolsUnified, invokeMcpTool } from './MCPGateway.js';
import { BROWSER_ACTIONS, parseBrowserLine, runBrowserRound } from './director/ComputerOps.js';

const RISK_ORDER = { safe: 0, medium: 1, risky: 2 };

/** Native registry tool → unified shape. */
export function normalizeNativeTool(t) {
  const perms = toolPermissionsFor(t.slug) || { mode: 'ask' };
  return {
    id: `native:${t.slug}`,
    slug: t.slug,
    name: t.name,
    description: t.desc || t.name,
    schema: null, // native schemas are built by ToolRuntime.buildNativeSchemas at execution time
    source: 'native',
    permissions: perms,
    risk: perms.mode === 'full' ? 'risky' : perms.mode === 'ask' ? 'medium' : 'safe',
    timeoutMs: t.timeoutMs || 30_000,
    cost: 0, // native tools spend no model tokens
    verification: 'engine result must be non-empty to count as success',
    async execute(args, opts = {}) {
      return executeTool({ slug: t.slug, args: args || {}, profile: opts.profile || 'auto' });
    },
  };
}

/** One browser/computer action → unified shape (the observe→act→verify loop's door). */
export function normalizeComputerAction(action) {
  return {
    id: `computer:${action}`,
    slug: action,
    name: `Browser action: ${action}`,
    description: `Computer-use action '${action}' — runs inside the observe→act→verify browser loop with screenshots.`,
    schema: null,
    source: 'computer',
    permissions: { mode: 'ask', boundary: 'browser' },
    risk: action === 'observe' ? 'safe' : 'medium',
    timeoutMs: 60_000,
    cost: 0,
    verification: 'post-action screenshot observation',
    async execute(args, opts = {}) {
      const line = String(args && args.line || '').trim();
      if (!line) return { ok: false, error: 'computer tools need args.line (e.g. "goto https://example.com")' };
      const parsed = parseBrowserLine(line);
      if (!parsed || (parsed.action && !BROWSER_ACTIONS.has(parsed.action))) {
        return { ok: false, error: `unknown browser action in '${line.slice(0, 80)}'` };
      }
      return runBrowserRound({ lines: [line], emit: opts.emit || (() => {}), identity: opts.identity || { agentId: 'unified-tools', displayName: 'JEXI' } });
    },
  };
}

/** The whole catalog: native + MCP + computer, one shape (spec §21). */
export function unifiedToolCatalog() {
  const native = TOOL_REGISTRY.map(normalizeNativeTool);
  const mcp = mcpToolsUnified().map((t) => ({
    ...t,
    name: t.name || t.id,
    cost: 0,
    verification: 'MCP tool result with server-side error surface',
    async execute(args, opts = {}) {
      return invokeMcpTool({ server: t.server, tool: t.name || t.id.split(':').pop(), args: args || {}, authorized: opts.authorized === true, timeoutMs: t.timeoutMs });
    },
  }));
  const computer = [...BROWSER_ACTIONS].map(normalizeComputerAction);
  return { native, mcp, computer, all: [...native, ...mcp, ...computer] };
}

/** Route one unified tool id to its real execution path. */
export async function invokeUnifiedTool(id, args = {}, opts = {}) {
  const { all } = unifiedToolCatalog();
  const tool = all.find((t) => t.id === id || t.slug === id || (id.startsWith('mcp:') && t.id === id));
  if (!tool) return { ok: false, error: `unknown tool '${id}'` };
  if (tool.source === 'mcp' && tool.requiresAuthorization && opts.authorized !== true) {
    return { ok: false, error: `refused: '${tool.id}' requires explicit authorization` };
  }
  try {
    return await tool.execute(args, opts);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
  }
}

/** Capability-first view for planning: what CAN be done, from which source, at what risk. */
export function capabilityIndex() {
  const { all } = unifiedToolCatalog();
  const bySource = {};
  for (const t of all) {
    bySource[t.source] = bySource[t.source] || { count: 0, maxRisk: 'safe' };
    bySource[t.source].count += 1;
    if ((RISK_ORDER[t.risk] || 0) > (RISK_ORDER[bySource[t.source].maxRisk] || 0)) bySource[t.source].maxRisk = t.risk;
  }
  return { total: all.length, bySource };
}
