// computer/tool-call/index.js
// Phase 29 Scope H — public surface of the GUI tool call engine.
//
//   selectEngine({ tools?, hasEnvTag?, prompt? })
//         -> { id: 'gui'|'code'|'native', strategy, priority, reason, tools }
//            gui=90 (GUI actions / <computer_env> tag), code=80 (code tool
//            names), native=0 (fallback default) — priority-descending,
//            first match wins, declared.
//   engineFor(input) -> { selection, engine } — select + build in one step.
//   createEngine(name) | registerEngine(name, factory) | engineNames()
//         — pluggable strategy registry; unknown name ->
//           E_UNKNOWN_TOOL_CALL_ENGINE.
//   Engine contract (every strategy engine):
//     engine.preparePrompt(tools)          -> promptSegments []
//     engine.prepareRequest(params)        -> requestParams
//     engine.parseStreaming(chunk, state)  -> { state, actions }
//     engine.parseFinal(response)          -> { actions }
//   Declared strategies: 'native' (OpenAI function calling), 'prompt'
//   (<computer_env> prompt segments; GUI engine), 'structured' (json_schema
//   response_format).
//
// Re-exports: PROVIDERS / listProviders / priorities / GUI_TOOL_NAMES /
// CODE_TOOL_NAMES (declared selection tables), shared normalizers
// (normalizeTools / extractToolNames / responseContent / contentDelta),
// assertEngineShape, TOOL_CALL_CODES.
//
// All errors are ComputerError with the declared Scope H codes
// E_UNKNOWN_TOOL_CALL_ENGINE / E_TOOL_CALL_MALFORMED plus reused
// E_INVALID_ARGUMENT; Scope A grammar codes propagate unchanged from
// action.parse. Zero new dependencies; deterministic — no clock, no
// randomness; nothing here fabricates an action or a success.

import {
  createEngine,
  registerEngine,
  engineNames,
  assertEngineShape,
  normalizeTools,
  extractToolNames,
  responseContent,
  contentDelta,
  ENGINE_METHODS,
  TOOL_CALL_CODES,
} from './engine.js';
import { createNativeEngine } from './strategies/native.js';
import { createPromptEngine } from './strategies/prompt.js';
import { createStructuredEngine } from './strategies/structured.js';
import {
  selectEngine,
  listProviders,
  GUI_TOOL_NAMES,
  CODE_TOOL_NAMES,
  PROVIDERS,
  GUI_PROVIDER_PRIORITY,
  CODE_PROVIDER_PRIORITY,
  NATIVE_PROVIDER_PRIORITY,
} from './selector.js';

/** Select + build in one step: { selection, engine }. */
export function engineFor(input) {
  const selection = selectEngine(input);
  return { selection, engine: createEngine(selection.strategy) };
}

export {
  createEngine,
  registerEngine,
  engineNames,
  assertEngineShape,
  normalizeTools,
  extractToolNames,
  responseContent,
  contentDelta,
  ENGINE_METHODS,
  TOOL_CALL_CODES,
  createNativeEngine,
  createPromptEngine,
  createStructuredEngine,
  selectEngine,
  listProviders,
  GUI_TOOL_NAMES,
  CODE_TOOL_NAMES,
  PROVIDERS,
  GUI_PROVIDER_PRIORITY,
  CODE_PROVIDER_PRIORITY,
  NATIVE_PROVIDER_PRIORITY,
};

export default {
  createEngine,
  registerEngine,
  engineNames,
  selectEngine,
  listProviders,
  engineFor,
  TOOL_CALL_CODES,
};
