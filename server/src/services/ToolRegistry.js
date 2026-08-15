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

/**
 * B52 P4 — CODE-LEVEL TOOL ALLOWLIST for lightweight intents.
 * direct_answer / conversation (and friends) are MEMORY-ONLY: no web search,
 * no browser, no Trusted Library study, no bulk research tools — enforced in
 * code by enforceToolAllowlist() and by executeTool() (ToolRuntime), not just
 * by prompt rules. Intents NOT listed here are unrestricted (their composed
 * team already routes the right tools).
 */
export const TOOL_INTENT_ALLOWLIST = {
  direct_answer: ['memory-recall', 'rolling-summary', 'episode-recall', 'knowledge-load', 'preference-learn', 'profile-read', 'mcp-call', 'settings', 'knowledge-save', 'semantic-search'],
  conversation: ['memory-recall', 'memory-write', 'rolling-summary', 'episode-recall', 'episode-save', 'knowledge-load', 'preference-learn', 'profile-read', 'mcp-call', 'settings'],
  self_check: ['self-diagnose', 'settings'],
};

/**
 * Enforce the allowlist: refuse tools outside the intent's set. Unlisted
 * intents are unrestricted (returns { allowed: true }).
 * @returns {{allowed: boolean, reason?: string}}
 */
export function enforceToolAllowlist(intent, slug) {
  const allowed = TOOL_INTENT_ALLOWLIST[intent];
  if (!allowed) return { allowed: true };
  if (allowed.includes(slug)) return { allowed: true };
  return { allowed: false, reason: `Tool "${slug}" is outside the ${intent} allowlist — lightweight intents use memory/knowledge tools only (B52 P4).` };
}

/** slug → the JEXI engine (service module) that actually executes this tool. */
export const TOOL_REGISTRY = [
  // ── Search & research ─────────────────────────────────────────
  { slug: 'web-search', name: 'Web Search', type: 'Search', desc: 'Search multiple engines (SearXNG, DDG, Bing, Mojeek, Wikipedia, arXiv) and rank trusted sources.', agents: ['searcher', 'query-analyzer', 'researcher', 'news-scout', 'fact-checker'], engine: 'SearchEngine' },
  { slug: 'deep-read', name: 'Deep Read', type: 'Research', desc: 'Open a URL server-side and extract its real content (strip ads, keep the text).', agents: ['extractor', 'scholar', 'researcher'], engine: 'Extractor' },
  { slug: 'news-feed', name: 'News Feed', type: 'Research', desc: 'Fetch live headlines from free RSS feeds (Google News, BBC) and dedupe them.', agents: ['news-scout', 'news-filter'], engine: 'NewsAgent' },
  { slug: 'api-call', name: 'API Call', type: 'Data', desc: 'Call and parse an external JSON/REST API.', agents: ['scraper', 'data-engineer'], engine: 'fetch' },
  { slug: 'trusted-library', name: 'Trusted Library', type: 'Research', desc: 'Read free, trusted books, papers and overviews (Wikipedia, Gutenberg, arXiv, Open Library).', agents: ['scholar', 'researcher', 'news-scout'], engine: 'TrustedLibrary' },
  { slug: 'wikipedia-lookup', name: 'Wikipedia Lookup', type: 'Research', desc: 'Pull the trusted overview for any topic.', agents: ['scholar', 'searcher', 'researcher'], engine: 'SearchEngine' },
  { slug: 'arxiv-search', name: 'arXiv Search', type: 'Research', desc: 'Search academic papers on arXiv.', agents: ['scholar', 'researcher'], engine: 'SearchEngine' },
  { slug: 'pdf-extract', name: 'PDF Extract', type: 'Research', desc: 'Parse a PDF and extract its text for reading or indexing.', agents: ['document-analyst', 'extractor', 'scholar'], engine: 'Extractor' },
  { slug: 'trend-scan', name: 'Trend Scan', type: 'Research', desc: 'Detect rising topics and trending themes from feeds and searches.', agents: ['news-filter', 'market-analyst', 'researcher'], engine: 'NewsAgent' },
  { slug: 'market-research', name: 'Market Research', type: 'Research', desc: 'Size a market, estimate demand and map the landscape.', agents: ['market-analyst', 'researcher'], engine: 'SearchEngine' },
  { slug: 'competitor-scan', name: 'Competitor Scan', type: 'Research', desc: 'Analyze competitors: positioning, pricing, strengths, gaps.', agents: ['market-analyst', 'seo-specialist'], engine: 'SearchEngine' },

  // ── Browser & perception ──────────────────────────────────────
  { slug: 'link-open', name: 'Open Link', type: 'Browser', desc: 'Open a shared link in the real browser and summarize what it contains.', agents: ['navigator', 'computer-use'], engine: 'DesktopManager' },
  { slug: 'browser-drive', name: 'Browser Control', type: 'Browser', desc: 'Click, type, scroll, and interact with live numbered elements on a page.', agents: ['computer-use', 'navigator'], engine: 'DesktopManager' },
  { slug: 'vision-analyze', name: 'Vision', type: 'Perception', desc: 'Analyze images: describe, OCR text, and solve what is shown.', agents: ['vision'], engine: 'Gemini/Groq vision' },
  { slug: 'screenshot', name: 'Screenshot', type: 'Browser', desc: 'Capture the current page or screen as an image.', agents: ['vision', 'computer-use'], engine: 'DesktopManager' },
  { slug: 'page-text', name: 'Page Text', type: 'Browser', desc: 'Read all visible text on the current page.', agents: ['computer-use', 'navigator'], engine: 'DesktopManager' },
  { slug: 'form-fill', name: 'Form Fill', type: 'Browser', desc: 'Fill inputs, pick options and submit forms on a page.', agents: ['computer-use'], engine: 'DesktopManager' },
  { slug: 'tab-manage', name: 'Tab Manage', type: 'Browser', desc: 'Open, switch and close browser tabs.', agents: ['computer-use', 'navigator'], engine: 'DesktopManager' },
  { slug: 'ocr-read', name: 'OCR Read', type: 'Perception', desc: 'Extract text from an image or screenshot.', agents: ['vision'], engine: 'Gemini vision' },
  { slug: 'image-generate', name: 'Image Generate', type: 'Creative', desc: 'Generate or edit images from a description.', agents: ['illustrator', 'ad-copywriter'], engine: 'LLMClient' },
  { slug: 'audio-transcribe', name: 'Audio Transcribe', type: 'Perception', desc: 'Transcribe spoken audio to text.', agents: ['podcaster', 'reporter', 'document-analyst'], engine: 'LLMClient' },

  // ── Memory & conversation ─────────────────────────────────────
  { slug: 'memory-recall', name: 'Memory Recall', type: 'Memory', desc: 'Retrieve facts, preferences, learned answers and prior research from the memory core.', agents: ['memory', 'jexi', 'context-manager', 'archivist'], engine: 'MemoryManager' },
  { slug: 'memory-write', name: 'Memory Write', type: 'Memory', desc: 'Store durable facts, preferences and learned answers.', agents: ['memory', 'archivist'], engine: 'MemoryManager' },
  { slug: 'rolling-summary', name: 'Rolling Summary', type: 'Memory', desc: 'Keep a compact running summary of the whole conversation so nothing is forgotten.', agents: ['context-manager', 'jexi', 'archivist'], engine: 'MemoryManager' },
  { slug: 'episode-recall', name: 'Episode Recall', type: 'Memory', desc: 'Remember what happened in past sessions, not just the last few turns.', agents: ['archivist', 'context-manager', 'memory'], engine: 'MemoryManager' },
  { slug: 'knowledge-search', name: 'Knowledge Search', type: 'Knowledge', desc: 'Search the saved knowledge library and studied topics.', agents: ['books', 'scholar', 'researcher', 'document-analyst'], engine: 'MemoryManager' },
  { slug: 'knowledge-save', name: 'Knowledge Save', type: 'Knowledge', desc: 'Save studied topics and notes into the knowledge library.', agents: ['researcher', 'study', 'scholar', 'document-analyst'], engine: 'MemoryManager' },
  { slug: 'knowledge-load', name: 'Knowledge Load', type: 'Knowledge', desc: 'Load a progressive project-knowledge folder (e.g. conventions, architecture) on demand — the always-on JEXI.md only carries pointers.', agents: ['jexi', 'context-manager', 'archivist', 'coder', 'engineer', 'researcher'], engine: 'KnowledgeBase' },
  { slug: 'book-library', name: 'Book Library', type: 'Knowledge', desc: "Answer strictly from the user's own uploaded books with citations and quotes.", agents: ['books', 'scholar'], engine: 'BookLibrary' },
  { slug: 'document-rag', name: 'Document RAG', type: 'Knowledge', desc: 'Chunk uploaded documents and answer from the retrieved passages.', agents: ['document-analyst', 'books'], engine: 'MemoryManager/knowledge' },
  { slug: 'memory-clear', name: 'Memory Clear', type: 'Memory', desc: 'Wipe all or selected parts of the memory core.', agents: ['memory'], engine: 'MemoryManager' },
  { slug: 'preference-learn', name: 'Preference Learn', type: 'Memory', desc: 'Extract and store "do it this way" preferences from an exchange.', agents: ['memory', 'context-manager'], engine: 'PreferenceLearner' },
  { slug: 'profile-read', name: 'Profile Read', type: 'Memory', desc: 'Read the stored user profile: name, facts, preferences.', agents: ['memory', 'jexi'], engine: 'MemoryManager' },
  { slug: 'study-notes', name: 'Study Notes', type: 'Memory', desc: 'Create structured study notes saved to the knowledge library.', agents: ['study', 'researcher', 'teacher'], engine: 'MemoryManager' },
  // P7 — MCP as an INTERNAL tool: lets graph nodes call external MCP tools
  // (ask_jexi, memory_lookup, knowledge_search, list_books, get_health)
  // through the same validated tool path as internal tools.
  { slug: 'mcp-call', name: 'MCP Call', type: 'MCP', desc: 'Call an external MCP tool (ask_jexi, memory_lookup, knowledge_search, list_books, get_health) with schema-validated args.', agents: ['jexi', 'context-manager', 'memory'], engine: 'MCPServer' },
  // B56 — CONNECTORS as an INTERNAL tool: agents reach WhatsApp / GitHub /
  // Email through the registry via this one gated tool. It is EXTERNAL-tier,
  // so a send always pauses for ONE explicit human approval with the
  // finalized details (the OpenWorker risk model). Telegram was removed in B61.
  { slug: 'connector-call', name: 'Connector Call', type: 'Connectors', desc: 'Send an outbound action or read inbound events through a registered connector (whatsapp, github, email) — send_whatsapp, create_github_issue, send_email, create_github_file.', agents: ['jexi', 'github', 'email', 'context-manager'], engine: 'Connectors' },
  { slug: 'book-fetch', name: 'Book Fetch', type: 'Knowledge', desc: 'Fetch a free public-domain book or paper from the trusted library.', agents: ['books', 'scholar'], engine: 'TrustedLibrary' },
  { slug: 'knowledge-index', name: 'Knowledge Index', type: 'Knowledge', desc: 'Index studied material so recall is instant and complete.', agents: ['researcher', 'document-analyst', 'scholar'], engine: 'MemoryManager' },
  { slug: 'semantic-search', name: 'Semantic Search', type: 'Memory', desc: 'Hybrid vector + keyword search across all memories.', agents: ['memory', 'document-analyst', 'researcher'], engine: 'MemoryManager' },
  { slug: 'vector-embed', name: 'Vector Embed', type: 'Memory', desc: 'Embed a memory so semantic recall can find it.', agents: ['memory', 'document-analyst'], engine: 'LLMClient' },
  { slug: 'episode-save', name: 'Episode Save', type: 'Memory', desc: 'Save the current session as an episode for future recall.', agents: ['archivist', 'memory'], engine: 'MemoryManager' },

  // ── Execution & code ──────────────────────────────────────────
  { slug: 'code-run', name: 'Run Code', type: 'Execution', desc: 'Execute generated code and capture real stdout and errors.', agents: ['runner', 'debugger', 'coder', 'qa'], engine: 'Runner' },
  { slug: 'code-write', name: 'Write Files', type: 'Execution', desc: 'Generate and write project files into the workspace.', agents: ['architect', 'coder', 'writer', 'shipper', 'backend', 'frontend'], engine: 'Architect' },
  { slug: 'code-fix', name: 'Fix & Re-run', type: 'Execution', desc: 'Apply a fix to failing code and re-run until it is clean.', agents: ['debugger', 'coder'], engine: 'Architect.applyFix' },
  { slug: 'code-review', name: 'Code Review', type: 'Quality', desc: 'Review the code with APPROVED / CHANGES-REQUESTED verdict.', agents: ['reviewer', 'critic', 'security'], engine: 'SkillChain' },
  { slug: 'security-scan', name: 'Security Scan', type: 'Quality', desc: 'OWASP-class vulnerability review with CLEARED / BLOCKED verdict.', agents: ['security', 'guardrail'], engine: 'SkillChain' },
  { slug: 'fact-check', name: 'Fact Check', type: 'Quality', desc: 'Audit an answer against its sources and revise invented or unsupported claims.', agents: ['fact-checker', 'critic'], engine: 'VerificationLoop' },
  { slug: 'self-consistency', name: 'Self-Consistency', type: 'Quality', desc: 'Cross-check the answer against itself and the task before it ships.', agents: ['critic', 'reasoner'], engine: 'VerificationLoop' },
  { slug: 'test-automation', name: 'Test Automation', type: 'Quality', desc: 'Generate and run automated tests (unit, integration, E2E) for the code.', agents: ['qa', 'reviewer'], engine: 'Runner' },
  { slug: 'lint-check', name: 'Lint Check', type: 'Quality', desc: 'Run linters and static checks and fix what they flag.', agents: ['coder', 'reviewer'], engine: 'Runner' },
  { slug: 'dependency-audit', name: 'Dependency Audit', type: 'Quality', desc: 'Audit dependencies for known vulnerabilities and drift.', agents: ['security', 'reviewer'], engine: 'SkillChain' },
  { slug: 'build-check', name: 'Build Check', type: 'Quality', desc: 'Build the project and verify it compiles cleanly.', agents: ['runner', 'qa', 'coder'], engine: 'Runner' },
  { slug: 'pr-review', name: 'PR Review', type: 'DevTools', desc: 'Review an open pull request with a verdict and comments.', agents: ['github', 'reviewer'], engine: 'GitHubAgent' },
  { slug: 'preview-server', name: 'Preview Server', type: 'DevTools', desc: 'Spin up a live preview of a built app.', agents: ['devops', 'github'], engine: 'Runner' },

  // ── Dev tools & data ──────────────────────────────────────────
  { slug: 'github-cli', name: 'GitHub CLI', type: 'DevTools', desc: 'Run the real gh/git CLI: commit, push, PRs and issues.', agents: ['github'], engine: 'GitHubAgent' },
  { slug: 'git-status', name: 'Git Status', type: 'DevTools', desc: 'Inspect repo status, branches and diffs.', agents: ['github'], engine: 'GitHubAgent' },
  { slug: 'branch-manage', name: 'Branch Manage', type: 'DevTools', desc: 'Create, merge and clean up branches.', agents: ['github'], engine: 'GitHubAgent' },
  { slug: 'issue-track', name: 'Issue Track', type: 'DevTools', desc: 'Create, list and manage GitHub issues.', agents: ['github'], engine: 'GitHubAgent' },
  { slug: 'deploy-config', name: 'Deploy Config', type: 'DevOps', desc: 'Generate deploy configs: render.yaml, vercel.json, nginx, systemd.', agents: ['devops', 'cloud-engineer', 'terraform-engineer'], engine: 'DevOpsAgent' },
  { slug: 'dockerfile-write', name: 'Dockerfile Write', type: 'DevOps', desc: 'Write and optimize a Dockerfile for the project.', agents: ['devops', 'kubernetes-engineer'], engine: 'DevOpsAgent' },
  { slug: 'ci-pipeline', name: 'CI Pipeline', type: 'DevOps', desc: 'Write CI/CD pipelines that build, test and ship.', agents: ['ci-engineer', 'devops'], engine: 'DevOpsAgent' },
  { slug: 'infra-plan', name: 'Infra Plan', type: 'DevOps', desc: 'Design infrastructure-as-code: Terraform, cloud resources, networking.', agents: ['terraform-engineer', 'cloud-engineer', 'sre'], engine: 'DevOpsAgent' },
  { slug: 'cloud-cost', name: 'Cloud Cost', type: 'DevOps', desc: 'Estimate and optimize cloud spend.', agents: ['cost-optimizer', 'financial-advisor'], engine: 'DataAgent' },
  { slug: 'db-query', name: 'DB Query', type: 'Data', desc: 'Write and run database queries safely.', agents: ['sql', 'database-ops', 'database-admin'], engine: 'DataAgent' },
  { slug: 'db-schema', name: 'DB Schema', type: 'Data', desc: 'Design schemas, indexes and constraints.', agents: ['database', 'database-ops', 'data-engineer'], engine: 'DataAgent' },
  { slug: 'schema-migrate', name: 'Schema Migrate', type: 'Data', desc: 'Plan and write safe migrations.', agents: ['database', 'database-ops', 'data-engineer'], engine: 'DataAgent' },
  { slug: 'redis-ops', name: 'Redis Ops', type: 'Data', desc: 'Manage Redis keys, caching and state.', agents: ['database-ops', 'memory'], engine: 'MemoryManager' },
  { slug: 'backup-plan', name: 'Backup Plan', type: 'DevOps', desc: 'Design backups and restore drills that actually work.', agents: ['backup-engineer', 'sre', 'database-ops'], engine: 'SkillChain' },
  { slug: 'incident-runbook', name: 'Incident Runbook', type: 'DevOps', desc: 'Write runbooks for known failure modes.', agents: ['sre', 'incident-commander', 'blue-team'], engine: 'SkillChain' },
  { slug: 'changelog-write', name: 'Changelog Write', type: 'Writing', desc: 'Write release notes and changelogs from git history.', agents: ['release-engineer', 'writer'], engine: 'WriterAgent' },

  // ── Data work ─────────────────────────────────────────────────
  { slug: 'data-crunch', name: 'Data Crunch', type: 'Data', desc: 'Compute real statistics, aggregates and numbers from data.', agents: ['data', 'data-engineer', 'sql', 'math'], engine: 'DataAgent' },
  { slug: 'chart-builder', name: 'Chart Builder', type: 'Data', desc: 'Turn numbers into clear charts and dashboards.', agents: ['data-viz', 'data', 'data-engineer'], engine: 'DataAgent' },
  { slug: 'data-load', name: 'Data Load', type: 'Data', desc: 'Load data from files, URLs or APIs into a workable shape.', agents: ['data-engineer', 'data'], engine: 'DataAgent' },
  { slug: 'data-clean', name: 'Data Clean', type: 'Data', desc: 'Clean messy data: missing values, dupes, types, outliers.', agents: ['data-engineer', 'data-quality'], engine: 'DataAgent' },
  { slug: 'data-transform', name: 'Data Transform', type: 'Data', desc: 'Transform data between shapes and formats.', agents: ['data-engineer'], engine: 'DataAgent' },
  { slug: 'data-merge', name: 'Data Merge', type: 'Data', desc: 'Join and merge datasets correctly.', agents: ['data-engineer', 'data'], engine: 'DataAgent' },
  { slug: 'stats-compute', name: 'Stats Compute', type: 'Data', desc: 'Compute statistics, correlations and significance.', agents: ['data', 'data-scientist', 'sql'], engine: 'DataAgent' },
  { slug: 'report-generate', name: 'Report Generate', type: 'Data', desc: 'Turn data into a structured report with charts.', agents: ['reporting-analyst', 'bi-analyst', 'data-viz'], engine: 'DataAgent' },
  { slug: 'kpi-track', name: 'KPI Track', type: 'Data', desc: 'Define and track KPIs over time.', agents: ['bi-analyst', 'reporting-analyst', 'market-analyst'], engine: 'DataAgent' },
  { slug: 'model-train', name: 'Model Train', type: 'Data', desc: 'Train, fine-tune or evaluate a machine-learning model.', agents: ['ml-engineer', 'data-scientist', 'ml-ops'], engine: 'SkillChain' },
  { slug: 'eval-run', name: 'Eval Run', type: 'Data', desc: 'Run benchmarks and quality evaluations.', agents: ['data-scientist', 'ml-engineer'], engine: 'Runner' },

  // ── Security ──────────────────────────────────────────────────
  { slug: 'self-diagnose', name: 'Self Diagnose', type: 'System', desc: 'Read own health, memory, errors and source code to report root causes.', agents: ['self-diagnose'], engine: 'SelfMonitor' },
  { slug: 'settings', name: 'Settings', type: 'System', desc: "Read and update JEXI's settings and provider keys.", agents: ['jexi', 'context-manager'], engine: 'SettingsManager' },
  { slug: 'translate', name: 'Translate', type: 'Language', desc: 'Translate text with a draft → critique → revise reflection loop.', agents: ['translator', 'translator-v2'], engine: 'LLMClient' },
  { slug: 'vuln-scan', name: 'Vulnerability Scan', type: 'Security', desc: 'Scan an app or repo for exploitable vulnerabilities.', agents: ['appsec', 'pentester'], engine: 'SkillChain' },
  { slug: 'secrets-scan', name: 'Secrets Scan', type: 'Security', desc: 'Scan for leaked keys, tokens and credentials.', agents: ['appsec', 'guardrail'], engine: 'SkillChain' },
  { slug: 'code-sast', name: 'SAST', type: 'Security', desc: 'Run static analysis for security defects.', agents: ['appsec'], engine: 'SkillChain' },
  { slug: 'threat-model', name: 'Threat Model', type: 'Security', desc: 'Model attack surfaces and rank risks.', agents: ['risk-analyst', 'pentester'], engine: 'SkillChain' },
  { slug: 'compliance-check', name: 'Compliance Check', type: 'Security', desc: 'Check against standards: GDPR, ISO, SOC 2.', agents: ['compliance-officer', 'privacy-officer', 'legal'], engine: 'SkillChain' },
  { slug: 'privacy-review', name: 'Privacy Review', type: 'Security', desc: 'Review data flows and privacy posture.', agents: ['privacy-officer', 'legal'], engine: 'SkillChain' },
  { slug: 'auth-audit', name: 'Auth Audit', type: 'Security', desc: 'Audit auth flows: sessions, tokens, permissions.', agents: ['auth-engineer', 'appsec'], engine: 'SkillChain' },
  { slug: 'crypt-check', name: 'Crypto Check', type: 'Security', desc: 'Review encryption and hashing choices.', agents: ['cryptographer', 'appsec'], engine: 'SkillChain' },

  // ── Writing & creative ────────────────────────────────────────
  { slug: 'docx-write', name: 'Word Doc Write', type: 'Writing', desc: 'Create and edit Word documents.', agents: ['writer', 'document-analyst'], engine: 'SkillChain' },
  { slug: 'pptx-write', name: 'Slides Write', type: 'Writing', desc: 'Create presentation decks.', agents: ['writer', 'product-marketer'], engine: 'SkillChain' },
  { slug: 'xlsx-write', name: 'Spreadsheet Write', type: 'Data', desc: 'Create and analyze spreadsheets.', agents: ['data', 'bi-analyst', 'finance'], engine: 'DataAgent' },
  { slug: 'script-write', name: 'Script Write', type: 'Creative', desc: 'Write screenplays and video scripts.', agents: ['screenwriter', 'video-script-writer'], engine: 'SkillChain' },
  { slug: 'lyrics-write', name: 'Lyrics Write', type: 'Creative', desc: 'Write song lyrics with structure and rhyme.', agents: ['songwriter'], engine: 'SkillChain' },
  { slug: 'poem-write', name: 'Poem Write', type: 'Creative', desc: 'Write poems in any style.', agents: ['poet'], engine: 'SkillChain' },
  { slug: 'speech-write', name: 'Speech Write', type: 'Creative', desc: 'Write speeches with rhetoric that lands.', agents: ['speech-writer', 'ghostwriter'], engine: 'SkillChain' },
  { slug: 'essay-write', name: 'Essay Write', type: 'Creative', desc: 'Write argument-driven essays.', agents: ['essayist', 'academic-writer'], engine: 'SkillChain' },
  { slug: 'grant-proposal', name: 'Grant Proposal', type: 'Business', desc: 'Write grant applications and funding proposals.', agents: ['grant-writer', 'business-analyst'], engine: 'SkillChain' },
  { slug: 'newsletter-compose', name: 'Newsletter Compose', type: 'Writing', desc: 'Compose newsletters people open.', agents: ['newsletter-writer', 'product-marketer'], engine: 'SkillChain' },
  { slug: 'seo-optimize', name: 'SEO Optimize', type: 'Marketing', desc: 'Optimize content to rank and convert.', agents: ['seo-specialist', 'seo-writer', 'blog-writer'], engine: 'SkillChain' },
  { slug: 'ad-copy-generate', name: 'Ad Copy Generate', type: 'Marketing', desc: 'Write ad variations that convert.', agents: ['ad-copywriter', 'copywriter'], engine: 'SkillChain' },
  { slug: 'blog-write', name: 'Blog Write', type: 'Writing', desc: 'Write blog posts and articles.', agents: ['blog-writer', 'writer'], engine: 'SkillChain' },
  { slug: 'white-paper-write', name: 'White Paper Write', type: 'Writing', desc: 'Write long-form authority documents.', agents: ['white-paper-writer', 'researcher'], engine: 'SkillChain' },
  { slug: 'case-study-write', name: 'Case Study Write', type: 'Writing', desc: 'Write customer stories with outcomes.', agents: ['case-study-writer', 'customer-success'], engine: 'SkillChain' },
  { slug: 'summarize-doc', name: 'Summarize Doc', type: 'Writing', desc: 'Compress long content into precise summaries.', agents: ['summarizer', 'editor', 'reporter'], engine: 'Summarizer' },
  { slug: 'proofread-text', name: 'Proofread Text', type: 'Writing', desc: 'Fix typos, grammar and consistency.', agents: ['proofreader', 'editor', 'copyeditor'], engine: 'SkillChain' },
  { slug: 'email-draft', name: 'Email Draft', type: 'Writing', desc: 'Draft effective emails for any audience.', agents: ['email', 'sales-rep', 'support-engineer'], engine: 'SkillChain' },
  { slug: 'social-schedule', name: 'Social Schedule', type: 'Marketing', desc: 'Plan and schedule social posts.', agents: ['social', 'community-manager'], engine: 'SkillChain' },
  { slug: 'caption-write', name: 'Caption Write', type: 'Marketing', desc: 'Write punchy captions and hashtags.', agents: ['social', 'ad-copywriter'], engine: 'SkillChain' },

  // ── Business & product ────────────────────────────────────────
  { slug: 'business-plan-write', name: 'Business Plan', type: 'Business', desc: 'Write a full business plan with financials.', agents: ['business-analyst', 'startup-advisor', 'financial-advisor'], engine: 'SkillChain' },
  { slug: 'pricing-model', name: 'Pricing Model', type: 'Business', desc: 'Build pricing tiers and revenue models.', agents: ['pricing-strategist', 'financial-advisor', 'market-analyst'], engine: 'DataAgent' },
  { slug: 'pitch-deck', name: 'Pitch Deck', type: 'Business', desc: 'Build investor pitch decks.', agents: ['startup-advisor', 'product-marketer'], engine: 'SkillChain' },
  { slug: 'sales-outreach', name: 'Sales Outreach', type: 'Business', desc: 'Write outreach sequences that get replies.', agents: ['sales-rep', 'email', 'crm-specialist'], engine: 'SkillChain' },
  { slug: 'crm-update', name: 'CRM Update', type: 'Business', desc: 'Structure leads and follow-up systems.', agents: ['crm-specialist', 'sales-rep'], engine: 'SkillChain' },
  { slug: 'support-ticket', name: 'Support Ticket', type: 'Business', desc: 'Draft support replies and resolutions.', agents: ['support-engineer', 'customer-success'], engine: 'SkillChain' },
  { slug: 'onboarding-plan', name: 'Onboarding Plan', type: 'Business', desc: 'Design customer and employee onboarding.', agents: ['customer-success', 'hr-specialist'], engine: 'SkillChain' },
  { slug: 'hire-pipeline', name: 'Hire Pipeline', type: 'Business', desc: 'Design a hiring pipeline with screens.', agents: ['recruiter', 'hr-specialist'], engine: 'SkillChain' },
  { slug: 'interview-guide', name: 'Interview Guide', type: 'Business', desc: 'Build role-specific interview guides.', agents: ['recruiter', 'interviewer', 'hr-specialist'], engine: 'SkillChain' },

  // ── Life & wellness ───────────────────────────────────────────
  { slug: 'meal-plan', name: 'Meal Plan', type: 'Life', desc: 'Build meal plans from preferences and goals.', agents: ['nutrition', 'chef', 'health'], engine: 'SkillChain' },
  { slug: 'workout-plan', name: 'Workout Plan', type: 'Life', desc: 'Build workout plans and progress tracking.', agents: ['fitness', 'health', 'nutrition'], engine: 'SkillChain' },
  { slug: 'sleep-plan', name: 'Sleep Plan', type: 'Life', desc: 'Design sleep routines and wind-downs.', agents: ['sleep-coach', 'health'], engine: 'SkillChain' },
  { slug: 'meditation-guide', name: 'Meditation Guide', type: 'Life', desc: 'Guide meditation and breathing sessions.', agents: ['meditation-coach'], engine: 'SkillChain' },
  { slug: 'pet-care-guide', name: 'Pet Care Guide', type: 'Life', desc: 'Care and training plans for pets.', agents: ['pet-care'], engine: 'SkillChain' },
  { slug: 'garden-plan', name: 'Garden Plan', type: 'Life', desc: 'Plan gardens and plant care.', agents: ['gardener'], engine: 'SkillChain' },
  { slug: 'home-org-plan', name: 'Home Organize', type: 'Life', desc: 'Declutter and organize spaces.', agents: ['home-org', 'interior-designer'], engine: 'SkillChain' },
  { slug: 'room-design', name: 'Room Design', type: 'Life', desc: 'Design room layouts and styling.', agents: ['interior-designer', 'fashion-stylist'], engine: 'SkillChain' },
  { slug: 'wardrobe-plan', name: 'Wardrobe Plan', type: 'Life', desc: 'Plan a wardrobe and personal style.', agents: ['fashion-stylist'], engine: 'SkillChain' },
  { slug: 'skincare-routine', name: 'Skincare Routine', type: 'Life', desc: 'Build skincare and beauty routines.', agents: ['beauty-advisor'], engine: 'SkillChain' },
  { slug: 'event-plan', name: 'Event Plan', type: 'Life', desc: 'Plan events with budgets and logistics.', agents: ['event-planner', 'wedding-planner', 'travel'], engine: 'SkillChain' },
  { slug: 'wedding-plan', name: 'Wedding Plan', type: 'Life', desc: 'Plan weddings with vendors and timelines.', agents: ['wedding-planner', 'event-planner'], engine: 'SkillChain' },
  { slug: 'dating-profile', name: 'Dating Profile', type: 'Life', desc: 'Write dating profiles that stand out.', agents: ['dating-coach'], engine: 'SkillChain' },
  { slug: 'relationship-advice', name: 'Relationship Advice', type: 'Life', desc: 'Advice for communication and conflict.', agents: ['relationship-coach', 'counselor'], engine: 'SkillChain' },
  { slug: 'counseling-session', name: 'Counseling', type: 'Life', desc: 'Empathetic guided conversation and reflection.', agents: ['counselor'], engine: 'SkillChain' },

  // ── Education ─────────────────────────────────────────────────
  { slug: 'homework-solve', name: 'Homework Help', type: 'Education', desc: 'Work through homework with explanations.', agents: ['homework-helper', 'tutor', 'math'], engine: 'SkillChain' },
  { slug: 'exam-prep-plan', name: 'Exam Prep', type: 'Education', desc: 'Build exam prep plans and drills.', agents: ['exam-coach', 'study', 'teacher'], engine: 'SkillChain' },
  { slug: 'flashcard-generate', name: 'Flashcard Generate', type: 'Education', desc: 'Generate flashcard decks with spaced repetition.', agents: ['flashcard-maker', 'teacher'], engine: 'SkillChain' },
  { slug: 'quiz-generate', name: 'Quiz Generate', type: 'Education', desc: 'Generate quizzes and practice tests.', agents: ['teacher', 'exam-coach'], engine: 'SkillChain' },
  { slug: 'rubric-grade', name: 'Rubric Grade', type: 'Education', desc: 'Grade work against a rubric with feedback.', agents: ['grader', 'teacher'], engine: 'SkillChain' },
  { slug: 'curriculum-build', name: 'Curriculum Build', type: 'Education', desc: 'Design curricula aligned to standards.', agents: ['curriculum-designer', 'teacher'], engine: 'SkillChain' },
  { slug: 'lab-safety', name: 'Lab Safety', type: 'Education', desc: 'Plan experiments with safety checks.', agents: ['lab-assistant', 'science'], engine: 'SkillChain' },
  { slug: 'thesis-support', name: 'Thesis Support', type: 'Education', desc: 'Support thesis structure, research and writing.', agents: ['research-mentor', 'academic-writer', 'scholar'], engine: 'SkillChain' },
  { slug: 'citation-format', name: 'Citation Format', type: 'Education', desc: 'Format citations in any style.', agents: ['academic-writer', 'research-mentor'], engine: 'SkillChain' },

  // ── Productivity ──────────────────────────────────────────────
  { slug: 'schedule-plan', name: 'Schedule Plan', type: 'Productivity', desc: 'Plan days, weeks and calendars.', agents: ['scheduler', 'task-manager', 'executive-assistant'], engine: 'SkillChain' },
  { slug: 'meeting-minutes', name: 'Meeting Minutes', type: 'Productivity', desc: 'Write agendas and minutes with action items.', agents: ['meeting-planner', 'note-taker', 'reporter'], engine: 'SkillChain' },
  { slug: 'expense-log', name: 'Expense Log', type: 'Productivity', desc: 'Track expenses and budgets.', agents: ['expense-tracker', 'finance'], engine: 'DataAgent' },
  { slug: 'task-board', name: 'Task Board', type: 'Productivity', desc: 'Build task lists and priority boards.', agents: ['task-manager', 'scheduler'], engine: 'SkillChain' },
  { slug: 'inbox-triage', name: 'Inbox Triage', type: 'Productivity', desc: 'Triage email and draft replies.', agents: ['email-triage', 'email'], engine: 'SkillChain' },
  { slug: 'notes-organize', name: 'Notes Organize', type: 'Productivity', desc: 'Organize notes and action items.', agents: ['note-taker', 'study'], engine: 'MemoryManager' },

  // ── Media & video ────────────────────────────────────────────
  { slug: 'video-analyze', name: 'Video Analyze', type: 'Media', desc: 'Watch any video link frame-by-frame: timestamped captions, sampled frames, key moments.', agents: ['video-analyst'], engine: 'VideoAnalyzer' },
  { slug: 'video-transcript', name: 'Video Transcript', type: 'Media', desc: 'Pull the full timestamped transcript of a YouTube/TikTok/Instagram video.', agents: ['video-analyst'], engine: 'VideoAnalyzer' },
  { slug: 'video-frames', name: 'Video Frames', type: 'Media', desc: 'Sample visual frames across a video timeline for vision analysis.', agents: ['video-analyst', 'vision'], engine: 'VideoAnalyzer' },

  // ── Observability ────────────────────────────────────────────
  { slug: 'start_trace', name: 'Start Trace', type: 'Observability', desc: 'Open an OpenTelemetry-style trace span for a task with latency and status tracking.', agents: ['observability'], engine: 'ObservabilityAgent' },
  { slug: 'end_trace', name: 'End Trace', type: 'Observability', desc: 'Close a trace span, recording duration and success/failure.', agents: ['observability'], engine: 'ObservabilityAgent' },
  { slug: 'emit_metric', name: 'Emit Metric', type: 'Observability', desc: 'Record a counter or gauge (latency, tokens, gate results) into the metrics store.', agents: ['observability'], engine: 'ObservabilityAgent' },

  // ── Sandbox ──────────────────────────────────────────────────
  { slug: 'create_sandbox', name: 'Create Sandbox', type: 'Sandbox', desc: 'Create an isolated execution workspace with CPU/memory/timeout limits.', agents: ['sandbox', 'runner'], engine: 'SandboxAgent' },
  { slug: 'run_in_sandbox', name: 'Run in Sandbox', type: 'Sandbox', desc: 'Execute a command inside an isolated workspace with strict limits.', agents: ['sandbox', 'runner'], engine: 'SandboxAgent' },
  { slug: 'destroy_sandbox', name: 'Destroy Sandbox', type: 'Sandbox', desc: 'Tear down a sandbox workspace and release its resources.', agents: ['sandbox', 'runner'], engine: 'SandboxAgent' },
  { slug: 'snapshot_workspace', name: 'Snapshot Workspace', type: 'Sandbox', desc: 'Capture a workspace state for rollback or reuse.', agents: ['sandbox'], engine: 'SandboxAgent' },

  // ── Offline / local LLM ──────────────────────────────────────
  { slug: 'query_local_llm', name: 'Query Local LLM', type: 'Offline', desc: 'Ask a local LLM backend (Ollama / llama.cpp) for an answer.', agents: ['offline'], engine: 'OfflineAgent' },
  { slug: 'list_local_models', name: 'List Local Models', type: 'Offline', desc: 'List models available on the local LLM backend.', agents: ['offline'], engine: 'OfflineAgent' },
  { slug: 'warmup_model', name: 'Warmup Model', type: 'Offline', desc: 'Pre-load a local model so later queries are fast.', agents: ['offline'], engine: 'OfflineAgent' },

  // ── Guardrail & safe mode ────────────────────────────────────
  { slug: 'scan_prompt_safety', name: 'Scan Prompt Safety', type: 'Guardrail', desc: 'Scan a prompt for injection, jailbreak or tool-abuse attempts.', agents: ['guardrail', 'security'], engine: 'GuardrailAgent' },
  { slug: 'force_safe_mode', name: 'Force Safe Mode', type: 'Guardrail', desc: 'Restrict the task to read-only tools or abort with a clear explanation.', agents: ['guardrail', 'security'], engine: 'GuardrailAgent' },

  // ── Concurrency ──────────────────────────────────────────────
  { slug: 'acquire_lock', name: 'Acquire Lock', type: 'Concurrency', desc: 'Take a named lock so concurrent sessions cannot write the same memory.', agents: ['concurrency', 'memory'], engine: 'ConcurrencyAgent' },
  { slug: 'release_lock', name: 'Release Lock', type: 'Concurrency', desc: 'Release a previously acquired named lock.', agents: ['concurrency', 'memory'], engine: 'ConcurrencyAgent' },
  { slug: 'get_workspace_id', name: 'Get Workspace ID', type: 'Concurrency', desc: 'Return the current session/workspace ID for isolation checks.', agents: ['concurrency', 'memory'], engine: 'ConcurrencyAgent' },

  // ── Voice ────────────────────────────────────────────────────
  { slug: 'start_voice_stream', name: 'Start Voice Stream', type: 'Voice', desc: 'Begin a streaming speech-to-text session with barge-in enabled.', agents: ['voice-orchestrator'], engine: 'VoiceAgent' },
  { slug: 'stop_voice_stream', name: 'Stop Voice Stream', type: 'Voice', desc: 'End the active speech stream cleanly.', agents: ['voice-orchestrator'], engine: 'VoiceAgent' },
  { slug: 'speak', name: 'Speak', type: 'Voice', desc: 'Synthesize and play TTS audio for a message.', agents: ['voice-orchestrator'], engine: 'VoiceAgent' },
  { slug: 'listen', name: 'Listen', type: 'Voice', desc: 'Capture the next utterance and transcribe it.', agents: ['voice-orchestrator'], engine: 'VoiceAgent' },

  // ── Plugin manager ───────────────────────────────────────────
  { slug: 'load_plugin', name: 'Load Plugin', type: 'Plugin', desc: 'Validate and load an external skill/tool plugin package.', agents: ['plugin-manager'], engine: 'PluginAgent' },
  { slug: 'unload_plugin', name: 'Unload Plugin', type: 'Plugin', desc: 'Unload a plugin and remove its tools from the registry.', agents: ['plugin-manager'], engine: 'PluginAgent' },
  { slug: 'list_plugins', name: 'List Plugins', type: 'Plugin', desc: 'List loaded plugins with their versions and capabilities.', agents: ['plugin-manager'], engine: 'PluginAgent' },

  // ── Chaos (test-only, feature-flagged) ───────────────────────
  { slug: 'inject_failure', name: 'Inject Failure', type: 'Chaos', desc: 'Inject a controlled failure (provider timeout, tool error) — only when the chaos flag is on.', agents: ['chaos-agent'], engine: 'ChaosAgent' },
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
  const tools = toolsForTeam(team);
  // B52 hard enforcement, now at the OFFER layer too: intents with a code
  // allowlist (direct_answer / conversation / self_check) are only OFFERED
  // the tools they may actually call — the planning-time set matches the
  // runtime gate, so heavy tools (web, browser, study, connectors) can never
  // leak into a lightweight intent's tool list.
  const allowlist = TOOL_INTENT_ALLOWLIST[intent];
  if (allowlist) return tools.filter((t) => allowlist.includes(t.slug));
  return tools;
}

/** Pretty one-line summary: "6 tools". */
export function toolSummary(intent, extra = {}) {
  return `${toolsForIntent(intent, extra).length} tools`;
}

/** Tool names for the live pipeline stream. */
export function toolNames(intent, extra = {}) {
  return toolsForIntent(intent, extra).map((t) => t.name);
}
