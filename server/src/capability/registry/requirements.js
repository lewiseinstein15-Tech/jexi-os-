/**
 * JEXI OS — capability registry — requirement inference.
 *
 * The second half of the fix. The registry answers "what can JEXI do?"; this
 * module answers "what does THIS task need?" — from the request's own words,
 * not from the classified intent.
 *
 * Why that separation matters: the old path was
 *
 *     query → intent (classifier) → team → plan.tools → offered tools
 *
 * so a classification error silently removed the tools the task required.
 * Measured: "search the web for the latest Node.js release" classified as
 * `legal_task` and was offered `compliance-check` and `privacy-review`, with
 * no web search anywhere in the menu.
 *
 * Requirement inference is deterministic and inspectable: every rule states the
 * pattern and the capability it implies, so a misroute can no longer hide
 * behind an opaque model decision. The inferred capabilities are MERGED with
 * the plan's tools (never substituted for them), which means a wrong
 * classification can withhold nothing the request plainly asks for.
 *
 * This does not attempt to replace the classifier. It is a floor: the explicit
 * things a user said they want are always reachable.
 */

/** One rule: a pattern, the capabilities it implies, and why. */
const RULES = [
  // ── filesystem ──────────────────────────────────────────────────────────
  {
    id: 'fs-read-verb',
    re: /\b(read|open|inspect|view|show( me)?|display|cat|print)\b[^.]{0,40}\b(file|files|source|code|contents?|directory|folder|dir)\b/i,
    caps: ['filesystem_read'],
    why: 'asked to read a file/directory',
  },
  {
    id: 'fs-read-path',
    re: /(^|[\s'"`])((?:[\w.-]+\/)+[\w.-]+|\w+\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|txt|yml|yaml|toml|py|rb|go|rs|java|c|cpp|h|css|html|sh|env|lock|cfg|ini))\b/i,
    caps: ['filesystem_read'],
    why: 'named a file path',
  },
  {
    id: 'fs-write-verb',
    re: /\b(write|create|make|save|generate|append to|edit|modify|update|rewrite|patch)\b[^.]{0,40}\b(file|files|document|script|module|component|config)\b/i,
    caps: ['filesystem_write', 'filesystem_read'],
    why: 'asked to create/edit a file',
  },
  {
    id: 'fs-find',
    re: /\b(find|locate|search (for|the) files?|grep|which files?|list (the )?files?)\b/i,
    caps: ['filesystem_read'],
    why: 'asked to find files or search contents',
  },

  // ── terminal ────────────────────────────────────────────────────────────
  {
    id: 'terminal-explicit',
    re: /\b(run|execute|exec)\b[^.]{0,30}\b(command|cmd|shell|bash|terminal|script|program|process)\b/i,
    caps: ['terminal'],
    why: 'asked to run a command',
  },
  {
    id: 'terminal-in-terminal',
    re: /\b(in|from|using|via) (the )?(terminal|shell|command line|cli|console)\b/i,
    caps: ['terminal'],
    why: 'named the terminal as the place to act',
  },
  {
    id: 'terminal-tool',
    re: /\b(^|\s)(ls|pwd|cd|mkdir|rm|cp|mv|touch|chmod|curl|wget|npm|npx|pnpm|yarn|pip|python3?|node|make|docker|kubectl)\b(\s|$)/i,
    caps: ['terminal'],
    why: 'named a shell command or CLI tool',
  },
  {
    id: 'terminal-install',
    re: /\b(install|uninstall|build|compile|deploy|start|stop|restart|kill)\b[^.]{0,30}\b(the )?(app|server|package|dependency|dependencies|project|service|process)\b/i,
    caps: ['terminal'],
    why: 'asked to install/build/run a program',
  },

  // ── testing ─────────────────────────────────────────────────────────────
  {
    id: 'testing',
    re: /\b(run|re-?run|execute)\b[^.]{0,30}\b(tests?|test suite|specs?|pytest|jest|vitest|unit tests?|integration tests?)\b/i,
    caps: ['testing', 'terminal'],
    why: 'asked to run tests',
  },
  {
    id: 'testing-failing',
    re: /\b(failing|broken|red) (tests?|suite|specs?)\b|\bmake (the )?tests? pass\b|\bfix the test\b|\btest failure\b|\bpytest\b/i,
    caps: ['testing', 'filesystem_read', 'filesystem_write', 'terminal'],
    why: 'a failing test needs read + edit + re-run',
  },

  // ── git ─────────────────────────────────────────────────────────────────
  {
    id: 'git',
    re: /\b(git|commit|commits|diff|branch|branches|merge|rebase|stash|checkout|pull request|pull requests|pr|prs|repo|repository)\b/i,
    caps: ['git'],
    why: 'git/repo language',
  },

  // ── web search / fetch ──────────────────────────────────────────────────
  {
    id: 'web-search',
    re: /\b(search|google|look up|find out|research|browse)\b[^.]{0,40}\b(web|online|internet|the net|for)\b|\b(search the web|web search|google it|look it up online)\b/i,
    caps: ['web_search'],
    why: 'asked to search the web',
  },
  {
    id: 'web-recency',
    re: /\b(latest|newest|current|today|recent|up-?to-?date|this (week|month|year)|breaking|news)\b/i,
    caps: ['web_search'],
    why: 'asked for current/latest information',
  },
  {
    id: 'web-fetch',
    re: /\b(fetch|download|open|visit|read)\b[^.]{0,30}\b(url|link|page|website|site|article)\b|https?:\/\/\S+/i,
    caps: ['web_fetch'],
    why: 'asked to fetch a URL',
  },
  {
    id: 'browser',
    re: /\b(browser|headless|screenshot|click|scroll|fill (in )?the form|navigate to|render(ed)? (page|html))\b/i,
    caps: ['browser'],
    why: 'needs a real browser',
  },

  // ── memory ──────────────────────────────────────────────────────────────
  {
    id: 'memory-write',
    re: /\b(remember|memorize|note that|keep in mind|don'?t forget|save this)\b/i,
    caps: ['memory'],
    why: 'asked to remember something',
  },
  {
    id: 'memory-read',
    re: /\b(do you remember|what did i (say|tell|ask|mention)|recall|my (name|preference|favorite|birthday))\b/i,
    caps: ['memory'],
    why: 'asked to recall something',
  },

  // ── delegation ──────────────────────────────────────────────────────────
  {
    id: 'delegation',
    re: /\b(delegate|subagent|sub-agent|spawn (an? )?agent|another agent|in parallel|parallelize)\b/i,
    caps: ['delegation'],
    why: 'asked to delegate work',
  },

  // ── data ────────────────────────────────────────────────────────────────
  {
    id: 'data',
    re: /\b(csv|tsv|json|dataframe|sql query|query the data|parse the data|analyz(e|ing) the data|dataset)\b/i,
    caps: ['data'],
    why: 'structured-data work',
  },

  // ── github ──────────────────────────────────────────────────────────────
  {
    id: 'github',
    re: /\b(github|pull request|pr #?\d+|issue #?\d+|open an issue|review the pr)\b/i,
    caps: ['github'],
    why: 'GitHub work',
  },

  // ── code intelligence ───────────────────────────────────────────────────
  {
    id: 'code-intel',
    re: /\b(go to definition|find (all )?references|diagnostics|type error|hover info|language server)\b/i,
    caps: ['code_intel'],
    why: 'asked for language-server information',
  },

  // ── research sources ────────────────────────────────────────────────────
  {
    id: 'papers',
    re: /\b(arxiv|preprint|paper|papers|journal article|scientific stud|citation)\b/i,
    caps: ['papers'],
    why: 'academic-paper language',
  },
  {
    id: 'encyclopedia',
    re: /\b(wikipedia|encyclopedia)\b/i,
    caps: ['encyclopedia'],
    why: 'asked for an encyclopedia source',
  },
  {
    id: 'docs-lookup',
    re: /\b(api docs|documentation for|docs for|official docs|library docs|framework docs)\b/i,
    caps: ['docs_lookup'],
    why: 'asked for library documentation',
  },
];

/**
 * Infer the capabilities a task requires from the request itself.
 *
 * @param {string} query
 * @param {object} [plan]  the classifier's plan (its tools also imply caps)
 * @returns {{ required: string[], reasons: {id:string, capability:string, why:string}[], source: string }}
 */
export function inferRequirements(query, plan = {}) {
  const q = String(query || '');
  const required = new Set();
  const reasons = [];

  for (const rule of RULES) {
    if (!rule.re.test(q)) continue;
    for (const cap of rule.caps) {
      if (!required.has(cap)) {
        required.add(cap);
        reasons.push({ id: rule.id, capability: cap, why: rule.why });
      }
    }
  }

  // The plan's own tools imply capabilities too — if the classifier already
  // asked for fs_read, filesystem_read is satisfied and does not need adding.
  const plannedTools = new Set((plan.tools || []).map((t) => String(t)));
  const planCaps = new Set();
  for (const [tool, cap] of TOOL_TO_CAPABILITY_FOR_REQUIREMENTS) {
    if (plannedTools.has(tool)) planCaps.add(cap);
  }

  // A coding/fix intent is itself a requirement signal: an edit must be
  // verified, which needs testing + terminal even when the user did not say
  // "run the tests".
  const intent = String(plan?.intent || '').toLowerCase();
  if (['code', 'coding', 'code_task', 'code_fix', 'debug', 'refactor'].includes(intent)) {
    for (const cap of ['filesystem_read', 'filesystem_write', 'testing', 'terminal']) {
      if (!required.has(cap)) { required.add(cap); reasons.push({ id: 'coding-intent', capability: cap, why: 'coding turn must read, edit and verify' }); }
    }
  }

  return {
    required: [...required],
    satisfiedByPlan: [...planCaps],
    reasons,
    source: 'requirement-inference',
  };
}

/* Local map to avoid importing the ledger module here (keeps this file
   dependency-free and cheap to unit test). Mirrors ledger.TOOL_TO_CAPABILITY. */
const TOOL_TO_CAPABILITY_FOR_REQUIREMENTS = new Map([
  ['fs_read', 'filesystem_read'], ['fs_ls', 'filesystem_read'], ['fs_glob', 'filesystem_read'], ['fs_grep', 'filesystem_read'],
  ['fs_write', 'filesystem_write'], ['fs_edit', 'filesystem_write'], ['fs_append', 'filesystem_write'], ['fs_delete', 'filesystem_write'],
  ['term_execute', 'terminal'], ['term_session', 'terminal'],
  ['pytest_run', 'testing'], ['test_run', 'testing'], ['test_coverage', 'testing'],
  ['git_status', 'git'], ['git_diff', 'git'], ['git_log', 'git'], ['git_commit', 'git'], ['git_branch', 'git'],
  ['web_search', 'web_search'], ['web_fetch', 'web_fetch'],
  ['nav_navigate', 'browser'], ['nav_extract', 'browser'],
  ['mem_store', 'memory'], ['mem_recall', 'memory'],
  ['delegate_spawn', 'delegation'],
  ['data_json', 'data'], ['data_csv', 'data'], ['data_sql', 'data'],
  ['gh_issue_list', 'github'], ['gh_pr_create', 'github'],
  ['lsp_diagnostics', 'code_intel'],
]);

/** Exposed for tests/diagnostics: the rule table. */
export function requirementRules() {
  return RULES.map((r) => ({ id: r.id, caps: r.caps, why: r.why }));
}
