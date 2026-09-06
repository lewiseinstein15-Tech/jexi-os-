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
 *   - Destructive-looking tools require BOTH the server holding the DESTRUCTIVE
 *     grant AND an explicit `authorized` flag on the call. Detectors: tool name
 *     heuristics (always), plus the UNTRUSTED destructiveHint annotation — which
 *     yields to an explicitly granted LOCAL_WRITE boundary (overwrite-in-scope
 *     is the write that was granted; delete-style names still stand).
 *   - Every invocation is audit-logged (bounded JSONL).
 *
 * The connector is injectable for keyless deterministic tests.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_REGISTRY_PATH = () => new URL('../../../mcp/registry.json', import.meta.url).pathname;
const DIRECTORY_PATH = () => new URL('../../../mcp/tool-directory.json', import.meta.url).pathname;
const STATE_FILE = () => path.join(process.env.DATA_DIR || './data', 'mcp-registry-state.json');
const AUDIT_FILE = () => path.join(process.env.DATA_DIR || './data', 'mcp-audit.jsonl');

/** Tool directory: every server's tool names as last verified live — lets the planner
 *  see all 35 servers' tools without holding 35 child processes. */
export function loadToolDirectory() {
  try {
    const raw = JSON.parse(fs.readFileSync(DIRECTORY_PATH(), 'utf8'));
    return raw.servers || {};
  } catch { return {}; }
}

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

/* Cgroup-aware memory ceiling (Docker/Render): os.totalmem() reports the
 * HOST's RAM inside a container, so a 512MB Render instance looks like the
 * whole machine. Read the cgroup v2/v1 limit and take the smaller truth. */
function hostMemoryLimitMb() {
  let mb = os.totalmem() / 1048576;
  try {
    const v2 = Number(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim());
    if (Number.isFinite(v2) && v2 > 0) mb = Math.min(mb, v2 / 1048576);
  } catch { /* not cgroup v2 */ }
  try {
    const v1 = Number(fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim());
    if (Number.isFinite(v1) && v1 > 0 && v1 < 1e12) mb = Math.min(mb, v1 / 1048576);
  } catch { /* not cgroup v1 */ }
  return Math.round(mb);
}

/** Free memory, cgroup-aware: limit minus current usage when a cgroup limit
 *  exists (os.freemem() reports host-wide free inside containers). */
function hostFreeMemoryMb() {
  try {
    const cur = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
    const lim = Number(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim());
    if (Number.isFinite(cur) && Number.isFinite(lim) && lim > 0 && lim < 1e12) return Math.round((lim - cur) / 1048576);
  } catch { /* fall through */ }
  try {
    const lim = Number(fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim());
    if (Number.isFinite(lim) && lim > 0 && lim < 1e12) {
      const usageFile = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
      let used = 0;
      try { used = Number(fs.readFileSync(usageFile, 'utf8').trim()); } catch { used = 0; }
      if (Number.isFinite(used)) return Math.round((lim - used) / 1048576);
    }
  } catch { /* fall through */ }
  return Math.round(os.freemem() / 1048576);
}

/* ── connection + discovery + invocation ──────────────────────────────── */

const connections = new Map(); // name → { tools: [{name, description, inputSchema}], connectedAt, lastError, lastSuccessAt, calls, failures }
const connectState = new Map(); // name → { lastConnectAt, lastConnectError } — survives failed connects (a failed connect leaves NO connection entry, so without this the failure is invisible)
let connector = null; // injectable seam

/** Inject a connection factory (tests). Real default: the official MCP SDK below. */
export function __setConnector(fn) { connector = fn; }

/** Interpolate registry placeholders at CONNECT time (never bake host paths into the registry). */
function interpolateArg(a, wsDir) {
  const dataDir = process.env.DATA_DIR || './data';
  const dbPath = path.join(dataDir, 'mcp-sqlite.db');
  const duckPath = path.join(dataDir, 'mcp-duckdb.duckdb');
  return String(a)
    .replace(/\$\{JEXI_WORKSPACE\}/g, wsDir)
    .replace(/\$\{JEXI_SQLITE_DB\}/g, dbPath)
    .replace(/\$\{JEXI_DUCKDB_DB\}/g, duckPath);
}

/**
 * REAL connector (Sept 2026 — Lewis switched servers on): own SDK Client over
 * StdioClientTransport / StreamableHTTPClientTransport. No plugin seam, no
 * fake listTools. What this returns is what actually talks to the server.
 */
async function defaultConnector(entry) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { WORKSPACE_DIR } = await import('../config.js');

  let client;
  if (entry.transport === 'streamable-http') {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const transport = new StreamableHTTPClientTransport(new URL(entry.url), {
      requestInit: { headers: { ...(entry.headers || {}) } },
    });
    client = new Client({ name: 'jexi-mcp-gateway', version: '1.0.0' }, { capabilities: {} });
    try {
      await withTimeout(client.connect(transport), 90_000, 'connect timed out');
    } catch (e) {
      try { await transport.close(); } catch { /* already gone */ }
      try { await client.close(); } catch { /* already gone */ }
      throw e;
    }
  } else {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    // the workspace root must exist before servers that take it as an argument
    // (filesystem roots, git --repository) can start — create-on-connect.
    try { fs.mkdirSync(WORKSPACE_DIR, { recursive: true }); } catch { /* best effort */ }
    const args = (entry.args || []).map((a) => interpolateArg(a, WORKSPACE_DIR));
    // mcp-server-git crashes unless --repository points at an existing GIT REPO
    // (NoSuchPathError otherwise). The JEXI workspace is versioned anyway —
    // git-init it once if it is not a repo yet.
    try {
      const repoIdx = args.indexOf('--repository');
      if (repoIdx >= 0 && args[repoIdx + 1] && !fs.existsSync(path.join(args[repoIdx + 1], '.git'))) {
        const { spawnSync } = await import('node:child_process');
        spawnSync('git', ['init', '-q', args[repoIdx + 1]], { timeout: 15_000 });
      }
    } catch { /* best effort — server reports honestly if still broken */ }
    // sqlite path placeholder → make sure the parent dir exists (empty file = server opens/creates it)
    const transport = new StdioClientTransport({
      command: entry.command,
      args,
      env: { ...process.env, ...(entry.env || {}) }, // npx needs PATH/HOME; registry env overrides win
      stderr: 'pipe',
    });
    client = new Client({ name: 'jexi-mcp-gateway', version: '1.0.0' }, { capabilities: {} });
    try {
      await withTimeout(client.connect(transport), 90_000, 'connect timed out'); // npx cold download is slow
    } catch (e) {
      // LEAK FIX (Render, Sept 2026): a failed/timed-out connect must KILL the
      // stdio child. Otherwise every npx/uvx attempt that dies mid-install
      // leaves an orphan (npm alone is ~100-200MB) — on a 512MB host three
      // failures = dead brain. NOTE: close the TRANSPORT, not just the client —
      // a client whose connect() never finished does not own the transport, so
      // client.close() alone leaves the child alive (verified live).
      try { await transport.close(); } catch { /* already gone */ }
      try { await client.close(); } catch { /* already gone */ }
      throw e;
    }
  }

  return {
    listTools: async () => client.listTools(),
    callTool: async (req) => {
      const res = await client.callTool(req);
      if (res && res.isError === true) {
        const text = Array.isArray(res.content) ? res.content.map((c) => c.text || '').join(' ').slice(0, 200) : '';
        throw new Error(text || 'tool reported an error');
      }
      return res;
    },
    close: async () => { try { await client.close(); } catch { /* already gone */ } },
  };
}

function withTimeout(p, ms, label) {
  let timer = null;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([p, timeoutP]).finally(() => clearTimeout(timer));
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
    connectState.set(name, { lastConnectAt: new Date().toISOString(), lastConnectError: null });
    connections.set(name, { tools, __client: typeof conn.callTool === 'function' ? conn : null, grants: entry.permissions, serverName: name, connectedAt: new Date().toISOString(), lastError: null, lastSuccessAt: null, calls: 0, failures: 0 });
    audit({ type: 'MCP_CONNECTED', server: name, tools: tools.length });
    return { ok: true, server: name, tools: tools.length };
  } catch (e) {
    connectState.set(name, { lastConnectAt: new Date().toISOString(), lastConnectError: String(e && e.message).slice(0, 200) });
    audit({ type: 'MCP_CONNECT_FAILED', server: name, error: String(e && e.message).slice(0, 200) });
    return { ok: false, error: String(e && e.message).slice(0, 300) };
  }
}

/**
 * Boot wiring: connect every ENABLED server, one at a time, fail-soft.
 * Called shortly after the brain is up so enabled servers' tools are offered
 * to the model without anyone opening the UI. A server that cannot start
 * (missing runtime, no network) just reports honestly in health.
 */
export async function connectEnabledMcpServers() {
  const reg = effectiveRegistry();
  const out = [];
  // SMALL-HOST MODE (Render free tier, Sept 2026): with ~512MB total, the app
  // itself + even 3 boot-connected stdio children leave <100MB free — the
  // npx startup spike (~100-150MB) then OOM-kills the whole brain on the
  // first lazy connect (observed live as 502 recycles). On such hosts connect
  // NOTHING stdio at boot: every server wakes on first use (lazy, warm cache
  // from the image prewarm) and sleeps again via the idle sweeper.
  const totalMb = hostMemoryLimitMb();
  const smallHost = totalMb < 768;
  for (const s of reg.servers) {
    if (!s.enabled) continue;
    if (connections.has(s.name)) continue; // already up (e.g. retry pass)
    // Hosted HTTP servers hold no child process — connect them all at boot.
    if (s.transport === 'streamable-http') {
      const r = await connectGatewayServer(s.name);
      out.push({ server: s.name, ok: r.ok === true, tools: r.tools || 0, ...(r.ok ? {} : { error: r.error }) });
      continue;
    }
    if (smallHost) {
      out.push({ server: s.name, ok: true, skipped: true, note: `small host (${totalMb}MB) — lazy only, wakes on first use` });
      continue;
    }
    // Memory guard: each connected local MCP server is a child process
    // (~40-90MB). Stop before starving the brain; the rest wake on first use.
    const freeMb = hostFreeMemoryMb();
    if (out.filter((o) => o.ok && !o.skipped && !o.hosted).length > 0 && freeMb < 300) {
      out.push({ server: s.name, ok: true, skipped: true, note: `memory guard: ${freeMb}MB free — sleeps, wakes on first use` });
      continue;
    }
    const r = await connectGatewayServer(s.name);
    out.push({ server: s.name, ok: r.ok === true, tools: r.tools || 0, ...(r.ok ? {} : { error: r.error }) });
  }
  return out;
}

/** Close a live connection (kills the stdio child process). Server stays enabled unless disabled too. */
export async function disconnectGatewayServer(name) {
  const conn = connections.get(name);
  if (!conn) return { ok: true, already: true };
  connections.delete(name);
  try {
    if (conn.__client && typeof conn.__client.close === 'function') await conn.__client.close();
  } catch { /* closing a dead process is fine */ }
  audit({ type: 'MCP_DISCONNECTED', server: name });
  return { ok: true, disconnected: name };
}

/**
 * IDLE SWEEPER (Render, Sept 2026): on a 512MB host every connected stdio
 * server is a live child process (~40-90MB each). Servers nobody has talked
 * to for IDLE_MINUTES go to sleep — the connection closes, the child dies,
 * memory comes back. The server stays enabled and WAKES ON NEXT USE (lazy
 * connect), so this is invisible except in lower memory use. Hosted HTTP
 * servers hold no child and are never swept. JEXI_MCP_IDLE_MINUTES=0 disables.
 */
export function startIdleSweeper() {
  const smallHost = hostMemoryLimitMb() < 768;
  const minutes = Number(process.env.JEXI_MCP_IDLE_MINUTES ?? (smallHost ? 5 : 10));
  if (!(minutes > 0)) return { started: false, reason: `JEXI_MCP_IDLE_MINUTES=${minutes} — idle sweep disabled` };
  const interval = setInterval(() => { sweepIdleServers(minutes); }, 60_000);
  if (typeof interval.unref === 'function') interval.unref();
  return { started: true, idleMinutes: minutes };
}

/** One idle-sweep pass (exported for tests): sleep stdio servers idle > minutes. */
export async function sweepIdleServers(minutes = Number(process.env.JEXI_MCP_IDLE_MINUTES ?? 10)) {
  if (!(minutes > 0)) return { swept: [] };
  const cutoff = Date.now() - minutes * 60_000;
  const swept = [];
  for (const [name, conn] of [...connections.entries()]) {
    // Only stdio servers hold a child process; only real clients can be closed.
    if (!conn.__client) continue;
    const entry = effectiveRegistry().servers.find((s) => s.name === name);
    if (entry && entry.transport === 'streamable-http') continue;
    const lastUsed = conn.lastSuccessAt || conn.connectedAt;
    if (Date.parse(lastUsed) < cutoff) {
      await disconnectGatewayServer(name);
      audit({ type: 'MCP_IDLE_SLEEP', server: name, note: `idle > ${minutes}min — child stopped, wakes on next use` });
      swept.push(name);
    }
  }
  return { swept };
}

/**
 * Does a tool look destructive? Two detectors, both only detectors:
 *  - the tool NAME matching delete/remove/drop/… → always treated as destructive
 *  - an UNTRUSTED destructiveHint annotation → destructive UNLESS the server
 *    holds LOCAL_WRITE: inside a granted local-write boundary an overwrite-style
 *    tool (e.g. filesystem write_file within its roots) is exactly the write
 *    that was granted. Delete-style names are still caught by the first rule.
 */
function looksDestructive(tool, grants = []) {
  if (/delete|remove|drop|truncate|destroy|wipe|reset|purge|uninstall/i.test(tool.name || '')) return true;
  const ann = tool.annotations || {};
  if (ann.destructiveHint === true) return !grants.includes('LOCAL_WRITE');
  return false;
}

/** Unified tool shape (Phase 3 interface). CONNECTED servers expose live tools (with schemas);
 *  enabled-but-sleeping servers expose their directory tools (verified live previously) —
 *  invoking one wakes the server (lazy connect). Hosted HTTP servers hold no child process. */
export function mcpToolsUnified() {
  const out = [];
  const directory = loadToolDirectory();
  const reg = effectiveRegistry();
  for (const entry of reg.servers) {
    if (!entry.enabled) continue;
    const grants = entry.permissions || ['READ_ONLY'];
    const c = connections.get(entry.name);
    if (c) {
      for (const t of c.tools) {
        out.push({
          id: `mcp:${entry.name}:${t.name}`,
          description: t.description,
          schema: t.inputSchema,
          source: 'mcp',
          server: entry.name,
          live: true,
          permissions: grants,
          risk: looksDestructive(t, grants) ? 'risky' : (grants.includes('LOCAL_WRITE') ? 'medium' : 'safe'),
          timeoutMs: 30_000,
          cost: 0,
          requiresAuthorization: looksDestructive(t, grants),
        });
      }
    } else {
      const dir = directory[entry.name];
      if (!dir) continue;
      for (const t of dir.tools || []) {
        out.push({
          id: `mcp:${entry.name}:${t.name}`,
          description: t.description,
          schema: null, // wakes with the real schema on connect
          source: 'mcp',
          server: entry.name,
          live: false, // sleeping — first call connects the server
          permissions: grants,
          risk: grants.includes('LOCAL_WRITE') ? 'medium' : 'safe',
          timeoutMs: 45_000, // includes the wake
          cost: 0,
          requiresAuthorization: looksDestructive({ name: t.name }, grants),
        });
      }
    }
  }
  // live connections from non-default registries still report
  for (const [server, conn] of connections) {
    if (reg.servers.some((s) => s.name === server)) continue;
    const grants = conn.grants || ['READ_ONLY'];
    for (const t of conn.tools) {
      out.push({
        id: `mcp:${server}:${t.name}`, description: t.description, schema: t.inputSchema, source: 'mcp',
        server, live: true, permissions: grants,
        risk: looksDestructive(t, grants) ? 'risky' : (grants.includes('LOCAL_WRITE') ? 'medium' : 'safe'),
        timeoutMs: 30_000, cost: 0, requiresAuthorization: looksDestructive(t, grants),
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
  let conn = connections.get(server);
  if (!conn) {
    // Lazy connect: an enabled server spins up on first real use (idle servers cost no memory).
    const reg = effectiveRegistry();
    const entry = reg.servers.find((s) => s.name === server);
    if (entry && entry.enabled) {
      const r = await connectGatewayServer(server);
      if (!r.ok) return { ok: false, error: `server '${server}' not connected (${r.error})` };
      conn = connections.get(server);
    }
  }
  if (!conn) return { ok: false, error: `server '${server}' is not connected` };
  const grants = conn.grants || []; // the permission boundary the server was CONNECTED with
  const toolDef = conn.tools.find((t) => t.name === tool);
  if (!toolDef) return { ok: false, error: `unknown tool '${tool}' on '${server}'` };

  const destructive = looksDestructive(toolDef, grants);
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

/** Live tool list of a CONNECTED server (name + description each), or null. */
export function gatewayServerTools(name) {
  const c = connections.get(name);
  return c ? c.tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 220) })) : null;
}

/** Server health snapshot (spec §17: server health + lifecycle). */
export function mcpServerHealth() {
  const reg = effectiveRegistry();
  const rows = reg.servers.map((s) => {
    const c = connections.get(s.name);
    const cs = connectState.get(s.name);
    // enabled + unconnected: 'ready' (never tried / healthy idle) vs 'error' (last connect attempt failed)
    const idleStatus = cs && cs.lastConnectError ? 'error' : 'ready';
    return {
      name: s.name,
      enabled: s.enabled,
      trustLevel: s.trustLevel,
      permissions: s.permissions,
      status: !s.enabled ? 'disabled' : c ? (c.failures > 0 && !c.lastSuccessAt ? 'error' : 'connected') : idleStatus,
      tools: c ? c.tools.length : ((loadToolDirectory()[s.name] || {}).tools || []).length,
      live: !!c,
      calls: c ? c.calls : 0,
      failures: c ? c.failures : 0,
      lastError: c ? c.lastError : (cs ? cs.lastConnectError : null),
      lastConnectAt: cs ? cs.lastConnectAt : null,
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
export function __resetGateway() { connections.clear(); connectState.clear(); connector = null; }
