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
import { makeRiskGuard } from '../../tools/execution/risk-guard.js';
import { detectSandboxBackends } from '../../services/Sandbox.js';

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
  RUNTIME_RING: 'runtime_ring',      // blocked by the execution ring, not the profile
  NEVER_INVOKED: 'never_invoked',
  UNKNOWN: 'unknown',                // reachability could not be established
  OK: 'ok',
});

/**
 * The execution ring the active runtime enforces.
 *
 * Mirrors `ringForBackend()` in `tools/domains/executor.js` so the capability
 * report and the executor cannot drift: docker OR namespaces ⇒ `container`,
 * nothing enforced ⇒ `host`. This is a *report* of the guard's input — it does
 * not change what the guard allows. Callers may inject `opts.sandboxRing` to
 * make the result deterministic in tests.
 */
export function resolveSandboxRing() {
  try {
    const caps = detectSandboxBackends();
    if (caps?.docker?.available) return 'container';
    if (caps?.namespaces) return 'container';
    return 'host';
  } catch {
    return 'container'; // the guard's own default when detection is unavailable
  }
}

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
  /* Phase 2A — the execution ring is a SEPARATE gate from the profile. Before
     this, `available` was `registered && hasEngine && permitted` and never
     consulted the guard, so a ring-2 tool (term_execute, git_status…) reported
     `available: true` while the executor refused it at the container ring. */
  const sandboxRing = opts.sandboxRing || resolveSandboxRing();
  const guard = makeRiskGuard({ sandboxRing });

  const providers = [];
  let anyExists = false;
  let anyRegistered = false;
  let anyReachable = false;   // registered && engine && permitted — the OLD `available`
  let anyExecutable = false;  // reachable && the guard allows it (ring + sideEffects)
  const reasons = new Set();

  for (const p of entry.providers) {
    const rec = { ...p, exists: false, registered: false, reachable: false, executable: false, available: false };

    if (p.tool) {
      const def = resolveToolDef(p.tool);
      const regDef = getRegisteredTool(p.tool); // carries runtimeRing / sideEffects / riskLevel
      rec.exists = Boolean(def);
      rec.registered = rec.exists;
      rec.hasEngine = toolHasEngine(p.tool);
      const tier = RISK_TO_TIER[riskLevelOf(p.tool)];
      rec.tier = tier;
      rec.permitted = tiers.includes(tier);
      rec.reachable = rec.registered && rec.hasEngine && rec.permitted;
      // Executability runs the SAME guard the executor runs — no second policy.
      const ringCheck = regDef ? guard.check(regDef) : { allowed: false };
      rec.ringAllowed = ringCheck.allowed;
      rec.executable = rec.reachable && ringCheck.allowed;
      rec.available = rec.executable;

      const blockedBy = [];
      if (!rec.registered) blockedBy.push(REASONS.NOT_REGISTERED);
      else if (!rec.hasEngine) blockedBy.push(REASONS.NO_ENGINE);
      else if (!rec.permitted) blockedBy.push(REASONS.PERMISSION_DENIED);
      else if (!ringCheck.allowed) blockedBy.push(REASONS.RUNTIME_RING);
      rec.blockedBy = blockedBy;
      for (const b of blockedBy) reasons.add(b);
    } else if (p.mcpServer) {
      const dirEntry = mcp.directory[p.mcpServer];
      const known = Boolean(dirEntry && Array.isArray(dirEntry.tools) && dirEntry.tools.length);
      rec.exists = known || mcp.live.has(p.mcpServer);
      rec.registered = rec.exists;
      rec.connected = mcp.live.has(p.mcpServer);
      rec.toolCount = known ? dirEntry.tools.length : 0;
      /* An MCP tool runs inside its own server process, outside this sandbox
         ring, so the ring guard does not apply to it. Reachability is NOT
         probed here (that would be an unreviewed external call), so it is
         marked unprobed rather than claimed as verified. */
      rec.probed = false;
      rec.reachable = rec.exists;
      rec.executable = rec.exists;
      rec.available = rec.executable;
      rec.blockedBy = rec.exists ? [] : [REASONS.SERVER_OFFLINE];
      if (!rec.exists) reasons.add(REASONS.SERVER_OFFLINE);
    }

    if (rec.exists) anyExists = true;
    if (rec.registered) anyRegistered = true;
    if (rec.reachable) anyReachable = true;
    if (rec.executable) anyExecutable = true;
    providers.push(rec);
  }

  const toolProvs = providers.filter((p) => p.tool);
  const succeeded = succeededSet.has(id);
  const discoverable = anyExists || anyRegistered;
  const permitted = toolProvs.length ? toolProvs.some((p) => p.permitted) : anyExists;
  // The ring allows the capability when at least one provider passes the ring
  // gate (a profile denial is reported separately, so the two never blur).
  const ringAllowed = providers.some((p) => (p.tool ? p.ringAllowed : true));
  const blockedBy = [...new Set(providers.flatMap((p) => p.blockedBy || []))].sort();

  // `state` is the strongest claim the registry can make, derived from the
  // providers. Reachable-but-not-executable is only a REGISTERED claim.
  const state = succeeded ? STATES.SUCCEEDED
    : anyExecutable ? STATES.AVAILABLE
      : anyRegistered ? STATES.REGISTERED
        : anyExists ? STATES.EXISTS
          : null;

  const reason = anyExecutable ? REASONS.OK
    : (reasons.size ? [...reasons].sort()[0] : REASONS.NOT_IN_CATALOG);

  return {
    id,
    title: entry.title,
    whenToUse: entry.whenToUse,
    state,
    exists: anyExists,
    registered: anyRegistered,
    discoverable,
    permitted,
    reachable: anyReachable,
    executable: anyExecutable,
    // DEPRECATED alias. Historically it meant "registered + engine + profile
    // permits". It now equals `executable`, so a capability the active runtime
    // guard blocks can never be reported `available: true` again. Prefer the
    // explicit fields above.
    available: anyExecutable,
    succeeded,
    reason,
    reasons: [...reasons].sort(),
    blockedBy,
    ringAllowed,
    sandboxRing,
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
 * The tool slugs a capability would contribute, restricted to those the runtime
 * can actually REACH (registered + engine + profile permits).
 *
 * This is what the tool-set builder merges in, so the model is never handed a
 * slug that cannot run. It deliberately uses `reachable`, not `executable`:
 * reachability is the same predicate this function always used, so tool
 * offering is unchanged. Whether the ring lets the tool EXECUTE is surfaced
 * separately by `blockedBy` / the ledger, not by silently dropping the slug.
 */
export function availableToolsFor(id, opts = {}) {
  const d = describeCapability(id, opts);
  if (!d.reachable) return [];
  return d.providers.filter((p) => p.reachable && p.tool).map((p) => p.tool);
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
    // Phase 2A — the honest split. `executable` = the runtime guard permits it
    // right now; `ringBlocked` = registered and reachable but refused by the
    // execution ring. `available` (above) is the deprecated alias for the
    // SUCCEEDED-or-executable bucket and equals `executable` here.
    executable: all.filter((c) => c.executable).length,
    ringBlocked: all.filter((c) => c.registered && c.blockedBy.includes(REASONS.RUNTIME_RING)).length,
    sandboxRing: all[0]?.sandboxRing ?? null,
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
