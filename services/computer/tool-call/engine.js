// computer/tool-call/engine.js
// Phase 29 Scope H — the tool-call engine strategy interface + registry.
//
// Ported from TARS (bytedance/UI-TARS-desktop, Apache 2.0) ToolCallEngine
// strategy design: HOW a model is asked for tools (prompt segments / request
// params) and HOW its answer is parsed back into actions is a pluggable
// strategy. Declared strategies:
//
//   native      OpenAI-compatible function calling (tools in request params)
//   prompt      prompt engineering: tools rendered into a <computer_env>
//               prompt segment (TARS GuiToolCallEngine lineage; env-tag style)
//   structured  structured outputs: response_format json_schema envelope
//
// Strategy interface (every engine object implements exactly this):
//   engine.preparePrompt(tools)          -> promptSegments []
//   engine.prepareRequest(params)        -> requestParams
//   engine.parseStreaming(chunk, state)  -> { state, actions }
//   engine.parseFinal(response)          -> { actions }
//
// Selection is priority-based and DECLARED (selector.js): GUI actions or a
// <computer_env> tag -> GUI engine priority 90; code tool names -> Code
// engine priority 80; otherwise the native default (fallback). Engines are
// plain factory objects — zero new classes; the only error class in
// computer/** remains ComputerError.
//
// Error codes declared by Scope H (ComputerError only):
//   E_UNKNOWN_TOOL_CALL_ENGINE  createEngine/registerEngine with a strategy
//                               name outside the registry
//   E_TOOL_CALL_MALFORMED       a response/payload cannot be parsed into
//                               actions (no content, no tag block, no valid
//                               JSON, no action line)
// Reused codes: E_INVALID_ARGUMENT (argument misuse) and Scope A's
// E_UNKNOWN_ACTION / E_MALFORMED_ACTION (propagated UNCHANGED from
// action.parse — the grammar authority stays Scope A).
//
// Determinism: no clock, no randomness; shared helpers are function
// declarations (circular-import safe); every parse is a pure function of
// its inputs.

import { ComputerError } from '../errors.js';
import { createNativeEngine } from './strategies/native.js';
import { createPromptEngine } from './strategies/prompt.js';
import { createStructuredEngine } from './strategies/structured.js';

// Error codes declared by Scope H. Every one is carried by ComputerError
// (computer/errors.js) — no new error class.
export const TOOL_CALL_CODES = Object.freeze([
  'E_UNKNOWN_TOOL_CALL_ENGINE',
  'E_TOOL_CALL_MALFORMED',
]);

/** The contract methods every strategy engine must implement. */
export const ENGINE_METHODS = Object.freeze([
  'preparePrompt',
  'prepareRequest',
  'parseStreaming',
  'parseFinal',
]);

/**
 * Validate one engine object against the strategy interface.
 * Throws ComputerError(E_INVALID_ARGUMENT) on a shape violation.
 */
export function assertEngineShape(engine) {
  const missing = engine === null || typeof engine !== 'object'
    ? [...ENGINE_METHODS]
    : ENGINE_METHODS.filter((m) => typeof engine[m] !== 'function');
  if (missing.length > 0) {
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `tool-call: engine must implement ${ENGINE_METHODS.join('/')} (missing: ${missing.join(', ')})`,
      { missing }
    );
  }
  return true;
}

// --- shared input normalization (used across strategies) ---------------------

/**
 * Normalize a tools argument into descriptors [{ name, description, parameters }].
 * Accepted entries: 'name' | { name, description?, parameters? } |
 * { function: { name, description?, parameters? } } (OpenAI function shape).
 * Deterministic; misuse is E_INVALID_ARGUMENT.
 */
export function normalizeTools(tools) {
  if (tools === undefined || tools === null) return [];
  if (!Array.isArray(tools)) {
    throw new ComputerError('E_INVALID_ARGUMENT', `tool-call: tools must be an array (got ${typeof tools})`, {
      got: typeof tools,
    });
  }
  return tools.map((t) => {
    if (typeof t === 'string') {
      if (t.length === 0) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'tool-call: tool name must be a non-empty string', {});
      }
      return { name: t, description: '', parameters: null };
    }
    if (t !== null && typeof t === 'object' && !Array.isArray(t)) {
      const fn = t.function !== null && typeof t.function === 'object' ? t.function : null;
      const name =
        typeof t.name === 'string' && t.name.length > 0
          ? t.name
          : fn !== null && typeof fn.name === 'string' && fn.name.length > 0
            ? fn.name
            : null;
      if (!name) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'tool-call: tool entry must carry a non-empty string name', {});
      }
      const description =
        typeof t.description === 'string'
          ? t.description
          : fn !== null && typeof fn.description === 'string'
            ? fn.description
            : '';
      const parameters =
        t.parameters !== undefined ? t.parameters : fn !== null && fn.parameters !== undefined ? fn.parameters : null;
      return { name, description, parameters };
    }
    throw new ComputerError(
      'E_INVALID_ARGUMENT',
      `tool-call: tool entry must be a name string or a descriptor object (got ${t === null ? 'null' : typeof t})`,
      {}
    );
  });
}

/** Tool names only (selector input view of normalizeTools). */
export function extractToolNames(tools) {
  return normalizeTools(tools).map((d) => d.name);
}

/**
 * Strict text-content extraction from a response envelope. Accepted:
 * plain string | { choices:[{ delta:{content} }] } | { choices:[{ message:{content} }] }
 * | { content }. Anything else -> E_TOOL_CALL_MALFORMED (never guessed).
 */
export function responseContent(response) {
  if (typeof response === 'string') return response;
  if (response !== null && typeof response === 'object' && !Array.isArray(response)) {
    const d = response.choices && response.choices[0] && response.choices[0].delta
      ? response.choices[0].delta.content
      : undefined;
    if (typeof d === 'string') return d;
    const m =
      response.choices && response.choices[0] && response.choices[0].message
        ? response.choices[0].message.content
        : undefined;
    if (typeof m === 'string') return m;
    if (typeof response.content === 'string') return response.content;
  }
  throw new ComputerError('E_TOOL_CALL_MALFORMED', 'tool-call: response carries no text content', {
    got: response === null ? 'null' : typeof response,
  });
}

/**
 * Lenient streaming counterpart of responseContent: a chunk with no text
 * piece yields '' (streaming chunks legitimately carry no content).
 */
export function contentDelta(chunk) {
  if (typeof chunk === 'string') return chunk;
  if (chunk !== null && typeof chunk === 'object' && !Array.isArray(chunk)) {
    const d =
      chunk.choices && chunk.choices[0] && chunk.choices[0].delta
        ? chunk.choices[0].delta.content
        : undefined;
    if (typeof d === 'string') return d;
    const m =
      chunk.choices && chunk.choices[0] && chunk.choices[0].message
        ? chunk.choices[0].message.content
        : undefined;
    if (typeof m === 'string') return m;
    if (typeof chunk.content === 'string') return chunk.content;
  }
  return '';
}

// --- strategy registry (pluggable) -------------------------------------------
//
// The three declared strategies are registered at load. registerEngine is
// the declared extension seam: new strategies plug in WITHOUT editing the
// declared set (mirrors Scope B's attachBackend discipline). The registry
// order is deterministic: declaration order, then registration order.

const registry = new Map([
  ['native', createNativeEngine],
  ['prompt', createPromptEngine],
  ['structured', createStructuredEngine],
]);

/** Create one strategy engine by name. Unknown name -> E_UNKNOWN_TOOL_CALL_ENGINE. */
export function createEngine(name) {
  const factory = typeof name === 'string' ? registry.get(name) : undefined;
  if (!factory) {
    const shown = typeof name === 'string' ? `'${name}'` : `(${typeof name})`;
    throw new ComputerError(
      'E_UNKNOWN_TOOL_CALL_ENGINE',
      `tool-call: unknown engine strategy ${shown} — known strategies: ${[...registry.keys()].join(', ')}`,
      { name, known: [...registry.keys()] }
    );
  }
  return factory();
}

/**
 * Pluggability seam: register a new strategy factory under `name`. The
 * factory must be stateless and produce an interface-conformant engine
 * (validated before acceptance). Duplicate names are refused.
 */
export function registerEngine(name, factory) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new ComputerError('E_INVALID_ARGUMENT', 'tool-call: registerEngine requires a non-empty string name', {});
  }
  if (typeof factory !== 'function') {
    throw new ComputerError('E_INVALID_ARGUMENT', 'tool-call: registerEngine requires a factory function', {});
  }
  if (registry.has(name)) {
    throw new ComputerError('E_INVALID_ARGUMENT', `tool-call: strategy '${name}' is already registered`, { name });
  }
  assertEngineShape(factory()); // validate-before-accept; factories are stateless
  registry.set(name, factory);
  return { registered: name, engines: engineNames() };
}

/** Registered strategy names, in declaration + registration order. */
export function engineNames() {
  return Object.freeze([...registry.keys()]);
}
