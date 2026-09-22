// computer/vlm/provider.js
// Phase 29 Scope E — OpenAI-compatible VLM client over an INJECTED transport.
//
// TARS UITarsModel wraps an OpenAI-compatible endpoint (defaults:
// UI-TARS-1.5-7B, Doubao-1.5-UI-TARS). JEXI mirrors the seam, not the SDK:
//
//   createVlm({ client, model, maxTurns, imageMode })
//     client    — INJECTED transport: client(payload) -> response object
//                 (synchronous, e.g. probe stubs / Scope C seam) OR
//                 Promise<response> (async HTTP). infer() returns a plain
//                 result for sync clients and a Promise for async clients
//                 (declared dual mode). The sandbox injects stubs; nothing
//                 here performs I/O on its own.
//     model     — default 'UI-TARS-1.5-7B' (TARS default, declared).
//     maxTurns  — sliding-window size for internal history
//                 (default 10, see context.js).
//     imageMode — 'base64' (default) | 'url'. DECLARED, never both:
//                 base64 -> image is raw bytes sent as a
//                 data:image/png;base64,... URL; url -> image is a URL
//                 string passed through untouched.
//
//   available() -> { available, model? }   static config only: NO call, NO
//                                          health ping, NO transport touch
//   infer({ image, instruction, history? })
//              -> { raw, prediction }      history (optional) overrides the
//                                          internal window for THIS call
//                                          (still windowed); the completed
//                                          turn is always recorded
//                                          internally
//   reset()    -> { cleared }               clears internal history + audit
//
// Request payload (OpenAI chat completions, deterministic key order):
//   { model, messages: [ system(COMPUTER_USE_PROMPT),
//     ...history pairs (TEXT-ONLY user/assistant),
//     user([image_url part, text part]) ], temperature: 0, stream: false }
//   The image rides ONLY on the current user turn; history is text-only
//   (token discipline). temperature 0 declared for determinism.
//
// Prediction extraction (declared, deterministic): the first line of the
// raw content whose trimmed text starts with a frozen Scope A action name
// followed by '('. No action line -> E_VLM_MALFORMED. The Scope A parser
// remains the parse authority downstream (browser.js ground()).
//
// Truthfulness:
//   - unconfigured -> available() { available:false }; infer() THROWS
//     E_VLM_UNAVAILABLE. No transport object exists in this module without
//     injection — the sandbox makes zero network calls.
//   - never fabricates a prediction: transport throw -> E_VLM_ERROR;
//     error-shaped response -> E_VLM_ERROR; response without choices /
//     content / action line -> E_VLM_MALFORMED. A ComputerError thrown by
//     the injected client propagates UNCHANGED.
//   - validation order (declared): args-object type -> client presence ->
//     field validation -> transport.
//
// Errors (ComputerError codes):
//   E_VLM_UNAVAILABLE  — no provider client configured
//   E_VLM_ERROR        — client threw / provider returned an error object
//   E_VLM_MALFORMED    — response not an object, no choices, no content
//                        string, or no action line in content
//   E_INVALID_ARGUMENT — bad options, bad image/instruction/history shapes

import { ComputerError } from '../errors.js';
import { actionNames } from '../action/space.js';
import { COMPUTER_USE_PROMPT } from './prompt.js';
import { createHistory, windowTurns, DEFAULT_MAX_TURNS } from './context.js';

export const DEFAULT_MODEL = 'UI-TARS-1.5-7B';
export const PROVIDER_NAME = 'openai-compatible';
export const IMAGE_MODES = Object.freeze(['base64', 'url']);

const ACTION_LINE_RE = new RegExp(`^\\s*(?:${actionNames().join('|')})\\s*\\(`);

function invalidArgument(message, details) {
  return new ComputerError('E_INVALID_ARGUMENT', message, details ?? {});
}

function transportError(err) {
  if (err instanceof ComputerError) throw err; // injected client's declared code wins
  throw new ComputerError(
    'E_VLM_ERROR',
    `vlm: provider call failed (${err && err.message ? err.message : String(err)})`,
    {}
  );
}

// ---------------------------------------------------------------------------
// Deployment default transport — mirrors the existing repo HTTP pattern
// (global fetch, ConnectorBase style). NEVER invoked in the sandbox: the
// factory runs only when deployment wiring explicitly calls it. No new
// dependencies — fetch is a Node built-in.
// ---------------------------------------------------------------------------
export function createDefaultClient({ baseUrl, apiKey, timeoutMs = 60000 } = {}) {
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
    throw invalidArgument('createDefaultClient: baseUrl must be an http(s) URL string', {
      got: typeof baseUrl,
    });
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw invalidArgument('createDefaultClient: apiKey must be a non-empty string', {});
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return async function client(payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from VLM endpoint`);
    return res.json();
  };
}

// ---------------------------------------------------------------------------
// Response handling — strict shape validation, then action-line extraction.
// ---------------------------------------------------------------------------
export function extractActionLine(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (ACTION_LINE_RE.test(trimmed)) return trimmed;
  }
  return null;
}

function handleResponse(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new ComputerError('E_VLM_MALFORMED', 'vlm: provider response is not an object', {});
  }
  if (response.error) {
    const msg =
      typeof response.error.message === 'string' ? response.error.message : JSON.stringify(response.error);
    throw new ComputerError('E_VLM_ERROR', `vlm: provider returned error (${msg})`, {});
  }
  const choices = response.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ComputerError('E_VLM_MALFORMED', 'vlm: provider response has no choices array', {});
  }
  const content = choices[0] && choices[0].message && choices[0].message.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new ComputerError('E_VLM_MALFORMED', 'vlm: provider response has no message content string', {});
  }
  const prediction = extractActionLine(content);
  if (!prediction) {
    throw new ComputerError(
      'E_VLM_MALFORMED',
      'vlm: no action line from the frozen vocabulary in provider content',
      { raw: content }
    );
  }
  return { raw: content, prediction };
}

// ---------------------------------------------------------------------------
// Payload construction — deterministic (fixed key order, temperature 0).
// ---------------------------------------------------------------------------
function toImageUrl(image, imageMode) {
  if (imageMode === 'url') {
    if (typeof image !== 'string' || image.length === 0) {
      throw invalidArgument('vlm: image must be a non-empty URL string in url imageMode', {
        got: typeof image,
      });
    }
    return image;
  }
  if (!Buffer.isBuffer(image) && !(image instanceof Uint8Array)) {
    throw invalidArgument('vlm: image must be raw bytes (Buffer/Uint8Array) in base64 imageMode', {
      got: typeof image,
    });
  }
  if (image.length === 0) throw invalidArgument('vlm: image bytes are empty', {});
  return `data:image/png;base64,${Buffer.from(image).toString('base64')}`;
}

function buildPayload({ model, turns, instruction, image, imageMode }) {
  const messages = [{ role: 'system', content: COMPUTER_USE_PROMPT }];
  for (const t of turns) {
    messages.push({ role: 'user', content: t.instruction });
    messages.push({ role: 'assistant', content: t.prediction });
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: toImageUrl(image, imageMode) } },
      { type: 'text', text: instruction },
    ],
  });
  return { model, messages, temperature: 0, stream: false };
}

// ---------------------------------------------------------------------------
// createVlm — the facade. Shape-compatible with the Scope C VLM seam
// (browser.js setVlm: available() / infer({ image, instruction })).
// ---------------------------------------------------------------------------
export function createVlm(opts = {}) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw invalidArgument('createVlm: options must be an object', {});
  }
  const { client = null, model = DEFAULT_MODEL, maxTurns = DEFAULT_MAX_TURNS, imageMode = 'base64' } = opts;
  if (client !== null && typeof client !== 'function') {
    throw invalidArgument('createVlm: client must be a function (payload) -> response | Promise<response>', {});
  }
  if (typeof model !== 'string' || model.length === 0) {
    throw invalidArgument('createVlm: model must be a non-empty string', {});
  }
  if (!IMAGE_MODES.includes(imageMode)) {
    throw invalidArgument(`createVlm: imageMode must be one of ${IMAGE_MODES.join('|')}`, { got: imageMode });
  }
  const history = createHistory({ maxTurns });

  function effectiveTurns(historyOverride) {
    if (historyOverride === undefined) return history.turns();
    const w = windowTurns(historyOverride, maxTurns); // validates + windows
    return w.kept;
  }

  function prepare(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw invalidArgument('infer: args must be an object', {});
    }
    if (!client) {
      throw new ComputerError(
        'E_VLM_UNAVAILABLE',
        'vlm: no provider client configured in this environment; inject one via createVlm({ client })',
        {}
      );
    }
    if (typeof args.instruction !== 'string' || args.instruction.length === 0) {
      throw invalidArgument('vlm: instruction must be a non-empty string', {});
    }
    const imageDataUrl = toImageUrl(args.image, imageMode);
    const turns = effectiveTurns(args.history);
    return buildPayload({ model, turns, instruction: args.instruction, image: args.image, imageMode });
  }

  function infer(args) {
    const payload = prepare(args);
    let res;
    try {
      res = client(payload);
    } catch (err) {
      transportError(err);
    }
    if (res && typeof res.then === 'function') {
      return res.then(handleResponse, transportError).then((result) => {
        history.push({ instruction: args.instruction, prediction: result.prediction });
        return result;
      });
    }
    const result = handleResponse(res);
    history.push({ instruction: args.instruction, prediction: result.prediction });
    return result;
  }

  return {
    providerName: PROVIDER_NAME,
    model,
    imageMode,
    maxTurns,
    available() {
      return client ? { available: true, model } : { available: false };
    },
    infer,
    reset() {
      return history.reset();
    },
    historySnapshot() {
      return history.turns();
    },
    droppedTurns() {
      return history.droppedTurns();
    },
    // Declared evidence/debug surface: the exact payload infer() would send,
    // without any transport call. Same validation, same construction.
    buildRequest(args) {
      return prepare(args);
    },
  };
}
