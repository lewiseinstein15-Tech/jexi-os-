// computer/modes/modes.js
// Phase 29 Scope G — agent modes (omni / gui / game), DECLARED.
//
// Ported from TARS AgentMode: one runtime-selected mode restricts the tool
// set the agent may use.
//
//   omni  all tools — GUI actions + shell/code + MCP          (default)
//   gui   GUI actions only — no shell, no MCP
//   game  GUI actions minus navigate/navigate_back; requires a
//         preset `link` — the single URL the game agent operates on
//
// Tool catalog (CLOSED): the union of tool families across engines.
//   gui_core    the Scope A frozen nine-action vocabulary; the grammar
//               authority for those names remains Scope A's parser — this
//               module only gates at policy level
//   navigation  the browser-engine GUI actions navigate/navigate_back
//               (TARS GUIAgent space; game mode removes exactly these two)
//   shell       the shell/code-engine gate ('bash')
//   mcp         the MCP tool gate
//
// Contract:
//   modes.list()            -> [{ id: 'omni'|'gui'|'game', description }]
//   modes.set(id, opts?)    -> { mode }   refused while a loop is active
//   modes.active()          -> { id, opts }
//   modes.allowed(action)   -> boolean    pure policy predicate; unknown
//                                         names answer false (a tool outside
//                                         the closed catalog is by definition
//                                         not allowed in any mode)
//   modes.setLoopActive(b)  -> { loopActive }  integration seam for the
//                                         Scope F GUI agent loop — the loop
//                                         registers while running OR paused
//                                         (a paused session is still active)
//   modes.loopActive()      -> boolean
//
// Error discipline (ComputerError only — computer/errors.js; no new class):
//   E_UNKNOWN_AGENT_MODE  set() with an id outside the closed set (Scope G)
//   E_LOOP_ACTIVE         set() while an agent loop is active; ANY mode
//                         change is refused mid-session, including re-set
//                         of the current mode (Scope G)
//   E_INVALID_ARGUMENT    opts misuse (reused Scope A code): non-object
//                         opts, unknown option key for the mode, option of
//                         the wrong type, missing required option
//
// Declared validation order in set(): unknown mode -> loop-active -> opts.
// Determinism: no clock, no randomness; frozen tables; stable iteration
// order everywhere. Default state before any set(): { id: 'omni', opts: {} }
// (schema default). opts use REPLACE semantics — every successful set()
// stores exactly the declared, validated keys of THIS call; nothing merges,
// nothing carries over. Option values are stored as provided (validation
// only — no silent mutation of caller values).

import { ComputerError } from '../errors.js';
import { AGENT_MODE_SCHEMA, DEFAULT_AGENT_MODE, agentModeIds, modeOption } from './schema.js';

// --- tool catalog (closed, declared) ---------------------------------------

export const TOOL_CATALOG = Object.freeze({
  gui_core: Object.freeze([
    'click', 'left_double', 'right_single', 'drag', 'hotkey', 'type', 'scroll', 'wait', 'finished',
  ]),
  navigation: Object.freeze(['navigate', 'navigate_back']),
  shell: Object.freeze(['bash']),
  mcp: Object.freeze(['mcp']),
});

/** Flat tool universe in catalog declaration order (stable matrix order). */
export const TOOL_ORDER = Object.freeze(Object.values(TOOL_CATALOG).flat());

// --- mode -> toolset mapping (declared) -------------------------------------

export const MODE_TOOLSETS = Object.freeze({
  omni: Object.freeze(['gui_core', 'navigation', 'shell', 'mcp']),
  gui: Object.freeze(['gui_core', 'navigation']),
  game: Object.freeze(['gui_core']),
});

// Allowed sets are built once from the declared tables and never mutated.
const ALLOWED_SETS = (() => {
  const sets = {};
  for (const [modeId, groups] of Object.entries(MODE_TOOLSETS)) {
    const s = new Set();
    for (const g of groups) {
      const tools = TOOL_CATALOG[g];
      if (!tools) {
        throw new ComputerError(
          'E_INVALID_ARGUMENT',
          `modes: toolset for '${modeId}' references unknown catalog group '${g}'`,
          { mode: modeId, group: g }
        );
      }
      for (const t of tools) s.add(t);
    }
    sets[modeId] = s;
  }
  return Object.freeze(sets);
})();

// --- opts validation (driven by the schema, not ad hoc) ----------------------

function validateOpts(modeId, opts) {
  const declared = AGENT_MODE_SCHEMA.modeOpts[modeId];
  // Absent opts still honor the schema's required keys: a mode that
  // requires a payload (game -> link) can never be set without it.
  if (opts === undefined || opts === null) {
    if (declared.required.length > 0) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `modes.set: mode '${modeId}' requires option '${declared.required[0]}'`,
        { mode: modeId, key: declared.required[0] }
      );
    }
    return Object.freeze({});
  }
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `modes.set: opts must be an object (got ${Array.isArray(opts) ? 'array' : typeof opts})`,
      { mode: modeId }
    );
  }
  const out = {};
  for (const key of Object.keys(opts)) {
    const prop = declared.properties[key];
    if (!prop) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `modes.set: unknown option '${key}' for mode '${modeId}'`,
        { mode: modeId, key }
      );
    }
    if (prop.type === 'string') {
      const v = opts[key];
      if (typeof v !== 'string' || v.trim().length < (prop.minLength || 1)) {
        throw new ComputerError(
          'E_INVALID_ARGUMENT',
          `modes.set: option '${key}' for mode '${modeId}' must be a string of at least ${prop.minLength || 1} non-blank character(s)`,
          { mode: modeId, key }
        );
      }
    }
    out[key] = opts[key];
  }
  for (const req of declared.required) {
    if (!(req in out)) {
      throw new ComputerError(
        'E_INVALID_ARGUMENT',
        `modes.set: mode '${modeId}' requires option '${req}'`,
        { mode: modeId, key: req }
      );
    }
  }
  return Object.freeze(out);
}

// --- the modes singleton ------------------------------------------------------

const state = {
  modeId: DEFAULT_AGENT_MODE,
  opts: Object.freeze({}),
  loopActive: false,
};

export const modes = Object.freeze({
  /** The three declared modes, in schema declaration order. */
  list() {
    return AGENT_MODE_SCHEMA.options.map((o) => ({ id: o.id, description: o.description }));
  },

  /**
   * Select the active agent mode. Validation order is declared:
   * unknown mode -> loop-active refusal -> opts validation.
   * Returns { mode: id }; stores opts with REPLACE semantics.
   */
  set(id, opts) {
    const option = typeof id === 'string' ? modeOption(id) : undefined;
    if (!option) {
      throw new ComputerError(
        'E_UNKNOWN_AGENT_MODE',
        `modes.set: unknown agent mode ${typeof id === 'string' ? `'${id}'` : `(${typeof id})`} — known modes: ${agentModeIds().join(', ')}`,
        { id, known: agentModeIds() }
      );
    }
    if (state.loopActive) {
      throw new ComputerError(
        'E_LOOP_ACTIVE',
        `modes.set: agent mode change refused while an agent loop is active (active mode '${state.modeId}', requested '${option.id}')`,
        { activeMode: state.modeId, requestedMode: option.id }
      );
    }
    const nextOpts = validateOpts(option.id, opts);
    state.modeId = option.id;
    state.opts = nextOpts;
    return { mode: state.modeId };
  },

  /** Current mode + a copy of its stored opts (schema default before set). */
  active() {
    return { id: state.modeId, opts: { ...state.opts } };
  },

  /** Policy predicate: is `action` allowed by the active mode's toolset? */
  allowed(action) {
    if (typeof action !== 'string' || action.length === 0) return false;
    return ALLOWED_SETS[state.modeId].has(action);
  },

  /**
   * Integration seam for the agent loop (Scope F shape): mark whether an
   * agent loop is currently active (running or paused). While true, ANY
   * modes.set() is refused with E_LOOP_ACTIVE.
   */
  setLoopActive(active) {
    state.loopActive = Boolean(active);
    return { loopActive: state.loopActive };
  },

  /** Is an agent loop currently registered as active? */
  loopActive() {
    return state.loopActive;
  },
});

// Error codes declared by Scope G. Every one is carried by ComputerError
// (computer/errors.js) — no new error class.
export const MODE_CODES = Object.freeze([
  'E_UNKNOWN_AGENT_MODE', // set() with a mode outside the closed set
  'E_LOOP_ACTIVE',        // set() while an agent loop is active
]);
