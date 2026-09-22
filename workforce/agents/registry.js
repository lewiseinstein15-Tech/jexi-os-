/**
 * JEXI OS — PHASE 13 SCOPE A — BULK AGENT REGISTRY.
 *
 * The contract surface for the 400+ agent roster:
 *
 *   agents.load(root)            -> { count, agents[] }
 *   agents.get(id)               -> spec | null
 *   agents.list({ division? })   -> agents[]
 *   agents.validate(spec)        -> { valid, errors? }
 *
 *   import { createRegistry } from './registry.js';
 *   const agents = createRegistry();
 *   agents.load().count;
 *
 * A registry is built once from a load result and indexes it by id. `get` and
 * `list` are pure reads over that index; nothing is re-read from disk, so a
 * registry is a snapshot and a second `refresh()` is how you take a new one.
 *
 *   const agents = createRegistry();
 *   agents.load();
 *   agents.refresh();            // re-read disk, same index shape
 *   agents.stats();              // counts by origin and division
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { load as loadRoster, loadDir as loadRosterDir, parseFrontmatter } from './loader.js';
import { validate as validateSpec, ERRORS, REQUIRED_FIELDS, TRUST_LEVELS, CAPABILITIES } from './agent-spec.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../..');
const DIVISIONS_FILE = 'workforce/divisions.json';

/**
 * The 18 division ids, read from workforce/divisions.json when it is reachable
 * and otherwise null. The registry never invents a division: an unknown
 * division in a spec is an error, so the division set comes from the committed
 * registry rather than a literal in this module.
 */
function readDivisions(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, DIVISIONS_FILE), 'utf8'));
    return (raw.divisions || []).map((d) => d.id);
  } catch {
    return null;
  }
}

/**
 * Build a registry over a repo root.
 *
 *   createRegistry({ root })   -> registry
 *
 * `root` defaults to the repo root; `divisionsPath` overrides where the
 * division id list is read from. When the division list cannot be read, specs
 * keep their declared division and `stats().uncheckedDivisions` is true.
 */
export function createRegistry(options = {}) {
  const root = options.root || REPO_ROOT;
  const state = {
    root,
    agents: [],
    byId: new Map(),
    divisions: options.divisions || null,
    duplicates: [],
    errors: [],
    loaded: false,
  };

  function reindex(result) {
    state.agents = result.agents;
    state.duplicates = result.duplicates || [];
    state.errors = result.errors || [];
    state.byId = new Map(result.agents.map((a) => [a.id, a]));
    state.loaded = true;
  }

  function load(inputRoot) {
    const target = inputRoot || state.root;
    const result = loadRoster(target);
    if (!state.divisions) state.divisions = readDivisions(target);
    reindex(result);
    return { count: result.count, agents: result.agents };
  }

  function refresh() {
    return load();
  }

  function get(id) {
    return state.byId.get(String(id)) || null;
  }

  function list(filter = {}) {
    const { division } = filter;
    const all = state.agents;
    if (!division) return [...all];
    return all.filter((a) => a.division === division);
  }

  function validate(spec, opts = {}) {
    const res = validateSpec(spec, { divisions: state.divisions, ...opts });
    // A spec that collides with a loaded agent is a roster conflict even though
    // the spec is well-formed on its own, so this check runs regardless of
    // whether the schema check above passed.
    if (spec && spec.id && state.loaded && state.byId.has(spec.id)) {
      return {
        valid: false,
        errors: [
          ...(res.errors || []),
          { code: ERRORS.DUPLICATE_AGENT, field: 'id', message: `agent "${spec.id}" already exists in the roster` },
        ],
      };
    }
    return res;
  }

  /** True when `id` is present exactly once in the loaded roster. */
  function has(id) {
    return state.byId.has(String(id));
  }

  function stats() {
    const byOrigin = {};
    const byDivision = {};
    for (const a of state.agents) {
      byOrigin[a.origin] = (byOrigin[a.origin] || 0) + 1;
      byDivision[a.division] = (byDivision[a.division] || 0) + 1;
    }
    return {
      count: state.agents.length,
      byOrigin,
      byDivision,
      duplicates: state.duplicates.length,
      errors: state.errors.length,
      uncheckedDivisions: !state.divisions,
    };
  }

  /** The division id list the registry validates against, or null. */
  function divisions() {
    return state.divisions ? [...state.divisions] : null;
  }

  function errors() {
    return [...state.errors];
  }

  function duplicates() {
    return [...state.duplicates];
  }

  return {
    load, refresh, get, list, validate, has, stats, divisions, errors, duplicates,
    get size() { return state.agents.length; },
    get agents() { return [...state.agents]; },
  };
}

export { loadRosterDir as loadDirectory, parseFrontmatter, ERRORS, REQUIRED_FIELDS, TRUST_LEVELS, CAPABILITIES };
