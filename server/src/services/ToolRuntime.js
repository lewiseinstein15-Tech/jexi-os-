/**
 * JEXI OS — Tool Runtime (roadmap stage 9: unified tool runtime).
 *
 * The Tool Registry (ToolRegistry.js) is the CATALOG — 151 tools with slugs,
 * descriptions and the agents allowed to use them. This module is the
 * RUNTIME: it turns a tool slug + arguments into a real, gated, observable
 * execution.
 *
 *   schema        — per-tool argument schema (name / type / required)
 *   permission    — every tool is classified safe | medium | risky
 *   profiles      — auto (safe+medium auto, risky blocked) ·
 *                   ask  (safe auto, medium/risky need approval) ·
 *                   full (everything auto) — stored in settings
 *   validation    — args checked against the schema before anything runs
 *   timeout       — every execution is time-boxed
 *   events        — every execution emits tool.start / tool.result so the
 *                   UI shows live what JEXI is doing (Grok Build lesson:
 *                   tool execution must be observable and interceptable)
 *
 * Tools with a real engine run for real. Tools without one (or without the
 * required key/engine) return an honest "routed to <agent>" result — never a
 * fake success.
 */

import { TOOL_REGISTRY, getTool, enforceToolAllowlist } from './ToolRegistry.js';
import { aggregateSearch } from './SearchEngine.js';
import { extractContent, extractPdfText, downloadBookFromUrl } from './Extractor.js';
import { runNewsTeam } from './NewsAgent.js';
import { searchTrustedBooks, getTrustedBookText, latestNews } from './TrustedLibrary.js';
import { runCommand } from './Runner.js';
import { computeStats } from './DataAgent.js';
import { synthesizeAnswer } from './Summarizer.js';
import { analyzeVideo, getVideoTranscript } from './VideoAnalyzer.js';
import {
  semanticRecall, rememberUserFact, searchKnowledge, saveKnowledgeFile,
  loadMemory, rememberEpisode, saveMemory, getActiveSession,
} from './MemoryManager.js';
import { appendEvent } from './EventLog.js'; // B78 — tool calls/results are first-class events
import { getPluginTool } from './PluginContext.js'; // B97 — plugin-mounted tools run through the same gated pipeline
import { discoverSkills, loadSkillForModel, observeHostMutationFromArgs } from './SkillDiscovery.js'; // B98 — dsh-style ranked skill discovery + progressive load
import { collectSystemStatus } from './SelfMonitor.js';
import { loadSettings, saveSettings } from './SettingsManager.js';
import { runHooks } from './HookEngine.js';
import { classifyRisk } from './RiskGuard.js';

/* ------------------------------------------------------------------ */
/* Schemas — argument contracts for the executable tools.              */
/* ------------------------------------------------------------------ */
export const TOOL_SCHEMAS = {
  'web-search': { query: { type: 'string', required: true, desc: 'Search query' }, limit: { type: 'number', desc: 'Max results' } },
  'wikipedia-lookup': { topic: { type: 'string', required: true, desc: 'Topic to look up' } },
  'arxiv-search': { query: { type: 'string', required: true, desc: 'Paper search query' } },
  'market-research': { topic: { type: 'string', required: true, desc: 'Market to size' } },
  'competitor-scan': { topic: { type: 'string', required: true, desc: 'Competitor or market' } },
  'deep-read': { url: { type: 'string', required: true, desc: 'URL to read' } },
  'pdf-extract': { url: { type: 'string', required: true, desc: 'PDF URL or path' } },
  'trusted-library': { topic: { type: 'string', required: true, desc: 'Topic to research' } },
  'book-fetch': { url: { type: 'string', required: true, desc: 'Book/paper URL' } },
  'news-feed': { query: { type: 'string', required: true, desc: 'Topic or empty for headlines' } },
  'memory-recall': { query: { type: 'string', required: true, desc: 'What to remember' }, limit: { type: 'number' } },
  'memory-write': { fact: { type: 'string', required: true, desc: 'Fact/preference to store' }, label: { type: 'string', desc: 'Optional label' } },
  'knowledge-search': { query: { type: 'string', required: true, desc: 'Search the knowledge library' } },
  'knowledge-save': { category: { type: 'string', required: true, desc: 'Category folder' }, filename: { type: 'string', required: true, desc: 'File name' }, content: { type: 'string', required: true, desc: 'Content to save' } },
  'profile-read': {},
  'semantic-search': { query: { type: 'string', required: true, desc: 'Semantic query' }, limit: { type: 'number' } },
  'episode-save': { ask: { type: 'string', required: true }, reply: { type: 'string', required: true } },
  'code-run': { command: { type: 'string', required: true, desc: 'Shell command (sandboxed, time-boxed)' }, cwd: { type: 'string' } },
  'code-write': { filename: { type: 'string', required: true, desc: 'Workspace-relative path' }, content: { type: 'string', required: true, desc: 'File content' } },
  'summarize-doc': { text: { type: 'string', required: true, desc: 'Text to summarize' }, query: { type: 'string', desc: 'Focus question' } },
  'video-analyze': { url: { type: 'string', required: true, desc: 'Video URL' } },
  'video-transcript': { url: { type: 'string', required: true, desc: 'Video URL' } },
  'data-crunch': { rows: { type: 'array', desc: 'Data rows' }, columns: { type: 'array', desc: 'Column names' } },
  'stats-compute': { rows: { type: 'array', desc: 'Data rows' }, columns: { type: 'array', desc: 'Column names' } },
  'self-diagnose': {},
  'trend-scan': { query: { type: 'string', desc: 'Topic to scan trends for' } },
  'mcp-call': { tool: { type: 'string', required: true, desc: 'MCP tool name (ask_jexi, memory_lookup, knowledge_search, list_books, get_health)' }, args: { type: 'object', desc: 'Arguments for the MCP tool' } },
  'connector-call': { name: { type: 'string', required: true, desc: 'Connector name (github, email)' }, method: { type: 'string', desc: "Method: 'send' (default) | 'receive' | 'reply' | 'health'" }, payload: { type: 'object', desc: 'Payload for the connector method (see the generated send_<connector> tool schemas)' } },
};

/* ------------------------------------------------------------------ */
/* Priority 4 — fail-closed OUTPUT validation. Inputs are already checked  */
/* against TOOL_SCHEMAS; outputs are now validated too so malformed tool   */
/* results never silently become an empty/hallucinated reply.              */
/* ------------------------------------------------------------------ */
import { z } from 'zod';

/** Per-tool output contracts for the engines whose shape downstream code trusts. */
/**
 * B98 — rank-aware match for skill-search (name > description > whenToUse).
 * Mirrors DSH tool-skill's catalog search semantics (metadata only).
 */
function matchScore(c, q) {
  const name = String(c.name || '').toLowerCase();
  const desc = String(c.description || '').toLowerCase();
  const when = String(c.whenToUse || '').toLowerCase();
  if (name === q) return 100;
  if (name.includes(q)) return 60;
  if (desc.includes(q)) return 30;
  if (when.includes(q)) return 15;
  // token-level: any query word in name/description
  const words = q.split(/\s+/).filter(Boolean);
  if (words.some((w) => name.includes(w))) return 12;
  if (words.some((w) => desc.includes(w))) return 8;
  return 0;
}

/**
 * B99 — the safe default visible set for run_code when the calling loop did
 * not provide its pruned schemas (direct /api/tools/execute calls): read-tier
 * tools + planning/memory tools, capped — never the whole catalog.
 */
function defaultCodeTools() {
  const extra = new Set(['todo', 'plan', 'memory-recall', 'session-list', 'session-search', 'skill-load', 'skill-search', 'subagent']);
  return TOOL_REGISTRY.filter((t) => t.tier === 'read' || extra.has(t.slug)).slice(0, 30);
}

export const TOOL_OUTPUT_SCHEMAS = {
  'web-search': z.object({
    kind: z.string(),
    query: z.string(),
    results: z.array(z.object({ title: z.string().optional().nullable(), url: z.string().optional().nullable(), snippet: z.string().optional().nullable() })).optional(),
  }).passthrough(),
  'deep-read': z.object({ kind: z.string(), url: z.string(), text: z.string() }).passthrough(),
  'pdf-extract': z.object({ kind: z.string(), url: z.string(), text: z.string() }).passthrough(),
  'stats-compute': z.object({ kind: z.string(), stats: z.unknown() }).passthrough(),
  'self-diagnose': z.object({ kind: z.string(), status: z.unknown() }).passthrough(),
  'mcp-call': z.object({ ok: z.boolean(), tool: z.string().optional(), result: z.unknown().optional(), error: z.unknown().optional() }).passthrough(),
  'connector-call': z.object({ ok: z.boolean(), connector: z.string().optional(), method: z.string().optional(), result: z.unknown().optional(), events: z.unknown().optional(), error: z.unknown().optional(), code: z.string().optional() }).passthrough(),
  // B96 — DeepSeek-Harness-style tools: canonical output contracts.
  'session-list': z.object({ kind: z.literal('sessions'), conversations: z.array(z.unknown()).optional(), active: z.unknown().optional() }).passthrough(),
  'session-search': z.object({ kind: z.literal('session-search'), query: z.string(), results: z.array(z.unknown()).optional() }).passthrough(),
  'session-fork': z.object({ ok: z.boolean(), id: z.string().optional(), parentSession: z.string().optional(), seedLength: z.number().optional(), error: z.string().optional() }).passthrough(),
  'subagent': z.object({ kind: z.literal('subagent'), task: z.string().optional(), report: z.string().optional(), ok: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'skill-load': z.object({ kind: z.literal('skill').optional(), ok: z.boolean().optional(), slug: z.string().optional(), name: z.string().optional(), description: z.string().optional(), provider: z.string().optional(), source: z.string().optional(), rank: z.number().optional(), resourceBase: z.unknown().optional(), body: z.string().optional() }).passthrough(),
  'skill-search': z.object({ kind: z.literal('skill-search'), query: z.string(), total: z.number().optional(), results: z.array(z.unknown()).optional() }).passthrough(),
  'run_code': z.object({ kind: z.literal('code-run').optional(), description: z.string().optional(), logs: z.array(z.string()).optional(), result: z.unknown().optional(), toolCalls: z.number().optional(), durationMs: z.number().optional(), truncated: z.boolean().optional(), error: z.string().optional(), ok: z.boolean().optional(), subCalls: z.array(z.unknown()).optional() }).passthrough(),
  'todo': z.object({ kind: z.literal('todo'), todos: z.array(z.unknown()).optional() }).passthrough(),
  'plan': z.object({ kind: z.literal('plan'), plan: z.unknown().optional() }).passthrough(),
  'weather-now': z.object({ ok: z.boolean(), kind: z.literal('weather').optional(), city: z.string().optional(), tempC: z.unknown().optional(), desc: z.string().optional() }).passthrough(),
};

/**
 * P4 — validate tool arguments against the schema, fail closed.
 * Returns { ok: true, args } or { ok: false, error: { code, message, node, raw } }.
 */
export function validateToolArgs(slug, args = {}) {
  const schema = TOOL_SCHEMAS[slug];
  if (!schema) return { ok: true, args };
  const problems = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.required && (args[key] === undefined || args[key] === null || args[key] === '')) {
      problems.push(`missing required arg "${key}"${spec.desc ? ` (${spec.desc})` : ''}`);
    }
    if (args[key] !== undefined && spec.type === 'number' && typeof args[key] !== 'number') problems.push(`"${key}" must be a number`);
    if (args[key] !== undefined && spec.type === 'object' && (typeof args[key] !== 'object' || args[key] === null)) problems.push(`"${key}" must be an object`);
  }
  if (problems.length) {
    return { ok: false, error: { code: 'SCHEMA_VALIDATION_FAILED', message: `Invalid arguments for "${slug}": ${problems.join('; ')}`, node: 'tool', raw: args } };
  }
  return { ok: true, args };
}

/**
 * P4 — validate a tool's OUTPUT shape, fail closed. Returns the structured
 * error when malformed so callers route to replanner instead of replying.
 */
export function validateToolOutput(slug, result) {
  const schema = TOOL_OUTPUT_SCHEMAS[slug];
  if (!schema) return { ok: true };
  if (result === undefined || result === null) {
    return { ok: false, error: { code: 'SCHEMA_VALIDATION_FAILED', message: `Tool "${slug}" returned no output`, node: 'tool' } };
  }
  const check = schema.safeParse(result);
  if (!check.success) {
    return {
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: `Tool "${slug}" returned malformed output: ${check.error.issues.map((i) => i.message).join('; ')}`,
        node: 'tool',
        raw: result,
      },
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* B67 — native tool-calling schemas.                                  */
/*                                                                     */
/* Converts tool definitions (the flat TOOL_SCHEMAS style, or explicit  */
/* { slug, name, desc, schema } entries) into OpenAI function-calling  */
/* schemas so the Orchestrator-Workers SIMPLE path and the AgentLoop   */
/* can offer REAL native tool calls — no JSON-in-prose parsing.        */
/* ------------------------------------------------------------------ */

/**
 * Build OpenAI function-calling schemas from tool definitions.
 * Each def: { slug, name?, desc?, schema? } where schema is the flat
 * TOOL_SCHEMAS shape ({ key: { type, required, desc } }). Defs without a
 * schema (registry-only, no executable engine) are omitted — offering them
 * would just give the model routing dead-ends.
 */
export function buildNativeSchemas(defs) {
  return (defs || [])
    .map((t) => {
      const schema = (t && t.schema) || TOOL_SCHEMAS[t && t.slug];
      if (!schema) return null;
      const properties = {};
      const required = [];
      for (const [k, spec] of Object.entries(schema)) {
        const type = spec.type === 'number' ? 'number' : spec.type === 'array' ? 'array' : spec.type === 'object' ? 'object' : 'string';
        properties[k] = { type, description: spec.desc || '' };
        if (spec.required) required.push(k);
      }
      return {
        type: 'function',
        function: {
          name: t.slug,
          description: String(t.desc || t.name || t.slug).slice(0, 500),
          parameters: { type: 'object', properties, required },
        },
      };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Permissions — safe = read-only, medium = writes JEXI's own data,    */
/* risky = executes code / touches external systems.                   */
/* ------------------------------------------------------------------ */
const SAFE_TOOLS = new Set([
  'web-search', 'wikipedia-lookup', 'arxiv-search', 'market-research', 'competitor-scan',
  'deep-read', 'pdf-extract', 'trusted-library', 'book-fetch', 'news-feed', 'trend-scan',
  'memory-recall', 'knowledge-search', 'profile-read', 'semantic-search', 'summarize-doc',
  'video-analyze', 'video-transcript', 'data-crunch', 'stats-compute', 'self-diagnose',
]);

const RISKY_TOOLS = new Set([
  'code-run', 'code-write', 'github-cli', 'git-status', 'branch-manage', 'issue-track',
  'browser-drive', 'form-fill', 'tab-manage', 'memory-clear',
]);

export function toolPermission(slug) {
  if (RISKY_TOOLS.has(slug)) return 'risky';
  if (SAFE_TOOLS.has(slug)) return 'safe';
  return 'medium'; // writes to JEXI's own data (memory, knowledge) or external reads
}

/* ------------------------------------------------------------------ */
/* B55 P1 — OpenWorker risk-tiered execution (layered on top of the    */
/* existing permission system; nothing here replaces it).              */
/*                                                                     */
/*   read        — no side effects (search, lookup, comparison)        */
/*                 → ALWAYS autonomous, never confirm                  */
/*   write_local — scoped mutation of the user's own data/workspace    */
/*                 (drafting, editing, saving) → ALWAYS autonomous     */
/*   exec        — running code / commands → autonomous by default,    */
/*                 logged, reversible only (RiskGuard already blocks   */
/*                 HIGH/irreversible calls)                            */
/*   external    — spends money, sends something externally, or is     */
/*                 irreversible → ALWAYS requires ONE explicit human   */
/*                 approval showing REAL finalized details             */
/* ------------------------------------------------------------------ */

/** Static tier per tool slug (args can refine it, e.g. mcp-call). */
const TOOL_TIERS = {
  // read
  'web-search': 'read', 'wikipedia-lookup': 'read', 'arxiv-search': 'read', 'market-research': 'read',
  'competitor-scan': 'read', 'deep-read': 'read', 'pdf-extract': 'read', 'trusted-library': 'read',
  'book-fetch': 'read', 'news-feed': 'read', 'trend-scan': 'read', 'memory-recall': 'read',
  'knowledge-search': 'read', 'profile-read': 'read', 'semantic-search': 'read', 'summarize-doc': 'read',
  'video-analyze': 'read', 'video-transcript': 'read', 'data-crunch': 'read', 'stats-compute': 'read',
  'self-diagnose': 'read',
  // write_local
  'memory-write': 'write_local', 'knowledge-save': 'write_local', 'episode-save': 'write_local',
  'code-write': 'write_local', 'memory-clear': 'write_local',
  // exec
  'code-run': 'exec', 'git-status': 'exec', 'branch-manage': 'exec', 'issue-track': 'exec',
  'tab-manage': 'exec',
  // external
  'github-cli': 'external', 'browser-drive': 'external', 'form-fill': 'external',
  'mcp-call': 'external', // refined by args below — the default is CONFIRM, per OpenWorker
  'connector-call': 'external', // refined by method below — send = CONFIRM
};

/**
 * Built-in MCP tools on JEXI's allowlist are read-only by its MCP safety
 * model (ask_jexi writes only into WORKSPACE_DIR through the same safe
 * pipeline; the rest are pure reads). Any OTHER mcp-call target defaults to
 * 'external' — conservative: unknown/registered-external tools require the
 * one-time human approval before they can run.
 */
const BUILTIN_MCP_READ_TOOLS = new Set(['ask_jexi', 'memory_lookup', 'knowledge_search', 'list_books', 'get_health']);

/** Refine the tier from the actual call args (call-level, not just slug). */
export function toolTier(slug, args = {}) {
  if (slug === 'mcp-call') {
    const name = String(args.tool || '');
    return BUILTIN_MCP_READ_TOOLS.has(name) ? 'read' : 'external';
  }
  if (slug === 'connector-call') {
    // Sending anything out is EXTERNAL (one human approval). Reading inbound
    // events or checking health has no side effects → read tier.
    const method = String(args.method || 'send');
    return method === 'receive' || method === 'health' ? 'read' : 'external';
  }
  return TOOL_TIERS[slug] || 'read';
}

/**
 * B55 P5 — is this tool result a REAL completed execution? A tool call is
 * only "done" when the actual tool response confirms it: routed (planned but
 * not executed), paused (awaiting approval) and blocked results are NOT done.
 */
export function isToolDone(res) {
  if (!res || res.ok !== true) return false;
  if (res.routed === true) return false; // registry-only: never claimed as done
  if (res.paused === true || res.approvalRequired === true) return false;
  return true;
}

/** Permission profiles the user can pick in Settings. */
export const TOOL_PROFILES = {
  auto: { label: 'Auto', desc: 'Auto-run safe + medium tools; risky tools are blocked', allow: ['safe', 'medium'] },
  ask: { label: 'Ask', desc: 'Auto-run safe tools; medium/risky need your approval', allow: ['safe'] },
  full: { label: 'Full', desc: 'Auto-run everything including code execution', allow: ['safe', 'medium', 'risky'] },
};

export function activeToolProfile() {
  const s = loadSettings();
  return TOOL_PROFILES[s.toolProfile] ? s.toolProfile : 'auto';
}

export function setToolProfile(profile) {
  if (!TOOL_PROFILES[profile]) throw new Error(`Unknown tool profile: ${profile}`);
  const s = loadSettings();
  s.toolProfile = profile;
  saveSettings(s);
  return { profile, ...TOOL_PROFILES[profile] };
}

/* ------------------------------------------------------------------ */
/* Real executors — the engines behind the executable core.            */
/* ------------------------------------------------------------------ */
const WORKSPACE = 'workspace'; // resolve from settings in index.js wiring

async function runEngine(slug, args, opts = {}) {
  switch (slug) {
    case 'web-search':
    case 'wikipedia-lookup':
    case 'arxiv-search':
    case 'market-research':
    case 'competitor-scan':
    case 'trend-scan': {
      const q = args.query || args.topic || args.url || '';
      const prefix = slug === 'wikipedia-lookup' ? 'wikipedia ' : slug === 'arxiv-search' ? 'arxiv ' : '';
      const articles = await aggregateSearch(prefix + q, null);
      return { kind: 'search', query: q, results: (articles || []).slice(0, (args.limit || 5)).map((a) => ({ title: a.title, url: a.link || a.url, snippet: String(a.snippet || a.content || '').slice(0, 260) })) };
    }
    case 'deep-read': {
      const content = await extractContent(args.url);
      return { kind: 'content', url: args.url, text: String(content || '').slice(0, 8000) };
    }
    case 'pdf-extract': {
      const buf = await downloadBookFromUrl(args.url);
      const text = await extractPdfText(buf);
      return { kind: 'pdf', url: args.url, text: String(text || '').slice(0, 8000) };
    }
    case 'trusted-library': {
      const books = await searchTrustedBooks(args.topic);
      return { kind: 'books', topic: args.topic, books: (books || []).slice(0, 4).map((b) => ({ title: b.title, url: b.url, snippet: String(b.snippet || '').slice(0, 240) })) };
    }
    case 'book-fetch': {
      const text = await getTrustedBookText(args.url, 24000);
      return { kind: 'book', url: args.url, text: String(text || '').slice(0, 8000) };
    }
    case 'news-feed': {
      const items = args.query ? await latestNews(args.query, 8) : await runNewsTeam('', () => {});
      return { kind: 'news', query: args.query || 'headlines', items: (items || []).slice(0, 8).map((n) => ({ title: n.title, url: n.url, source: n.source, time: n.published })) };
    }
    case 'memory-recall':
    case 'semantic-search': {
      const found = await semanticRecall(args.query, { limit: args.limit || 3, maxChars: 2000 });
      return { kind: 'memory', query: args.query, matches: found.map((f) => ({ label: f.label, text: String(f.text || '').slice(0, 400) })) };
    }
    case 'memory-write': {
      await rememberUserFact(args.fact, 0.8, args.label || 'fact');
      saveMemory();
      return { kind: 'stored', fact: args.fact };
    }
    case 'knowledge-search': {
      const hits = await searchKnowledge(args.query);
      return { kind: 'knowledge', query: args.query, hits: (hits || []).slice(0, 4).map((k) => ({ title: k.title || k.file, text: String(k.content || k.text || '').slice(0, 400) })) };
    }
    case 'knowledge-save': {
      await saveKnowledgeFile(args.category, args.filename, args.content);
      return { kind: 'stored', file: `${args.category}/${args.filename}` };
    }
    case 'profile-read': {
      const m = loadMemory();
      return { kind: 'profile', profile: m.userProfile || {}, facts: (m.userFacts || []).slice(0, 6) };
    }
    case 'episode-save': {
      await rememberEpisode(args.ask, args.reply);
      return { kind: 'stored', episode: args.ask.slice(0, 80) };
    }
    case 'code-run': {
      const out = await runCommand(args.command, { timeout: 30000, cwd: args.cwd });
      return { kind: 'exec', command: args.command, output: String(out.output || '').slice(0, 6000), success: !!out.success };
    }
    case 'code-write': {
      const { writeFile } = await import('fs/promises');
      const { join } = await import('path');
      await writeFile(join(process.env.WORKSPACE_DIR || WORKSPACE, args.filename), args.content, 'utf-8');
      return { kind: 'written', file: args.filename };
    }
    case 'summarize-doc': {
      const summary = await synthesizeAnswer(args.query || 'Summarize', [{ title: 'Document', content: args.text }]);
      return { kind: 'summary', summary: String(summary || '').slice(0, 4000) };
    }
    case 'video-analyze': {
      const res = await analyzeVideo(args.url, { sendEvent: () => {} });
      return { kind: 'video', url: args.url, summary: String(res?.summary || res?.analysis || JSON.stringify(res).slice(0, 2000)).slice(0, 4000) };
    }
    case 'video-transcript': {
      const segs = await getVideoTranscript(args.url);
      return { kind: 'transcript', url: args.url, text: String(segs?.text || segs?.join?.('\n') || JSON.stringify(segs).slice(0, 2000)).slice(0, 8000) };
    }
    case 'data-crunch':
    case 'stats-compute': {
      const stats = computeStats(args.rows || [], args.columns || []);
      return { kind: 'stats', stats };
    }
    case 'self-diagnose': {
      const status = await collectSystemStatus();
      return { kind: 'system', status };
    }
    case 'mcp-call': {
      // P7 — internal MCP tool path: an internal node reaches an external MCP
      // tool through the same schema-validated path as internal tools.
      const { callMcpTool } = await import('../../mcp-server.js');
      return await callMcpTool(args.tool, args.args || {});
    }
    case 'connector-call': {
      // B56 — connectors through the same gated tool path. send() is
      // EXTERNAL-tier (approval happens above in executeTool); the connector
      // module resolves the registered instance by name.
      const { callConnector } = await import('../connectors/index.js');
      const res = await callConnector(args.name, { method: args.method || 'send', payload: args.payload || {} });
      if (!res.ok) {
        return { ok: false, connector: args.name, error: { code: res.code || 'CONNECTOR_FAILED', message: res.error || 'connector call failed' }, ...(res.retryAfter ? { retryAfter: res.retryAfter } : {}) };
      }
      return res;
    }

    /* ---------------- B96 — DeepSeek-Harness-style tools ---------------- */

    case 'session-list': {
      // DSH session_query: list prior conversations with titles + activity.
      const { listConversations } = await import('./SessionConversations.js');
      const { getActiveSession } = await import('./MemoryManager.js');
      const convs = listConversations();
      const active = getActiveSession();
      return { kind: 'sessions', active, conversations: convs.slice(0, 20).map((c) => ({ id: c.id, title: c.title, messages: c.messageCount, lastActive: c.lastActive, isActive: c.id === active })) };
    }

    case 'session-search': {
      // DSH session_query: full-text search across ALL past conversations.
      const { searchConversations } = await import('./SessionConversations.js');
      const q = args.query || '';
      const res = searchConversations(q, { limit: Number(args.limit) || 5 });
      return { kind: 'session-search', query: q, results: res };
    }

    case 'session-fork': {
      // DSH session fork: seed a new conversation from the current one.
      const { forkConversation } = await import('./SessionConversations.js');
      const { getActiveSession } = await import('./MemoryManager.js');
      const source = args.session || getActiveSession() || 'default';
      const f = forkConversation(source, args.newId || null);
      return f.ok ? { ok: true, id: f.id, parentSession: f.parentSession, seedLength: f.seedLength } : { ok: false, error: f.error };
    }

    case 'subagent': {
      // DSH tool-subagent: delegate a sub-task to a child agent (own context).
      const { runSubagent } = await import('./SubagentRuntime.js');
      const task = String(args.task || '').slice(0, 2000);
      if (!task) return { ok: false, error: 'subagent task required' };
      const report = await runSubagent(task, args.instructions || '', { depth: Number(args.depth) || 1 });
      return { kind: 'subagent', task: task.slice(0, 120), report: String(report || '').slice(0, 3000) };
    }

    case 'skill-load': {
      // DSH tool-skill: load a skill body into context (progressive disclosure).
      // B98 — resolves through ranked discovery (project → user → bundled)
      // first; falls back to the SkillChain roster library for legacy slugs.
      const slug = String(args.skill || args.name || '').trim();
      if (!slug) return { ok: false, error: 'skill name required' };
      const found = loadSkillForModel(slug);
      if (found) {
        return {
          kind: 'skill', slug, name: found.name,
          description: String(found.content || '').slice(0, 160),
          provider: found.provider, source: found.source, rank: found.rank,
          resourceBase: found.resourceBase,
          body: String(found.content || '').slice(0, 8000),
        };
      }
      const { loadSkill, skillMeta } = await import('./SkillChain.js');
      const meta = skillMeta(slug);
      const body = loadSkill(slug);
      if (!body) return { ok: false, error: `skill "${slug}" not found` };
      return { kind: 'skill', slug, name: (meta && meta.name) || slug, provider: 'roster', source: 'bundled', rank: 600, body: String(body.md || '').slice(0, 8000) };
    }

    case 'skill-search': {
      // DSH tool-skill catalog: metadata-only search across ranked roots —
      // full bodies are NEVER returned here (progressive disclosure).
      const q = String(args.query || '').trim().toLowerCase();
      if (!q) return { kind: 'skill-search', query: '', total: 0, results: [] };
      const limit = Math.min(Math.max(1, Number(args.limit) || 12), 25);
      const results = discoverSkills()
        .filter((c) => c.invocation.modelInvocable)
        .map((c) => ({ c, score: matchScore(c, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.c.rank - b.c.rank)
        .slice(0, limit)
        .map((x) => ({
          name: x.c.name,
          description: x.c.description,
          ...(x.c.whenToUse ? { whenToUse: x.c.whenToUse } : {}),
          source: x.c.source,
          rank: x.c.rank,
          provider: x.c.provider,
        }));
      return { kind: 'skill-search', query: String(args.query).slice(0, 200), total: results.length, results };
    }

    case 'run_code': {
      // B99 — CODE MODE (PTC): dsh `code` preset mirror. The model writes ONE
      // TypeScript program; every `await tools.<name>(args)` inside dispatches
      // through THIS gated runtime (permissions, allowlists, risk tiers) and
      // only what the program prints/returns comes back to the model.
      const { renderToolsSdk, runCodeProgram, RUN_CODE_NAME } = await import('./CodeModeRuntime.js');
      const code = String(args.code || '');
      if (!code.trim()) return { ok: false, error: 'run_code requires a code body' };
      const description = String(args.description || '').trim().slice(0, 120) || 'program';
      // Visible set: the loop's pruned schemas when present, else the safe
      // default (read-tier + planning tools) — never the whole catalog.
      let visible = Array.isArray(opts.codeTools) ? opts.codeTools.filter((t) => t && t.slug) : [];
      if (!visible.length) visible = defaultCodeTools();
      const names = visible.map((t) => t.slug);
      const subCalls = [];
      const out = await runCodeProgram({
        code,
        toolNames: names,
        isReadTool: (name) => { const t = getTool(name); return !!t && t.tier === 'read'; },
        dispatch: async (name, tArgs) => {
          if (name === RUN_CODE_NAME) throw new Error('run_code cannot be called from inside a program');
          const sub = await executeTool({
            slug: name,
            args: tArgs || {},
            profile: opts.profile,
            sendEvent: opts.sendEvent,
            signal: opts.signal,
            intent: opts.intent,
          });
          subCalls.push({ name, ok: !!sub.ok, error: sub.error || null });
          if (!sub.ok) throw new Error((sub.error || `tool "${name}" failed`).slice(0, 400));
          if (sub.result === undefined || sub.result === null) return null;
          try { return JSON.parse(String(sub.result)); } catch { return sub.result; }
        },
        signal: opts.signal,
        maxSubCalls: 40,
        maxRunMs: 120000,
      });
      const status = out.error ? 'FAILED' : out.truncated ? 'truncated' : 'ok';
      try {
        opts.sendEvent('agent.log', {
          message: `🧮 Code Mode · ${description} — ${out.toolCalls} tool call(s) in ${out.durationMs}ms · ${status}${out.error ? `: ${out.error}` : ''}`,
        });
      } catch { /* noop */ }
      if (out.error) {
        return { ok: false, kind: 'code-run', description, error: out.error, logs: out.logs.slice(0, 40), toolCalls: out.toolCalls, durationMs: out.durationMs };
      }
      return {
        kind: 'code-run', description, logs: out.logs.slice(0, 60),
        result: out.result === undefined ? null : out.result,
        toolCalls: out.toolCalls, durationMs: out.durationMs, truncated: !!out.truncated,
        subCalls: subCalls.slice(0, 15),
      };
    }

    case 'todo': {
      // DSH todo: the model manages its own visible task list.
      const { todoList, todoAdd, todoComplete, todoRemove } = await import('./TodoStore.js');
      const op = args.op || 'list';
      if (op === 'add') return { kind: 'todo', todos: todoAdd(String(args.text || '')) };
      if (op === 'complete') return { kind: 'todo', todos: todoComplete(Number(args.index)) };
      if (op === 'remove') return { kind: 'todo', todos: todoRemove(Number(args.index)) };
      return { kind: 'todo', todos: todoList() };
    }

    case 'plan': {
      // DSH plan: explicit multi-step plan with per-step status.
      const { planSet, planGet, planUpdate } = await import('./PlanStore.js');
      const op = args.op || 'get';
      if (op === 'set') return { kind: 'plan', plan: planSet(String(args.title || ''), Array.isArray(args.steps) ? args.steps : []) };
      if (op === 'update') return { kind: 'plan', plan: planUpdate(Number(args.index), String(args.status || ''), String(args.note || '')) };
      return { kind: 'plan', plan: planGet() };
    }

    default: {
      // B97 — PLUGIN SEAM: tools mounted by plugins (deepseek-harness style)
      // execute here, through the SAME permission/risk/approval pipeline.
      const pluginTool = getPluginTool(slug);
      if (pluginTool) {
        try {
          const r = await pluginTool.handler(args || {});
          return { ok: !!r.ok, ...r };
        } catch (e) {
          return { ok: false, error: (e && e.message) || 'plugin tool failed' };
        }
      }
      return null; // no engine — caller decides fallback
    }
  }
}

/** Normalize anything the engines return into a flat displayable string. */
function formatResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result, null, 2).slice(0, 8000); } catch (e) { return String(result); }
}

/* ------------------------------------------------------------------ */
/* The runtime entry point.                                            */
/* ------------------------------------------------------------------ */
/**
 * Execute a tool by slug with full gating + observability.
 * Returns { ok, permission, profile, durationMs, result, error, approvalRequired }.
 */
/**
 * B78 — event-sourced logging wrapper: every tool invocation and its real
 * outcome is recorded in the durable event log (tool_call → tool_result),
 * regardless of which return path the gate took (allowed / blocked / failed).
 * The gated body is unchanged below (executeToolInner).
 */
export async function executeTool(params) {
  const { slug, args = {} } = params || {};
  try {
    appendEvent('tool_call', {
      tool: slug,
      args: safeArgs(slug, args),
      tier: toolTier(slug, args),
      profile: (params && (params.profile || activeToolProfile())) || activeToolProfile(),
    });
  } catch (e) {}
  const result = await executeToolInner(params);
  try {
    appendEvent('tool_result', {
      tool: slug,
      ok: !!result.ok,
      blocked: !!result.blocked,
      declined: !!result.declined,
      paused: !!result.paused,
      approvalRequired: !!result.approvalRequired,
      error: String(result.error || '').slice(0, 300),
      durationMs: result.durationMs || 0,
    });
  } catch (e) {}
  return result;
}

async function executeToolInner({ slug, args = {}, profile, intent, sendEvent, confirm, codeTools, signal }) {
  const started = Date.now();
  const emit = (type, payload) => { try { if (typeof sendEvent === 'function') sendEvent(type, payload); } catch (e) {} };
  // B97 — PLUGIN SEAM: plugin-mounted tools are first-class. If the static
  // registry misses, synthesize the tool record from the plugin context so
  // the same gates (allowlist, permission, risk, approval, events) apply.
  let tool = getTool(slug);
  if (!tool) {
    const pt = getPluginTool(slug);
    if (pt) tool = { slug, name: pt.name || slug, desc: pt.desc || 'plugin tool', agents: [], permission: pt.permission || 'medium' };
    else return { ok: false, error: `Unknown tool: ${slug}`, durationMs: 0 };
  }

  // B52 P4 — hard enforcement: lightweight intents (direct_answer,
  // conversation, …) may only call their memory/knowledge allowlist. This is
  // a CODE gate, not a prompt rule — a web/browser/study tool outside the
  // allowlist is refused before it can execute.
  if (intent) {
    const en = enforceToolAllowlist(intent, slug);
    if (!en.allowed) {
      const refused = { ok: false, blocked: true, byAllowlist: intent, tool: slug, error: en.reason, durationMs: Date.now() - started };
      emit('tool.refused', { tool: slug, intent, reason: en.reason });
      return refused;
    }
  }

  const perm = toolPermission(slug);
  const useProfile = profile || activeToolProfile();
  const tier = toolTier(slug, args); // B55 P1 — OpenWorker risk tier

  emit('tool.start', { tool: slug, name: tool.name, permission: perm, tier, profile: useProfile, args: safeArgs(slug, args) });

  // HOOK ENGINE (stage 22) — PreToolUse gate, fail-open (only deny blocks).
  const gate = runHooks('beforeTool', { tool: slug, query: args.query || args.url || args.command || '' }, (t, d) => emit(t, d));
  if (!gate.allowed) {
    const blocked = { ok: false, blocked: true, byHook: gate.blocked.name, tool: slug, error: `Blocked by hook "${gate.blocked.name}": ${gate.blocked.message || 'denied'}.`, durationMs: Date.now() - started };
    emit('tool.result', { tool: slug, ok: false, blocked: true, byHook: gate.blocked.name, error: blocked.error, durationMs: blocked.durationMs });
    return blocked;
  }

  // Permission gate
  const allowed = TOOL_PROFILES[useProfile]?.allow || [];
  if (!allowed.includes(perm)) {
    const blocked = { ok: false, blocked: true, permission: perm, profile: useProfile, tool: slug, error: `${tool.name} needs ${perm} permission (profile: ${useProfile}). Switch to Full or Ask in Settings.`, durationMs: Date.now() - started };
    emit('tool.result', { tool: slug, ok: false, blocked: true, permission: perm, profile: useProfile, error: blocked.error, durationMs: blocked.durationMs });
    return blocked;
  }

  // RISK GUARD (stage 17) — classify the actual call, not just the slug.
  const risk = classifyRisk(slug, args);
  if (!risk.canRun) {
    const blocked = {
      ok: false, blocked: true, risk: risk.level, tool: slug, byRiskGuard: true,
      error: `Risk guard blocked this call: ${risk.reason}${risk.reasons.length ? ` (${risk.reasons.join('; ')})` : ''}. You can allow it explicitly in Settings → Security.`,
      durationMs: Date.now() - started,
    };
    emit('tool.result', { tool: slug, ok: false, blocked: true, byRiskGuard: true, risk: risk.level, error: blocked.error, durationMs: blocked.durationMs });
    return blocked;
  }
  if (risk.level === 'medium' || risk.level === 'high') {
    emit('tool.risk', { tool: slug, level: risk.level, reasons: risk.reasons });
  }

  // Argument validation
  const schema = TOOL_SCHEMAS[slug] || {};
  const problems = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.required && (args[key] === undefined || args[key] === null || args[key] === '')) {
      problems.push(`missing required arg "${key}"${spec.desc ? ` (${spec.desc})` : ''}`);
    }
    if (args[key] !== undefined && spec.type === 'number' && typeof args[key] !== 'number') problems.push(`"${key}" must be a number`);
  }
  if (problems.length) {
    const invalid = { ok: false, tool: slug, error: `Invalid arguments: ${problems.join('; ')}`, durationMs: Date.now() - started };
    emit('tool.result', { tool: slug, ok: false, error: invalid.error, durationMs: invalid.durationMs });
    return invalid;
  }

  // B55 P1 — EXTERNAL tier gate (OpenWorker): anything that spends money,
  // sends something externally, or is irreversible ALWAYS requires ONE
  // explicit human approval showing the REAL finalized details (never
  // placeholders). read / write_local / exec run autonomously by default.
  if (tier === 'external') {
    const details = buildFinalizedDetails(slug, args);
    const payload = {
      risk: 'irreversible',
      tier: 'external',
      node: 'tool',
      tool: slug,
      action: slug,
      details,
      question: `⚠ This is an **external** action (spends money, sends something out, or is irreversible).\n\n**Finalized details:** ${details}\n\nSay **yes** to run it exactly as shown, or **no** to cancel.`,
    };
    if (typeof confirm === 'function') {
      const decision = await confirm(payload);
      if (decision === false) {
        const declined = { ok: false, declined: true, tool: slug, tier, approvalRequired: false, error: `Cancelled — I won't run ${slug}. Tell me if you change your mind.`, durationMs: Date.now() - started };
        emit('tool.result', { tool: slug, ok: false, declined: true, error: declined.error, durationMs: declined.durationMs });
        return declined;
      }
      if (decision === 'paused') {
        const paused = { ok: false, paused: true, approvalRequired: true, tool: slug, tier, error: 'Approval requested — resuming after the user confirms.', durationMs: Date.now() - started };
        emit('tool.result', { tool: slug, ok: false, paused: true, approvalRequired: true, durationMs: paused.durationMs });
        return paused;
      }
      // decision === true → approved, run below.
    } else {
      const needApproval = { ok: false, approvalRequired: true, tool: slug, tier, error: `${slug} is an external action and needs your approval before it can run. ${details}`, details, durationMs: Date.now() - started };
      emit('tool.result', { tool: slug, ok: false, approvalRequired: true, error: needApproval.error, durationMs: needApproval.durationMs });
      return needApproval;
    }
  }

  try {
    // B99 — code-mode programs get a longer budget (the program itself caps
    // its own wall-clock inside the worker; this is the outer backstop).
    const outerTimeoutMs = slug === 'run_code' ? 240000 : 60000;
    const result = await withTimeout(runEngine(slug, args, {
      codeTools,
      profile,
      sendEvent: emit,
      signal,
      intent,
    }), outerTimeoutMs);
    // P4 — fail closed on malformed tool OUTPUT (never a silent empty reply).
    const outCheck = validateToolOutput(slug, result);
    if (!outCheck.ok) {
      const invalid = { ok: false, tool: slug, code: outCheck.error.code, error: outCheck.error.message, raw: outCheck.error.raw, durationMs: Date.now() - started };
      emit('tool.result', { tool: slug, ok: false, error: invalid.error, durationMs: invalid.durationMs });
      return invalid;
    }
    // P8 — engines that honestly report failure (e.g. mcp-call) stay failures.
    if (result && typeof result === 'object' && result.ok === false) {
      const msg = result.error?.message || String(result.error || 'tool reported failure');
      const failed = { ok: false, tool: slug, code: result.error?.code, error: msg, durationMs: Date.now() - started };
      emit('tool.result', { tool: slug, ok: false, error: msg, durationMs: failed.durationMs });
      return failed;
    }
    if (result === null) {
      // Registry tool without a runtime engine — route to its owning agents.
      const routed = { ok: true, routed: true, tool: slug, result: `This tool is planned and routed to: ${(tool.agents || []).slice(0, 3).join(', ')}. It runs during the pipeline execution for this task.` };
      emit('tool.result', { tool: slug, ok: true, routed: true, durationMs: Date.now() - started });
      return { ...routed, permission: perm, durationMs: Date.now() - started };
    }
    runHooks('afterTool', { tool: slug, query: args.query || args.url || args.command || '', ok: true }, (t, d) => emit(t, d));
    // B98 — first-party writes under a skill root invalidate the discovery
    // cache (DSH observeHostMutation) so new/edited skills appear instantly.
    if (/^(write|save|create|edit|upload|update|build|scaffold)/i.test(slug)) {
      try { observeHostMutationFromArgs(args); } catch { /* noop */ }
    }
    const ok = { ok: true, tool: slug, permission: perm, tier, result: formatResult(result), durationMs: Date.now() - started };
    emit('tool.result', { tool: slug, ok: true, durationMs: ok.durationMs, preview: String(ok.result).slice(0, 300) });
    return ok;
  } catch (e) {
    const failed = { ok: false, tool: slug, error: (e && e.message) || String(e), durationMs: Date.now() - started };
    emit('tool.result', { tool: slug, ok: false, error: failed.error, durationMs: failed.durationMs });
    return failed;
  }
}

/**
 * B55 P1 — human-readable FINALIZED details for an EXTERNAL approval prompt.
 * Built from the validated args so the user approves the real call, never a
 * placeholder.
 */
export function buildFinalizedDetails(slug, args = {}) {
  if (slug === 'code-run') return `$ ${args.command || '(no command)'}`;
  if (slug === 'mcp-call') {
    const safe = safeArgs(slug, args.args || {});
    return `MCP tool: ${args.tool || '(none)'}${Object.keys(safe).length ? ` with ${JSON.stringify(safe)}` : ''}`;
  }
  if (slug === 'connector-call') {
    const safe = safeArgs(slug, args.payload || {});
    return `Connector: ${args.name || '(none)'} · method: ${args.method || 'send'}${Object.keys(safe).length ? ` · ${JSON.stringify(safe)}` : ''}`;
  }
  const safe = safeArgs(slug, args);
  const parts = Object.entries(safe)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return parts.length ? parts.join(' · ') : `${slug} (no arguments)`;
}

/** Full catalog: registry + schema + permission, for the /api/tools UI. */
export function getToolCatalog() {
  return TOOL_REGISTRY.map((t) => ({
    slug: t.slug,
    name: t.name,
    type: t.type,
    desc: t.desc,
    agents: t.agents,
    engine: t.engine,
    permission: toolPermission(t.slug),
    tier: toolTier(t.slug),
    schema: TOOL_SCHEMAS[t.slug] || null,
    executable: !!TOOL_SCHEMAS[t.slug],
  }));
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function safeArgs(slug, args) {
  // Never log key-like values
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (/key|token|secret|password/i.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}
