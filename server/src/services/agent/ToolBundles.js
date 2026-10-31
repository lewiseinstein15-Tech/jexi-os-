/**
 * JEXI OS — AGENT — ToolBundles.
 *
 * The capability BUNDLES a turn can disclose, as data.
 *
 * M11 measured the failure this module exists to fix: a coding turn was
 * offered 41 tools (25 plan + 16 routed MCP), the 3B model answered in prose
 * instead of calling any of them, and the graded file was never written. A
 * controlled probe isolated the cause — the SIZE of the offered menu, not the
 * model's ability to write Python (41 tools → 0/4 tool-call; 3 tools → 3/4).
 *
 * The fix is progressive disclosure: offer a SMALL, relevant initial menu and
 * let the agent pull in more on demand. This file is the vocabulary for that —
 * which tools belong to which bundle — kept as DATA so a bundle is auditable
 * and a new tool can be added to a bundle without touching selection logic.
 *
 * Each bundle has two tiers:
 *   `core`   — the few tools disclosed when the bundle is part of a turn's
 *              INITIAL menu. Deliberately minimal.
 *   `slugs`/`prefixes` — the bundle's full membership, disclosed when the agent
 *              explicitly asks for that bundle via `request_tools`.
 *
 * Design constraints (from the M12 mission):
 *   - GENERAL, not a HumanEval special case. Bundles describe ordinary
 *     capability areas (coding, filesystem, web, memory, …); no bundle knows
 *     anything about a benchmark.
 *   - NO second registry. Bundles name slugs that must already resolve through
 *     the live registries (`resolveToolDef`); an unknown slug is dropped, not
 *     invented. `ToolDisclosure` verifies every slug before offering it.
 *   - NO redundant members in a core. `code-write`/`code-run` (legacy) and
 *     `fs_write`/`term_execute` (domain) do the same jobs; a core never offers
 *     both, so the model is not asked to choose between two identical tools.
 *   - ADDITIVE disclosure only. Selecting a bundle never removes the plan's
 *     tools or an explicitly required one; it decides which EXTRA capabilities
 *     start in the menu and which stay one `request_tools` call away.
 */

/**
 * A bundle: an id, plain-language title/description (shown to the model in the
 * expansion tool and in logs), the capabilities it covers, and its members.
 */
export const TOOL_BUNDLES = {
  filesystem: {
    id: 'filesystem',
    title: 'Filesystem',
    description: 'Read, list, search, write and edit files in the workspace.',
    capabilities: ['filesystem_read', 'filesystem_write'],
    core: ['fs_read', 'fs_write', 'fs_edit'],
    prefixes: ['fs_'],
    slugs: ['fs_read', 'fs_ls', 'fs_glob', 'fs_grep', 'fs_write', 'fs_edit', 'fs_append'],
  },
  terminal: {
    id: 'terminal',
    title: 'Terminal',
    description: 'Run a shell command or manage a persistent terminal session.',
    capabilities: ['terminal'],
    core: ['term_execute'],
    prefixes: ['term_'],
    slugs: ['term_execute', 'term_session'],
  },
  testing: {
    id: 'testing',
    title: 'Tests & verification',
    description: 'Run a test suite or coverage and read the real pass/fail verdict.',
    capabilities: ['testing'],
    core: ['pytest_run'],
    prefixes: ['test_', 'pytest_'],
    slugs: ['test_run', 'pytest_run', 'test_coverage'],
  },
  git: {
    id: 'git',
    title: 'Git',
    description: 'Inspect and change version-control state: status, diff, log, commit, branch.',
    capabilities: ['git'],
    core: ['git_status', 'git_diff'],
    prefixes: ['git_'],
    slugs: ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_branch'],
  },
  code: {
    id: 'code',
    title: 'Code execution',
    description: 'Run code and write files through the sandboxed code tools (legacy aliases of fs_write/term_execute).',
    capabilities: [],
    core: ['code-write', 'code-run'],
    prefixes: ['code_'],
    slugs: ['code-run', 'code-write'],
  },
  web: {
    id: 'web',
    title: 'Web research',
    description: 'Search the web and fetch the contents of a specific URL.',
    capabilities: ['web_search', 'web_fetch'],
    core: ['web_search', 'web_fetch'],
    prefixes: ['web_'],
    slugs: ['web_search', 'web_fetch', 'web-search', 'deep-read'],
  },
  browser: {
    id: 'browser',
    title: 'Browser',
    description: 'Drive a real browser: navigate, click, type, extract a rendered page.',
    capabilities: ['browser'],
    core: ['nav_navigate', 'nav_extract'],
    prefixes: ['nav_'],
    slugs: ['nav_navigate', 'nav_click', 'nav_type', 'nav_extract', 'browser-drive'],
  },
  memory: {
    id: 'memory',
    title: 'Memory & knowledge',
    description: 'Store and recall what was learned across turns.',
    capabilities: ['memory'],
    core: ['mem_recall', 'mem_store'],
    prefixes: ['mem_'],
    slugs: ['mem_store', 'mem_recall', 'mem_forget', 'memory-recall', 'memory-write', 'knowledge-load'],
  },
  data: {
    id: 'data',
    title: 'Data analysis',
    description: 'Parse and query structured data (JSON, CSV, SQL).',
    capabilities: ['data'],
    core: ['data_json', 'data_csv'],
    prefixes: ['data_'],
    slugs: ['data_json', 'data_csv', 'data_sql'],
  },
  delegation: {
    id: 'delegation',
    title: 'Delegation',
    description: 'Spawn a subagent for a parallel or specialist subtask and collect its result.',
    capabilities: ['delegation'],
    core: ['delegate_spawn'],
    prefixes: ['delegate_'],
    slugs: ['delegate_spawn', 'delegate_await'],
  },
  github: {
    id: 'github',
    title: 'GitHub',
    description: 'Work with GitHub: issues, pull requests, reviews.',
    capabilities: ['github'],
    core: ['gh_issue_list', 'gh_pr_create'],
    prefixes: ['gh_'],
    slugs: ['gh_pr_create', 'gh_pr_review', 'gh_issue_list'],
  },
  lsp: {
    id: 'lsp',
    title: 'Code intelligence',
    description: 'Language-server facts: diagnostics, definitions, references, symbols.',
    capabilities: ['code_intel'],
    core: ['lsp_diagnostics'],
    prefixes: ['lsp_'],
    slugs: ['lsp_diagnostics', 'lsp_definition', 'lsp_references', 'lsp_hover', 'lsp_symbols'],
  },
  communication: {
    id: 'communication',
    title: 'Communication',
    description: 'Notify the user or ask a direct question.',
    capabilities: [],
    core: ['comm_ask'],
    prefixes: ['comm_'],
    slugs: ['comm_notify', 'comm_ask'],
  },
};

/**
 * The UNIVERSAL core floor: the bundles every turn gets when its intent has no
 * mapping. The measured failure mode is not only "the menu is too big" but "the
 * intent label is wrong": a coding request classified as `observability`
 * matched no bundle and silently received the FULL menu, so the narrowing never
 * happened. Read + write + run is the floor any task can start from, and
 * everything else stays one `request_tools` call away. An intent mapped to an
 * explicit `[]` (e.g. `self_check`) still means "no disclosure".
 */
export const DEFAULT_BUNDLES = ['filesystem', 'terminal'];

/**
 * The initial bundle set per intent — the progressive-disclosure floor: the
 * smallest menu that lets the turn start its actual work. Anything not listed
 * stays reachable through `request_tools`.
 *
 * A coding turn gets read + edit + run + verify and NOTHING else. A research
 * turn gets web, not the coding set. An intent NOT listed here falls back to
 * `DEFAULT_BUNDLES` (read/write/run), never to the full catalogue.
 */
export const INTENT_BUNDLES = {
  // Coding: the measured failure. Read → edit → run → verify, nothing more.
  code_task: ['filesystem', 'terminal', 'testing'],
  code_fix: ['filesystem', 'terminal', 'testing'],
  code: ['filesystem', 'terminal', 'testing'],
  coding: ['filesystem', 'terminal', 'testing'],
  debug: ['filesystem', 'terminal', 'testing'],
  refactor: ['filesystem', 'terminal', 'testing'],
  test: ['filesystem', 'terminal', 'testing'],

  // Research / knowledge: web first, memory as the recall floor.
  research: ['web', 'memory'],
  learning_research: ['web', 'memory'],
  study_topic: ['web', 'memory'],
  news_latest: ['web'],
  link_analysis: ['web', 'browser'],
  knowledge_recall: ['memory'],
  memory_query: ['memory'],

  // Data / devops / github.
  data: ['data', 'filesystem'],
  data_analysis: ['data', 'filesystem'],
  devops: ['terminal', 'filesystem'],
  github: ['github', 'git', 'filesystem'],
  perf: ['filesystem', 'terminal', 'testing'],

  // Explicit browser intent only.
  computer_use: ['browser'],
  travel_booking: ['browser'],

  // Lightweight intents keep the memory floor and nothing else.
  direct_answer: ['memory'],
  conversation: ['memory'],
  self_check: [],
};

/**
 * Bundles eligible for on-demand disclosure regardless of intent — the agent
 * may legitimately discover mid-task that it needs them. They are NOT in the
 * initial menu; they are what `request_tools` can pull in (still subject to the
 * permission/risk gate at execute time).
 */
export const DISCOVERABLE_BUNDLES = [
  'filesystem', 'terminal', 'testing', 'git', 'code',
  'web', 'browser', 'memory', 'data', 'delegation', 'github', 'lsp', 'communication',
];

/**
 * The initial bundles for an intent.
 *
 * A mapped intent uses its own list (an explicit `[]` means "no disclosure").
 * An UNMAPPED intent gets `DEFAULT_BUNDLES` — the universal read/write/run
 * floor — so a misclassified intent can no longer silently fall back to the
 * full catalogue, which is exactly the bug that made the M12 narrowing
 * intermittent (a coding task classified `observability` offered 24 tools).
 */
export function initialBundlesForIntent(intent) {
  const key = String(intent || '').toLowerCase();
  if (Array.isArray(INTENT_BUNDLES[key])) return [...INTENT_BUNDLES[key]];
  return [...DEFAULT_BUNDLES];
}

/** One bundle by id, or null. */
export function getBundle(id) {
  return TOOL_BUNDLES[id] || null;
}

/** Every bundle id, in declaration order. */
export function bundleIds() {
  return Object.keys(TOOL_BUNDLES);
}
