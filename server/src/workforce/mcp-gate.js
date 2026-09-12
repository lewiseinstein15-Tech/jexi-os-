/**
 * MCP GRANT GATE (Phase 2, Scope D — MCP architecture).
 *
 * Deny-by-default. Every mcp__ tool call an agent makes passes through this
 * gate with the agent's grants in hand:
 *
 *   - NO grants           -> DENIED (the agent has no MCP access at all)
 *   - grant for server X  -> server X tools allowed, every other server
 *     denied (both at the server and tool level)
 *   - grant tools: ['*']  -> all tools on that server
 *   - grant tools: [..]   -> only the listed tools on that server
 *
 * The gate is a pure function: `authorizeMcpCall(grants, server, tool)`.
 * No keys, no network — deterministic and unit-testable. The director lane
 * feeds each employee's `allowedMCP` in; ToolRuntime/EmployeeSession keep
 * owning lazy connect + execution.
 */
export const DENY_DEFAULT = 'DENY_DEFAULT';

export function authorizeMcpCall(grants, server, tool) {
  const safeServer = String(server || '');
  const safeTool = String(tool || '');
  if (!safeServer) {
    return { allowed: false, denial: DENY_DEFAULT, server: '', tool: safeTool, reason: 'no server target' };
  }
  const list = Array.isArray(grants) ? grants : [];
  if (!list.length) {
    return { allowed: false, denial: DENY_DEFAULT, server: safeServer, tool: safeTool, reason: 'agent has no MCP grants (deny-by-default)' };
  }
  const grant = list.find((g) => g && g.server === safeServer);
  if (!grant) {
    return { allowed: false, denial: `${safeServer}:ungranted`, server: safeServer, tool: safeTool, reason: `server '${safeServer}' is not in the agent's grants` };
  }
  if (!Array.isArray(grant.tools)) {
    return { allowed: false, denial: `${safeServer}:malformed`, server: safeServer, tool: safeTool, reason: `grant for '${safeServer}' is malformed` };
  }
  if (grant.tools.includes('*')) {
    return { allowed: true, server: safeServer, tool: safeTool, grant: safeServer };
  }
  if (grant.tools.includes(safeTool)) {
    return { allowed: true, server: safeServer, tool: safeTool, grant: safeServer };
  }
  return { allowed: false, denial: `${safeServer}:${safeTool}`, server: safeServer, tool: safeTool, reason: `tool '${safeTool}' is not granted on server '${safeServer}'` };
}