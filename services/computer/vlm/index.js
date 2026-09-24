// computer/vlm/index.js
// Phase 29 Scope E — public surface of the VLM provider module.
//
//   createVlm({ client?, model?, maxTurns?, imageMode? })
//        -> { available, infer, reset, historySnapshot, droppedTurns,
//             buildRequest, providerName, model, imageMode, maxTurns }
//   createDefaultClient({ baseUrl, apiKey, timeoutMs? })
//        -> async transport for deployment (global fetch; never used in
//           the sandbox; zero new dependencies)
//
// Re-exports: prompt (COMPUTER_USE_PROMPT / ACTION_LINES /
// buildSystemPrompt), context (createHistory / windowTurns /
// DEFAULT_MAX_TURNS), provider constants (DEFAULT_MODEL / PROVIDER_NAME /
// IMAGE_MODES / extractActionLine).
//
// All errors are ComputerError with the declared Scope E codes:
// E_VLM_UNAVAILABLE / E_VLM_ERROR / E_VLM_MALFORMED / E_INVALID_ARGUMENT.
// No path in this module fabricates a prediction or performs I/O without
// an injected transport.

import { createVlm, createDefaultClient, DEFAULT_MODEL, PROVIDER_NAME, IMAGE_MODES, extractActionLine } from './provider.js';
import { COMPUTER_USE_PROMPT, ACTION_LINES, ACTION_SPACE_VERSION_LINE, buildSystemPrompt } from './prompt.js';
import { createHistory, windowTurns, DEFAULT_MAX_TURNS } from './context.js';

export {
  createVlm,
  createDefaultClient,
  DEFAULT_MODEL,
  PROVIDER_NAME,
  IMAGE_MODES,
  extractActionLine,
  COMPUTER_USE_PROMPT,
  ACTION_LINES,
  ACTION_SPACE_VERSION_LINE,
  buildSystemPrompt,
  createHistory,
  windowTurns,
  DEFAULT_MAX_TURNS,
};

export default { createVlm, createDefaultClient, buildSystemPrompt, createHistory };
