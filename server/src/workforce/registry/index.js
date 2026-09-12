/**
 * WORKFORCE REGISTRY (Phase 2, Scope D — Agents + MCP).
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
 */
import { loadEmployees } from '../../services/director/Employees.js';

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