// Phase 11 Scope G — reach-mcp: local stdio MCP server exposing the
// internet reach layer (Scopes D–F: 16-channel registry, ordered backend
// routing, doctor) as 8 real MCP tools.
//
// JSON-RPC 2.0 over stdio (MCP stdio transport = newline-delimited JSON).
// Every tool calls the REAL reach implementation — reads do real HTTP via
// the channel backends and fail honestly (AUTH_REQUIRED / BACKEND_UNAVAILABLE /
// RUNTIME_MISSING); no placeholder content is ever synthesized.

import readline from 'node:readline';
import { read, search } from './core.js';
import { ReachConfig } from './config.js';
import { checkAll, formatReport } from './doctor.js';
import { ALL_CHANNELS, route, getChannel } from './channels/index.js';

const SERVER_INFO = { name: 'reach-mcp', version: '1.0.0' };

function makeCfg() { return new ReachConfig(); }

const TOOLS = [
  {
    name: 'reach_read',
    description: 'Read a URL through the 16-channel reach layer. Routes to the first matching channel (web is the last-resort fallback); ordered backend chain with first-success-wins. Fails honestly (AUTH_REQUIRED / BACKEND_UNAVAILABLE / RUNTIME_MISSING) — never placeholder content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to read.' },
        backend_override: { type: 'string', description: 'Optional <channel>_backend override applied for THIS call (moved to front of the chain; unknown names are tried first honestly).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async run(args) {
      const cfg = makeCfg();
      const decision = route(String(args.url));
      if (!decision.channel) {
        const e = new Error(`no channel can handle ${args.url}`); e.code = 'NO_CHANNEL'; throw e;
      }
      if (args.backend_override) cfg.fileData[`${decision.channel.name}_backend`] = String(args.backend_override);
      const r = await read(String(args.url), { config: cfg });
      return {
        ok: true, backend: r.backend, routing: r.routing,
        attempts: (r.attempts || []).map((a) => ({ backend: a.backend, ok: a.ok, error: a.error })),
        content: typeof r.content === 'string' ? r.content.slice(0, 6000) : r.content,
      };
    },
  },
  {
    name: 'reach_search',
    description: 'Search across every channel that implements search (github keyless repo search, reddit public search, web DuckDuckGo/Jina). Per-channel failure isolates and is reported honestly.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    async run(args) {
      const r = await search(String(args.query), { config: makeCfg() });
      return r;
    },
  },
  {
    name: 'reach_route',
    description: 'Which channel would handle a URL, and why (first can_handle match; specific channels before the generic web fallback). No fetch happens.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
    async run(args) {
      const u = String(args.url);
      const matching = ALL_CHANNELS.filter((c) => { try { return c.can_handle(u); } catch { return false; } }).map((c) => c.name);
      const decision = route(u);
      return { url: u, matches: matching, routedTo: decision.channel?.name || null, reason: decision.reason || null };
    },
  },
  {
    name: 'reach_channels',
    description: 'The full channel registry: all 16 channels with tier (0 zero-config / 1 key-or-CLI / 2 login-gated) and ordered backend chains. Web is always LAST.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      return {
        count: ALL_CHANNELS.length,
        webIsLast: ALL_CHANNELS[ALL_CHANNELS.length - 1].name === 'web',
        channels: ALL_CHANNELS.map((c) => ({ name: c.name, tier: c.tier, backends: c.backends, description: c.description })),
      };
    },
  },
  {
    name: 'reach_check',
    description: 'Real health probe of reach channels (each check() does a real network probe and classifies ok/warn/off/error). Pass a channel name for one, or omit for all 16 — per-channel failure isolates.',
    inputSchema: { type: 'object', properties: { channel: { type: 'string', description: 'Optional single channel name.' } }, additionalProperties: false },
    async run(args) {
      if (args.channel) {
        const ch = getChannel(String(args.channel));
        if (!ch) throw new Error(`unknown channel: ${args.channel}`);
        const s = await ch.check(makeCfg());
        return { channel: ch.name, ...s };
      }
      const results = await checkAll(makeCfg());
      return { channels: results };
    },
  },
  {
    name: 'reach_doctor',
    description: 'Full reach doctor report (machine-readable): per-channel status/message/tier plus the human-readable formatted report.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const results = await checkAll(makeCfg());
      return { results, report: formatReport(results) };
    },
  },
  {
    name: 'reach_config',
    description: 'Effective reach configuration with provenance: every key with its resolved value and source layer (env > config file > default / unset).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      return { configPath: makeCfg().filePath, snapshot: makeCfg().snapshot() };
    },
  },
  {
    name: 'reach_explain',
    description: 'Explain the full routing + backend-chain decision for a URL WITHOUT fetching: matching channels, the winner, and each matching channel\'s ordered backend chain (default order).',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
    async run(args) {
      const u = String(args.url);
      const decision = route(u);
      const matching = ALL_CHANNELS.filter((c) => { try { return c.can_handle(u); } catch { return false; } });
      return {
        url: u,
        matches: matching.map((c) => c.name),
        routedTo: decision.channel?.name || null,
        reason: decision.reason || null,
        orderedBackends: Object.fromEntries(matching.map((c) => [c.name, c.ordered_backends(makeCfg())])),
      };
    },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyErr = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return replyErr(null, -32700, 'Parse error'); }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
        break;
      case 'notifications/initialized':
      case 'initialized':
        break; // notification — never answered
      case 'ping':
        reply(id, {});
        break;
      case 'tools/list':
        reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
        break;
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return replyErr(id, -32602, `unknown tool: ${params?.name}`);
        try {
          const result = await tool.run(params?.arguments || {});
          reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
          reply(id, { content: [{ type: 'text', text: String(err?.message || err) }], isError: true });
        }
        break;
      }
      default:
        if (!isNotification) replyErr(id, -32601, `method not found: ${method}`);
    }
  } catch (err) {
    if (!isNotification) replyErr(id, -32603, `internal error: ${String(err?.message || err)}`);
  }
});

// stderr is for logs only — stdout carries the protocol.
process.stderr.write(`${SERVER_INFO.name} ${SERVER_INFO.version} ready: ${TOOLS.length} tools\n`);
