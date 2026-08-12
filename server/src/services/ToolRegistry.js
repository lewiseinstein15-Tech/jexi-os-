/**
 * JEXI OS — Tool Registry.
 *
 * Every framework that runs production agents treats TOOLS as first-class
 * citizens: smolagents' "tools vs skills" split (tools = atomic actions,
 * skills = composed workflows), the OpenAI Agents SDK (agents = instructions
 * + tools), AutoTool / vLLM auto-tool-choice (auto-select the right tool set
 * per task), and LangChain DeepAgents' context management. JEXI always had
 * the ENGINES (search, browser, memory, runner, GitHub CLI, books, …) but
 * never an explicit, routable catalog of them.
 *
 * This module fixes that:
 *   - TOOL_REGISTRY — every executable tool with a slug, a plain-language
 *     description, the agents allowed to use it, and the engine that runs it.
 *   - toolsForTeam() / toolsForIntent() — AUTO tool selection: for every task
 *     the planner derives the tool set from the composed agent team, with
 *     zero manual instruction ("just call the tools the task needs").
 *     AutoTool-style pruning: we offer the small, relevant subset — never the
 *     whole catalog — which keeps prompts small and decisions reliable.
 */

import { composeTeam } from './AgentRoster.js';

/** slug → the JEXI engine (service module) that actually executes this tool. */
export const TOOL_REGISTRY = [
  // ── Search & research ─────────────────────────────────────────
  { slug: 'web-search', name: 'Web Search', type: 'Search', desc: 'Search multiple engines (SearXNG, DDG, Bing, Mojeek, Wikipedia, arXiv) and rank trusted sources.', agents: ['searcher', 'query-analyzer', 'researcher', 'news-scout', 'fact-checker'], engine: 'SearchEngine' },
  { slug: 'deep-read', name: 'Deep Read', type: 'Research', desc: 'Open a URL server-side and extract its real content (strip ads, keep the text).', agents: ['extractor', 'scholar', 'researcher'], engine: 'Extractor' },
  { slug: 'news-feed', name: 'News Feed', type: 'Research', desc: 'Fetch live headlines from free RSS feeds (Google News, BBC) and dedupe them.', agents: ['news-scout', 'news-filter'], engine: 'NewsAgent' },
  { slug: 'api-call', name: 'API Call', type: 'Data', desc: 'Call and parse an external JSON/REST API.', agents: ['scraper', 'data-engineer'], engine: 'fetch' },

  // ── Browser & perception ──────────────────────────────────────
  { slug: 'link-open', name: 'Open Link', type: 'Browser', desc: 'Open a shared link in the real browser and summarize what it contains.', agents: ['navigator', 'computer-use'], engine: 'DesktopManager' },
  { slug: 'browser-drive', name: 'Browser Control', type: 'Browser', desc: 'Click, type, scroll, and interact with live numbered elements on a page.', agents: ['computer-use', 'navigator'], engine: 'DesktopManager' },
  { slug: 'vision-analyze', name: 'Vision', type: 'Perception', desc: 'Analyze images: describe, OCR text, and solve what is shown.', agents: ['vision'], engine: 'Gemini/Groq vision' },

  // ── Memory & conversation ─────────────────────────────────────
  { slug: 'memory-recall', name: 'Memory Recall', type: 'Memory', desc: 'Retrieve facts, preferences, learned answers and prior research from the memory core.', agents: ['memory', 'jexi', 'context-manager', 'archivist'], engine: 'MemoryManager' },
  { slug: 'memory-write', name: 'Memory Write', type: 'Memory', desc: 'Store durable facts, preferences and learned answers.', agents: ['memory', 'archivist'], engine: 'MemoryManager' },
  { slug: 'rolling-summary', name: 'Rolling Summary', type: 'Memory', desc: 'Keep a compact running summary of the whole conversation so nothing is forgotten.', agents: ['context-manager', 'jexi', 'archivist'], engine: 'MemoryManager' },
  { slug: 'episode-recall', name: 'Episode Recall', type: 'Memory', desc: 'Remember what happened in past sessions, not just the last few turns.', agents: ['archivist', 'context-manager', 'memory'], engine: 'MemoryManager' },
  { slug: 'knowledge-search', name: 'Knowledge Search', type: 'Knowledge', desc: 'Search the saved knowledge library and studied topics.', agents: ['books', 'scholar', 'researcher', 'document-analyst'], engine: 'MemoryManager' },
  { slug: 'knowledge-save', name: 'Knowledge Save', type: 'Knowledge', desc: 'Save studied topics and notes into the knowledge library.', agents: ['researcher', 'study', 'scholar', 'document-analyst'], engine: 'MemoryManager' },
  { slug: 'book-library', name: 'Book Library', type: 'Knowledge', desc: 'Answer strictly from the user\'s own uploaded books with citations and quotes.', agents: ['books', 'scholar'], engine: 'BookLibrary' },
  { slug: 'document-rag', name: 'Document RAG', type: 'Knowledge', desc: 'Chunk uploaded documents and answer from the retrieved passages.', agents: ['document-analyst', 'books'], engine: 'MemoryManager/knowledge' },

  // ── Execution & code ──────────────────────────────────────────
  { slug: 'code-run', name: 'Run Code', type: 'Execution', desc: 'Execute generated code and capture real stdout and errors.', agents: ['runner', 'debugger', 'coder', 'qa'], engine: 'Runner' },
  { slug: 'code-write', name: 'Write Files', type: 'Execution', desc: 'Generate and write project files into the workspace.', agents: ['architect', 'coder', 'writer', 'shipper', 'backend', 'frontend'], engine: 'Architect' },
  { slug: 'code-fix', name: 'Fix & Re-run', type: 'Execution', desc: 'Apply a fix to failing code and re-run until it is clean.', agents: ['debugger', 'coder'], engine: 'Architect.applyFix' },
  { slug: 'code-review', name: 'Code Review', type: 'Quality', desc: 'Review the code with APPROVED / CHANGES-REQUESTED verdict.', agents: ['reviewer', 'critic', 'security'], engine: 'SkillChain' },
  { slug: 'security-scan', name: 'Security Scan', type: 'Quality', desc: 'OWASP-class vulnerability review with CLEARED / BLOCKED verdict.', agents: ['security', 'guardrail'], engine: 'SkillChain' },
  { slug: 'fact-check', name: 'Fact Check', type: 'Quality', desc: 'Audit an answer against its sources and revise invented or unsupported claims.', agents: ['fact-checker', 'critic'], engine: 'VerificationLoop' },
  { slug: 'self-consistency', name: 'Self-Consistency', type: 'Quality', desc: 'Cross-check the answer against itself and the task before it ships.', agents: ['critic', 'reasoner'], engine: 'VerificationLoop' },

  // ── Dev tools & data ──────────────────────────────────────────
  { slug: 'github-cli', name: 'GitHub CLI', type: 'DevTools', desc: 'Run the real gh/git CLI: commit, push, PRs and issues.', agents: ['github'], engine: 'GitHubAgent' },
  { slug: 'data-crunch', name: 'Data Crunch', type: 'Data', desc: 'Compute real statistics, aggregates and numbers from data.', agents: ['data', 'data-engineer', 'sql', 'math'], engine: 'DataAgent' },
  { slug: 'chart-builder', name: 'Chart Builder', type: 'Data', desc: 'Turn numbers into clear charts and dashboards.', agents: ['data-viz', 'data', 'data-engineer'], engine: 'DataAgent' },
  { slug: 'self-diagnose', name: 'Self Diagnose', type: 'System', desc: 'Read own health, memory, errors and source code to report root causes.', agents: ['self-diagnose'], engine: 'SelfMonitor' },
  { slug: 'settings', name: 'Settings', type: 'System', desc: 'Read and update JEXI\'s settings and provider keys.', agents: ['jexi', 'context-manager'], engine: 'SettingsManager' },
  { slug: 'translate', name: 'Translate', type: 'Language', desc: 'Translate text with a draft → critique → revise reflection loop.', agents: ['translator', 'translator-v2'], engine: 'LLMClient' },
];

export const TOOL_COUNT = TOOL_REGISTRY.length;

const toolBySlug = new Map(TOOL_REGISTRY.map((t) => [t.slug, t]));

/** Look up one tool. */
export function getTool(slug) {
  return toolBySlug.get(slug) || null;
}

/** All tools a composed team of agents may use (union, stable order). */
export function toolsForTeam(team) {
  const slugs = new Set((team || []).map((a) => a.slug || a));
  const seen = new Set();
  const out = [];
  for (const tool of TOOL_REGISTRY) {
    if (tool.agents.some((a) => slugs.has(a)) && !seen.has(tool.slug)) {
      seen.add(tool.slug);
      out.push(tool);
    }
  }
  return out;
}

/** Auto tool selection for an intent: derive the tool set from the composed team. */
export function toolsForIntent(intent, extra = {}) {
  // Reuse the roster's team composition — one source of truth for "who runs".
  const team = composeTeam(intent, extra);
  return toolsForTeam(team);
}

/** Pretty one-line summary: "6 tools". */
export function toolSummary(intent, extra = {}) {
  return `${toolsForIntent(intent, extra).length} tools`;
}

/** Tool names for the live pipeline stream. */
export function toolNames(intent, extra = {}) {
  return toolsForIntent(intent, extra).map((t) => t.name);
}
