// computer/modes/index.js
// Phase 29 Scope G — public surface of the agent-mode module.
//
//   modes.list()           -> [{ id: 'omni'|'gui'|'game', description }]
//   modes.set(id, opts?)   -> { mode }     E_UNKNOWN_AGENT_MODE on an id
//                                           outside the closed set;
//                                           E_LOOP_ACTIVE while a loop is
//                                           active (any change refused)
//   modes.active()         -> { id, opts } (schema default { omni, {} }
//                                           before the first set)
//   modes.allowed(action)  -> boolean      policy gate over the closed tool
//                                           catalog; unknown names -> false
//   modes.setLoopActive(b) -> { loopActive }  seam for the Scope F GUI agent
//                                           loop (running or paused counts
//                                           as active)
//   modes.loopActive()     -> boolean
//
// Re-exports: AGENT_MODE_SCHEMA (declarative runtime-settings schema —
// modes, descriptions, defaults, per-mode opts), TOOL_CATALOG / TOOL_ORDER /
// MODE_TOOLSETS (closed tool universe), MODE_CODES (declared Scope G codes).
//
// All errors are ComputerError with the declared Scope G codes:
// E_UNKNOWN_AGENT_MODE / E_LOOP_ACTIVE, plus the reused E_INVALID_ARGUMENT
// for opts misuse. Zero new dependencies; fully deterministic — no clock,
// no randomness; nothing here fabricates state or success.

import { modes, TOOL_CATALOG, TOOL_ORDER, MODE_TOOLSETS, MODE_CODES } from './modes.js';
import { AGENT_MODE_SCHEMA, DEFAULT_AGENT_MODE, AGENT_MODE_ID, agentModeIds, modeOption } from './schema.js';

export {
  modes,
  TOOL_CATALOG,
  TOOL_ORDER,
  MODE_TOOLSETS,
  MODE_CODES,
  AGENT_MODE_SCHEMA,
  DEFAULT_AGENT_MODE,
  AGENT_MODE_ID,
  agentModeIds,
  modeOption,
};

export default { modes, AGENT_MODE_SCHEMA };
