/**
 * JEXI OS — MCP GATEWAY (AGI Phase 2).
 *
 * One controlled door for every external MCP server (spec §17–§20):
 *
 *   registry (mcp/registry.json, all DISABLED by default — nothing auto-trusts)
 *     → enable/disable (admin action, persisted as runtime state)
 *     → connect via the existing McpClient (official SDK transports)
 *     → discovery: tools + schemas, wrapped with source/permissions/risk
 *     → invocation: permission boundary check + per-call authorization for
 *       risky tools + timeout + health + audit log
 *
 * Security posture (research/MCP.md, per the 2026-07-28 spec):
 *   - MCP tool annotations are UNTRUSTED input — they are hints, never the
 *     decision. The server's registry-granted permissions are the boundary.
 *   - Destructive-looking tools (annotation OR name heuristics) require BOTH
 *     the server holding the DESTRUCTIVE grant AND an explicit `authorized`
 *     flag on the call.
 *   - Every invocation is audit-logged (bounded JSONL).
 *
 * The connector is injectable for keyless deterministic tests.
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REGISTRY_PATH = () => new URL('../../../mcp/registry.json', import.meta.url).pathname;
const STATE_FILE = () => path.join(process.env.DATA_DIR || './data', 'mcp-registry-state.json');
const AUDIT_FILE = () => path.join(process.env.DATA_DIR || './data', 'mcp-audit.jsonl');

export const PERMISSION_BOUNDARIES = ['READ_ONLY', 'LOCAL_WRITE', 'NETWORK', 'EXECUTION', 'GIT', 'DEPLOYMENT', 'DESTRUCTIVE'];

/* ── registry ─────────────────────────────────────────────────────────── */

export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH()) {
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const servers = [];
  for (const s of Array.isArray(raw.servers) ? raw.servers : []) {
    if (!s || typeof s.name !== 'string') continue;
    const perms = Array.isArray(s.permissions) ? s.permissions.filter((p) => PERMISSION_BOUNDARIES.includes(p)) : [];
    servers.push({
      name: s.name,
      description: String(s.description || '').slice(0, 300),
      transport: s.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
      ...(s.transport === 'streamable-http' ? { url: s.url } : { command: s.command, args: Array.isArray(s.args) ? s.args : [] }),
      enabled: s.enabled === true,
      trustLevel: s.trustLevel === 'community' ? 'community' : 'curated',
      permissions: perms.length ? perms : ['READ_ONLY'], // least privilege when unspecified
      notes: s.notes || '',
    });
  }
  return { version: raw.version || 1, servers };
}

/** Runtime enable/disable state, persisted separately from the shipped registry. */
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch { return {}; }
}
function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2));
  } catch { /* never fatal */ }
}

export function enableMcpServer(name, { force = false } = {}) {
  const reg = loadRegistry();
  const entry = reg.servers.find((s) => s.name === name);
  if (!entry) return { ok: false, error: `unknown server '${name}'` };
  if (entry.trustLevel === 'community' && !force) {
    return { ok: false, error: `'${name}' is community-trust — pass force:true after review` };
  }
  const state = loadState();
  state[name] = { ...(state[name] || {}), enabled: true };
  saveState(state);
  return { ok: true, enabled: name };
}

export function disableMcpServer(name) {
  const state = loadState();
  if (state[name]) { state[name].enabled = false; saveState(state); }
  return { ok: true, disabled: name };
}

/** Effective registry view: shipped defaults + runtime overrides (state wins only where it exists). */
export function effectiveRegistry(registryPath = DEFAULT_REGISTRY_PATH()) {
  const reg = loadRegistry(registryPath);
  const state = loadState();
  return {
    ...reg,
    servers: reg.servers.map((s) => {
      const st = state[s.name];
      return { ...s, enabled: st && typeof st.enabled === 'boolean' ? st.enabled : s.enabled };
    }),
  };
}

/* ── audit (bounded JSONL) ────────────────────────────────────────────── */

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE()), { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    let existing = '';
    try { existing = fs.readFileSync(AUDIT_FILE(), 'utf8'); } catch { /* new */ }
    const lines = existing.trimEnd().split('\n').filter(Boolean);
    while (lines.length >= 500) lines.shift(); // bounded
    fs.writeFileSync(AUDIT_FILE(), lines.concat(line).join('\n') + '\n');
  } catch { /* never fatal */ }
}

/* ── connection + discovery + invocation ──────────────────────────────── */

const connections = new Map(); // name → { tools: [{name, description, inputSchema}], connectedAt, lastError, lastSuccessAt, calls, failures }
let connector = null; // injectable seam

/** Inject a connection factory (tests). Real default: McpClient. */
export function __setConnector(fn) { connector = fn; }

async function defaultConnector(entry) {
  const { connectMcpServer } = await import('./McpClient.js');
  const spec = entry.transport === 'streamable-http'
    ? { serverName: entry.name, transport: 'streamable-http', url: entry.url }
    : { serverName: entry.name, transport: 'stdio', command: entry.command, args: entry.args };
  const res = await connectMcpServer(spec);
  if (!res || res.ok === false) throw new Error(res && res.error ? res.error : 'connect failed');
  return { listTools: async () => ({ tools: [] }) }; // McpClient registers on the plugin seam; the gateway records what it can
}

export async function connectGatewayServer(name, { registryPath } = {}) {
  const reg = effectiveRegistry(registryPath);
  const entry = reg.servers.find((s) => s.name === name);
  if (!entry) return { ok: false, error: `unknown server '${name}'` };
  if (!entry.enabled) return { ok: false, error: `'${name}' is not enabled in the registry` };
  if (connections.has(name)) return { ok: true, already: true };
  try {
    const conn = await (connector || defaultConnector)(entry);
    const listed = await conn.listTools();
    const tools = (listed && Array.isArray(listed.tools) ? listed.tools : []).map((t) => ({
      name: String(t.name || '').slice(0, 120),
      description: String(t.description || '').slice(0, 500),
      inputSchema: t.inputSchema || null,
      annotations: t.annotations || null, // UNTRUSTED hints (spec guidance)
    }));
    connections.set(name, { tools, __client: typeof conn.callTool === 'function' ? conn : null, grants: entry.permissions, serverName: name, connectedAt: new Date().toISOString(), lastError: null, lastSuccessAt: null, calls: 0, failures: 0 });
    audit({ type: 'MCP_CONNECTED', server: name, tools: tools.length });
    return { ok: true, server: name, tools: tools.length };
  } catch (e) {
    audit({ type: 'MCP_CONNECT_FAILED', server: name, error: String(e && e.message).slice(0, 200) });
    return { ok: false, error: String(e && e.message).slice(0, 300) };
  }
}

/** Does a tool look destructive? Annotations are hints; names are heuristics. BOTH are just detectors. */
function looksDestructive(tool) {
  const ann = tool.annotations || {};
  if (ann.destructiveHint === true) return true;
  return /delete|remove|drop|truncate|destroy|wipe|reset|purge|uninstall/i.test(tool.name || '');
}

/** Unified tool shape (Phase 3 interface) for every discovered MCP tool. */
export function mcpToolsUnified() {
  const out = [];
  for (const [server, conn] of connections) {
    const grants = conn.grants || ['READ_ONLY'];
    for (const t of conn.tools) {
      out.push({
        id: `mcp:${server}:${t.name}`,
        description: t.description,
        schema: t.inputSchema,
        source: 'mcp',
        server,
        permissions: grants,
        risk: looksDestructive(t) ? 'risky' : (grants.includes('LOCAL_WRITE') ? 'medium' : 'safe'),
        timeoutMs: 30_000,
        cost: 0,
        requiresAuthorization: looksDestructive(t),
      });
    }
  }
  return out;
}

/**
 * Invoke an MCP tool through the permission boundary.
 * @param {object} p { server, tool, args, authorized, timeoutMs }
 */
export async function invokeMcpTool({ server, tool, args = {}, authorized = false, timeoutMs = 30_000 } = {}) {
  const conn = connections.get(server);
  if (!conn) return { ok: false, error: `server '${server}' is not connected` };
  const grants = conn.grants || []; // the permission boundary the server was CONNECTED with
  const toolDef = conn.tools.find((t) => t.name === tool);
  if (!toolDef) return { ok: false, error: `unknown tool '${tool}' on '${server}'` };

  const destructive = looksDestructive(toolDef);
  if (destructive && !grants.includes('DESTRUCTIVE')) {
    audit({ type: 'MCP_DENIED', server, tool, reason: 'destructive tool on a server without the DESTRUCTIVE grant' });
    return { ok: false, error: `refused: '${tool}' looks destructive and server '${server}' does not hold the DESTRUCTIVE permission` };
  }
  if (destructive && !authorized) {
    audit({ type: 'MCP_DENIED', server, tool, reason: 'destructive tool requires explicit per-call authorization' });
    return { ok: false, error: `refused: '${tool}' requires explicit authorization for this call` };
  }
  if (!grants.includes('READ_ONLY') && !grants.length) {
    return { ok: false, error: `server '${server}' has no granted permissions` };
  }

  conn.calls += 1;
  audit({ type: 'MCP_INVOKE', server, tool, authorized: destructive ? true : undefined });
  try {
    const client = conn.__client;
    if (!client) throw new Error('no callable client attached (server connected without an invocation seam)');
    let timer = null;
    const timeoutP = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`MCP tool '${tool}' timed out after ${timeoutMs}ms`)), timeoutMs);
      if (typeof timer.unref === 'function') timer.unref(); // never hold the process for a lost race
    });
    let result;
    try {
      result = await Promise.race([client.callTool({ name: tool, arguments: args }), timeoutP]);
    } finally {
      clearTimeout(timer);
    }
    conn.lastSuccessAt = new Date().toISOString();
    return { ok: true, result };
  } catch (e) {
    conn.failures += 1;
    conn.lastError = String(e && e.message).slice(0, 200);
    audit({ type: 'MCP_INVOKE_FAILED', server, tool, error: conn.lastError });
    return { ok: false, error: conn.lastError };
  }
}

/** Server health snapshot (spec §17: server health + lifecycle). */
export function mcpServerHealth() {
  const reg = effectiveRegistry();
  const rows = reg.servers.map((s) => {
    const c = connections.get(s.name);
    return {
      name: s.name,
      enabled: s.enabled,
      trustLevel: s.trustLevel,
      permissions: s.permissions,
      status: !s.enabled ? 'disabled' : c ? (c.failures > 0 && !c.lastSuccessAt ? 'error' : 'connected') : 'off',
      tools: c ? c.tools.length : 0,
      calls: c ? c.calls : 0,
      failures: c ? c.failures : 0,
      lastError: c ? c.lastError : null,
      lastSuccessAt: c ? c.lastSuccessAt : null,
      connectedAt: c ? c.connectedAt : null,
    };
  });
  // live connections whose registry entry came from a non-default registry still report
  for (const [name, c] of connections) {
    if (!rows.some((r) => r.name === name)) {
      rows.push({
        name, enabled: true, trustLevel: 'runtime', permissions: c.grants || [],
        status: c.failures > 0 && !c.lastSuccessAt ? 'error' : 'connected',
        tools: c.tools.length, calls: c.calls, failures: c.failures,
        lastError: c.lastError, lastSuccessAt: c.lastSuccessAt, connectedAt: c.connectedAt,
      });
    }
  }
  return rows;
}

/** Test seam: wipe connections. */
export function __resetGateway() { connections.clear(); connector = null; }
