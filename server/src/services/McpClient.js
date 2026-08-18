/**
 * B135 — MCP CLIENT (DeepSeek Harness `packages/mcp/mcp-client` mirror).
 *
 * Connects to EXTERNAL MCP servers (stdio child process or Streamable HTTP /
 * SSE) and registers their tools on the plugin seam under server-qualified
 * public names — `mcp__<serverName>__<rawName>` — so every tool passes the
 * SAME gates as built-ins (permission, risk, sandbox, plan mode, output
 * contracts). Namespace rules (dsh): serverName must match
 * `[A-Za-z0-9_-]{1,32}`, one live instance per serverName, disposal
 * disconnects and unregisters.
 *
 * Reconnect policy (dsh connection.ts defaults): on lost connection, retry
 * with capped exponential backoff; tools stay registered but calls fail with
 * a clear "server disconnected" error until the connection returns.
 *
 * Config lives in DATA_DIR/mcp.json:
 *   { "servers": [ { "serverName", "transport": "stdio", "command", "args",
 *     "env", "cwd", "toolCallTimeoutMs", "failOnStartupError" } | { ...,
 *     "transport": "streamable-http", "url", "headers" } ] }
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, WORKSPACE_DIR } from '../config.js';
import { getActivePluginContext } from './PluginContext.js';

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;
const DEFAULT_CONFIG_PATH = path.join(DATA_DIR, 'mcp.json');

/** Live clients by serverName. */
const clients = new Map(); // serverName → { serverName, client, transport, unregister, tools, status, timer }

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

function resolveReconnectPolicy(config = {}) {
  return {
    retries: Number.isInteger(config.retries) && config.retries >= 0 ? config.retries : 5,
    baseDelayMs: Number.isInteger(config.baseDelayMs) && config.baseDelayMs > 0 ? config.baseDelayMs : 1000,
    maxDelayMs: Number.isInteger(config.maxDelayMs) && config.maxDelayMs > 0 ? config.maxDelayMs : 30000,
  };
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal && signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')); };
    if (signal) { if (signal.aborted) { clearTimeout(t); reject(new Error('aborted')); return; } signal.addEventListener('abort', onAbort, { once: true }); }
  });
}

/** One server entry → SDK transport. */
async function buildTransport(spec) {
  if (spec.transport === 'stdio') {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    return new StdioClientTransport({
      command: spec.command,
      args: spec.args || [],
      env: { ...(spec.env || {}) },
      cwd: spec.cwd || WORKSPACE_DIR || process.cwd(),
      stderr: 'pipe',
    });
  }
  if (spec.transport === 'streamable-http' || spec.transport === 'http') {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    return new StreamableHTTPClientTransport(new URL(spec.url), {
      requestInit: { headers: { ...(spec.headers || {}) } },
    });
  }
  throw new Error(`mcp-client: unknown transport "${spec.transport}" (use stdio or streamable-http)`);
}

/** Validate + normalize one server spec. */
export function validateServerSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('mcp server spec must be an object');
  if (typeof spec.serverName !== 'string' || !SERVER_NAME_PATTERN.test(spec.serverName)) {
    throw new Error(`mcp serverName must match ${SERVER_NAME_PATTERN}`);
  }
  if (clients.has(spec.serverName)) throw new Error(`mcp serverName "${spec.serverName}" is already live`);
  const normalized = {
    ...spec,
    toolCallTimeoutMs: Number.isInteger(spec.toolCallTimeoutMs) && spec.toolCallTimeoutMs > 0 ? spec.toolCallTimeoutMs : DEFAULT_TOOL_CALL_TIMEOUT_MS,
    failOnStartupError: spec.failOnStartupError !== false,
  };
  if (normalized.transport === 'stdio' && typeof normalized.command !== 'string') {
    throw new Error('stdio mcp server requires a command');
  }
  if ((normalized.transport === 'streamable-http' || normalized.transport === 'http') && typeof normalized.url !== 'string') {
    throw new Error('streamable-http mcp server requires a url');
  }
  return normalized;
}

/**
 * Connect one MCP server and register its tools on the plugin seam.
 * @returns {Promise<{ok, serverName, tools: string[]}>}
 */
export async function connectMcpServer(spec) {
  let normalized;
  try {
    normalized = validateServerSpec(spec);
  } catch (e) {
    return { ok: false, serverName: spec && spec.serverName, error: (e && e.message) || String(e) };
  }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client({ name: 'jexi-mcp-client', version: '1.0.0' }, { capabilities: {} });
  const transport = await buildTransport(normalized);
  const record = {
    serverName: normalized.serverName,
    client,
    transport,
    spec: normalized,
    tools: new Map(), // publicName → rawName
    unregisterBySlug: new Map(),
    status: 'connecting',
    error: null,
    unregisterFns: [],
    reconnectTimer: null,
    reconnectAttempts: 0,
    policy: resolveReconnectPolicy(normalized.reconnect),
    disposed: false,
  };
  clients.set(normalized.serverName, record);

  const syncTools = async () => {
    const list = await client.listTools();
    const ctx = getActivePluginContext();
    if (!ctx) throw new Error('plugin context not ready — mcp tools cannot be registered');
    // remove stale registrations
    for (const [publicName, rawName] of record.tools) {
      if (!list.tools.some((t) => t.name === rawName)) {
        const unreg = record.unregisterBySlug.get(publicName);
        if (unreg) { try { unreg(); } catch { /* noop */ } }
        record.unregisterBySlug.delete(publicName);
        record.tools.delete(publicName);
      }
    }
    for (const t of list.tools) {
      const publicName = `mcp__${normalized.serverName}__${t.name}`;
      if (record.tools.has(publicName)) continue;
      const unregister = ctx.tools.register({
        slug: publicName,
        name: t.name,
        desc: (t.description || `MCP tool from server ${normalized.serverName}`).slice(0, 400),
        args: (t.inputSchema && t.inputSchema.properties) || {},
        timeoutMs: normalized.toolCallTimeoutMs,
        permission: 'medium',
        handler: async (args) => {
          if (record.status !== 'connected') {
            return { ok: false, error: `mcp server "${normalized.serverName}" is ${record.status} — not connected` };
          }
          const timeout = new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ ok: false, error: `MCP tool call timed out after ${normalized.toolCallTimeoutMs}ms` }), normalized.toolCallTimeoutMs);
            if (timer.unref) timer.unref();
          });
          const call = (async () => {
            const res = await client.callTool({ name: t.name, arguments: args || {} });
            const content = Array.isArray(res.content) ? res.content.map((c) => (c && c.text !== undefined ? c.text : JSON.stringify(c))).join('\n') : JSON.stringify(res);
            return { ok: !res.isError, kind: 'mcp-result', server: normalized.serverName, tool: t.name, output: String(content || '').slice(0, 12000), ...(res.isError ? { error: String(content).slice(0, 500) } : {}) };
          })();
          try {
            return await Promise.race([call, timeout]);
          } catch (e) {
            return { ok: false, error: `MCP tool call failed: ${(e && e.message) || e}` };
          }
        },
      });
      record.unregisterFns.push(unregister);
      record.unregisterBySlug.set(publicName, unregister);
      record.tools.set(publicName, t.name);
    }
  };

  const connectOnce = async () => {
    await client.connect(transport);
    record.status = 'connected';
    record.reconnectAttempts = 0;
    await syncTools();
  };

  const startReconnectLoop = () => {
    if (record.disposed || record.reconnectTimer) return;
    const { retries, baseDelayMs, maxDelayMs } = record.policy;
    if (record.reconnectAttempts > retries) {
      record.status = 'disconnected';
      return;
    }
    const backoff = Math.min(baseDelayMs * 2 ** record.reconnectAttempts, maxDelayMs);
    record.reconnectTimer = setTimeout(async () => {
      record.reconnectTimer = null;
      if (record.disposed) return;
      record.reconnectAttempts += 1;
      record.status = 'reconnecting';
      try {
        const { Client: C2 } = await import('@modelcontextprotocol/sdk/client/index.js');
        const fresh = new C2({ name: 'jexi-mcp-client', version: '1.0.0' }, { capabilities: {} });
        const newTransport = await buildTransport(normalized);
        await fresh.connect(newTransport);
        // swap record fields
        const old = record.client;
        record.client = fresh;
        record.transport = newTransport;
        try { await old.close(); } catch { /* noop */ }
        record.status = 'connected';
        record.reconnectAttempts = 0;
        await syncTools();
      } catch (e) {
        record.error = (e && e.message) || String(e);
        startReconnectLoop();
      }
    }, backoff);
    if (record.reconnectTimer.unref) record.reconnectTimer.unref();
  };

  try {
    await connectOnce();
    return { ok: true, serverName: normalized.serverName, tools: [...record.tools.keys()] };
  } catch (e) {
    record.error = (e && e.message) || String(e);
    if (normalized.failOnStartupError) {
      clients.delete(normalized.serverName);
      return { ok: false, serverName: normalized.serverName, error: record.error };
    }
    record.status = 'disconnected';
    startReconnectLoop();
    return { ok: false, serverName: normalized.serverName, error: record.error, reconnecting: true };
  }
}

/** Disconnect one server (unregisters its tools, releases the namespace). */
export async function disconnectMcpServer(serverName) {
  const record = clients.get(String(serverName || ''));
  if (!record) return { ok: false, error: `no live mcp server "${serverName}"` };
  record.disposed = true;
  if (record.reconnectTimer) { clearTimeout(record.reconnectTimer); record.reconnectTimer = null; }
  for (const fn of record.unregisterFns) { try { fn(); } catch { /* noop */ } }
  record.unregisterFns = [];
  record.tools.clear();
  try { await record.client.close(); } catch { /* noop */ }
  clients.delete(record.serverName);
  return { ok: true, serverName };
}

/** Load + connect every server from the config file (fail-open). */
export async function loadMcpServers(configPath = DEFAULT_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) return { ok: true, servers: [], note: 'no mcp.json — mcp-client disabled' };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    return { ok: false, servers: [], error: `mcp.json parse error: ${(e && e.message) || e}` };
  }
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.servers) ? parsed.servers : []);
  const results = [];
  for (const spec of list) {
    try {
      results.push(await connectMcpServer(spec));
    } catch (e) {
      results.push({ ok: false, serverName: spec && spec.serverName, error: (e && e.message) || String(e) });
    }
  }
  return { ok: true, servers: results };
}

/** Status of every live client. */
export function mcpServerStatus() {
  return [...clients.values()].map((r) => ({
    serverName: r.serverName,
    transport: r.spec.transport,
    status: r.status,
    tools: [...r.tools.keys()].length,
    toolNames: [...r.tools.keys()].slice(0, 40),
    error: r.error,
    reconnectAttempts: r.reconnectAttempts,
  }));
}
