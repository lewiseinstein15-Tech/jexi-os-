/**
 * JEXI OS — Agent Definitions + Professional Agent Contracts (B50 P4, M3).
 *
 * Reusable, on-disk agent definition files under server/agents/ — the
 * "reusable agents" primitive: a definition file (frontmatter: the
 * machine-readable CONTRACT; body: the specialist system prompt) that any
 * runtime can load and spawn. A definition can declare `context: fork`,
 * meaning it runs isolated and returns only a summary.
 *
 * CONTRACT SCHEMA (frontmatter, flat keys; lists use [a, b, c] form):
 *
 *   REQUIRED — the runtime refuses to spawn without these:
 *     name            agent identity (kebab-case)
 *     mission         one-paragraph mission: what this agent exists to do
 *     allowed-tools   non-empty tool-slug allowlist (validated vs registry)
 *     delivers        expected outputs (what the parent receives)
 *     completion      completion criteria (how DONE is recognized)
 *
 *   RECOMMENDED — missing entries produce warnings, not refusal:
 *     expertise       capability areas
 *     scope           what is in/out of scope for this agent
 *     activates-when  activation conditions (when to spawn it)
 *     requires        required inputs from the parent brief
 *     evidence        evidence the agent must attach to its report
 *     quality-gates   checks the report must pass before it ships
 *     recovery        recovery strategy when its tools fail
 *     escalate-when   escalation conditions (when to stop and ask)
 *
 *   OPTIONAL:
 *     description     short human description (defaults to mission)
 *     model           model preference (default|fast|strong|<provider/model>)
 *     context         fork = isolated execution, summary-only return
 *     workflow        ordered procedure (steps separated by " > ")
 *     failure-modes   known failure modes to watch for
 *     never-when      explicit non-activation conditions
 *     memory          memory policy (what to read/write)
 *     contract        contract schema version (current: 1)
 *
 * Unknown keys produce warnings (typo detection) — never silent.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AGENTS_DIR = path.resolve(__dirname, '../../agents');

export const CONTRACT_VERSION = 1;
export const MIN_PROMPT_CHARS = 200; // bodies shorter than this are shallow, not professional

const REQUIRED_FIELDS = ['name', 'mission', 'allowed-tools', 'delivers', 'completion'];
const LIST_FIELDS = new Set(['allowed-tools', 'expertise', 'requires', 'evidence', 'quality-gates', 'failure-modes']);
const KNOWN_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  'expertise', 'scope', 'activates-when', 'requires', 'evidence', 'quality-gates',
  'recovery', 'escalate-when', 'description', 'model', 'context', 'workflow',
  'failure-modes', 'never-when', 'memory', 'contract',
]);
const RECOMMENDED_FIELDS = ['expertise', 'scope', 'activates-when', 'requires', 'evidence', 'quality-gates', 'recovery', 'escalate-when'];

/** Parse YAML frontmatter (---\nkey: value\n---) from an agent definition. */
export function parseAgentFrontmatter(md) {
  const m = String(md || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (!kv) continue;
    const val = kv[2].trim();
    meta[kv[1]] = val.startsWith('[')
      ? val.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      : val;
  }
  return meta;
}

/** List available agent definition slugs (server/agents/*.md). */
export function listAgentDefinitions() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

/** Load an agent definition by slug → { slug, meta, systemPrompt }. Null if absent. */
export function loadAgentDefinition(slug) {
  const safe = String(slug || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  const p = path.join(AGENTS_DIR, `${safe}.md`);
  if (!fs.existsSync(p)) return null;
  const md = fs.readFileSync(p, 'utf-8');
  const meta = parseAgentFrontmatter(md);
  const systemPrompt = String(md).replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
  return { slug: safe, meta, systemPrompt };
}

/**
 * Validate an agent contract. Returns { ok, errors[], warnings[] }.
 * `opts.toolSlugs` (array) enables allowlist-vs-registry validation.
 */
export function validateAgentContract(def, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!def || typeof def !== 'object') return { ok: false, errors: ['no definition provided'], warnings };
  const meta = (def.meta && typeof def.meta === 'object') ? def.meta : {};
  const slug = def.slug || meta.name || '?';

  for (const f of REQUIRED_FIELDS) {
    const v = meta[f];
    const empty = v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
    if (empty) errors.push(`${slug}: required contract field "${f}" is missing or empty`);
  }
  if (meta.name && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(meta.name))) {
    errors.push(`${slug}: "name" must be kebab-case (got "${meta.name}")`);
  }
  if (meta.name && def.slug && meta.name !== def.slug) {
    warnings.push(`${slug}: "name" (${meta.name}) differs from the file slug — keep them identical`);
  }
  for (const f of LIST_FIELDS) {
    if (meta[f] != null && !Array.isArray(meta[f])) {
      errors.push(`${slug}: "${f}" must use the [a, b, c] list form`);
    }
  }
  if (meta['allowed-tools'] != null && Array.isArray(meta['allowed-tools']) && !meta['allowed-tools'].length) {
    errors.push(`${slug}: "allowed-tools" must not be empty — an agent with no tools cannot do verifiable work`);
  }
  if (Array.isArray(opts.toolSlugs) && opts.toolSlugs.length && Array.isArray(meta['allowed-tools'])) {
    const known = new Set(opts.toolSlugs);
    for (const t of meta['allowed-tools']) {
      if (!known.has(t)) errors.push(`${slug}: unknown tool slug "${t}" in allowed-tools`);
    }
  }
  if (meta.context != null && !['fork', 'share', ''].includes(String(meta.context).toLowerCase())) {
    warnings.push(`${slug}: "context" should be "fork" or "share" (got "${meta.context}")`);
  }
  if (meta.contract != null && String(meta.contract) !== String(CONTRACT_VERSION)) {
    warnings.push(`${slug}: contract version "${meta.contract}" differs from current (${CONTRACT_VERSION})`);
  }
  for (const key of Object.keys(meta)) {
    if (!KNOWN_FIELDS.has(key)) warnings.push(`${slug}: unknown contract field "${key}" (typo?)`);
  }
  for (const f of RECOMMENDED_FIELDS) {
    if (meta[f] == null || meta[f] === '' || (Array.isArray(meta[f]) && !meta[f].length)) {
      warnings.push(`${slug}: recommended contract field "${f}" is missing`);
    }
  }
  const promptLen = String(def.systemPrompt || '').trim().length;
  if (promptLen < MIN_PROMPT_CHARS) {
    errors.push(`${slug}: system prompt is ${promptLen} chars — below the ${MIN_PROMPT_CHARS}-char professional floor (shallow agents are refused)`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Load + validate in one step.
 * Returns { def, validation } or { def: null, validation } when absent.
 */
export function loadValidatedAgentDefinition(slug, opts = {}) {
  const def = loadAgentDefinition(slug);
  if (!def) {
    return { def: null, validation: { ok: false, errors: [`no agent definition "${slug}"`], warnings: [] } };
  }
  return { def, validation: validateAgentContract(def, opts) };
}

/** Does a definition (or skill frontmatter) declare isolated execution? */
export function wantsIsolation(def) {
  return !!(def && def.meta && String(def.meta.context || '').toLowerCase() === 'fork');
}

/** Resolve the allowed-tools list from a definition, else []. */
export function allowedToolsFor(def) {
  const t = def && def.meta && def.meta['allowed-tools'];
  return Array.isArray(t) ? t : [];
}

/** Compact contract card for APIs/dashboards (no prompt body). */export function contractSummary(def, validation = null) {
  if (!def) return null;
  const meta = def.meta || {};
  return {
    slug: def.slug,
    name: meta.name || def.slug,
    mission: meta.mission || meta.description || '',
    model: meta.model || 'default',
    isolated: wantsIsolation(def),
    tools: allowedToolsFor(def),
    requires: meta.requires || [],
    delivers: meta.delivers || '',
    completion: meta.completion || '',
    valid: validation ? !!validation.ok : null,
    errors: validation ? validation.errors : undefined,
    warnings: validation ? validation.warnings : undefined,
  };
}

/**
 * Validate EVERY on-disk definition. Returns:
 *   { valid, count, agents: [{ slug, ok, errors[], warnings[] }],
 *     errors: [{ agent, issues[] }], warnings: [{ agent, issues[] }] }
 * `opts.toolSlugs` enables allowlist-vs-registry validation.
 */
export function validateAllAgentContracts(opts = {}) {
  const agents = listAgentDefinitions().map((slug) => {
    const { def, validation } = loadValidatedAgentDefinition(slug, opts);
    return {
      slug,
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      summary: def ? contractSummary(def, validation) : null,
    };
  });
  return {
    valid: agents.every((a) => a.ok),
    count: agents.length,
    agents,
    errors: agents.filter((a) => a.errors.length).map((a) => ({ agent: a.slug, issues: a.errors })),
    warnings: agents.filter((a) => a.warnings.length).map((a) => ({ agent: a.slug, issues: a.warnings })),
  };
}
