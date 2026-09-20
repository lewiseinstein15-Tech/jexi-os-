// prompt/tools/descriptions.js
// Tool description block renderer (Phase 25, Scope D).
//
// Renders the runtime tool surface into the prompt as markdown, under a
// strict budget. Real agent prompts spend the majority of their tokens
// here, so this module is deliberately mechanical: it renders EXACTLY
// the definition it was given — no rewording, no eliding, no
// truncation mid-tool. Tools are atomic: fully rendered or dropped
// (with a reported reason).
//
// Data flow (production): the real domains (server/src/tools/domains/**,
// Phase 5 — 12 domains; tools/domains/lsp/**, Phase 11 — 15 CBM tools)
// register ToolDefinitions into the real ToolRegistry
// (server/src/tools/registry/ToolRegistry.js). loadToolRegistry() then
// mirrors those definitions into a prompt-side catalog. This module
// never imports server code — it depends on the ToolDefinition SHAPE
// only ({ name, description, parameters, returns, riskLevel, ... }),
// keeping prompt/** zero-dependency and the zone boundary clean.
//
// Contract (exported through index.js as the `tools` namespace):
//   tools.render(toolIds, opts)   -> { block, toolCount, charCount, dropped }
//   tools.budget(block, budget)   -> (budget.js)
//   tools.select(agentSpec, budget) -> { toolIds, dropped }
//
// Block format (markdown, one stanza per tool):
//   ### <tool_slug>
//   <one-line description>
//   - **params**: `name: type` (required|optional) — <param description>?
//   - **returns**: <one-line>
//   - **risk**: <low|medium|high|critical>
//
// Determinism: same inputs -> byte-identical block. Ordering is
// canonical (explicit priority DESC, then tool id ASC by code unit —
// localeCompare is banned because it is locale-dependent). No clocks,
// no randomness, no iteration-order dependence anywhere.

import { PromptError, isPromptError } from '../assembly/errors.js';
import { toolBudgetChars } from './budget.js';

export { PromptError, isPromptError };

const TOOL_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Collapse any whitespace run to a single space (one-line contract). */
function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Deterministic code-unit comparison — never localeCompare. */
function byIdAsc(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalize JSON-Schema `parameters` into a param list:
 * [{ name, type, required, description? }], schema declaration order
 * preserved (the declaration order is part of the input, so preserving
 * it is deterministic).
 */
function normalizeParams(parameters, id) {
  if (parameters === undefined) return [];
  if (!isPlainObject(parameters) || parameters.type !== 'object') {
    throw new PromptError('E_INVALID_TOOL', 'parameters must be a JSON Schema object with type "object"', { id });
  }
  const { properties, required } = parameters;
  if (properties !== undefined && !isPlainObject(properties)) {
    throw new PromptError('E_INVALID_TOOL', 'parameters.properties must be a plain object', { id });
  }
  if (required !== undefined && (!Array.isArray(required) || required.some((r) => typeof r !== 'string'))) {
    throw new PromptError('E_INVALID_TOOL', 'parameters.required must be an array of strings', { id });
  }
  const requiredSet = new Set(required ?? []);
  return Object.freeze(
    Object.entries(properties ?? {}).map(([name, schema]) =>
      Object.freeze({
        name,
        type: typeof schema?.type === 'string' ? schema.type : 'any',
        required: requiredSet.has(name),
        ...(typeof schema?.description === 'string' && schema.description.trim() !== ''
          ? { description: oneLine(schema.description) }
          : {}),
      }),
    ),
  );
}

/**
 * Normalize a tool definition into a frozen prompt-side spec.
 * Accepts both real ToolDefinition fields (name, riskLevel, returns as
 * JSON-Schema-ish object) and direct prompt-spec fields (id, risk,
 * returns as string). `source` is optional provenance for audits —
 * it is bookkeeping metadata and never rendered into the block.
 */
function normalizeToolDef(def) {
  if (!isPlainObject(def)) {
    throw new PromptError('E_INVALID_TOOL', 'tool definition must be a plain object', { got: typeof def });
  }
  const id = def.id ?? def.name;
  if (typeof id !== 'string' || !TOOL_ID_PATTERN.test(id)) {
    throw new PromptError('E_INVALID_TOOL', `tool id must match ${TOOL_ID_PATTERN}`, { id: String(id) });
  }
  if (typeof def.description !== 'string' || def.description.trim() === '') {
    throw new PromptError('E_INVALID_TOOL', 'tool description must be a non-empty string', { id });
  }
  const risk = def.risk ?? def.riskLevel;
  if (!RISK_LEVELS.includes(risk)) {
    throw new PromptError('E_INVALID_TOOL', `tool risk must be one of ${RISK_LEVELS.join('|')}`, { id, risk: String(risk) });
  }
  const priority = def.priority ?? 0;
  if (typeof priority !== 'number' || !Number.isFinite(priority)) {
    throw new PromptError('E_INVALID_TOOL', 'tool priority must be a finite number', { id, priority: String(priority) });
  }
  let returns = 'unspecified';
  if (typeof def.returns === 'string' && def.returns.trim() !== '') {
    returns = oneLine(def.returns);
  } else if (isPlainObject(def.returns) && typeof def.returns.description === 'string' && def.returns.description.trim() !== '') {
    returns = oneLine(def.returns.description);
  }
  const spec = {
    id,
    description: oneLine(def.description),
    params: normalizeParams(def.parameters, id),
    returns,
    risk,
    priority,
    ...(typeof def.source === 'string' ? { source: def.source } : {}),
  };
  return Object.freeze({ ...spec, params: spec.params });
}

/**
 * Render ONE tool to its full markdown stanza (atomic unit).
 * Every stanza carries all four content lines — a tool is never
 * partially rendered.
 */
export function renderToolText(spec) {
  const parts = spec.params.map(
    (p) => `\`${p.name}: ${p.type}\` (${p.required ? 'required' : 'optional'})${p.description ? ` — ${p.description}` : ''}`,
  );
  return [
    `### ${spec.id}`,
    spec.description,
    `- **params**: ${parts.length > 0 ? parts.join(', ') : '(none)'}`,
    `- **returns**: ${spec.returns}`,
    `- **risk**: ${spec.risk}`,
  ].join('\n');
}

/**
 * Create an isolated tool catalog (probes/tests prefer this over the
 * shared defaultCatalog, mirroring Scope A's registry pattern).
 */
export function createToolCatalog() {
  const byId = new Map();

  function register(def) {
    const spec = normalizeToolDef(def);
    if (byId.has(spec.id)) {
      throw new PromptError('E_DUPLICATE_TOOL', `tool already registered: ${spec.id}`, { id: spec.id });
    }
    byId.set(spec.id, spec);
    return spec;
  }

  function registerAll(defs) {
    if (!Array.isArray(defs)) {
      throw new PromptError('E_INVALID_TOOL', 'registerAll expects an array of tool definitions', { got: typeof defs });
    }
    return defs.map(register);
  }

  function get(id) {
    return byId.get(id) ?? null;
  }
  function has(id) {
    return byId.has(id);
  }
  /** All registered ids, alphabetically sorted (deterministic). */
  function ids() {
    return [...byId.keys()].sort(byIdAsc);
  }
  /** All specs, id-sorted (deterministic). */
  function list() {
    return ids().map((id) => byId.get(id));
  }
  function size() {
    return byId.size;
  }
  function clear() {
    byId.clear();
  }

  return { register, registerAll, get, has, ids, list, size, clear };
}

/** Shared singleton — the app-level tool surface. Populated via loadToolRegistry. */
export const defaultCatalog = createToolCatalog();

/**
 * Mirror a real ToolRegistry-like source into a catalog.
 * Duck-typed: the source only needs listTools() -> [ToolDefinition].
 * This is the READ-ONLY bridge from server tool domains into the
 * prompt zone — no server file is modified by prompt code.
 * `source` stamps provenance onto every registered spec (audit only,
 * never rendered).
 */
export function loadToolRegistry(registryLike, { catalog = defaultCatalog, source = 'ToolRegistry' } = {}) {
  if (!isPlainObject(registryLike) || typeof registryLike.listTools !== 'function') {
    throw new PromptError('E_INVALID_REGISTRY', 'registryLike must expose listTools()', { got: typeof registryLike?.listTools });
  }
  const defs = registryLike.listTools();
  const registered = catalog.registerAll(defs.map((d) => ({ ...d, source })));
  return Object.freeze({ registered: registered.length, catalog });
}

/** Resolve a tool's effective priority: explicit opts override spec field. */
function priorityOf(id, spec, priorities) {
  if (priorities !== undefined) {
    const p = priorities[id];
    if (p !== undefined) return p;
  }
  return spec.priority;
}

/**
 * Canonical keep-order: explicit priority DESC, then id ASC (code-unit).
 * Stable sort + deterministic comparator => byte-identical output for
 * identical inputs, process after process.
 */
function keepOrder(entries, priorities) {
  return [...entries]
    .map((e) => ({ ...e, prio: priorityOf(e.spec.id, e.spec, priorities) }))
    .sort((a, b) => b.prio - a.prio || byIdAsc(a.spec.id, b.spec.id));
}

/**
 * Prefix-fit: find the longest prefix of ordered full-text stanzas whose
 * newline-joined block fits budgetChars. Everything past the prefix is
 * dropped — i.e. the LOWEST-PRIORITY tools (tail of the keep order) are
 * dropped first, atomically. dropped[] is reported in REMOVAL SEQUENCE
 * (lowest-priority tool first). Returns { kept, dropped }.
 */
function fitByBudget(ordered, budgetChars) {
  const kept = [];
  const dropped = [];
  let used = 0;
  for (let i = 0; i < ordered.length; i++) {
    const text = renderToolText(ordered[i].spec);
    const cost = used === 0 ? text.length : text.length + 1; // +1 joining newline
    if (used + cost <= budgetChars) {
      kept.push({ ...ordered[i], text });
      used += cost;
    } else {
      for (let j = ordered.length - 1; j >= i; j--) {
        dropped.push({ id: ordered[j].spec.id, reason: 'budget-exceeded' });
      }
      break;
    }
  }
  return { kept, dropped };
}

function validatePriorities(priorities, where) {
  if (priorities === undefined) return undefined;
  if (!isPlainObject(priorities)) {
    throw new PromptError('E_INVALID_PRIORITIES', `${where} must be a plain object of { toolId: number }`, { got: typeof priorities });
  }
  for (const [id, p] of Object.entries(priorities)) {
    if (typeof p !== 'number' || !Number.isFinite(p)) {
      throw new PromptError('E_INVALID_PRIORITIES', `${where}.${id} must be a finite number`, { id, got: String(p) });
    }
  }
  return priorities;
}

function validatePromptBudget(promptBudget) {
  if (typeof promptBudget !== 'number' || !Number.isFinite(promptBudget) || promptBudget <= 0) {
    throw new PromptError('E_INVALID_PROMPT_BUDGET', 'promptBudget must be a positive finite number', { got: promptBudget });
  }
  const budgetChars = toolBudgetChars(promptBudget);
  if (budgetChars < 1) {
    throw new PromptError('E_INVALID_PROMPT_BUDGET', `tool budget rounds to ${budgetChars} chars; increase promptBudget`, { promptBudget, budgetChars });
  }
  return budgetChars;
}

/**
 * Render the tool description block.
 *
 * tools.render(toolIds, opts) -> { block, toolCount, charCount, dropped }
 *   opts.promptBudget?: number  - enforce the 55% budget: drop
 *                                 lowest-priority tools atomically until fit
 *   opts.priorities?:  object   - { toolId: priority } overrides
 *   opts.agent?:       object   - { allowedTools: string[] } permission filter
 *   opts.catalog?:     object   - isolated catalog (tests); default: defaultCatalog
 *
 * Refusals (PromptError):
 *   E_INVALID_TOOL_IDS     - toolIds not an array of strings
 *   E_DUPLICATE_TOOL       - an id appears twice in toolIds
 *   E_UNKNOWN_TOOL         - an id is not in the catalog (thrown BEFORE
 *                            anything is rendered: no partial output, ever)
 *   E_INVALID_AGENT_SPEC   - agent/allowedTools malformed
 *   E_INVALID_PRIORITIES   - priorities malformed
 *   E_INVALID_PROMPT_BUDGET- promptBudget malformed
 *
 * dropped entries: { id, reason: 'not-permitted' | 'budget-exceeded' }.
 * not-permitted entries follow toolIds order; budget-exceeded entries
 * follow REMOVAL SEQUENCE (lowest-priority tool dropped first).
 * Dropped tools are always REPORTED — no silent loss.
 */
export function render(toolIds, opts = {}) {
  if (!Array.isArray(toolIds) || toolIds.some((id) => typeof id !== 'string')) {
    throw new PromptError('E_INVALID_TOOL_IDS', 'toolIds must be an array of strings', { got: typeof toolIds });
  }
  if (!isPlainObject(opts)) {
    throw new PromptError('E_INVALID_OPTS', 'opts must be a plain object', { got: typeof opts });
  }
  const catalog = opts.catalog ?? defaultCatalog;
  const dup = toolIds.find((id, i) => toolIds.indexOf(id) !== i);
  if (dup !== undefined) {
    throw new PromptError('E_DUPLICATE_TOOL', `tool requested twice: ${dup}`, { id: dup });
  }

  // Fail-loud gate BEFORE any rendering: unknown ids abort the whole
  // call (all-or-nothing — a missing tool is a caller bug, not a drop).
  const unknown = toolIds.filter((id) => !catalog.has(id));
  if (unknown.length > 0) {
    throw new PromptError('E_UNKNOWN_TOOL', `unknown tool(s): ${unknown.join(', ')}`, { unknown });
  }

  // Permission filter (Rule 1): agent.allowedTools, when provided,
  // restricts what may be rendered; the rest is dropped, not hidden.
  const dropped = [];
  let requested = toolIds;
  if (opts.agent !== undefined) {
    if (!isPlainObject(opts.agent)) {
      throw new PromptError('E_INVALID_AGENT_SPEC', 'agent must be a plain object', { got: typeof opts.agent });
    }
    if (opts.agent.allowedTools !== undefined) {
      const at = opts.agent.allowedTools;
      if (!Array.isArray(at) || at.some((id) => typeof id !== 'string')) {
        throw new PromptError('E_INVALID_AGENT_SPEC', 'agent.allowedTools must be an array of strings', { got: typeof at });
      }
      const allowed = new Set(at);
      requested = toolIds.filter((id) => allowed.has(id));
      for (const id of toolIds) {
        if (!allowed.has(id)) dropped.push({ id, reason: 'not-permitted' });
      }
    }
  }

  const priorities = validatePriorities(opts.priorities, 'priorities');
  const ordered = keepOrder(requested.map((id) => ({ spec: catalog.get(id) })), priorities);

  let kept;
  if (opts.promptBudget !== undefined) {
    const budgetChars = validatePromptBudget(opts.promptBudget);
    const fit = fitByBudget(ordered, budgetChars);
    kept = fit.kept;
    dropped.push(...fit.dropped);
  } else {
    kept = ordered.map((e) => ({ ...e, text: renderToolText(e.spec) }));
  }

  const block = kept.map((e) => e.text).join('\n');
  return Object.freeze({
    block,
    toolCount: kept.length,
    charCount: block.length,
    dropped: Object.freeze(dropped.map((d) => Object.freeze(d))),
  });
}

/**
 * Plan which tools fit an agent's prompt budget.
 *
 * tools.select(agentSpec, promptBudget) -> { toolIds, dropped }
 *   agentSpec.allowedTools?: string[] - candidate pool; when omitted the
 *                                       whole catalog is the pool
 *   agentSpec.priorities?:   object   - explicit priorities
 *   agentSpec.catalog?:      object   - isolated catalog (tests)
 *
 * Same keep-order and prefix-fit rules as render. Unlike render, ids in
 * allowedTools that are not in the catalog are REPORTED as dropped
 * ({ id, reason: 'unknown-tool' }) instead of thrown: select is a
 * planner over possibly-stale allow-lists, and the drop report satisfies
 * the no-silent-loss rule. render() stays fail-loud because it is the
 * final, exact render step.
 */
export function select(agentSpec, promptBudget) {
  if (agentSpec === undefined || agentSpec === null) agentSpec = {};
  if (!isPlainObject(agentSpec)) {
    throw new PromptError('E_INVALID_AGENT_SPEC', 'agentSpec must be a plain object', { got: typeof agentSpec });
  }
  const budgetChars = validatePromptBudget(promptBudget);
  const catalog = agentSpec.catalog ?? defaultCatalog;
  const priorities = validatePriorities(agentSpec.priorities, 'agentSpec.priorities');

  const dropped = [];
  let candidateIds;
  if (agentSpec.allowedTools !== undefined) {
    const at = agentSpec.allowedTools;
    if (!Array.isArray(at) || at.some((id) => typeof id !== 'string')) {
      throw new PromptError('E_INVALID_AGENT_SPEC', 'agentSpec.allowedTools must be an array of strings', { got: typeof at });
    }
    candidateIds = [...at];
  } else {
    candidateIds = catalog.ids();
  }

  const entries = [];
  for (const id of candidateIds) {
    const spec = catalog.get(id);
    if (!spec) {
      dropped.push({ id, reason: 'unknown-tool' });
      continue;
    }
    entries.push({ spec });
  }

  const ordered = keepOrder(entries, priorities);
  const fit = fitByBudget(ordered, budgetChars);
  dropped.push(...fit.dropped);

  return Object.freeze({
    toolIds: Object.freeze(fit.kept.map((e) => e.spec.id)),
    dropped: Object.freeze(dropped.map((d) => Object.freeze(d))),
  });
}
