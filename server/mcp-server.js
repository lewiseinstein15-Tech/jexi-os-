/**
 * JEXI OS — Model Context Protocol (MCP) server.
 *
 * Lets AI assistants (Claude Desktop, Cursor, Claude Code, ChatGPT…)
 * securely connect to JEXI's brain over one HTTP endpoint (/mcp).
 *
 * What is exposed:
 *   TOOLS     ask_jexi · memory_lookup · knowledge_search · list_books · get_health
 *   RESOURCES memory://user · memory://chat · knowledge://structure · knowledge://files
 *
 * Safety model (deliberate, minimal surface):
 *   - Allowlist only: anything not registered here is NOT callable. The MCP
 *     SDK rejects unknown tools/resources automatically.
 *   - Read-mostly: the only "action" tool is ask_jexi, which runs JEXI's own
 *     planner — the same safe pipeline the chat UI uses (it writes generated
 *     apps only into WORKSPACE_DIR; no destructive operations).
 *   - Auth: the endpoint rides the existing Express API gate (JEXI_API_KEY) and
 *     can additionally require MCP_MCP_KEY on every client request.
 *   - No destructive tools (no clearMemory, no deleteBook, no settings writes).
 *
 * Run standalone (dev):  node mcp-server.js            → http://127.0.0.1:3457/mcp
 * Or mount in the app:   node index.js                 → http://<host>:<PORT>/mcp
 */

import express from 'express';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { planner } from './src/services/Planner.js';
import { orchestrator } from './src/services/Orchestrator.js';
import { loadMemory, getChatHistory, getMemoryStats, topUserFacts, searchKnowledge, getKnowledgeStructure, getKnowledgeStatus } from './src/services/MemoryManager.js';
import { listBooks } from './src/services/BookLibrary.js';
import { loadSettings } from './src/services/SettingsManager.js';

export const MCP_PORT = Number(process.env.MCP_PORT) || 3457;

/** Optional per-request MCP key (JEXI_MCP_KEY). When set, every MCP request
 *  must carry it as the Authorization: Bearer <key> header. */
const MCP_KEY = process.env.JEXI_MCP_KEY || '';

const server = new McpServer({ name: 'jexi-os', version: '1.1.0' }, { capabilities: { tools: {}, resources: {} } });

/* ------------------------------------------------------------------ *
 *  Internal helpers
 * ------------------------------------------------------------------ */

/** Run a query through JEXI's real planner + orchestrator (the same pipeline
 *  the chat UI uses) and return a structured, JSON-safe result. */
async function runJexiQuery(query, opts = {}) {
  const raw = String(query || '').trim();
  if (!raw) throw new Error('query must be a non-empty string');

  // Capture the terminal event: Orchestrator emits 'done' with the summary.
  let result = { success: false, summary: '', sources: [], files: [], statistics: {} };
  const events = [];
  const sendEvent = (type, data) => {
    events.push({ type, ...data });
    if (type === 'done') {
      result = {
        success: !!data.success,
        summary: data.summary || '',
        sources: data.sources || [],
        files: data.files || [],
        statistics: data.statistics || {},
        error: data.error || '',
      };
    }
  };

  const plan = await planner.analyzeIntent(raw, { image: opts.image });
  const results = await orchestrator.executePlan(plan, raw, sendEvent, { image: opts.image });

  // Contract: a successful run always carries a readable summary.
  if (!result.summary && results?.summary) result.summary = results.summary;
  if (!result.summary && results?.success) result.summary = '✅ Task completed.';
  if (!result.summary && results?.error) result.summary = `⚠ ${results.error}`;

  const agentTrace = events
    .filter(e => e.type === 'log')
    .map(e => `[${e.agent}] ${e.message}`)
    .slice(-15);

  return { ...result, plan: { intent: plan.intent, reasoning: plan.reasoning }, trace: agentTrace };
}

/* ------------------------------------------------------------------ *
 *  TOOLS (allowlist)
 * ------------------------------------------------------------------ */

// 1 — the main action: run any task through JEXI's agent team.
server.tool(
  'ask_jexi',
  'Run a task or question through JEXI OS. Returns a structured answer after the agent team finishes. ' +
    'Use for building apps, research, study, math, coding, news and general questions.',
  { query: z.string().min(1).describe('The task or question for JEXI, e.g. "build a calculator app" or "latest AI news"') },
  async ({ query }) => {
    const out = await runJexiQuery(query);
    return { content: [{ type: 'text', text: out.summary || '(no summary)' }], structuredContent: out };
  }
);

// 2 — read the memory core (profile + facts + stats).
server.tool(
  'memory_lookup',
  'Read what JEXI remembers about the user: profile, learned preferences/facts, memory stats.',
  { detail: z.enum(['profile', 'facts', 'stats', 'full']).optional().default('full').describe('How much detail to return') },
  async ({ detail }) => {
    const mem = loadMemory();
    const profile = mem.userProfile || {};
    const facts = topUserFacts(8).map(f => (typeof f === 'string' ? f : f?.text || String(f)));
    const stats = getMemoryStats ? getMemoryStats() : {};
    if (detail === 'profile') return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }], structuredContent: { profile } };
    if (detail === 'facts') return { content: [{ type: 'text', text: facts.join('\n') || '(no facts yet)' }], structuredContent: { facts } };
    if (detail === 'stats') return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }], structuredContent: { stats } };
    return { content: [{ type: 'text', text: JSON.stringify({ profile, facts, stats }, null, 2) }], structuredContent: { profile, facts, stats } };
  }
);

// 3 — knowledge library search.
server.tool(
  'knowledge_search',
  'Search JEXI\'s saved knowledge library (books, study notes, solutions) for a topic.',
  { query: z.string().min(1).describe('Search term, e.g. "calculus" or "quantum computing"'), limit: z.number().int().min(1).max(20).optional().default(10) },
  async ({ query, limit }) => {
    const hits = searchKnowledge(query).slice(0, limit);
    const text = hits.length
      ? hits.map((h, i) => `${i + 1}. [${h.category || 'knowledge'}] ${h.filename || h.topic || ''} — ${(h.excerpt || h.content || '').slice(0, 240)}`).join('\n')
      : '(no knowledge matches)';
    return { content: [{ type: 'text', text }], structuredContent: { query, results: hits } };
  }
);

// 4 — books in the library.
server.tool(
  'list_books',
  'List the books stored in JEXI\'s library (read-only).',
  {},
  async () => {
    const books = listBooks();
    return { content: [{ type: 'text', text: books.length ? books.map((b, i) => `${i + 1}. ${b.title || b.name}`).join('\n') : '(library is empty)' }], structuredContent: { books } };
  }
);

// 5 — health + key status.
server.tool(
  'get_health',
  'Check whether JEXI\'s brain is online and which AI providers are configured (without exposing keys).',
  {},
  async () => {
    const settings = loadSettings();
    const hasEnv = {
      groq: !!process.env.GROQ_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
    };
    const providers = {
      groq: hasEnv.groq || !!settings.groqKey,
      gemini: hasEnv.gemini || !!settings.geminiKey,
      openrouter: hasEnv.openrouter,
    };
    const out = { ok: true, name: 'jexi-os', providers, memory: loadMemory() ? 'available' : 'empty' };
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
  }
);

/* ------------------------------------------------------------------ *
 *  RESOURCES (read-only)
 * ------------------------------------------------------------------ */

const listStatic = (resources) => () => ({ resources });

server.registerResource(
  'memory://user',
  new ResourceTemplate('memory://user', { list: listStatic([{ uri: 'memory://user', name: 'User profile & learned facts', description: 'JEXI\'s saved profile and learned preferences/facts about the user' }]) }),
  { title: 'User profile & learned facts', description: 'JEXI\'s saved profile and learned preferences/facts about the user' },
  async () => {
    const mem = loadMemory();
    const body = JSON.stringify({ profile: mem.userProfile || {}, recentFacts: topUserFacts(8) }, null, 2);
    return { contents: [{ uri: 'memory://user', mimeType: 'application/json', text: body }] };
  }
);

server.registerResource(
  'memory://chat',
  new ResourceTemplate('memory://chat', { list: listStatic([{ uri: 'memory://chat', name: 'Recent chat history', description: 'The last 20 exchanges between the user and JEXI' }]) }),
  { title: 'Recent chat history', description: 'The last 20 exchanges between the user and JEXI' },
  async () => {
    const body = JSON.stringify({ history: getChatHistory(20) }, null, 2);
    return { contents: [{ uri: 'memory://chat', mimeType: 'application/json', text: body }] };
  }
);

server.registerResource(
  'knowledge://structure',
  new ResourceTemplate('knowledge://structure', { list: listStatic([{ uri: 'knowledge://structure', name: 'Knowledge library structure & status', description: 'Categories, file counts and health of the saved knowledge library' }]) }),
  { title: 'Knowledge library structure & status', description: 'Categories, file counts and health of the saved knowledge library' },
  async () => {
    const body = JSON.stringify({ structure: getKnowledgeStructure(), status: getKnowledgeStatus() }, null, 2);
    return { contents: [{ uri: 'knowledge://structure', mimeType: 'application/json', text: body }] };
  }
);

server.registerResource(
  'knowledge://files',
  new ResourceTemplate('knowledge://files/{category}', { list: listStatic([{ uri: 'knowledge://files/{category}', name: 'Knowledge files by category', description: 'Files inside one knowledge category, e.g. knowledge://files/calculus' }]) }),
  { title: 'Knowledge files by category', description: 'Files inside one knowledge category, e.g. knowledge://files/calculus' },
  async (uri, variables) => {
    const structure = getKnowledgeStructure();
    const category = variables?.category || '';
    const files = structure?.[category] || (structure?.categories?.[category]) || [];
    const body = JSON.stringify({ category, files }, null, 2);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: body }] };
  }
);

/* ------------------------------------------------------------------ *
 *  Express wiring — mount on the existing app at /mcp
 * ------------------------------------------------------------------ */

// Stateless transport (no session IDs): each POST creates a fresh transport,
// the SDK validates the request internally and streams the response. This is
// the simplest robust mode for a personal OS and matches the SDK's documented
// Express example.
let transport = null;

export function mountMcp(app) {
  app.use('/mcp', express.json({ limit: '2mb' }), async (req, res, next) => {
    try {
      // Optional dedicated MCP key: Authorization: Bearer <JEXI_MCP_KEY>
      if (MCP_KEY) {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (token !== MCP_KEY) {
          res.status(401).json({ error: 'Unauthorized — MCP requires a valid bearer token (set JEXI_MCP_KEY).' });
          return;
        }
      }

      if (req.method === 'POST') {
        // Close any previous transport so a reconnect starts clean.
        await transport?.close().catch(() => {});
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === 'GET') {
        // Session status ping (clients probe with GET before initializing).
        res.status(200).json({ jsonrpc: '2.0', result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'jexi-os', version: '1.1.0' } }, id: null });
        return;
      }

      res.status(405).json({ error: 'Method not allowed — MCP uses POST (and GET for status).' });
    } catch (err) {
      console.error('[MCP] request error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}

/* ------------------------------------------------------------------ *
 *  Standalone launcher (node mcp-server.js)
 * ------------------------------------------------------------------ */

if (process.argv[1] && process.argv[1].endsWith('mcp-server.js')) {
  const app = express();
  mountMcp(app);
  app.get('/health', (req, res) => res.json({ ok: true, mcp: 'jexi-os', endpoint: '/mcp' }));
  app.listen(MCP_PORT, () => {
    console.log(`\n🧠 JEXI OS MCP server ready`);
    console.log(`   Endpoint: http://127.0.0.1:${MCP_PORT}/mcp`);
    console.log(`   Tools:    ask_jexi, memory_lookup, knowledge_search, list_books, get_health`);
    console.log(`   Resources: memory://user, memory://chat, knowledge://structure, knowledge://files/{category}`);
    console.log(`   Auth:     ${MCP_KEY ? 'JEXI_MCP_KEY required (Bearer)' : 'open (set JEXI_MCP_KEY to lock it)'}\n`);
  });
}
