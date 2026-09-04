/**
 * B223 — TOOL DISCOVERY (spec Part 20): objective → capability → tool.
 *
 * The gap this closes (from the architecture audit, §3 row 5): tools were
 * injected per-employee (composeTeam → toolsForTeam) — safe and tested, but
 * never DISCOVERED per-objective. Part 20 wants the registry matched the
 * other way: read the objective, derive the capabilities it actually needs,
 * and surface the tools that provide them — with per-tool risk and
 * verification metadata, and honest capability gaps when nothing covers a
 * requirement.
 *
 * Rules (deterministic, auditable — no LLM calls, same discipline as B215):
 *   - Capabilities come from two real sources, tagged by provenance:
 *     INTERPRETER — the structured objective state's requiredCapabilities
 *                   (derived from the subtasks the plan calls for, B215).
 *     INFERRED    — keyword families on the objective text (documented
 *                   heuristics; better than pretending we know nothing).
 *   - Every registry tool derives capabilities from its type + explicit
 *     hints — no tool is left untagged.
 *   - Risk metadata is REAL: the B209 permission requirements
 *     (READ/WRITE/EXECUTE/NETWORK/GIT/DESTRUCTIVE), the registry tier
 *     (read/write_local/exec) and derived flags (outbound / destructive /
 *     execute / network). Outbound sends stay approval-gated (B56).
 *   - Verification metadata names HOW a tool's result can be verified
 *     (exit-code / verdict / citations / state-diff) — or honestly null
 *     for purely generative tools.
 *   - Discovery is ADDITIVE metadata. It does NOT replace the per-team
 *     injection or bypass the B52 intent allowlist or the B209 permission
 *     gate — it layers on top: what the objective needs, what the team
 *     already covers, what's missing.
 */

import { TOOL_REGISTRY, toolsForTeam, enforceToolAllowlist } from './ToolRegistry.js';
import { toolPermissionsFor } from './director/Permissions.js';

/* ── 1. Tool → capabilities (every tool tagged, by rule) ─────────────── */

/** Capability families by registry type (the derivation base). */
const TYPE_CAPABILITIES = {
  Search: ['research', 'realtime-info'],
  Research: ['research'],
  Data: ['data-analysis'],
  Browser: ['browser-interaction'],
  Perception: ['vision'],
  Memory: ['memory'],
  Knowledge: ['knowledge-recall'],
  Execution: ['author-code', 'execute-code', 'debug-code'],
  Quality: ['verification'],
  DevTools: ['git'],
  DevOps: ['deploy'],
  Security: ['security-audit'],
  Writing: ['writing'],
  Creative: ['creative'],
  Business: ['business'],
  Life: ['life-planning'],
  Education: ['education'],
  Productivity: ['scheduling'],
  Language: ['translation'],
  Marketing: ['writing'],
  MCP: ['external-tools'],
  Connectors: ['outbound-send'],
  System: ['system'],
  Guardrail: ['safety'],
  Concurrency: ['system'],
  Voice: ['voice'],
  Plugin: ['system'],
  Agent: ['orchestration'],
  Jobs: ['background-jobs'],
  Goal: ['goals'],
  Schedule: ['scheduling'],
  Terminal: ['execute-code'],
  Code: ['execute-code'],
  Sandbox: ['system'],
  Offline: ['local-models'],
  Chaos: ['testing'],
  Media: ['vision', 'research'],
  Observability: ['system'],
};

/** Extra capabilities for key tools (the explicit layer over the type rule). */
const EXTRA_CAPABILITIES = {
  'web-search': ['research', 'realtime-info'],
  'news-feed': ['realtime-info'],
  'trend-scan': ['realtime-info'],
  'deep-read': ['research'],
  'trusted-library': ['research', 'knowledge-recall'],
  'wikipedia-lookup': ['research'],
  'arxiv-search': ['research'],
  'market-research': ['research'],
  'competitor-scan': ['research'],
  'fact-check': ['verification'],
  'self-consistency': ['verification'],
  'test-automation': ['verification'],
  'build-check': ['verification'],
  'code-review': ['verification'],
  'security-scan': ['verification', 'security-audit'],
  'code-write': ['author-code'],
  'code-run': ['execute-code'],
  'code-fix': ['debug-code'],
  'github-cli': ['git'],
  'git-status': ['git'],
  'branch-manage': ['git'],
  'issue-track': ['git'],
  'pr-review': ['git', 'verification'],
  'vision-analyze': ['vision'],
  'ocr-read': ['vision'],
  'screenshot': ['vision'],
  'image-generate': ['creative'],
  'connector-call': ['outbound-send'],
  'memory-clear': ['memory'],
  'run-command': ['execute-code'],
  'terminal_open': ['execute-code'],
  'terminal_send': ['execute-code'],
  run_code: ['execute-code'],
  'browser-drive': ['browser-interaction'],
  'form-fill': ['browser-interaction'],
  'data-crunch': ['data-analysis'],
  'stats-compute': ['data-analysis'],
  'chart-builder': ['data-analysis'],
  'schedule_create': ['scheduling'],
  todo: ['scheduling'],
  'task-board': ['scheduling'],
  'semantic-search': ['memory', 'research'],
  'session-search': ['memory'],
  'book-library': ['knowledge-recall'],
  'document-rag': ['knowledge-recall'],
  'subagent': ['orchestration'],
  workflow: ['orchestration'],
  ralph: ['orchestration'],
};

/** Tools whose results verify in a named way (everything else → null, honestly). */
const VERIFICATION_KIND = {
  'code-run': 'exit-code', 'code-fix': 'exit-code', run_code: 'exit-code', 'test-automation': 'exit-code',
  'build-check': 'exit-code', 'lint-check': 'exit-code', eval_run: 'exit-code', 'run-command': 'exit-code',
  pwsh: 'exit-code', terminal_send: 'output-drain',
  'code-review': 'verdict', 'security-scan': 'verdict', 'vuln-scan': 'verdict', 'secrets-scan': 'verdict',
  'code-sast': 'verdict', 'fact-check': 'verdict', 'self-consistency': 'verdict', 'compliance-check': 'verdict',
  'web-search': 'citations', 'deep-read': 'citations', 'trusted-library': 'citations', 'wikipedia-lookup': 'citations',
  'arxiv-search': 'citations', 'news-feed': 'citations', 'book-library': 'citations', 'document-rag': 'citations',
  'code-write': 'state-diff', 'github-cli': 'state-diff', 'git-status': 'state-diff', 'branch-manage': 'state-diff',
};

/** Tools that touch the world outside JEXI (approval-gated at runtime — B56). */
const OUTBOUND_TOOLS = new Set(['connector-call']);
/** Tools that destroy state irreversibly. */
const DESTRUCTIVE_TOOLS = new Set(['memory-clear', 'job_kill', 'force-delete', 'disk-wipe', 'schedule_delete']);

/** capabilities for one tool (type family + explicit extras, deduped). */
export function capabilitiesForTool(tool) {
  const caps = new Set([...(TYPE_CAPABILITIES[tool.type] || []), ...(EXTRA_CAPABILITIES[tool.slug] || [])]);
  return [...caps];
}

/** risk metadata for one tool — REAL fields only (B209 requirements + tier + flags). */
export function riskForTool(tool) {
  const permissions = toolPermissionsFor(tool.slug);
  const tier = tool.tier || (tool.type === 'Execution' || tool.type === 'Terminal' || tool.type === 'Code' ? 'exec' : 'read');
  return {
    tier,
    permissions,
    flags: {
      network: permissions.includes('NETWORK'),
      execute: permissions.includes('EXECUTE') || tier === 'exec',
      outbound: OUTBOUND_TOOLS.has(tool.slug),
      destructive: permissions.includes('DESTRUCTIVE') || DESTRUCTIVE_TOOLS.has(tool.slug),
    },
    // outbound sends always pause for ONE explicit human approval (B56 model)
    approvalRequired: OUTBOUND_TOOLS.has(tool.slug),
  };
}

/* ── 2. Objective → required capabilities ────────────────────────────── */

/** Freeform interpreter capability → canonical (synonym folding). */
const CAPABILITY_SYNONYMS = {
  coding: 'author-code', code: 'author-code', programming: 'author-code', development: 'author-code',
  engineering: 'author-code', software: 'author-code', debugging: 'debug-code', debug: 'debug-code',
  research: 'research', searching: 'research', 'information-retrieval': 'research',
  writing: 'writing', copywriting: 'writing', documentation: 'writing',
  analysis: 'data-analysis', data: 'data-analysis', analytics: 'data-analysis', statistics: 'data-analysis',
  vision: 'vision', 'image-analysis': 'vision', 'image-recognition': 'vision',
  security: 'security-audit', 'security-review': 'security-audit',
  deployment: 'deploy', devops: 'deploy', infrastructure: 'deploy',
  scheduling: 'scheduling', automation: 'scheduling', reminders: 'scheduling',
  memory: 'memory', recall: 'memory', personalization: 'memory',
  github: 'git', 'version-control': 'git',
  email: 'outbound-send', messaging: 'outbound-send',
  education: 'education', tutoring: 'education', teaching: 'education',
  business: 'business', marketing: 'writing', finance: 'data-analysis',
};

/** Objective-text keyword families (provenance: INFERRED — documented heuristics). */
const OBJECTIVE_HINTS = [
  { capability: 'author-code', re: /\b(build|create|make|develop|write)\b[^.]{0,40}\b(app|application|website|web app|game|program|software|tool|api|site|service|bot|script)\b|\b(code|program|implement|refactor)\b/i },
  { capability: 'debug-code', re: /\b(fix|debug|broken|error|bug|crash|fails?|not working)\b/i },
  { capability: 'research', re: /\b(research|investigate|find out|look up|compare|what is|who is|latest|news|sources?|study)\b/i },
  { capability: 'realtime-info', re: /\b(latest|current|today|now|live|up-to-date|breaking|recent)\b/i },
  { capability: 'vision', re: /\b(image|picture|photo|screenshot|look at this|what do you see|diagram|ocr)\b/i },
  { capability: 'data-analysis', re: /\b(data|dataset|datasets|chart|charts|graph|graphs|statistics|stats|numbers|spreadsheet|csv)\b/i },
  { capability: 'git', re: /\b(github|repo|repository|commit|pull request|pr\b|branch|issue)\b/i },
  { capability: 'outbound-send', re: /\b(send|email|post|publish|share|notify)\b[^.]{0,30}\b(to|on|via|through)\b|\bsend (an? )?(email|message|issue)\b/i },
  { capability: 'scheduling', re: /\b(every day|daily|weekly|schedule|recurring|remind me|each morning|every hour)\b/i },
  { capability: 'writing', re: /\b(write|draft|compose|essay|blog|article|report|document|story|letter)\b/i },
  { capability: 'knowledge-recall', re: /\b(from my books|from the book|library|documents?|pdf|uploaded)\b/i },
  { capability: 'security-audit', re: /\b(security|vulnerab|exploit|penetration|threat|owasp|secure)\b/i },
  { capability: 'deploy', re: /\b(deploy|docker|kubernetes|ci\/cd|pipeline|infrastructure|terraform|hosting)\b/i },
  { capability: 'verification', re: /\b(verify|prove|check (?:that|if)|make sure|confirm)\b/i },
];

function canonicalizeCapability(raw) {
  const c = String(raw || '').trim().toLowerCase();
  if (!c) return null;
  if (c.startsWith('dept:')) return c; // departmental families pass through
  return CAPABILITY_SYNONYMS[c] || c;
}

/**
 * Derive the required capabilities for an objective.
 * @param {string} objective
 * @param {{requiredCapabilities?: string[]}} [interpreted] — B215 structured state
 * @returns {{ capabilities: string[], provenance: Record<string, 'INTERPRETER'|'INFERRED'> }}
 */
export function requiredCapabilities(objective, interpreted) {
  const caps = [];
  const provenance = {};
  const seen = new Set();
  const add = (cap, prov) => {
    if (!cap || seen.has(cap)) return;
    seen.add(cap);
    caps.push(cap);
    provenance[cap] = prov;
  };

  // 1) interpreter-derived (from the subtasks the plan actually calls for)
  for (const raw of (interpreted && interpreted.requiredCapabilities) || []) {
    const cap = canonicalizeCapability(raw);
    // keep unknown-but-explicit interpreter capabilities: they still map by
    // string against tool capabilities below (honest passthrough)
    add(cap || String(raw).toLowerCase(), 'INTERPRETER');
  }
  // 2) keyword families on the objective text
  for (const h of OBJECTIVE_HINTS) {
    if (h.re.test(String(objective || ''))) add(h.capability, 'INFERRED');
  }
  return { capabilities: caps, provenance };
}

/* ── 3. The discovery pass ───────────────────────────────────────────── */

/**
 * Objective → capability → tool discovery with risk/verification metadata.
 * Pure function. No LLM calls. Additive metadata — never replaces the
 * per-team injection, the B52 allowlist or the B209 permission gate.
 *
 * @param {{ objective: string, intent?: string, team?: (string|{slug:string})[],
 *           interpreted?: {requiredCapabilities?: string[]} }} input
 */
export function discoverTools({ objective, intent = null, team = null, interpreted = null } = {}) {
  const { capabilities: reqCaps, provenance } = requiredCapabilities(objective, interpreted);

  // capability → providing tools (from the derivation rules)
  const toolsByCapability = new Map();
  for (const tool of TOOL_REGISTRY) {
    for (const cap of capabilitiesForTool(tool)) {
      if (!toolsByCapability.has(cap)) toolsByCapability.set(cap, []);
      toolsByCapability.get(cap).push(tool);
    }
  }

  const teamBaseline = (team ? toolsForTeam(team) : []).map((t) => t.slug);
  const baselineSet = new Set(teamBaseline);

  // match: every required capability → its providing tools (allowlist-filtered)
  const matches = new Map(); // slug -> { tool, matched: Set<cap> }
  const gaps = [];
  const blocked = [];
  for (const cap of reqCaps) {
    if (cap.startsWith('dept:')) continue; // departments organize PEOPLE, not tools — never a tool gap
    const providers = toolsByCapability.get(cap) || [];
    if (providers.length === 0) {
      gaps.push({ capability: cap, reason: 'no tool in the registry provides this capability', provenance: provenance[cap] });
      continue;
    }
    let offered = 0;
    for (const tool of providers) {
      const gate = enforceToolAllowlist(intent, tool.slug);
      if (!gate.allowed) continue;
      offered++;
      if (!matches.has(tool.slug)) matches.set(tool.slug, { tool, matched: new Set() });
      matches.get(tool.slug).matched.add(cap);
    }
    if (offered === 0 && providers.length > 0) {
      blocked.push({ capability: cap, reason: `tools exist but the ${intent} allowlist (B52 P4) withholds them for this intent`, provenance: provenance[cap] });
    }
  }

  // AutoTool-style pruning: small, relevant subset — never the whole catalog.
  const MAX_TOOLS = 12;
  const tools = [...matches.values()]
    .map(({ tool, matched }) => ({
      slug: tool.slug,
      name: tool.name,
      type: tool.type,
      matchedCapabilities: [...matched],
      risk: riskForTool(tool),
      verification: { kind: VERIFICATION_KIND[tool.slug] || null }, // null = generative, honestly unverifiable
      why: `${[...matched].join(', ')} — ${tool.desc}`,
    }))
    .sort((a, b) => {
      // matched count first; then tools covering INTERPRETER-derived capabilities
      // (the plan actually calls for them) over keyword-INFERRED ones; then stable alpha
      const w = (t) => t.matchedCapabilities.filter((c) => provenance[c] === 'INTERPRETER').length;
      return b.matchedCapabilities.length - a.matchedCapabilities.length || w(b) - w(a) || a.slug.localeCompare(b.slug);
    })
    .slice(0, MAX_TOOLS);

  return {
    objective: String(objective || '').slice(0, 400),
    requiredCapabilities: reqCaps,
    capabilityProvenance: provenance,
    tools,
    teamBaseline,
    addedForObjective: tools.map((t) => t.slug).filter((s) => !baselineSet.has(s)),
    gaps,
    blockedByAllowlist: blocked,
    meta: {
      toolCount: tools.length,
      capabilityCount: reqCaps.length,
      gapCount: gaps.length + blocked.length,
      deterministic: true, // no LLM calls — same input, same output
    },
  };
}
