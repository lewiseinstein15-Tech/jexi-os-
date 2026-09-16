/**
 * WORKFORCE REGISTRY (Phase 2, Scope D — Agents + MCP; extended phase-6 Scope E).
 *
 * Capability-driven agent catalog built OVER the authoritative hot-path
 * roster (server/src/services/director/Employees.js). This layer adds the
 * three workforce contracts the OS needs:
 *
 *   1. CAPABILITY INDEX  — every registered agent is searchable by
 *      capability token; the index is the deterministic lookup surface the
 *      router uses (never ad-hoc keyword matching).
 *   2. OVERLAP VALIDATOR — two agents claiming the SAME slot with
 *      near-identical descriptions are refused at registration (colocated
 *      responsibility is a bug, not a choice).
 *   3. DESCRIPTION BUDGET — descriptions are truncated to a hard token
 *      budget (15k) so the catalog can never bloat a prompt.
 *
 * Registration is idempotent and additive over the Employees roster:
 * `registerAll()` pulls the current roster once and indexes it. Agents
 * disabled in the roster are excluded from the index.
 *
 * Depends only on `getEmployee`/`loadEmployees` from Employees.js.
 *
 * SCOPE E (phase-6, legacy migration round 2): this module is now THE single
 * roster API surface. The legacy catalog data moved verbatim into
 * `catalog.js` (same commit deleted services/AgentRoster.js), and every
 * production consumer (Planner, ToolRegistry, Orchestrator, TaskManager,
 * PluginRegistry, JexiIdentity, ArchitectureViews, Reachability,
 * ProfileCompleteness, SkillChain, verification AgentVerifier, server
 * index.js /api/roster) imports from HERE. getAgent bridges the legacy
 * catalog AND the authoritative Employees roster; rosterStats reports both
 * worlds; composeTeam keeps the exact TEAM_PLAN delegation and gains
 * capability-token composition over the live Employees roster.
 */
import { loadEmployees } from '../../services/director/Employees.js';
import {
  AGENT_ROSTER,
  SKILL_REGISTRY,
  ROSTER_COUNT,
  SKILL_COUNT,
  getAgent as catalogGetAgent,
  getSkill,
  agentSkills,
} from './catalog.js';
// Cycle note: Planner ↔ registry (Planner imports the roster surface here;
// composeTeam delegates to TEAM_PLAN there). Same live-binding cycle the old
// Planner ↔ AgentRoster pair had — every use is call-time, never eval-time.
import { TEAM_PLAN } from '../../services/Planner.js';

/** Legacy catalog data (moved verbatim from services/AgentRoster.js). */
export { AGENT_ROSTER, SKILL_REGISTRY, ROSTER_COUNT, SKILL_COUNT, getSkill, agentSkills };

export const DESC_BUDGET_TOKENS = 15000;
export const OVERLAP_THRESHOLD = 0.85;

const _index = new Map();   // agentId -> normalized agent record
let _initialized = false;

/** Truncate a description to the budget (words ≈ tokens for ASCII prose). */
export function truncateToBudget(desc, budget = DESC_BUDGET_TOKENS) {
  if (!desc) return '';
  const words = String(desc).trim().split(/\s+/);
  if (words.length <= budget) return words.join(' ');
  return words.slice(0, budget).join(' ') + '…';
}

/** Token estimate for the whole catalog (used by the budget gate). */
export function catalogTokens(agents) {
  let total = 0;
  for (const a of agents || []) {
    total += String(a.description || '').split(/\s+/).filter(Boolean).length;
    total += (a.capabilities || []).length;
    total += String(a.role || '').split(/\s+/).filter(Boolean).length;
  }
  return total;
}

/**
 * Jaccard overlap between two agents' capability sets + description cosine.
 * Shared `capabilities` and `role` collide fastest; identical descriptions
 * are the strongest signal. Returns 0..1.
 */
export function computeOverlap(a, b) {
  const capsA = new Set(a.capabilities || []);
  const capsB = new Set(b.capabilities || []);
  const inter = [...capsA].filter((c) => capsB.has(c)).length;
  const union = new Set([...capsA, ...capsB]).size || 1;
  const capSim = inter / union;

  const roleSim = (a.role || '').toLowerCase() === (b.role || '').toLowerCase() ? 1 : 0;
  const da = (a.description || '').toLowerCase();
  const db = (b.description || '').toLowerCase();

  let descSim = 0;
  if (da && db) {
    const wa = new Set(da.split(/\W+/).filter((w) => w.length > 2));
    const wb = new Set(db.split(/\W+/).filter((w) => w.length > 2));
    const both = [...wa].filter((w) => wb.has(w)).length;
    const all = new Set([...wa, ...wb]).size || 1;
    descSim = both / all;
  }

  return +(0.45 * capSim + 0.25 * roleSim + 0.30 * descSim).toFixed(3);
}

/** Build the internal normalized index record for one roster employee. */
function _record(e) {
  return {
    agentId: e.agentId,
    displayName: e.displayName,
    role: e.role,
    description: truncateToBudget(e.description),
    capabilities: [...e.capabilities],
    supportedTools: [...e.supportedTools],
    allowedMCP: (e.allowedMCP || []).map((g) => ({ ...g })),
    permissions: [...e.permissions],
    support: Boolean(e.support),
  };
}

/**
 * Rebuild the capability index from the authoritative roster. Returns the
 * number of agents indexed and (when strict) any overlap violations.
 */
export function registerAll({ strict = false } = {}) {
  const roster = loadEmployees().filter((e) => !e.disabled);
  _index.clear();
  for (const e of roster) _index.set(e.agentId, _record(e));
  _initialized = true;

  const violations = strict ? validateOverlaps() : [];
  return { agents: _index.size, violations };
}

/** Ensure the index is populated (idempotent). */
export function ensureIndex() {
  if (!_initialized) registerAll();
  return _index;
}

/** Index lookup by exact agent id. */
export function getByAgentId(agentId) {
  ensureIndex();
  return _index.get(String(agentId).toLowerCase()) || null;
}

/** Capability index: agentId -> sorted list of matching agents (highest first). */
export function findByCapability(capability) {
  ensureIndex();
  const cap = String(capability).toLowerCase();
  return [..._index.values()]
    .filter((a) => a.capabilities.map((c) => c.toLowerCase()).includes(cap))
    .sort((a, b) => (b.capabilities.length - a.capabilities.length));
}

/** Full index (for tests/inspection). */
export function listAgents() {
  ensureIndex();
  return [..._index.values()];
}

/**
 * OVERLAP VALIDATOR — refuse near-duplicate agents in the same slot.
 * For every pair whose overlap >= OVERLAP_THRESHOLD, return a violation
 * naming both agents. Registration with `strict: true` surfaces these.
 */
export function validateOverlaps(threshold = OVERLAP_THRESHOLD) {
  ensureIndex();
  const all = [..._index.values()];
  const violations = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const s = computeOverlap(all[i], all[j]);
      if (s >= threshold) {
        violations.push({
          a: all[i].agentId,
          b: all[j].agentId,
          overlap: s,
          message: `agents '${all[i].agentId}' and '${all[j].agentId}' overlap ${s.toFixed(3)} >= ${threshold} — colocated responsibility; differentiate descriptions or merge.`,
        });
      }
    }
  }
  return violations;
}

/**
 * DESCRIPTION BUDGET — reject registration that would blow the catalog
 * budget. Returns { ok, tokens, budget, error? }.
 */
export function checkCatalogBudget(agents = listAgents(), budget = DESC_BUDGET_TOKENS) {
  const tokens = catalogTokens(agents);
  if (tokens > budget) {
    return { ok: false, tokens, budget, error: `catalog is ${tokens} tokens; budget ${budget}` };
  }
  return { ok: true, tokens, budget };
}

/* ────────────────────────────────────────────────────────────────────────
 * SCOPE E — single roster API surface (legacy-compat + Employees bridge).
 * The 12 production consumers' exact APIs, now wrapped over the
 * authoritative Employees roster where a bridge exists.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Look up one agent: legacy specialist catalog FIRST (252 entries, exact
 * legacy behavior), then the AUTHORITATIVE Employees roster (9 stable
 * coworkers, capability-indexed). Employees records are returned in a
 * team-compatible shape (slug/name mirrors agentId/displayName).
 */
export function getAgent(slug) {
  const legacy = catalogGetAgent(slug);
  if (legacy) return legacy;
  if (slug == null || slug === '') return null;
  const rec = getByAgentId(String(slug));
  if (!rec) return null;
  return { ...rec, slug: rec.agentId, name: rec.displayName, source: 'employees' };
}

/** Normalize TEAM_PLAN/compound slugs into the composed team (legacy logic). */
function _teamFromSlugs(slugs) {
  const seen = new Set();
  const team = [];
  for (const slug of slugs) {
    const agent = getAgent(slug);
    if (agent && !seen.has(slug)) {
      seen.add(slug);
      team.push(agent);
    }
  }
  return team;
}

/**
 * Compose the workforce for a capability token straight off the
 * AUTHORITATIVE Employees roster: exact capability match first, then token
 * containment. Returns an ordered agent list (most capable first).
 */
export function composeWorkforce(capability, opts = {}) {
  const token = String(capability || '').toLowerCase().replace(/[^a-z-]/g, '');
  if (!token) return [];
  let hits = findByCapability(token);
  if (!hits.length) {
    hits = listAgents().filter((a) =>
      (a.capabilities || []).some((c) => {
        const cl = c.toLowerCase();
        return cl.includes(token) || token.includes(cl);
      })
    );
  }
  const team = hits.map((a) => ({ ...a, slug: a.agentId, name: a.displayName, source: 'employees' }));
  return opts.limit ? team.slice(0, opts.limit) : team;
}

/**
 * Compose the roster of specialists for an intent (catalog big, team small,
 * per task). Resolution order:
 *   1. compound_task → extra.steps slugs (legacy behavior, verbatim);
 *   2. TEAM_PLAN[intent] → the single team map in Planner.js (legacy
 *      behavior, verbatim — plan UI, planner and audit share it);
 *   3. NEW (Scope E): any other intent composes from the AUTHORITATIVE
 *      Employees roster by capability token (composeWorkforce).
 */
export function composeTeam(intent, extra = {}) {
  if (intent === 'compound_task') {
    return _teamFromSlugs(
      (extra.steps || []).flatMap((s) => {
        const agent = getAgent(String(s).toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-'));
        return agent ? [agent.slug] : [];
      })
    );
  }
  if (TEAM_PLAN[intent]) return _teamFromSlugs(TEAM_PLAN[intent]);
  return composeWorkforce(intent, extra);
}

/** Expand a team of agents into every skill they collectively master. */
export function skillsForTeam(team) {
  const seen = new Set();
  const out = [];
  for (const agent of team) {
    for (const slug of agent.skills || []) {
      const skill = getSkill(slug);
      if (skill && !seen.has(slug)) {
        seen.add(slug);
        out.push(skill);
      }
    }
  }
  return out;
}

/** Pretty one-line summary: "12 specialists · 34 skills". */
export function rosterSummary(intent, extra = {}) {
  const team = composeTeam(intent, extra);
  const skills = skillsForTeam(team);
  return `${team.length} specialists · ${skills.length} skills`;
}

/** Names of the specialists composed for an intent (for the plan UI). */
export function rosterFor(intent, extra = {}) {
  return composeTeam(intent, extra).map((a) => a.name);
}

/** Skill IDs the composed team collectively masters (for the plan UI). */
export function skillsFor(intent, extra = {}) {
  return skillsForTeam(composeTeam(intent, extra)).map((s) => s.slug);
}

/** Human-readable skills line for the pipeline stream. */
export function skillsLine(intent, extra = {}) {
  const names = skillsForTeam(composeTeam(intent, extra)).map((s) => s.name);
  return names.length ? names.slice(0, 12).join(' · ') : '';
}

/**
 * Catalog sizes + LIVE workforce stats in one call.
 *
 * Legacy shape (agents/skills) is preserved for the existing consumers
 * (Planner plan payload, Orchestrator planner log, tests). The Scope E
 * fields report the authoritative Employees roster:
 *   count        — live coworkers indexed from director/Employees.js;
 *   byCapability — { capability → n } histogram over the live index;
 *   byCoworker   — [{ agentId, role, capabilities, support }] per coworker.
 */
export function rosterStats() {
  const idx = ensureIndex();
  const byCapability = {};
  const byCoworker = [];
  for (const rec of idx.values()) {
    for (const c of rec.capabilities || []) byCapability[c] = (byCapability[c] || 0) + 1;
    byCoworker.push({
      agentId: rec.agentId,
      role: rec.role,
      capabilities: (rec.capabilities || []).length,
      support: rec.support,
    });
  }
  return { agents: ROSTER_COUNT, skills: SKILL_COUNT, count: idx.size, byCapability, byCoworker };
}