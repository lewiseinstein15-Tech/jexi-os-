/**
 * JEXI OS — capability registry — the four-state model.
 *
 * The mission this implements: a runtime that can tell the difference between
 *
 *   exists       — the capability is described in the catalog and at least one
 *                  provider for it resolves to a real tool
 *   registered   — that provider tool is actually in a registry the runtime
 *                  dispatches through (native registry / domain engine /
 *                  plugin / MCP directory)
 *   available    — it can run RIGHT NOW: an engine is attached, the active
 *                  permission profile permits it, and (for MCP) the server is
 *                  connected or known to the directory
 *   succeeded    — it has actually produced a successful, non-refused result
 *                  in this session (from the outcome ledger)
 *
 * The old runtime had exactly one of these — "registered" — and conflated it
 * with "the model may use it". That is why JEXI could truthfully claim a
 * capability existed while being unable to use it, and why the answer to "can
 * you search the web?" depended on the classifier rather than on the runtime.
 *
 * Every state is computed from live runtime sources. Nothing is hard-coded, and
 * a capability with no working provider reports `available: false` with the
 * reason, rather than an optimistic `true`.
 */
import { CAPABILITIES, getCapability } from './catalog.js';
import { resolveToolDef, toolHasEngine, activeToolProfile, TOOL_PROFILES } from '../../services/ToolRuntime.js';
import { getTool as getRegisteredTool } from '../../tools/registry/ToolRegistry.js';
import { loadToolDirectory, mcpServerHealth } from '../../services/MCPGateway.js';
import { succeededCapabilities, recordOutcome as _recordOutcome } from './ledger.js';

/** The four states, in order of increasing strength. */
export const STATES = Object.freeze({
  EXISTS: 'exists',
  REGISTERED: 'registered',
  AVAILABLE: 'available',
  SUCCEEDED: 'succeeded',
});

export const STATE_ORDER = [STATES.EXISTS, STATES.REGISTERED, STATES.AVAILABLE, STATES.SUCCEEDED];

/** Why a capability is not available. Explicit beats a silent boolean. */
export const REASONS = Object.freeze({
  NOT_IN_CATALOG: 'not_in_catalog',
  NOT_REGISTERED: 'not_registered',
  NO_ENGINE: 'no_engine',
  SERVER_OFFLINE: 'server_offline',
  PERMISSION_DENIED: 'permission_denied',
  NEVER_INVOKED: 'never_invoked',
  OK: 'ok',
});

/** rank(state) → index, so callers can compare ("is it at least available?"). */
export function stateRank(state) {
  const i = STATE_ORDER.indexOf(String(state));
  return i < 0 ? -1 : i;
}

export function atLeast(state, floor) {
  return stateRank(state) >= stateRank(floor);
}

/* ── live runtime sources (memoised per call, never cached across calls) ──── */

/* Bootstrapping the domain registry.
 *
 * `resolveToolDef` / `toolHasEngine` can only see `fs_read`, `term_execute` and
 * friends once the domain registry exists, and it is registered lazily by the
 * first dispatch. A capability check that runs BEFORE any dispatch would
 * therefore report every domain capability unavailable — a false negative of
 * exactly the kind this registry exists to prevent. Prime it explicitly.
 *
 * The import is dynamic because `tools/domains/executor.js` imports
 * `tools/index.js`, which would otherwise close a static ESM cycle. */
let _primed = false;

export async function primeCapabilities() {
  if (_primed) return true;
  try {
    const { domainExecutor } = await import('../../tools/domains/executor.js');
    domainExecutor();
    _primed = true;
  } catch { /* domains unavailable — availability is then reported honestly */ }
  return _primed;
}

function mcpSnapshot() {
  let directory = {};
  const live = new Set();
  try { directory = loadToolDirectory() || {}; } catch { directory = {}; }
  try {
    for (const h of mcpServerHealth()) {
      if (h && h.status === 'connected') live.add(h.name);
    }
  } catch { /* health is best-effort; directory is the fallback */ }
  return { directory, live };
}

/** Profile → the risk tiers it permits (mirrors tools/domains/executor.js). */
const PROFILE_TIERS = {
  readonly: ['safe'],
  auto: ['safe', 'medium'],
  coding: ['safe', 'medium'],
  full: ['safe', 'medium', 'risky'],
};
const RISK_TO_TIER = { low: 'safe', medium: 'medium', high: 'risky', critical: 'risky' };

/**
 * The real risk level of a tool.
 *
 * `resolveToolDef` returns a probe stub WITHOUT `riskLevel` for domain tools
 * (ToolRuntime.resolveToolDef line ~505 builds `{slug,name,desc,permission}`).
 * Defaulting that to 'medium' silently denies every safe domain tool under the
 * readonly profile — measured: `fs_read` (declared `riskLevel: 'low'`) was
 * reported unavailable to a read-only session, which is the same class of
 * dishonest claim this registry exists to prevent, in the other direction.
 *
 * Read the definition the domain executor actually gates on instead.
 */
function riskLevelOf(slug) {
  try {
    const d = getRegisteredTool(slug);
    if (d?.riskLevel) return d.riskLevel;
  } catch { /* registry unavailable — fall through */ }
  return resolveToolDef(slug)?.riskLevel ?? 'medium';
}

/**
 * Compute the full state of one capability.
 *
 * @param {string} id
 * @param {object} [opts]
 * @param {string} [opts.profile]   override the active tool profile
 * @param {object} [opts.mcp]       pre-fetched { directory, live } snapshot
 * @param {Set<string>} [opts.succeeded] pre-fetched succeeded-capability set
 */
export function describeCapability(id, opts = {}) {
  const entry = getCapability(id);
  if (!entry) {
    return { id, state: null, exists: false, registered: false, available: false, succeeded: false, reason: REASONS.NOT_IN_CATALOG, providers: [] };
  }

  const profile = opts.profile || activeToolProfile();
  const tiers = PROFILE_TIERS[profile] || PROFILE_TIERS.auto;
  const mcp = opts.mcp || mcpSnapshot();
  const succeededSet = opts.succeeded || succeededCapabilities();

  const providers = [];
  let anyExists = false;
  let anyRegistered = false;
  let anyAvailable = false;
  const reasons = new Set();

  for (const p of entry.providers) {
    const rec = { ...p, exists: false, registered: false, available: false };

    if (p.tool) {
      const def = resolveToolDef(p.tool);
      rec.exists = Boolean(def);
      rec.registered = rec.exists;
      rec.hasEngine = toolHasEngine(p.tool);
      const tier = RISK_TO_TIER[riskLevelOf(p.tool)];
      rec.tier = tier;
      rec.permitted = tiers.includes(tier);
      rec.available = rec.registered && rec.hasEngine && rec.permitted;
      if (!rec.registered) reasons.add(REASONS.NOT_REGISTERED);
      else if (!rec.hasEngine) reasons.add(REASONS.NO_ENGINE);
      else if (!rec.permitted) reasons.add(REASONS.PERMISSION_DENIED);
    } else if (p.mcpServer) {
      const dirEntry = mcp.directory[p.mcpServer];
      const known = Boolean(dirEntry && Array.isArray(dirEntry.tools) && dirEntry.tools.length);
      rec.exists = known || mcp.live.has(p.mcpServer);
      rec.registered = rec.exists;
      rec.connected = mcp.live.has(p.mcpServer);
      rec.toolCount = known ? dirEntry.tools.length : 0;
      // A sleeping server wakes on first call, so "known to the directory"
      // counts as available; only an unknown server is offline.
      rec.available = rec.exists;
      if (!rec.exists) reasons.add(REASONS.SERVER_OFFLINE);
    }

    if (rec.exists) anyExists = true;
    if (rec.registered) anyRegistered = true;
    if (rec.available) anyAvailable = true;
    providers.push(rec);
  }

  const succeeded = succeededSet.has(id);
  // `state` is the strongest claim the registry can make, and it is derived
  // from the providers rather than asserted.
  const state = succeeded ? STATES.SUCCEEDED
    : anyAvailable ? STATES.AVAILABLE
      : anyRegistered ? STATES.REGISTERED
        : anyExists ? STATES.EXISTS
          : null;

  const reason = anyAvailable ? REASONS.OK
    : (reasons.size ? [...reasons].sort()[0] : REASONS.NOT_IN_CATALOG);

  return {
    id,
    title: entry.title,
    whenToUse: entry.whenToUse,
    state,
    exists: anyExists,
    registered: anyRegistered,
    available: anyAvailable,
    succeeded,
    reason,
    reasons: [...reasons].sort(),
    profile,
    providers,
  };
}

/** Every capability, fully described. Primes the domain registry first. */
export async function listCapabilityStatesAsync(opts = {}) {
  await primeCapabilities();
  return listCapabilityStates(opts);
}

/** Every capability, fully described. */
export function listCapabilityStates(opts = {}) {
  const mcp = opts.mcp || mcpSnapshot();
  const succeeded = opts.succeeded || succeededCapabilities();
  return CAPABILITIES.map((c) => describeCapability(c.id, { ...opts, mcp, succeeded }));
}

/**
 * The tool slugs a capability would contribute, restricted to those actually
 * available. This is what the tool-set builder merges in, so the model is
 * never handed a slug that cannot run.
 */
export function availableToolsFor(id, opts = {}) {
  const d = describeCapability(id, opts);
  if (!d.available) return [];
  return d.providers.filter((p) => p.available && p.tool).map((p) => p.tool);
}

/** Summarise availability for diagnostics and the "can you X?" answer. */
export function capabilitySummary(opts = {}) {
  const all = listCapabilityStates(opts);
  const byState = { exists: 0, registered: 0, available: 0, succeeded: 0, unavailable: 0 };
  for (const c of all) {
    if (!c.exists) byState.unavailable += 1;
    else if (c.state === STATES.SUCCEEDED) byState.succeeded += 1;
    else if (c.state === STATES.AVAILABLE) byState.available += 1;
    else if (c.state === STATES.REGISTERED) byState.registered += 1;
    else byState.exists += 1;
  }
  return {
    total: all.length,
    ...byState,
    profile: all[0]?.profile ?? null,
    capabilities: all,
  };
}

/** Async summary that primes the domain registry first (preferred in app code). */
export async function capabilitySummaryAsync(opts = {}) {
  await primeCapabilities();
  return capabilitySummary(opts);
}

/** Record that a capability succeeded (thin re-export for one import site). */
export { _recordOutcome as recordOutcome };
