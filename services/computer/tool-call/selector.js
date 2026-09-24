// computer/tool-call/selector.js
// Phase 29 Scope H — priority-based, DECLARED provider selection.
//
// TARS: GuiToolCallEngineProvider wins at priority 90 when tool names are
// GUI actions or a <computer_env> tag is present; the code engine follows
// at priority 80 for code tool names; everything else falls through to the
// native default (priority 0, always matches). Providers are scanned in
// priority-descending order and the FIRST match wins — deterministic.
//
//   gui    priority 90  strategy 'prompt'   GUI actions or <computer_env> tag
//   code   priority 80  strategy 'native'   code tool names
//   native priority  0  strategy 'native'   fallback default
//
// Tool families (closed, declared):
//   GUI_TOOL_NAMES  = Scope G TOOL_CATALOG.gui_core (the Scope A frozen
//                     nine) + TOOL_CATALOG.navigation — the GUI family,
//                     consistent with Scope G's gui mode.
//   CODE_TOOL_NAMES = Scope G TOOL_CATALOG.shell ('bash') + the declared
//                     TARS code-agent tool vocabulary (read_file,
//                     write_file, edit_file, execute_command,
//                     list_directory).
// Tools outside both families (e.g. 'mcp') select the native fallback.
//
// All refusals are ComputerError (computer/errors.js) — no new class.

import { ComputerError } from '../errors.js';
import { TOOL_CATALOG } from '../modes/index.js';
import { extractToolNames } from './engine.js';

export const GUI_PROVIDER_PRIORITY = 90;
export const CODE_PROVIDER_PRIORITY = 80;
export const NATIVE_PROVIDER_PRIORITY = 0;

/** The GUI tool family, in catalog declaration order (gui_core then navigation). */
export const GUI_TOOL_NAMES = Object.freeze([...TOOL_CATALOG.gui_core, ...TOOL_CATALOG.navigation]);
const GUI_SET = new Set(GUI_TOOL_NAMES);

/** The code tool family: Scope G shell gate + declared code-agent tools. */
export const CODE_TOOL_NAMES = Object.freeze([
  ...new Set([...TOOL_CATALOG.shell, 'execute_command', 'read_file', 'write_file', 'edit_file', 'list_directory']),
]);
const CODE_SET = new Set(CODE_TOOL_NAMES);

const ENV_TAG = '<computer_env>';

/** Declared providers, frozen. listProviders() returns them priority-descending. */
export const PROVIDERS = Object.freeze({
  gui: Object.freeze({
    id: 'gui',
    strategy: 'prompt',
    priority: GUI_PROVIDER_PRIORITY,
    description: 'GUI actions or <computer_env> tag present (TARS GuiToolCallEngineProvider)',
  }),
  code: Object.freeze({
    id: 'code',
    strategy: 'native',
    priority: CODE_PROVIDER_PRIORITY,
    description: 'code tool names (shell / file tools)',
  }),
  native: Object.freeze({
    id: 'native',
    strategy: 'native',
    priority: NATIVE_PROVIDER_PRIORITY,
    description: 'fallback default engine',
  }),
});

/** Declared providers, priority-descending (gui, code, native). */
export function listProviders() {
  return [PROVIDERS.gui, PROVIDERS.code, PROVIDERS.native];
}

/**
 * Select the engine provider for a tool set / env-tag state.
 * Input: { tools?, hasEnvTag?, prompt? } — tools may be name strings,
 * descriptors, or OpenAI function shapes (normalized); the env tag fires
 * via hasEnvTag:true or a prompt containing '<computer_env>'.
 * Returns { id, strategy, priority, reason, tools } — deterministic.
 */
export function selectEngine(input) {
  const params = input === null || typeof input !== 'object' ? {} : input;
  let names;
  try {
    names = extractToolNames(params.tools);
  } catch (e) {
    if (e instanceof ComputerError) {
      throw new ComputerError('E_INVALID_ARGUMENT', `selector: ${e.message}`, { cause: e.code });
    }
    throw e;
  }
  const envTag =
    params.hasEnvTag === true ||
    (typeof params.prompt === 'string' && params.prompt.includes(ENV_TAG));

  if (envTag || names.some((n) => GUI_SET.has(n))) {
    return {
      id: PROVIDERS.gui.id,
      strategy: PROVIDERS.gui.strategy,
      priority: PROVIDERS.gui.priority,
      reason: envTag ? 'env-tag' : 'gui-actions',
      tools: names,
    };
  }
  if (names.some((n) => CODE_SET.has(n))) {
    return {
      id: PROVIDERS.code.id,
      strategy: PROVIDERS.code.strategy,
      priority: PROVIDERS.code.priority,
      reason: 'code-tools',
      tools: names,
    };
  }
  return {
    id: PROVIDERS.native.id,
    strategy: PROVIDERS.native.strategy,
    priority: PROVIDERS.native.priority,
    reason: 'fallback',
    tools: names,
  };
}
