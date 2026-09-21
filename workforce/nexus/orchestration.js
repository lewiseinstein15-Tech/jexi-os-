/**
 * JEXI OS — PHASE 13 SCOPE C — NEXUS ORCHESTRATION.
 *
 * Sits ABOVE the divisions: given an intent, decide which strategy governs it,
 * which division owns it, and which agent takes it — and say why, in words.
 *
 *   const nexus = createNexus();
 *   nexus.load();
 *   nexus.route({ kind: 'research', description: 'size the market' });
 *   // -> { strategy, division, agent, reason }
 *
 * Grounding rules, all enforced here:
 *
 *   - A route names its strategy EXPLICITLY, either by matching intent.kind to a
 *     strategy token or by the caller naming context.strategyId. There is no
 *     "closest" or "default" strategy.
 *   - No matching strategy            -> E_NO_STRATEGY
 *   - Strategy matched, no able agent -> E_NO_AGENT
 *   - context.strategyId that is not a known strategy -> E_UNKNOWN_STRATEGY
 *   Nothing falls back silently.
 *
 * Scope A (roster) and Scope B (divisions) are READ-ONLY here. A route never
 * assigns, never writes a file, and never mutates the registries it consults.
 *
 * Determinism: same intent + same roster + same divisions -> byte-identical
 * result. Strategies sort by id; candidates keep upstream order; the first able
 * candidate wins. No clocks, no randomness, no hashing of unordered sets.
 */

import {
  normalize, validate as validateStrategy, tokens, ERRORS, StrategyError,
} from './strategy.js';
import { loadProjection } from './docs.js';
import { createRegistry as createAgentRegistry } from '../agents/registry.js';
import { createDivisionRegistry } from '../divisions/registry.js';

/** Intent fields. kind and description are required; context is optional. */
export const INTENT_REQUIRED = ['kind', 'description'];

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

const norm = (s) => String(s).trim().toLowerCase();

/**
 * Validate an intent.
 *
 *   validate(intent) -> { valid, errors? }
 *
 * Requires intent.kind and intent.description; intent.context is optional. An
 * intent is a plain object — an array or a string is a malformed intent, not an
 * intent with missing fields.
 */
export function validateIntent(intent) {
  const errors = [];
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return {
      valid: false,
      errors: [{ code: ERRORS.INVALID_INTENT, field: null, message: 'intent must be an object' }],
    };
  }
  for (const field of INTENT_REQUIRED) {
    if (isBlank(intent[field])) {
      errors.push({ code: ERRORS.INVALID_INTENT, field, message: `intent.${field} must be a non-empty string` });
    }
  }
  if ('context' in intent && intent.context !== undefined && intent.context !== null
      && (typeof intent.context !== 'object' || Array.isArray(intent.context))) {
    errors.push({ code: ERRORS.INVALID_INTENT, field: 'context', message: 'intent.context must be an object when present' });
  }
  return errors.length ? { valid: false, errors } : { valid: true };
}

/**
 * Resolve an upstream agent reference to roster agents.
 *
 *   resolveReference(ref, agents) -> string[]   (roster ids, sorted)
 *
 * Upstream names agents by display name ("Frontend Developer") or by slug
 * ("engineering-frontend-developer"). Resolution tries, in order:
 *   1. exact roster id
 *   2. exact name, case-insensitive
 *   3. display name with spaces -> dashes, case-insensitive
 * Returns every match so the caller can refuse an ambiguous one rather than
 * pick by sort order. Empty array means the reference does not resolve.
 */
export function resolveReference(ref, agents) {
  const raw = String(ref || '').trim();
  if (!raw) return [];
  const ids = new Set();

  if (agents.has(raw)) ids.add(raw);

  const lower = norm(raw);
  const dashed = lower.replace(/\s+/g, '-');
  for (const spec of agents.agents) {
    if (norm(spec.name) === lower) ids.add(spec.id);
    else if (norm(spec.id) === dashed) ids.add(spec.id);
    else if (norm(spec.id) === lower) ids.add(spec.id);
  }
  return [...ids].sort();
}

/**
 * Build a nexus router.
 *
 *   createNexus({ root, agents, divisions }) -> nexus
 *
 * `agents` / `divisions` inject pre-built Scope A / Scope B registries (tests,
 * alternate roots). They are used READ-ONLY: orchestration never assigns an
 * agent or mutates a membership.
 */
export function createNexus(options = {}) {
  const state = {
    root: options.root,
    agents: options.agents || null,
    divisions: options.divisions || null,
    strategies: [],
    byId: new Map(),
    byToken: new Map(),
    provenance: null,
    loaded: false,
  };

  function index(strategies) {
    state.strategies = [...strategies].sort((a, b) => a.id.localeCompare(b.id));
    state.byId = new Map(state.strategies.map((s) => [s.id, s]));
    state.byToken = new Map();
    for (const s of state.strategies) {
      for (const token of tokens(s)) {
        const key = norm(token);
        if (!state.byToken.has(key)) state.byToken.set(key, []);
        state.byToken.get(key).push(s.id);
      }
    }
  }

  /**
   * Load the strategy projection and bind Scope A + Scope B.
   *
   *   load()          -> { strategies: [] }
   *   load(root)      -> { strategies: [] }   (overrides the root once)
   */
  function load(inputRoot) {
    const root = inputRoot || state.root;
    const projection = loadProjection(root);
    const strategies = [];
    for (const raw of projection.strategies) {
      const s = normalize(raw);
      const { valid } = validateStrategy(s);
      if (valid) strategies.push(s);
    }
    index(strategies);
    state.provenance = {
      source: projection.source,
      upstream: projection.upstream,
      upstreamCommit: projection.upstreamCommit,
      license: projection.license,
      aliasCollisions: projection.aliasCollisions,
    };

    if (!state.agents) state.agents = createAgentRegistry({ root });
    if (!state.divisions) state.divisions = createDivisionRegistry({ root, agents: state.agents });
    if (!state.agents.size) state.agents.load(root);
    if (!state.divisions.size) state.divisions.load(root);

    state.loaded = true;
    return { strategies: [...state.strategies] };
  }

  function ensureLoaded() {
    if (!state.loaded) load();
  }

  function refresh() {
    state.loaded = false;
    return load();
  }

  /** One strategy by id. Unknown id throws E_UNKNOWN_STRATEGY. */
  function get(strategyId) {
    ensureLoaded();
    const s = state.byId.get(String(strategyId));
    if (!s) {
      throw new StrategyError(ERRORS.UNKNOWN_STRATEGY, `unknown strategy "${strategyId}"`, { strategyId: String(strategyId) });
    }
    return { ...s };
  }

  function strategies() {
    ensureLoaded();
    return state.strategies.map((s) => ({ ...s }));
  }

  function kinds() {
    ensureLoaded();
    return [...state.byToken.keys()].sort();
  }

  /**
   * Select the strategy for an intent.
   *
   * Explicit naming only: context.strategyId wins if present (and must exist),
   * otherwise intent.kind is matched against strategy tokens. A token owned by
   * more than one strategy is refused rather than resolved by order, so a
   * future projection with a collision fails loudly instead of routing quietly.
   */
  function selectStrategy(intent, context) {
    if (context && !isBlank(context.strategyId)) {
      return get(context.strategyId);
    }
    const key = norm(intent.kind);
    const owners = state.byToken.get(key) || [];
    if (owners.length === 0) {
      throw new StrategyError(ERRORS.NO_STRATEGY, `no strategy matches intent kind "${intent.kind}"`, { kind: intent.kind });
    }
    if (owners.length > 1) {
      throw new StrategyError(ERRORS.NO_STRATEGY, `intent kind "${intent.kind}" matches ${owners.length} strategies: ${owners.join(', ')}`, { kind: intent.kind, matches: [...owners] });
    }
    return get(owners[0]);
  }

  /**
   * Rank a strategy's candidates against the roster.
   *
   * Returns `{ able, unresolved, ambiguous }`. `able` preserves upstream
   * candidate order: the strategy's own stated preference is the tie-break.
   * A candidate is not able if it does not resolve, if it resolves ambiguously,
   * or if context.division / context.capabilities exclude it.
   */
  function candidatesFor(strategy, context) {
    const able = [];
    const unresolved = [];
    const ambiguous = [];
    const wantDivision = context && !isBlank(context.division) ? String(context.division) : null;
    const wantCaps = context && Array.isArray(context.capabilities) ? context.capabilities : null;

    for (const ref of strategy.candidates) {
      const matches = resolveReference(ref, state.agents);
      if (matches.length === 0) { unresolved.push(ref); continue; }
      if (matches.length > 1) { ambiguous.push({ ref, matches }); continue; }
      const spec = state.agents.get(matches[0]);
      if (!spec) { unresolved.push(ref); continue; }
      if (wantDivision && spec.division !== wantDivision) continue;
      if (wantCaps && !wantCaps.every((c) => (spec.capabilities || []).includes(c))) continue;
      able.push({ ref, spec });
    }
    return { able, unresolved, ambiguous };
  }

  /**
   * Route an intent.
   *
   *   route({ kind, description, context? }, context?) -> {
   *     strategy: { id, name, kind, scope, mode },
   *     division: { id, name },
   *     agent: { id, name, role, division, capabilities, origin },
   *     reason: string,
   *     intent: { kind, description },
   *     matched: { token, candidateRef, candidateIndex },
   *   }
   *
   * `context` may carry `strategyId` (name the strategy explicitly),
   * `division` (restrict able candidates), or `capabilities` (require tokens).
   * A context passed as the second argument is merged with intent.context.
   *
   * Throws E_INVALID_INTENT / E_NO_STRATEGY / E_NO_AGENT / E_UNKNOWN_STRATEGY.
   */
  function route(intent, context) {
    ensureLoaded();
    const { valid, errors } = validateIntent(intent);
    if (!valid) {
      throw new StrategyError(ERRORS.INVALID_INTENT, `malformed intent: ${errors.map((e) => e.field || e.code).join(', ')}`, { errors });
    }

    const ctx = { ...(intent.context || {}), ...(context || {}) };
    const strategy = selectStrategy(intent, ctx);
    const { able, unresolved, ambiguous } = candidatesFor(strategy, ctx);

    if (able.length === 0) {
      const why = [];
      if (unresolved.length) why.push(`${unresolved.length} candidate(s) not in roster: ${unresolved.slice(0, 5).join(', ')}`);
      if (ambiguous.length) why.push(`${ambiguous.length} ambiguous: ${ambiguous.map((a) => a.ref).join(', ')}`);
      if (ctx.division) why.push(`division filter "${ctx.division}" excluded the rest`);
      if (ctx.capabilities) why.push(`capability filter [${ctx.capabilities.join(', ')}] excluded the rest`);
      throw new StrategyError(
        ERRORS.NO_AGENT,
        `strategy "${strategy.id}" matched but has no able agent${why.length ? ` (${why.join('; ')})` : ''}`,
        { strategyId: strategy.id, unresolved, ambiguous },
      );
    }

    const chosen = able[0];
    const index0 = strategy.candidates.indexOf(chosen.ref);
    const spec = chosen.spec;

    // The division comes from the agent's own membership (Scope A), confirmed
    // against Scope B. The division registry is read-only here.
    let division = { id: spec.division, name: null, purpose: null };
    try {
      const d = state.divisions.get(spec.division);
      division = { id: d.id, name: d.name, purpose: d.purpose, agentCount: d.agentCount };
    } catch {
      division = { id: spec.division, name: null, purpose: null };
    }

    const roleNote = strategy.roles && strategy.roles[chosen.ref] ? ` as ${strategy.roles[chosen.ref]}` : '';
    const via = ctx.strategyId ? `context.strategyId="${strategy.id}"` : `intent kind "${intent.kind}" matched strategy token "${strategy.kind}"`;
    const reason = [
      `Intent "${intent.kind}" (${intent.description}) routed by ${via}`,
      `to strategy "${strategy.name}" [${strategy.id}, scope=${strategy.scope}${strategy.mode ? `, mode=${strategy.mode}` : ''}].`,
      `Strategy names ${strategy.candidates.length} candidate(s); candidate #${index0 + 1} "${chosen.ref}"${roleNote} resolves to roster agent "${spec.id}" (${spec.origin}, division ${spec.division}).`,
      `${able.length} of ${strategy.candidates.length} candidate(s) were able; this is the strategy's highest-ranked able candidate${unresolved.length ? `, with ${unresolved.length} unresolved` : ''}${ambiguous.length ? ` and ${ambiguous.length} ambiguous` : ''}.`,
    ].join(' ');

    return {
      strategy: { id: strategy.id, name: strategy.name, kind: strategy.kind, scope: strategy.scope, mode: strategy.mode },
      division,
      agent: {
        id: spec.id,
        name: spec.name,
        role: spec.role,
        division: spec.division,
        capabilities: [...(spec.capabilities || [])],
        origin: spec.origin,
      },
      reason,
      intent: { kind: intent.kind, description: intent.description },
      matched: { token: strategy.kind, candidateRef: chosen.ref, candidateIndex: index0 },
    };
  }

  function provenance() {
    return state.provenance ? { ...state.provenance } : null;
  }

  function setRoot(root) {
    state.root = root;
  }

  return {
    load, refresh, get, strategies, kinds, route, provenance, setRoot,
    validate: validateIntent,
    get size() { return state.strategies.length; },
  };
}