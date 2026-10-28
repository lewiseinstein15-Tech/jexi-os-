/**
 * JEXI OS — capability registry — the catalog.
 *
 * A capability is a thing JEXI can DO ("read a file", "search the web"), named
 * independently of the intent that happened to request it and independently of
 * the tool that implements it.
 *
 * Why this exists (see docs/ARCHITECTURE-CAPABILITY-RUNTIME.md):
 *   The offered tool set used to be derived ONLY from the classified intent
 *   (`plan.tools = toolsForTeam(intent)`). A wrong classification therefore
 *   withheld the tools the task actually needed — "search the web for X"
 *   classified as `legal_task` was offered `compliance-check` and no web
 *   search at all. The capability was registered the whole time; it was never
 *   offered. This catalog is the vocabulary that lets the runtime ask "what
 *   does this task need?" separately from "what did the classifier call it?".
 *
 * `providers` lists every real implementation, in preference order. A
 * capability is available when ANY provider can actually run — a native tool
 * with a registered engine, or an MCP server that is connected or known to the
 * directory (sleeping servers wake on first call).
 *
 * NOTHING here may claim a capability that no provider implements. Adding an
 * entry is a claim that the listed tools exist; the registry verifies it.
 */

/**
 * The catalog. `id` is the stable handle used in events, tests and the
 * registry; `title`/`whenToUse` are the tool-guidance text handed to a model.
 */
export const CAPABILITIES = [
  {
    id: 'filesystem_read',
    title: 'Read files and directories',
    whenToUse: 'Inspect a file, list a directory, find files by glob, or grep file contents.',
    providers: [
      { tool: 'fs_read' }, { tool: 'fs_ls' }, { tool: 'fs_glob' }, { tool: 'fs_grep' },
    ],
  },
  {
    id: 'filesystem_write',
    title: 'Create and edit files',
    whenToUse: 'Write, edit, append to, or delete a file in the workspace.',
    providers: [
      { tool: 'fs_write' }, { tool: 'fs_edit' }, { tool: 'fs_append' }, { tool: 'fs_delete' },
    ],
  },
  {
    id: 'terminal',
    title: 'Run terminal commands',
    whenToUse: 'Execute a shell command or manage a persistent terminal session.',
    providers: [{ tool: 'term_execute' }, { tool: 'term_session' }],
  },
  {
    id: 'testing',
    title: 'Run tests and coverage',
    whenToUse: 'Run a test suite (pytest, node --test) and read the pass/fail verdict.',
    providers: [{ tool: 'pytest_run' }, { tool: 'test_run' }, { tool: 'test_coverage' }],
  },
  {
    id: 'git',
    title: 'Inspect git state',
    whenToUse: 'Check status, read a diff, view history, commit, or branch.',
    providers: [
      { tool: 'git_status' }, { tool: 'git_diff' }, { tool: 'git_log' },
      { tool: 'git_commit' }, { tool: 'git_branch' },
    ],
  },
  {
    id: 'web_search',
    title: 'Search the web',
    whenToUse: 'Find current information online: news, releases, facts that may have changed.',
    providers: [
      { tool: 'web_search' },
      { mcpServer: 'duckduckgo' }, { mcpServer: 'free-search' },
    ],
  },
  {
    id: 'web_fetch',
    title: 'Fetch a URL',
    whenToUse: 'Retrieve and read the contents of a specific web page or document URL.',
    providers: [
      { tool: 'web_fetch' },
      { mcpServer: 'fetch' }, { mcpServer: 'duckduckgo' },
    ],
  },
  {
    id: 'browser',
    title: 'Drive a browser',
    whenToUse: 'Interact with a page that needs JavaScript: click, type, extract rendered content.',
    providers: [{ tool: 'nav_navigate' }, { tool: 'nav_extract' }, { tool: 'nav_click' }, { tool: 'nav_type' }],
  },
  {
    id: 'memory',
    title: 'Store and recall memory',
    whenToUse: 'Persist a fact about the user/project, or recall one that was stored earlier.',
    providers: [{ tool: 'mem_store' }, { tool: 'mem_recall' }, { tool: 'mem_forget' }],
  },
  {
    id: 'delegation',
    title: 'Delegate to a subagent',
    whenToUse: 'Hand a self-contained sub-task to a child agent and collect its report.',
    providers: [{ tool: 'delegate_spawn' }, { tool: 'delegate_await' }],
  },
  {
    id: 'data',
    title: 'Process structured data',
    whenToUse: 'Parse JSON/CSV or run a SQL query over local tabular data.',
    providers: [{ tool: 'data_json' }, { tool: 'data_csv' }, { tool: 'data_sql' }],
  },
  {
    id: 'github',
    title: 'Work with GitHub',
    whenToUse: 'List issues, open a pull request, or review one.',
    providers: [{ tool: 'gh_issue_list' }, { tool: 'gh_pr_create' }, { tool: 'gh_pr_review' }],
  },
  {
    id: 'code_intel',
    title: 'Code intelligence',
    whenToUse: 'Ask for diagnostics, definitions, references or hover info from a language server.',
    providers: [{ tool: 'lsp_diagnostics' }, { tool: 'lsp_definition' }, { tool: 'lsp_references' }],
  },
  {
    id: 'docs_lookup',
    title: 'Look up library documentation',
    whenToUse: 'Read current API docs for a library or framework.',
    providers: [
      { mcpServer: 'context7' }, { mcpServer: 'deepwiki' }, { mcpServer: 'mslearn' },
      { mcpServer: 'cloudflare-docs' }, { mcpServer: 'gitmcp' },
    ],
  },
  {
    id: 'papers',
    title: 'Search academic papers',
    whenToUse: 'Find or download a research paper / preprint.',
    providers: [{ mcpServer: 'arxiv' }],
  },
  {
    id: 'encyclopedia',
    title: 'Look up an encyclopedia article',
    whenToUse: 'Get a stable, citable overview of a topic or person.',
    providers: [{ mcpServer: 'wikipedia-js' }, { mcpServer: 'wikipedia-py' }],
  },
];

/** id → entry. */
export const CAPABILITY_BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id) {
  return CAPABILITY_BY_ID.get(String(id || '')) || null;
}

/** Every capability id, for diagnostics. */
export function capabilityIds() {
  return CAPABILITIES.map((c) => c.id);
}
