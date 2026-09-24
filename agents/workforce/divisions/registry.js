/**
 * JEXI OS — PHASE 13 SCOPE B — DIVISION REGISTRY.
 *
 * Reads the 18 divisions from workforce/divisions.json and pairs them with the
 * Scope A roster to give the workforce real membership semantics:
 *
 *   divisions.load()                       -> divisions[]
 *   divisions.get(id)                      -> division
 *   divisions.members(divisionId)          -> agents[]
 *   divisions.assign(agentId, divisionId)  -> { assigned }
 *   divisions.unassign(agentId)            -> { unassigned }
 *   divisions.counts()                     -> { [divisionId]: number }
 *
 * The divisions.json file is READ-ONLY here. Assignments live in an in-memory
 * overlay: `assign`/`unassign` move an agent between divisions for the life of
 * the registry, and nothing is written back to disk. Persisting is a zone-owner
 * task.
 *
 * Membership is a strict partition: every agent is in exactly one division.
 * `assign` on an agent that already has a division is a TRANSFER — the old
 * membership is removed, not shadowed. `counts()` therefore sums to the number
 * of assigned agents, which equals the roster size until something is
 * unassigned.
 *
 * Refusals are DivisionError with a stable `.code`:
 *   E_UNKNOWN_DIVISION  get/members/assign named a division that does not exist
 *   E_UNKNOWN_AGENT     assign/unassign named an agent that is not in the roster
 *   E_NO_MEMBERSHIP     unassign named an agent that is not currently assigned
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { createRegistry as createAgentRegistry } from '../agents/registry.js';
import { normalize, validate, ERRORS, DivisionError } from './division.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../..');
const DIVISIONS_FILE = 'workforce/divisions.json';

/** Read and normalize workforce/divisions.json. Throws on malformed JSON. */
function readDivisionFile(root) {
  const file = path.join(root, DIVISIONS_FILE);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(raw) ? raw : (raw.divisions || []);
  return entries.map((d) => normalize({ ...d, source: DIVISIONS_FILE }));
}

/**
 * Build a division registry.
 *
 *   createDivisionRegistry({ root, agents }) -> registry
 *
 * `root` defaults to the repo root; `agents` injects a pre-built Scope A
 * registry (tests, alternate roots). Call `load()` before querying.
 */
export function createDivisionRegistry(options = {}) {
  const root = options.root || REPO_ROOT;
  const state = {
    root,
    divisions: [],
    byId: new Map(),
    agents: options.agents || null,
    assignments: new Map(),      // agentId -> divisionId
    members: new Map(),          // divisionId -> Set<agentId>
    loaded: false,
    loadErrors: [],
  };

  function indexMemberships(agentRegistry) {
    state.assignments = new Map();
    state.members = new Map();
    for (const division of state.divisions) state.members.set(division.id, new Set());
    for (const spec of agentRegistry.agents) {
      const target = spec.division;
      if (!state.members.has(target)) {
        // A roster agent pointing at a division absent from divisions.json is a
        // partition break; record it instead of silently inventing a division.
        state.loadErrors.push({
          code: ERRORS.UNKNOWN_DIVISION,
          field: 'division',
          message: `agent "${spec.id}" declares unknown division "${target}"`,
          agentId: spec.id,
        });
        continue;
      }
      state.assignments.set(spec.id, target);
      state.members.get(target).add(spec.id);
    }
  }

  /**
   * Load divisions and the roster.
   *
   *   load()      -> divisions[]
   *   load(root)  -> divisions[]   (overrides the root once)
   *
   * Deterministic ordering: divisions sort by id, members sort by id.
   */
  function load(inputRoot) {
    const target = inputRoot || state.root;
    const raw = readDivisionFile(target);
    state.divisions = raw.filter((d) => validate(d).valid).sort((a, b) => a.id.localeCompare(b.id));
    state.byId = new Map(state.divisions.map((d) => [d.id, d]));

    const agents = state.agents || createAgentRegistry({ root: target });
    if (!state.agents) agents.load(target);
    state.agents = agents;

    indexMemberships(agents);
    state.loaded = true;
    return state.divisions;
  }

  function ensureLoaded() {
    if (!state.loaded) load();
  }

  function refresh() {
    state.loadErrors = [];
    return load();
  }

  /** The agents of a division, sorted by id. */
  function membersOf(divisionId) {
    const set = state.members.get(divisionId);
    return [...set].sort().map((id) => state.agents.get(id)).filter(Boolean);
  }

  /** Capability union across a division's current members, sorted. */
  function capabilitiesOf(divisionId) {
    const union = new Set();
    for (const spec of membersOf(divisionId)) for (const c of (spec.capabilities || [])) union.add(c);
    return [...union].sort();
  }

  /**
   * One division, with live `agentCount` and the capability union of its
   * current members. Throws E_UNKNOWN_DIVISION for an unknown id.
   */
  function get(divisionId) {
    ensureLoaded();
    const division = state.byId.get(String(divisionId));
    if (!division) {
      throw new DivisionError(ERRORS.UNKNOWN_DIVISION, `unknown division "${divisionId}"`, { divisionId });
    }
    const members = state.members.get(division.id);
    return {
      ...division,
      agentCount: members ? members.size : 0,
      capabilities: capabilitiesOf(division.id),
    };
  }

  /**
   * The agents in a division, sorted by id. Throws E_UNKNOWN_DIVISION for an
   * unknown id; an existing division with no members returns [].
   */
  function members(divisionId) {
    ensureLoaded();
    if (!state.byId.has(String(divisionId))) {
      throw new DivisionError(ERRORS.UNKNOWN_DIVISION, `unknown division "${divisionId}"`, { divisionId });
    }
    return membersOf(String(divisionId));
  }

  /**
   * Place an agent in a division.
   *
   *   assign(agentId, divisionId) -> { assigned, agentId, from, to, transferred }
   *
   * If the agent is already in another division this is a transfer: the old
   * membership is removed before the new one is added, so the agent is never in
   * two divisions. Assigning to its current division is a no-op that still
   * reports the membership.
   *
   * Throws E_UNKNOWN_AGENT for an agent not in the roster, E_UNKNOWN_DIVISION
   * for a division not in divisions.json.
   */
  function assign(agentId, divisionId) {
    ensureLoaded();
    const id = String(agentId);
    const target = String(divisionId);

    if (!state.agents.has(id)) {
      throw new DivisionError(ERRORS.UNKNOWN_AGENT, `unknown agent "${agentId}"`, { agentId: id });
    }
    if (!state.byId.has(target)) {
      throw new DivisionError(ERRORS.UNKNOWN_DIVISION, `unknown division "${divisionId}"`, { divisionId: target });
    }

    const from = state.assignments.get(id) || null;
    if (from === target) {
      return { assigned: true, agentId: id, from, to: target, transferred: false };
    }
    if (from && state.members.has(from)) state.members.get(from).delete(id);
    state.members.get(target).add(id);
    state.assignments.set(id, target);
    return { assigned: true, agentId: id, from, to: target, transferred: Boolean(from) };
  }

  /**
   * Remove an agent from its division.
   *
   *   unassign(agentId) -> { unassigned, agentId, from }
   *
   * Throws E_UNKNOWN_AGENT for an agent not in the roster, E_NO_MEMBERSHIP for
   * one that is currently in no division.
   */
  function unassign(agentId) {
    ensureLoaded();
    const id = String(agentId);
    if (!state.agents.has(id)) {
      throw new DivisionError(ERRORS.UNKNOWN_AGENT, `unknown agent "${agentId}"`, { agentId: id });
    }
    const from = state.assignments.get(id) || null;
    if (!from) {
      throw new DivisionError(ERRORS.NO_MEMBERSHIP, `agent "${agentId}" is not assigned to a division`, { agentId: id });
    }
    if (state.members.has(from)) state.members.get(from).delete(id);
    state.assignments.delete(id);
    return { unassigned: true, agentId: id, from };
  }

  /**
   * Membership counts per division, keyed by division id and sorted by id.
   *
   *   counts() -> { [divisionId]: number }
   *
   * Every declared division appears, so a division with no members reads 0. The
   * values sum to the number of assigned agents — the roster size until
   * something is unassigned.
   */
  function counts() {
    ensureLoaded();
    const out = {};
    for (const division of state.divisions) out[division.id] = state.members.get(division.id).size;
    return out;
  }

  /** Total assigned agents. Equals the roster size on a fresh load. */
  function assignedCount() {
    ensureLoaded();
    return state.assignments.size;
  }

  function has(divisionId) {
    ensureLoaded();
    return state.byId.has(String(divisionId));
  }

  function divisions() {
    ensureLoaded();
    return state.divisions.map((d) => get(d.id));
  }

  function errors() {
    return [...state.loadErrors];
  }

  return {
    load, refresh, get, members, assign, unassign, counts, assignedCount,
    has, divisions, errors,
    get size() { return state.divisions.length; },
  };
}