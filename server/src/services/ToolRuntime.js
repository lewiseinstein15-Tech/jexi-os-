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
import { WORKSPACE_DIR as CFG_WORKSPACE_DIR, PUBLIC_URL as CFG_PUBLIC_URL, MANAGER_URL as CFG_MANAGER_URL } from '../config.js'; // B127 — real workspace path + public base for URL sanitizing
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
import { SPILL_THRESHOLD } from './SpillStore.js'; // B100 — spill oversized tool results (dsh spill-policy)
import { planModeBlocked } from './PlanMode.js'; // B111 — plan mode hard-gates execution tools
import { collectSystemStatus } from './SelfMonitor.js';
import { loadSettings, saveSettings } from './SettingsManager.js';
import { runHooks } from './HookEngine.js';
import { classifyRisk } from './RiskGuard.js';
import { fireToolHooks } from './HookBridges.js'; // B135 — Codex/Claude Code hook bridges (fail-open)
import { needsApproval } from './UserApproval.js'; // B137 — dsh user-approval (external-tier pause policy)

/* ------------------------------------------------------------------ */
/* Schemas — argument contracts for the executable tools.              */
/* ------------------------------------------------------------------ */
export const TOOL_SCHEMAS = {
  'workflow': {
    script: { type: 'string', required: true, desc: 'Plain-JS workflow script body (top-level await; end with return <json>). Globals: agent(task,{instructions,depth}), parallel([fns]), pipeline(items,...stages), phase(title), log(msg), args.' },
    meta: { type: 'object', required: true, desc: '{name (kebab-case), description, whenToUse?, phases?: [{title, detail?}]}' },
    args: { type: 'object', desc: 'Optional JSON input exposed as the args global' },
    maxTotalAgents: { type: 'number', desc: 'Optional agent cap for this run' },
  },
  'send_message': {
    subagent_id: { type: 'string', required: true, desc: 'The background subagent id' },
    message: { type: 'string', required: true, desc: 'Message delivered as its next turn' },
  },
  'interrupt_agent': {
    agent_id: { type: 'string', required: true, desc: 'The running agent id to interrupt' },
  },
  'terminal_open': {
    type: { type: 'string', required: true, desc: 'Terminal backend type, usually "shell".' },
    name: { type: 'string', desc: 'Optional display name such as "main".' },
    cwd: { type: 'string', desc: 'Initial working directory (default: workspace root).' },
  },
  'terminal_send': {
    session_id: { type: 'string', required: true, desc: 'The terminal session id.' },
    input: { type: 'string', required: true, desc: 'Command/input to write to the session stdin.' },
  },
  'terminal_read': {
    session_id: { type: 'string', required: true, desc: 'The terminal session id.' },
    cap: { type: 'number', desc: 'Max output chars to drain (default 12000).' },
  },
  'terminal_signal': {
    session_id: { type: 'string', required: true, desc: 'The terminal session id.' },
    signal: { type: 'string', desc: 'Signal name, e.g. SIGINT (default).' },
  },
  'terminal_close': {
    session_id: { type: 'string', required: true, desc: 'The terminal session id.' },
  },
  'sandbox_mode': {
    mode: { type: 'string', required: true, desc: 'read-only | workspace-write | danger-full-access' },
  },
  'ralph': {
    objective: { type: 'string', required: true, desc: 'The immutable objective for the fresh-agent Ralph loop (one objective per call).' },
    maxRounds: { type: 'number', desc: 'Optional round cap (default 12, deployment ceiling 64).' },
    maxHandoffChars: { type: 'number', desc: 'Optional max serialized characters in one structured handoff (default 16384).' },
  },
  'report': {
    output: { type: 'string', required: true, desc: 'Actionable, self-contained content for the agent that started you (summarize conclusions, reference shared paths).' },
  },
  'subagent': {
    task: { type: 'string', required: true, desc: 'The sub-task to delegate to a child agent.' },
    instructions: { type: 'string', desc: 'Optional instructions / context for the child.' },
    depth: { type: 'number', desc: 'Optional recursion depth (default 1).' },
    provider: { type: 'string', desc: 'Subagent provider: in-process (default), claude-code, codex, acp, dsh-sdk (B138 — external CLI providers).' },
  },
  'schedule_create': {
    query: { type: 'string', required: true, desc: 'The recurring task/goal query to run.' },
    everySeconds: { type: 'number', desc: 'Run every N seconds (mutually exclusive with dailyAt).' },
    dailyAt: { type: 'string', desc: 'Run daily at HH:MM (24h; mutually exclusive with everySeconds).' },
    label: { type: 'string', desc: 'Optional human label.' },
    kind: { type: 'string', desc: 'task (default) or goal.' },
    autonomy: { type: 'string', desc: 'ask (default) or full for goal schedules.' },
  },
  'schedule_list': {},
  'schedule_delete': {
    id: { type: 'string', required: true, desc: 'The schedule id to delete.' },
  },
  'pwsh': {
    command: { type: 'string', required: true, desc: 'The PowerShell command to execute.' },
    description: { type: 'string', required: true, desc: 'Clear 5-10 word description of what the command does (shown in the UI).' },
    timeoutMs: { type: 'number', desc: 'Timeout in ms (default 30000, max 120000).' },
  },
  'cordis_inspect_list': {},
  'cordis_inspect_query': {
    provider: { type: 'string', required: true, desc: 'Provider id from cordis_inspect_list (e.g. jexi:plugins).' },
    method: { type: 'string', required: true, desc: 'Read-only method declared by the provider (e.g. listPlugins).' },
    input: { type: 'object', desc: 'Optional method input (e.g. { slug }).' },
  },
  'cordis_define': {
    name: { type: 'string', required: true, desc: 'Plugin name matching ^[a-z][a-z0-9_-]{1,48}$.' },
    purpose: { type: 'string', required: true, desc: 'Non-empty purpose statement.' },
    code: { type: 'object', required: true, desc: '{ host: "<async (jexi, input) => cleanup fn body>" } — the host half evaluated against the live plugin seam.' },
  },
  'cordis_run': {
    pluginId: { type: 'string', required: true, desc: 'The plugin id from cordis_define.' },
    packageId: { type: 'string', required: true, desc: 'The package id from cordis_define.' },
    input: { type: 'object', desc: 'Optional input passed to the host code.' },
  },
  'cordis_stop': {
    pluginId: { type: 'string', required: true, desc: 'The plugin id whose run to stop.' },
  },
  'cordis_undefine': {
    pluginId: { type: 'string', required: true, desc: 'The plugin id to remove.' },
  },
  'cordis_inspect_self': {},
  'create_goal': {
    objective: { type: 'string', required: true, desc: 'The concrete completion objective inferred from the direct human request.' },
    max_goal_rounds: { type: 'number', desc: 'Optional positive integer limit on automatic continuation rounds.' },
  },
  'update_goal': {
    goal_id: { type: 'string', required: true, desc: 'Exact id returned by get_goal.' },
    revision: { type: 'number', required: true, desc: 'Exact positive revision returned by get_goal.' },
    action: { type: 'string', required: true, desc: 'edit | pause | resume | complete | blocked' },
    objective: { type: 'string', desc: 'Replacement objective; valid only with action edit.' },
    max_goal_rounds: { type: 'number', desc: 'Replacement cap; valid only with action edit.' },
    blocking_condition: { type: 'string', desc: 'Concrete blocking condition; required only with action blocked.' },
  },
  // B112 — plan/ask tools need real argument schemas (providers strip undeclared args).
  'ask_user_question': {
    questions: {
      type: 'array', required: true,
      desc: 'Questions to ask the user before continuing: [{ id, question, header?, options?: [{label, description?}], multi_select? }]',
    },
  },
  'exit_plan_mode': {
    plan: { type: 'string', required: true, desc: 'The complete plan as markdown: # title, then steps with owner tool/agent, verification per step, open questions.' },
  },
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
  'episode-recall': { query: { type: 'string', required: true, desc: 'Search term for memorable past exchanges.' } },
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

/** B101 — union a canonical success contract with the honest-failure shape. */
const FAILURE_SHAPE = z.object({ ok: z.literal(false), error: z.unknown() }).passthrough();
const orFail = (success) => z.union([success, FAILURE_SHAPE]);

/** B101 — the search-family engines share one canonical output contract. */
function buildSearchContracts(...slugs) {
  const out = {};
  for (const slug of slugs) {
    out[slug] = orFail(z.object({ kind: z.literal('search'), query: z.string(), results: z.array(z.unknown()).optional() }).passthrough());
  }
  return out;
}

/**
 * Specific output contracts for the structured engines. Every other registry
 * tool falls back to GENERIC_TOOL_OUTPUT in validateToolOutput (B101 — all
 * 187 tools are contract-checked, dsh output-contract mirror).
 */
export const TOOL_OUTPUT_SCHEMAS = {
  // B101 — every structured engine has a canonical SUCCESS contract (required
  // fields) unioned with the honest-FAILURE shape (ok:false + error), exactly
  // dsh's output contract + isError channel. Anything else fails closed.
  ...buildSearchContracts('web-search', 'wikipedia-lookup', 'arxiv-search', 'market-research', 'competitor-scan', 'trend-scan'),
  'deep-read': orFail(z.object({ kind: z.literal('content'), url: z.string(), text: z.string() }).passthrough()),
  'pdf-extract': orFail(z.object({ kind: z.literal('pdf'), url: z.string(), text: z.string() }).passthrough()),
  'trusted-library': orFail(z.object({ kind: z.literal('books'), topic: z.string(), books: z.array(z.unknown()).optional() }).passthrough()),
  'book-fetch': orFail(z.object({ kind: z.literal('book'), url: z.string(), text: z.string() }).passthrough()),
  'news-feed': orFail(z.object({ kind: z.literal('news'), query: z.string(), items: z.array(z.unknown()).optional() }).passthrough()),
  'memory-recall': orFail(z.object({ kind: z.literal('memory'), query: z.string(), matches: z.array(z.unknown()).optional() }).passthrough()),
  'semantic-search': orFail(z.object({ kind: z.literal('memory'), query: z.string(), matches: z.array(z.unknown()).optional() }).passthrough()),
  'memory-write': orFail(z.object({ kind: z.literal('stored'), fact: z.string() }).passthrough()),
  'knowledge-save': orFail(z.object({ kind: z.literal('stored'), file: z.string() }).passthrough()),
  'episode-save': orFail(z.object({ kind: z.literal('stored'), episode: z.string() }).passthrough()),
  'knowledge-search': orFail(z.object({ kind: z.literal('knowledge'), query: z.string(), hits: z.array(z.unknown()).optional() }).passthrough()),
  'profile-read': orFail(z.object({ kind: z.literal('profile'), profile: z.unknown().optional(), facts: z.array(z.unknown()).optional() }).passthrough()),
  'code-run': orFail(z.object({ kind: z.literal('exec'), command: z.string(), output: z.string(), success: z.boolean() }).passthrough()),
  'code-write': orFail(z.object({ kind: z.literal('written'), file: z.string() }).passthrough()),
  'summarize-doc': orFail(z.object({ kind: z.literal('summary'), summary: z.string() }).passthrough()),
  'video-analyze': orFail(z.object({ kind: z.literal('video'), url: z.string(), summary: z.string() }).passthrough()),
  'video-transcript': orFail(z.object({ kind: z.literal('transcript'), url: z.string(), text: z.string() }).passthrough()),
  'data-crunch': orFail(z.object({ kind: z.literal('stats'), stats: z.unknown() }).passthrough()),
  'stats-compute': orFail(z.object({ kind: z.literal('stats'), stats: z.unknown() }).passthrough()),
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
  'spill-read': z.object({ kind: z.literal('spill').optional(), ok: z.boolean().optional(), locator: z.string().optional(), bytes: z.number().optional(), content: z.string().optional(), error: z.string().optional() }).passthrough(),
  'run_in_background': z.object({ kind: z.literal('job').optional(), ok: z.boolean().optional(), id: z.string().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  'jobs_collect': z.object({ kind: z.literal('job').optional(), ok: z.boolean().optional(), id: z.string().optional(), status: z.string().optional(), answer: z.string().nullable().optional(), error: z.string().optional() }).passthrough(),
  'job_list': z.object({ kind: z.literal('jobs').optional(), jobs: z.array(z.unknown()).optional(), ok: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'job_kill': z.object({ kind: z.literal('job').optional(), ok: z.boolean().optional(), id: z.string().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  'ask_user_question': z.object({ kind: z.literal('ask-user').optional(), ok: z.boolean().optional(), status: z.string().optional(), questions: z.array(z.unknown()).optional(), error: z.string().optional() }).passthrough(),
  'exit_plan_mode': z.object({ kind: z.literal('plan-review').optional(), ok: z.boolean().optional(), status: z.string().optional(), plan: z.string().optional(), error: z.string().optional() }).passthrough(),
  'workflow': z.object({ kind: z.literal('workflow').optional(), ok: z.boolean().optional(), runId: z.string().optional(), agentsStarted: z.number().optional(), result: z.unknown().optional(), stopReason: z.string().optional(), error: z.unknown().optional() }).passthrough(),
  'send_message': z.object({ kind: z.literal('message').optional(), ok: z.boolean().optional(), messageId: z.string().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  'interrupt_agent': z.object({ kind: z.literal('interrupt').optional(), ok: z.boolean().optional(), accepted: z.boolean().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  // B121 — plugin tools get canonical output contracts too.
  'time-now': z.object({ ok: z.boolean(), kind: z.literal('time').optional(), timezone: z.string().optional(), local: z.string().optional(), utc: z.string().optional(), common: z.array(z.string()).optional(), error: z.string().optional() }).passthrough(),
  'currency-convert': z.object({ ok: z.boolean(), kind: z.literal('currency').optional(), from: z.string().optional(), to: z.string().optional(), amount: z.number().optional(), converted: z.number().optional(), rate: z.number().optional(), at: z.string().optional(), error: z.string().optional() }).passthrough(),
  // B122 — crypto + ip-geo contracts.
  'crypto-price': z.object({ ok: z.boolean(), kind: z.literal('crypto').optional(), coins: z.array(z.unknown()).optional(), currency: z.string().optional(), at: z.string().optional(), cached: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'ip-geo': z.object({ ok: z.boolean(), kind: z.literal('ipgeo').optional(), ip: z.string().optional(), country: z.string().optional(), countryCode: z.string().optional(), city: z.string().optional(), latitude: z.number().nullable().optional(), longitude: z.number().nullable().optional(), flag: z.string().nullable().optional(), connection: z.unknown().optional(), timezone: z.string().nullable().optional(), localTime: z.string().nullable().optional(), error: z.string().optional() }).passthrough(),
  // B125 — DSH tool-web research contracts.
  'web_search': z.object({ ok: z.boolean(), kind: z.literal('web-search-result').optional(), sources: z.array(z.object({ url: z.string(), title: z.string().optional(), snippet: z.string().optional(), publishedAt: z.string().optional() })).optional(), truncated: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'web_fetch': z.object({ ok: z.boolean(), kind: z.literal('web-fetch-result').optional(), url: z.string().optional(), statusCode: z.number().optional(), body: z.unknown().optional(), truncated: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  // B126 — autonomous coding contracts (DSH tool-bash/tool-fs).
  'bash': z.object({ ok: z.boolean(), kind: z.literal('bash-result').optional(), command: z.string().optional(), output: z.string().optional(), code: z.number().nullable().optional(), durationMs: z.number().nullable().optional(), error: z.string().optional() }).passthrough(),
  'write': z.object({ ok: z.boolean(), kind: z.literal('write-result').optional(), path: z.string().optional(), operation: z.string().optional(), before: z.string().nullable().optional(), after: z.string().optional(), size: z.number().optional(), error: z.string().optional() }).passthrough(),
  'read': z.object({ ok: z.boolean(), kind: z.literal('read-result').optional(), path: z.string().optional(), content: z.string().optional(), error: z.string().optional() }).passthrough(),
  'edit': z.object({ ok: z.boolean(), kind: z.literal('edit-result').optional(), path: z.string().optional(), operation: z.string().optional(), after: z.string().optional(), error: z.string().optional() }).passthrough(),
  'list_files': z.object({ ok: z.boolean(), kind: z.literal('list-result').optional(), path: z.string().optional(), files: z.array(z.string()).optional(), error: z.string().optional() }).passthrough(),
  // B127 — tappable preview URLs.
  'preview-server': z.object({ ok: z.boolean(), kind: z.literal('preview').optional(), url: z.string().optional(), file: z.string().optional(), note: z.string().optional(), error: z.string().optional() }).passthrough(),
  // B131 — LSP code intelligence contract (dsh tool-lsp).
  'lsp': z.object({ ok: z.boolean(), kind: z.enum(['locations', 'hover']).optional(), locations: z.array(z.object({ uri: z.string(), range: z.unknown() })).optional(), resolvedWorkspaceUri: z.string().optional(), hover: z.unknown().nullable().optional(), error: z.string().optional() }).passthrough(),
  // B132 — goal tools (dsh tool-goal).
  'get_goal': z.object({ ok: z.boolean(), goal: z.unknown().nullable().optional(), error: z.string().optional() }).passthrough(),
  'create_goal': z.object({ ok: z.boolean(), goal_id: z.string().optional(), revision: z.number().optional(), objective: z.string().optional(), started: z.boolean().optional(), note: z.string().optional(), error: z.string().optional() }).passthrough(),
  'update_goal': z.object({ ok: z.boolean(), goal_id: z.string().optional(), revision: z.number().optional(), action: z.string().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  // B134 — terminal + sandbox tools.
  'terminal_open': z.object({ ok: z.boolean(), kind: z.literal('terminal').optional(), sessionId: z.string().optional(), name: z.string().optional(), motd: z.string().optional(), error: z.string().optional() }).passthrough(),
  'terminal_send': z.object({ ok: z.boolean(), sessionId: z.string().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  'terminal_read': z.object({ ok: z.boolean(), sessionId: z.string().optional(), output: z.string().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  'terminal_signal': z.object({ ok: z.boolean(), sessionId: z.string().optional(), accepted: z.boolean().optional(), status: z.string().optional(), error: z.string().optional() }).passthrough(),
  'terminal_close': z.object({ ok: z.boolean(), sessionId: z.string().optional(), closed: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'sandbox_mode': z.object({ ok: z.boolean(), mode: z.string().optional(), error: z.string().optional() }).passthrough(),
  // B135 — tool-ralph contract (dsh): terminal status + rounds + bounded report.
  'ralph': z.object({ ok: z.boolean(), status: z.enum(['complete', 'blocked', 'budget-limited', 'round-failed']).optional(), roundsStarted: z.number().optional(), report: z.unknown().nullable().optional(), lastReport: z.unknown().nullable().optional(), error: z.string().optional() }).passthrough(),
  // B137 — tool-subagent-report contract (dsh): child-scoped delivery.
  'report': z.object({ ok: z.boolean(), report: z.object({ id: z.string(), at: z.number(), text: z.string() }).optional(), error: z.string().optional() }).passthrough(),
  // B140 — schedule tools contracts (dsh schedule tools).
  'schedule_create': z.object({ ok: z.boolean(), schedule: z.unknown().nullable().optional(), error: z.string().optional() }).passthrough(),
  'schedule_list': z.object({ ok: z.boolean(), schedules: z.array(z.unknown()).optional(), error: z.string().optional() }).passthrough(),
  'schedule_delete': z.object({ ok: z.boolean(), id: z.string().optional(), error: z.string().optional() }).passthrough(),
  // B141 — tool-pwsh contract (dsh): PowerShell-dialect result.
  'pwsh': z.object({ ok: z.boolean(), kind: z.literal('pwsh-result').optional(), command: z.string().optional(), output: z.string().optional(), code: z.number().nullable().optional(), durationMs: z.number().nullable().optional(), error: z.string().optional() }).passthrough(),
  // B142 — cordis inspect contracts (dsh tool-cordis): read-only introspection.
  'cordis_inspect_list': z.object({ ok: z.boolean(), providers: z.array(z.unknown()).optional(), error: z.string().optional() }).passthrough(),
  'cordis_inspect_query': z.object({ ok: z.boolean(), provider: z.string().optional(), method: z.string().optional(), result: z.unknown().nullable().optional(), error: z.string().optional() }).passthrough(),
  // B143 — cordis runner contracts (dsh cordis-host-runner): define/run/stop/undefine/self.
  'cordis_define': z.object({ ok: z.boolean(), pluginId: z.string().optional(), packageId: z.string().optional(), name: z.string().optional(), purpose: z.string().optional(), hasHostHalf: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'cordis_run': z.object({ ok: z.boolean(), runId: z.string().optional(), pluginId: z.string().optional(), packageId: z.string().optional(), error: z.string().optional() }).passthrough(),
  'cordis_stop': z.object({ ok: z.boolean(), pluginId: z.string().optional(), wasRunning: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'cordis_undefine': z.object({ ok: z.boolean(), pluginId: z.string().optional(), wasRunning: z.boolean().optional(), error: z.string().optional() }).passthrough(),
  'cordis_inspect_self': z.object({ ok: z.boolean(), plugins: z.array(z.unknown()).optional(), stateFile: z.string().optional(), error: z.string().optional() }).passthrough(),
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
/**
 * B101 — GENERIC baseline contract: every registry tool without a specific
 * contract is still checked. Engines must return a string or a plain object
 * (arrays/numbers/booleans fail) — the routing signal (null) is legal.
 */
export const GENERIC_TOOL_OUTPUT = z.union([
  z.string(),
  z.object({
    ok: z.boolean().optional(),
    kind: z.string().optional(),
    result: z.unknown().optional(),
    tool: z.string().optional(),
    error: z.union([z.string(), z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough(), z.null()]).optional(),
    permission: z.string().optional(),
    tier: z.string().optional(),
    durationMs: z.number().optional(),
    paused: z.boolean().optional(),
    approvalRequired: z.boolean().optional(),
    blocked: z.boolean().optional(),
    routed: z.boolean().optional(),
  }).passthrough(),
]);

/** Does this tool have a contract (specific or the generic baseline)? */
export function hasOutputContract(slug) {
  return !!TOOL_OUTPUT_SCHEMAS[slug] || !!GENERIC_TOOL_OUTPUT;
}

/** B101 — tier-based timeout defaults (dsh: per-tool timeoutMs, else sane floor). */
const DEFAULT_TIMEOUTS = { read: 45000, write_local: 60000, exec: 120000, risky: 120000 };
function defaultTimeoutFor(tool) {
  return DEFAULT_TIMEOUTS[tool && tool.tier] || 60000;
}

export function validateToolOutput(slug, result) {
  const schema = TOOL_OUTPUT_SCHEMAS[slug] || GENERIC_TOOL_OUTPUT;
  if (result === null) return { ok: true }; // null = the routing contract (no engine)
  if (result === undefined) {
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
      if (!t || !t.slug) return null;
      // B105 — schema sources: explicit `schema` (registry style), `args`
      // (plugin style), TOOL_SCHEMAS, or a generic empty-object fallback so
      // plugin tools are ALWAYS visible to the model (never silently dropped).
      const schema = (t.schema || t.args) || TOOL_SCHEMAS[t.slug];
      const properties = {};
      const required = [];
      for (const [k, spec] of Object.entries(schema || {})) {
        const type = spec && spec.type === 'number' ? 'number' : spec && spec.type === 'array' ? 'array' : spec && spec.type === 'object' ? 'object' : 'string';
        properties[k] = { type, description: (spec && spec.desc) || '' };
        if (spec && spec.required) required.push(k);
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
    case 'episode-recall': {
      // B145 — session episodes recall: search recent memorable exchanges
      // (ask/reply pairs) for the query (dsh archivist episode recall).
      const { getRecentEpisodes } = await import('./MemoryManager.js');
      const q = String(args.query || '').toLowerCase();
      const episodes = getRecentEpisodes(30);
      const hits = q
        ? episodes.filter((e) => (e.ask + ' ' + e.reply).toLowerCase().includes(q)).slice(-6)
        : episodes.slice(-6);
      return {
        ok: true,
        kind: 'episode',
        query: args.query || '',
        episodes: hits.map((e) => ({ ask: e.ask, reply: e.reply.slice(0, 600), time: e.time })),
        total: episodes.length,
      };
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
      // B138 — provider routing: external CLI providers (claude-code, codex,
      // acp) run when their binary exists; anything else falls back to the
      // in-process runtime (fail-open).
      const task = String(args.task || '').slice(0, 2000);
      if (!task) return { ok: false, error: 'subagent task required' };
      const provider = String(args.provider || '').trim() || 'in-process';
      const { isExternalProvider, resolveSubagentProvider, runExternalSubagent } = await import('./SubagentProviders.js');
      if (isExternalProvider(provider)) {
        const key = resolveSubagentProvider(provider);
        const r = await runExternalSubagent({ provider: key, task, timeoutMs: 120000 });
        if (!r.ok) {
          return { ok: false, kind: 'subagent', task: task.slice(0, 120), provider: key, error: r.error || `external subagent failed (code ${r.code})`, ...(r.output ? { partial: r.output.slice(0, 2000) } : {}) };
        }
        return { kind: 'subagent', task: task.slice(0, 120), provider: key, report: String(r.output || '').slice(0, 3000) };
      }
      const { runSubagent } = await import('./SubagentRuntime.js');
      const report = await runSubagent(task, args.instructions || '', { depth: Number(args.depth) || 1 });
      return { kind: 'subagent', task: task.slice(0, 120), provider: 'in-process', report: String(report || '').slice(0, 3000) };
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

    case 'preview-server': {
      // B127 — REAL preview engine: returns the tappable public URL for the
      // workspace's index.html (or the named file). On Render, PUBLIC_URL is
      // https://jexi-brain-image.onrender.com → https://…/preview/<file>.
      const { runFile } = await import('./Runner.js');
      const name = String(args.name || 'index.html');
      const file = name.endsWith('.html') ? name : `${name}.html`;
      const out = await runFile(file, () => {});
      if (!out.success) {
        // Fall back to the URL even if the syntax check failed (the file
        // exists) so the user can still open it.
        const { PUBLIC_URL, MANAGER_URL } = await import('../config.js');
        const base = PUBLIC_URL || MANAGER_URL;
        return { ok: true, kind: 'preview', url: `${base}/preview/${encodeURIComponent(file)}`, file, note: out.output ? String(out.output).slice(0, 300) : undefined };
      }
      return { ok: true, kind: 'preview', url: out.url, file };
    }

    case 'spill-read': {
      // B100 — dsh spill policy: retrieve the full body of a spilled result.
      const { readSpill } = await import('./SpillStore.js');
      const r = readSpill(args.locator, Number(args.cap) || 30000);
      if (!r.ok) return { ok: false, error: r.error };
      return { kind: 'spill', locator: r.locator, bytes: r.bytes, content: r.content };
    }

    case 'run_in_background': {
      // B106 — dsh tool-jobs: launch a durable background job.
      const { startJob } = await import('./BackgroundJobs.js');
      const r = startJob({ task: args.task, session: opts.spillOwner || args.session || 'default', profile: opts.profile, signal: opts.signal });
      if (!r.ok) return { ok: false, error: r.error };
      return { kind: 'job', id: r.id, status: r.status };
    }

    case 'jobs_collect': {
      // B106 — collect a background job's status/answer.
      const { collectJob } = await import('./BackgroundJobs.js');
      const j = collectJob(args.id);
      if (!j) return { ok: false, error: `job \"${String(args.id || '')}\" not found` };
      return { kind: 'job', id: j.id, status: j.status, answer: j.answer, error: j.error || undefined };
    }

    case 'job_list': {
      // B106 — list background jobs.
      const { listJobs } = await import('./BackgroundJobs.js');
      return { kind: 'jobs', jobs: listJobs(Number(args.limit) || 20) };
    }

    case 'terminal_open': {
      // B134 — dsh tool-terminal: persistent shell sessions.
      const { terminalOpen } = await import('./TerminalSessions.js');
      const r = terminalOpen({ type: args.type, name: args.name, cwd: args.cwd });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'terminal', sessionId: r.sessionId, name: r.name, motd: r.motd };
    }

    case 'terminal_send': {
      const { terminalSend } = await import('./TerminalSessions.js');
      const r = terminalSend(args.session_id, args.input);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, sessionId: r.sessionId, status: r.status };
    }

    case 'terminal_read': {
      const { terminalRead } = await import('./TerminalSessions.js');
      const r = terminalRead(args.session_id, { cap: args.cap });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, sessionId: r.sessionId, output: r.output, status: r.status };
    }

    case 'terminal_signal': {
      const { terminalSignal } = await import('./TerminalSessions.js');
      const r = terminalSignal(args.session_id, args.signal);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, sessionId: r.sessionId, accepted: r.accepted, status: r.status };
    }

    case 'terminal_close': {
      const { terminalClose } = await import('./TerminalSessions.js');
      const r = terminalClose(args.session_id);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, sessionId: r.sessionId, closed: r.closed };
    }

    case 'sandbox_mode': {
      // B134 — dsh sandbox-policy: set the session sandbox mode.
      const { setSandboxMode } = await import('./SandboxMode.js');
      const conv = opts.spillOwner || 'default';
      const r = setSandboxMode(conv, args.mode);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, mode: r.mode };
    }

    case 'get_goal': {
      // B132 — dsh tool-goal: read the current goal.
      const { getCurrentGoal } = await import('./GoalTools.js');
      const r = getCurrentGoal();
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'goal', goal: r.goal };
    }

    case 'create_goal': {
      // B132 — dsh tool-goal: create a goal.
      const { createGoal } = await import('./GoalTools.js');
      const r = await createGoal({ objective: args.objective, max_goal_rounds: args.max_goal_rounds });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'goal', goal_id: r.goal_id, revision: r.revision, objective: r.objective, started: !!r.started, ...(r.note ? { note: r.note } : {}) };
    }

    case 'update_goal': {
      // B132 — dsh tool-goal: update with optimistic revision.
      const { updateGoal } = await import('./GoalTools.js');
      const r = updateGoal({
        goal_id: args.goal_id, revision: args.revision, action: args.action,
        objective: args.objective, max_goal_rounds: args.max_goal_rounds,
        blocking_condition: args.blocking_condition,
      });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'goal', goal_id: r.goal_id, revision: r.revision, action: r.action, status: r.status };
    }

    case 'job_kill': {
      // B106 — stop a background job.
      const { killJob } = await import('./BackgroundJobs.js');
      const r = killJob(args.id);
      if (!r.ok) return { ok: false, error: r.error };
      return { kind: 'job', id: r.id, status: r.status };
    }

    case 'ask_user_question': {
      // B110 — dsh tool-ask-user: park structured questions for the user.
      const { askQuestions } = await import('./PendingQuestions.js');
      const conv = opts.spillOwner || 'default';
      const r = askQuestions(conv, args.questions);
      if (!r.ok) return { ok: false, error: r.error };
      try { opts.sendEvent('ask.user', { conv, questions: r.questions }); } catch { /* noop */ }
      return {
        kind: 'ask-user', status: 'pending', questions: r.questions,
        note: 'Questions are awaiting the user. End your turn now — the answers arrive in the next message.',
      };
    }

    case 'exit_plan_mode': {
      // B110 — dsh plan-mode: present the completed plan for review.
      const { presentPlan } = await import('./PlanMode.js');
      const conv = opts.spillOwner || 'default';
      const r = presentPlan(conv, args.plan);
      if (!r.ok) return { ok: false, error: r.error };
      try { opts.sendEvent('plan.review', { conv, plan: r.plan }); } catch { /* noop */ }
      return { kind: 'plan-review', status: 'pending_review', plan: r.plan };
    }

    case 'workflow': {
      // B115 — dsh tool-workflow: run a model-written orchestration script
      // that fans out subagents (agent/parallel/pipeline/phase/log globals).
      const { startWorkflow, workflowRecord, WorkflowError } = await import('./WorkflowEngine.js');
      const script = String(args.script || '');
      const meta = args.meta;
      if (!script.trim()) return { ok: false, error: 'workflow requires a script body' };
      // Stream workflow events as agent logs (DSH observe-only events).
      const onEvent = (type, data) => {
        try {
          if (type === 'workflow/phase') opts.sendEvent('agent.log', { message: `🏁 ${data.title}` });
          else if (type === 'workflow/log') opts.sendEvent('agent.log', { message: `📝 ${data.message}` });
          else if (type === 'workflow/agent-start') opts.sendEvent('agent.log', { message: `🧑‍💻 Subagent ${data.seq}: ${data.task}…` });
          else if (type === 'workflow/end') opts.sendEvent('agent.log', { message: `🏁 Workflow ${data.runId} → ${data.stopReason} (${data.agentsStarted} subagents).` });
        } catch { /* noop */ }
      };
      let run;
      try {
        run = startWorkflow({ script, meta, args: args.args, maxTotalAgents: Number(args.maxTotalAgents) || undefined, signal: opts.signal, onEvent });
      } catch (e) {
        const code = e instanceof WorkflowError ? e.code : 'INVALID_ARGUMENT';
        return { ok: false, error: `${code}: ${(e && e.message) || e}` };
      }
      const out = await run.result;
      const rec = workflowRecord(run.id);
      if (out.stopReason !== 'completed') {
        return { ok: false, kind: 'workflow', runId: run.id, agentsStarted: out.agentsStarted, stopReason: out.stopReason, error: out.error || 'workflow failed' };
      }
      return { kind: 'workflow', runId: run.id, agentsStarted: out.agentsStarted, stopReason: 'completed', result: out.value };
    }

    case 'send_message': {
      // B115 — dsh tool-subagent-control: message a background subagent.
      const { sendMessageToJob } = await import('./BackgroundJobs.js');
      const r = sendMessageToJob(args.subagent_id, args.message);
      if (!r.ok) return { ok: false, error: r.error };
      return { kind: 'message', messageId: r.messageId, status: r.status };
    }

    case 'interrupt_agent': {
      // B115 — dsh tool-subagent-control: cancel a background subagent's turn.
      const { interruptJob } = await import('./BackgroundJobs.js');
      const r = interruptJob(args.agent_id);
      if (!r.ok) return { ok: false, error: r.error };
      return { kind: 'interrupt', accepted: !!r.accepted, status: r.status };
    }

    case 'report': {
      // B137 — dsh tool-subagent-report: child-scoped delivery to the parent.
      const { deliverReport } = await import('./SubagentReport.js');
      const r = deliverReport(opts.subagentId || null, String(args.output || ''));
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'report', report: r.report };
    }

    case 'schedule_create': {
      // B140 — dsh schedule_create: recurring task/goal schedules.
      const { taskScheduler } = await import('./TaskScheduler.js');
      if (!taskScheduler || typeof taskScheduler.create !== 'function') return { ok: false, error: 'scheduler unavailable' };
      const r = taskScheduler.create({
        query: String(args.query || ''),
        everySeconds: Number(args.everySeconds) || undefined,
        dailyAt: args.dailyAt || undefined,
        label: args.label || '',
        kind: args.kind || 'task',
        autonomy: args.autonomy || 'ask',
      });
      if (r.error) return { ok: false, error: r.error };
      return { ok: true, kind: 'schedule', schedule: r.schedule };
    }

    case 'schedule_list': {
      // B140 — dsh schedule_list.
      const { taskScheduler } = await import('./TaskScheduler.js');
      if (!taskScheduler || typeof taskScheduler.list !== 'function') return { ok: false, error: 'scheduler unavailable' };
      const schedules = taskScheduler.list().map((s) => taskScheduler.publicSchedule ? taskScheduler.publicSchedule(s) : s);
      return { ok: true, kind: 'schedule', schedules };
    }

    case 'schedule_delete': {
      // B140 — dsh schedule_delete.
      const { taskScheduler } = await import('./TaskScheduler.js');
      if (!taskScheduler || typeof taskScheduler.remove !== 'function') return { ok: false, error: 'scheduler unavailable' };
      const removed = taskScheduler.remove(String(args.id || ''));
      if (!removed) return { ok: false, error: `no schedule "${args.id}"` };
      return { ok: true, kind: 'schedule', id: String(args.id) };
    }

    case 'pwsh': {
      // B141 — dsh tool-pwsh: PowerShell-dialect execution (fail-open when
      // pwsh is not installed). Same marker/truncation story as bash.
      const { spawn } = await import('child_process');
      const fs = await import('fs');
      const { shellEnv } = await import('./ShellEnv.js');
      const command = String(args.command || '').trim();
      if (!command) return { ok: false, error: 'command required' };
      const hasPwsh = String(process.env.PATH || '').split(':').some((d) => d && (fs.existsSync(`${d}/pwsh`) || fs.existsSync(`${d}/pwsh.exe`)));
      if (!hasPwsh) return { ok: false, error: 'pwsh is not installed on this host — use the bash tool instead (dsh tool-pwsh fail-open).' };
      const timeout = Math.min(Math.max(Number(args.timeoutMs) || 30000, 1000), 120000);
      const started = Date.now();
      const output = await new Promise((resolve) => {
        let child;
        try {
          child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
            cwd: opts.spillOwner ? undefined : undefined,
            env: shellEnv({ convId: opts.spillOwner || 'pwsh' }),
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (e) { resolve({ ok: false, output: '', code: null, error: `spawn failed: ${(e && e.message) || e}` }); return; }
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (d) => { stdout = (stdout + d.toString('utf8')).slice(-12000); });
        child.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-4000); });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, timeout);
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ ok: code === 0, output: (stdout || stderr).slice(-12000), code, error: code === 0 ? null : (stderr || `pwsh exited ${code}`).slice(0, 2000) });
        });
        child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: '', code: null, error: (e && e.message) || 'spawn error' }); });
      });
      return {
        ok: output.ok,
        kind: 'pwsh-result',
        command: command.slice(0, 300),
        output: String(output.output || ''),
        code: output.code ?? null,
        durationMs: Date.now() - started,
        ...(output.error ? { error: output.error } : {}),
      };
    }

    case 'cordis_inspect_list': {
      // B142 — dsh tool-cordis: list every inspect provider.
      const { cordisInspectList } = await import('./CordisInspect.js');
      return { ok: true, kind: 'cordis', ...cordisInspectList() };
    }

    case 'cordis_inspect_query': {
      // B142 — dsh tool-cordis: one read-only inspect query.
      const { cordisInspectQuery } = await import('./CordisInspect.js');
      const r = cordisInspectQuery({ provider: String(args.provider || ''), method: String(args.method || ''), input: (args.input && typeof args.input === 'object') ? args.input : {} });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'cordis', provider: r.provider, method: r.method, result: r.result };
    }

    case 'cordis_define': {
      // B143 — dsh tool-cordis cordis_define: define a dynamic plugin package.
      const { cordisRunner } = await import('./CordisRunner.js');
      const r = cordisRunner().define({ name: String(args.name || ''), purpose: String(args.purpose || ''), code: (args.code && typeof args.code === 'object') ? args.code : {} });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'cordis', pluginId: r.pluginId, packageId: r.packageId, name: r.name, purpose: r.purpose, hasHostHalf: r.hasHostHalf };
    }

    case 'cordis_run': {
      // B143 — dsh tool-cordis cordis_run: evaluate host code against the live seam.
      const { cordisRunner } = await import('./CordisRunner.js');
      const r = await cordisRunner().run({ pluginId: String(args.pluginId || ''), packageId: String(args.packageId || ''), input: (args.input && typeof args.input === 'object') ? args.input : {} });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'cordis', runId: r.runId, pluginId: r.pluginId, packageId: r.packageId };
    }

    case 'cordis_stop': {
      const { cordisRunner } = await import('./CordisRunner.js');
      const r = await cordisRunner().stop({ pluginId: String(args.pluginId || '') });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'cordis', pluginId: r.pluginId, wasRunning: r.wasRunning };
    }

    case 'cordis_undefine': {
      const { cordisRunner } = await import('./CordisRunner.js');
      const r = await cordisRunner().undefine({ pluginId: String(args.pluginId || '') });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, kind: 'cordis', pluginId: r.pluginId, wasRunning: r.wasRunning };
    }

    case 'cordis_inspect_self': {
      const { cordisRunner } = await import('./CordisRunner.js');
      const r = cordisRunner().inspectSelf();
      return { ok: true, kind: 'cordis', ...r };
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

    case 'ralph': {
      // B135 — dsh tool-ralph: fresh structured-output child per round with
      // a bounded structured handoff; terminal statuses complete | blocked |
      // budget-limited | round-failed.
      const { runRalph } = await import('./RalphRunner.js');
      const conv = opts.spillOwner || 'default';
      const r = await runRalph({
        objective: String(args.objective || ''),
        maxRounds: Number(args.maxRounds) || undefined,
        maxHandoffChars: Number(args.maxHandoffChars) || undefined,
        signal: opts.signal,
        sendEvent: (t, d) => opts.sendEvent(t, { ...(d || {}), subagent: 'ralph', conv }),
      });
      if (!r.ok) {
        return { ok: false, kind: 'ralph', status: r.status, roundsStarted: r.roundsStarted, ...(r.report ? { report: r.report } : {}), ...(r.lastReport ? { lastReport: r.lastReport } : {}), error: r.error || `ralph ${r.status}` };
      }
      return { ok: true, kind: 'ralph', status: 'complete', roundsStarted: r.roundsStarted, report: r.report };
    }

    default: {
      // B97 — PLUGIN SEAM: tools mounted by plugins (deepseek-harness style)
      // execute here, through the SAME permission/risk/approval pipeline.
      const pluginTool = getPluginTool(slug);
      if (pluginTool) {
        try {
          const r = await pluginTool.handler(args || {}, { convId: opts.spillOwner || null });
          // B136 — a successful fs touch on a nested AGENTS.md marks it seen
          // (dsh agent-instructions inbox reconciliation).
          if (r && r.ok && (args.file_path || args.path)) {
            try {
              const { touchProjectInstructions } = await import('./AgentInstructions.js');
              touchProjectInstructions(args.file_path || args.path);
            } catch { /* noop */ }
          }
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
/** B127 — NEVER let a file:// path or the absolute workspace path reach the
 *  model (it invents untappable links from them). Rewrites:
 *    file://<abs-workspace>/x.html → <public>/preview/x.html
 *    <abs-workspace>/x.html        → <public>/preview/x.html
 *  Anything else file:// → stripped with a note.
 */
export function sanitizeModelOutput(text, extraWorkspace = null) {
  let out = String(text || '');
  const ws = extraWorkspace || CFG_WORKSPACE_DIR || WORKSPACE;
  const base = (CFG_PUBLIC_URL || CFG_MANAGER_URL || '').replace(/\/+$/, '');
  // 1) file://<workspace>/<file> → public preview URL
  if (ws) {
    const escWs = String(ws).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`file://${escWs}/([^\s)'"\\)]+)`, 'g'), (m, f) => `${base}/preview/${encodeURIComponent(f)}`);
    out = out.replace(new RegExp(`${escWs}/([^\s)'"\\)]+\\.html)`, 'g'), (m, f) => `${base}/preview/${encodeURIComponent(f)}`);
    out = out.split(String(ws)).join('<workspace>');
  }
  // 2) any other file:// path → note
  if (/file:\/\//i.test(out)) {
    out = out.replace(/file:\/\/[^\s)'"\\)]+/gi, (m) => `${base || ''}/preview/${encodeURIComponent(m.replace(/^file:\/\//i, '').split('/').pop() || 'index.html')}`);
  }
  return out;
}

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

async function executeToolInner({ slug, args = {}, profile, intent, sendEvent, confirm, codeTools, signal, spillOwner, subagentId }) {
  const started = Date.now();
  const emit = (type, payload) => { try { if (typeof sendEvent === 'function') sendEvent(type, payload); } catch (e) {} };
  // B97 — PLUGIN SEAM: plugin-mounted tools are first-class. If the static
  // registry misses, synthesize the tool record from the plugin context so
  // the same gates (allowlist, permission, risk, approval, events) apply.
  let tool = getTool(slug);
  if (!tool) {
    const pt = getPluginTool(slug);
    if (pt) tool = { slug, name: pt.name || slug, desc: pt.desc || 'plugin tool', agents: [], permission: pt.permission || 'medium', timeoutMs: typeof pt.timeoutMs === 'number' && pt.timeoutMs > 0 ? pt.timeoutMs : undefined };
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

  // B111 — PLAN MODE ENFORCEMENT: while plan mode is active for this
  // conversation (spillOwner = convId), execution tools are refused — no
  // builds, no preview servers, no browsing — until the user approves.
  if (spillOwner) {
    try {
      if (planModeBlocked(slug, args, spillOwner)) {
        const msg = slug === 'ask_user_question'
          ? 'Plan mode: do not ask the user — plan and execute automatically.'
          : 'Plan mode is active — execution tools are disabled while planning; execution follows automatically after exit_plan_mode.';
        const blocked = {
          ok: false, blocked: true, planMode: true, tool: slug,
          error: msg,
          durationMs: Date.now() - started,
        };
        emit('tool.refused', { tool: slug, reason: 'plan-mode', message: blocked.error });
        emit('tool.result', { tool: slug, ok: false, blocked: true, planMode: true, durationMs: 0 });
        return blocked;
      }
    } catch { /* gate is best-effort */ }
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
  // B137 — dsh user-approval: the session's approval policy decides whether
  // external-tier actions pause. 'never' (via a permission preset) proceeds;
  // the default 'ask' keeps the ONE-approval pause below.
  const approvalPolicy = (() => { try { return needsApproval(spillOwner) ? 'ask' : 'never'; } catch { return 'ask'; } })();
  if (tier === 'external' && approvalPolicy === 'ask') {
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
    // B101 — per-tool timeoutMs (dsh timeout-policy mirror): the tool's
    // declared budget wins; otherwise a tier default. The deadline aborts a
    // per-call controller so COOPERATIVE engines (run_code, subagent, …) see
    // the signal and reach quiescence; the race is the structured backstop.
    const timeoutMs = tool.timeoutMs && tool.timeoutMs > 0 ? tool.timeoutMs : defaultTimeoutFor(tool);
    const controller = new AbortController();
    let rejectRace = null;
    const raceTimeout = new Promise((_, reject) => { rejectRace = reject; });
    const timer = setTimeout(() => {
      controller.abort();
      if (rejectRace) rejectRace(Object.assign(new Error(`tool call timed out after ${timeoutMs}ms`), { code: 'TOOL_TIMEOUT', timeoutMs }));
    }, timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    // B135 — Codex/Claude Code hook bridges: PreToolUse (blocking decisions
    // honored, fail-open) then execution, then PostToolUse (record-only).
    try {
      const pre = await fireToolHooks('PreToolUse', { tool: slug, args, convId: spillOwner });
      if (pre.blocked) {
        clearTimeout(timer);
        const hookBlocked = { ok: false, blocked: true, byHookBridge: true, tool: slug, error: pre.reason || `Blocked by a hook bridge (PreToolUse ${slug}).`, durationMs: Date.now() - started };
        emit('tool.result', { tool: slug, ok: false, blocked: true, byHookBridge: true, error: hookBlocked.error, durationMs: hookBlocked.durationMs });
        return hookBlocked;
      }
    } catch { /* a hook bridge must never block the harness */ }

    let result;
    try {
      result = await Promise.race([
        runEngine(slug, args, {
          codeTools,
          profile,
          sendEvent: emit,
          signal: controller.signal,
          intent,
          spillOwner, // B135 — owners (persistent bash, ralph, questions) are per-conversation
          subagentId, // B137 — child-scoped report delivery
        }),
        raceTimeout,
      ]);
    } catch (e) {
      clearTimeout(timer);
      if (e && e.code === 'TOOL_TIMEOUT') {
        const tmo = { ok: false, tool: slug, code: 'TOOL_TIMEOUT', error: e.message, durationMs: Date.now() - started };
        emit('tool.result', { tool: slug, ok: false, code: 'TOOL_TIMEOUT', error: e.message, durationMs: tmo.durationMs });
        return tmo;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    // B135 — PostToolUse hook bridges (record-only, fail-open).
    try {
      await fireToolHooks('PostToolUse', { tool: slug, args, convId: spillOwner });
    } catch { /* a hook bridge must never block the harness */ }
    // P4 — fail closed on malformed tool OUTPUT (never a silent empty reply).
    const outCheck = validateToolOutput(slug, result);
    if (!outCheck.ok) {
      const invalid = { ok: false, tool: slug, code: outCheck.error.code, error: outCheck.error.message, raw: outCheck.error.raw, durationMs: Date.now() - started };
      emit('tool.result', { tool: slug, ok: false, error: invalid.error, durationMs: invalid.durationMs });
      return invalid;
    }
    // P8 — engines that honestly report failure (e.g. mcp-call) stay failures.
    if (result && typeof result === 'object' && result.ok === false) {
      const msg = result.error?.message || String(result.error || (result.kind ? `${result.kind} reported failure (code ${result.code ?? 'n/a'})` : 'tool reported failure'));
      // B135 — carry the structured engine result through so the model sees
      // real output/exit codes on failure (dsh presentResult parity).
      const failed = { ok: false, tool: slug, code: result.code ?? result.error?.code, error: msg, ...(result.kind ? { result } : {}), durationMs: Date.now() - started };
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
    // B127 — strip file:// and absolute workspace paths from model output
    // BEFORE anything else (the model must only ever see tappable URLs).
    try {
      if (typeof result === 'string' && (result.includes('file://') || String(result).includes(CFG_WORKSPACE_DIR))) {
        result = sanitizeModelOutput(result);
      }
    } catch { /* noop */ }
    // B100 — SPILL POLICY (dsh spill-policy mirror): oversized results are
    // saved to the spill store; the model receives a bounded preview + a
    // spill:// locator it can pull with spill-read when it actually needs it.
    // The threshold is measured on the UNCAPTED serialization (formatResult
    // already caps at 8k, which would mask everything above the threshold).
    let finalText;
    // spill-read results are already the spilled form (capped) — never re-spill.
    const alreadySpilled = slug === 'spill-read';
    const rawLen = alreadySpilled || result === null || result === undefined ? 0 : (typeof result === 'string' ? result.length : (() => { try { return JSON.stringify(result).length; } catch { return 0; } })());
    if (rawLen > SPILL_THRESHOLD) {
      const raw = typeof result === 'string' ? result : (() => { try { return JSON.stringify(result); } catch { return null; } })();
      if (raw !== null) {
        try {
          const { saveText, SPILL_PREVIEW_CHARS } = await import('./SpillStore.js');
          const sp = saveText({ owner: spillOwner, source: slug, suggestedName: slug, content: raw });
          if (sp.ok) {
            const preview = raw.slice(0, SPILL_PREVIEW_CHARS);
            finalText = `[📦 Result spilled — ${sp.bytes.toLocaleString()} bytes → ${sp.locator}. Use spill-read({ locator: "${sp.locator}" }) to read the full body.]\nPreview:\n${preview}${raw.length > SPILL_PREVIEW_CHARS ? '…' : ''}`;
          }
        } catch (e) { /* spilling is best-effort — keep the full result */ }
      }
    }
    if (finalText === undefined) finalText = formatResult(result);
    const ok = { ok: true, tool: slug, permission: perm, tier, result: finalText, durationMs: Date.now() - started };
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

// B101 — per-tool timeouts replaced the flat withTimeout helper (see executeToolInner).

function safeArgs(slug, args) {
  // Never log key-like values
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (/key|token|secret|password/i.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}
