// computer/modes/schema.js
// Phase 29 Scope G — runtime-settings-style schema for the agent mode.
//
// TARS (bytedance/UI-TARS-desktop, Apache 2.0) declares its runtime
// settings as a declarative schema: every setting carries an id, a type, a
// closed option list with descriptions, a default, and — where applicable —
// a declared per-option payload. Scope G follows that discipline. This file
// is PURE DECLARATION: no I/O, no behavior, no state, no clock. Everything
// behavioral (validation, listing, defaults) in computer/modes/modes.js is
// DERIVED from this table so the vocabulary is never hardcoded twice.
//
// The option list is CLOSED: 'omni' | 'gui' | 'game'. There is no runtime
// extension path — adding a mode is a versioned schema change, mirroring
// the Scope A action-space discipline.

export const AGENT_MODE_ID = 'agentMode';

export const DEFAULT_AGENT_MODE = 'omni';

export const AGENT_MODE_SCHEMA = Object.freeze({
  id: AGENT_MODE_ID,
  type: 'enum',
  default: DEFAULT_AGENT_MODE,
  options: Object.freeze([
    Object.freeze({
      id: 'omni',
      description: 'All engines: GUI actions, shell/code, and MCP tools.',
    }),
    Object.freeze({
      id: 'gui',
      description: 'GUI actions only: no shell and no MCP tools.',
    }),
    Object.freeze({
      id: 'game',
      description: 'GUI actions without navigate/navigate_back; operates on a preset link.',
    }),
  ]),
  // Per-mode option payloads, declared runtime-settings style. A mode with
  // no declared properties accepts no options; game requires exactly the
  // preset `link` it operates on.
  modeOpts: Object.freeze({
    omni: Object.freeze({ properties: Object.freeze({}), required: Object.freeze([]) }),
    gui: Object.freeze({ properties: Object.freeze({}), required: Object.freeze([]) }),
    game: Object.freeze({
      properties: Object.freeze({
        link: Object.freeze({
          type: 'string',
          minLength: 1,
          description: 'Preset URL the game-mode agent operates on',
        }),
      }),
      required: Object.freeze(['link']),
    }),
  }),
});

/** Closed mode-id list, in schema declaration order. */
export function agentModeIds() {
  return AGENT_MODE_SCHEMA.options.map((o) => o.id);
}

/** Schema option row for one mode id (or undefined outside the closed set). */
export function modeOption(id) {
  return AGENT_MODE_SCHEMA.options.find((o) => o.id === id);
}
