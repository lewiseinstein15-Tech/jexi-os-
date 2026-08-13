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

import { TOOL_REGISTRY, getTool } from './ToolRegistry.js';
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
  loadMemory, rememberEpisode, saveMemory,
} from './MemoryManager.js';
import { collectSystemStatus } from './SelfMonitor.js';
import { loadSettings, saveSettings } from './SettingsManager.js';
import { runHooks } from './HookEngine.js';

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
};

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

async function runEngine(slug, args) {
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
    default:
      return null; // no engine — caller decides fallback
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
export async function executeTool({ slug, args = {}, profile, sendEvent }) {
  const started = Date.now();
  const emit = (type, payload) => { try { if (typeof sendEvent === 'function') sendEvent(type, payload); } catch (e) {} };
  const tool = getTool(slug);
  if (!tool) return { ok: false, error: `Unknown tool: ${slug}`, durationMs: 0 };
  const perm = toolPermission(slug);
  const useProfile = profile || activeToolProfile();

  emit('tool.start', { tool: slug, name: tool.name, permission: perm, profile: useProfile, args: safeArgs(slug, args) });

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

  try {
    const result = await withTimeout(runEngine(slug, args), 60000);
    if (result === null) {
      // Registry tool without a runtime engine — route to its owning agents.
      const routed = { ok: true, routed: true, tool: slug, result: `This tool is planned and routed to: ${(tool.agents || []).slice(0, 3).join(', ')}. It runs during the pipeline execution for this task.` };
      emit('tool.result', { tool: slug, ok: true, routed: true, durationMs: Date.now() - started });
      return { ...routed, permission: perm, durationMs: Date.now() - started };
    }
    runHooks('afterTool', { tool: slug, query: args.query || args.url || args.command || '', ok: true }, (t, d) => emit(t, d));
    const ok = { ok: true, tool: slug, permission: perm, result: formatResult(result), durationMs: Date.now() - started };
    emit('tool.result', { tool: slug, ok: true, durationMs: ok.durationMs, preview: String(ok.result).slice(0, 300) });
    return ok;
  } catch (e) {
    const failed = { ok: false, tool: slug, error: (e && e.message) || String(e), durationMs: Date.now() - started };
    emit('tool.result', { tool: slug, ok: false, error: failed.error, durationMs: failed.durationMs });
    return failed;
  }
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
