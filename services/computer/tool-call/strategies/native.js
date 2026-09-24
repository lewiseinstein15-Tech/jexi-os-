// computer/tool-call/strategies/native.js
// Phase 29 Scope H — native strategy: OpenAI-compatible function calling.
//
// preparePrompt  -> [] (declared: the schema travels in request params,
//                   never in the prompt).
// prepareRequest -> { messages, tools: [{ type:'function', function:{
//                   name, description, parameters } }], tool_choice:'auto' }.
//                   Tools are accepted as name strings, descriptors, or
//                   OpenAI function shapes; missing description -> '',
//                   missing parameters -> the empty object schema.
// parseStreaming -> OpenAI tool_call delta accumulation: deltas are merged
//                   by index (name and arguments strings append); a call is
//                   emitted exactly once when its accumulated arguments
//                   first parse as JSON. Chunks without tool_call deltas
//                   are ignored (content chunks are legitimate).
// parseFinal     -> choices[0].message.tool_calls -> actions. A response
//                   with no tool_calls is a text answer -> { actions: [] }
//                   (declared: nothing to execute, nothing fabricated);
//                   a response without a choices/message envelope, a call
//                   without a name, or non-JSON arguments is
//                   E_TOOL_CALL_MALFORMED.
//
// Deterministic: stable key order, no clock, no randomness.

import { ComputerError } from '../../errors.js';
import { normalizeTools } from '../engine.js';

const EMPTY_PARAMS = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  required: Object.freeze([]),
});

export function createNativeEngine() {
  return {
    strategy: 'native',

    initialState() {
      return { calls: [] };
    },

    /** Native mode carries no prompt segments. */
    preparePrompt() {
      return [];
    },

    /** OpenAI function-calling request shape. */
    prepareRequest(params) {
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'native: params must be an object', {});
      }
      if (!Array.isArray(params.messages)) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'native: params.messages must be an array', {});
      }
      const tools = normalizeTools(params.tools).map((d) => ({
        type: 'function',
        function: {
          name: d.name,
          description: d.description,
          parameters: d.parameters !== null && d.parameters !== undefined ? d.parameters : EMPTY_PARAMS,
        },
      }));
      return { messages: [...params.messages], tools, tool_choice: 'auto' };
    },

    /**
     * Streaming parse: { state: { calls }, actions }. Delta index misuse
     * (negative / non-integer) is E_INVALID_ARGUMENT.
     */
    parseStreaming(chunk, state) {
      const prev = state === null || state === undefined ? this.initialState() : state;
      const calls = prev.calls.map((c) => ({ ...c }));

      const deltas =
        chunk !== null && typeof chunk === 'object' && !Array.isArray(chunk)
          ? (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.tool_calls) ||
            (chunk.delta && chunk.delta.tool_calls) ||
            chunk.tool_calls ||
            null
          : null;

      if (Array.isArray(deltas)) {
        for (const d of deltas) {
          if (d === null || typeof d !== 'object') {
            throw new ComputerError('E_INVALID_ARGUMENT', 'native: tool_call delta must be an object', {});
          }
          const idx = Number.isInteger(d.index) ? d.index : calls.length;
          if (idx < 0) {
            throw new ComputerError(
              'E_INVALID_ARGUMENT',
              'native: tool_call delta index must be a non-negative integer',
              { index: d.index }
            );
          }
          while (calls.length <= idx) calls.push({ name: '', arguments: '', emitted: false });
          const c = calls[idx];
          if (d.function && typeof d.function.name === 'string') c.name += d.function.name;
          if (d.function && typeof d.function.arguments === 'string') c.arguments += d.function.arguments;
        }
      }

      const actions = [];
      for (const c of calls) {
        if (c.emitted || !c.name || !c.arguments) continue;
        let parsed;
        try {
          parsed = JSON.parse(c.arguments);
        } catch {
          continue; // incomplete arguments — wait for more chunks
        }
        c.emitted = true;
        actions.push({ action: c.name, args: parsed });
      }
      return { state: { calls }, actions };
    },

    /** Final parse of an OpenAI function-calling response. */
    parseFinal(response) {
      if (response === null || typeof response !== 'object' || Array.isArray(response)) {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'native: response is not an object', {
          got: response === null ? 'null' : typeof response,
        });
      }
      const message = response.choices && response.choices[0] ? response.choices[0].message : undefined;
      if (message === null || typeof message !== 'object') {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'native: response has no choices/message envelope', {});
      }
      const toolCalls = message.tool_calls;
      if (toolCalls === undefined || toolCalls === null) {
        return { actions: [] }; // text-only answer — zero calls, declared
      }
      if (!Array.isArray(toolCalls)) {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'native: message.tool_calls must be an array', {});
      }
      const actions = toolCalls.map((tc) => {
        const fn = tc !== null && typeof tc === 'object' ? tc.function : undefined;
        if (!fn || typeof fn.name !== 'string' || fn.name.length === 0) {
          throw new ComputerError('E_TOOL_CALL_MALFORMED', 'native: tool_call carries no function name', {});
        }
        const raw = fn.arguments;
        let args;
        if (raw === undefined || raw === null) {
          args = {}; // zero-arg call, declared
        } else if (typeof raw === 'string') {
          try {
            args = JSON.parse(raw);
          } catch {
            throw new ComputerError(
              'E_TOOL_CALL_MALFORMED',
              `native: tool_call arguments is not valid JSON for '${fn.name}'`,
              { name: fn.name }
            );
          }
        } else if (typeof raw === 'object') {
          args = raw; // verbatim decode, declared
        } else {
          throw new ComputerError('E_TOOL_CALL_MALFORMED', `native: unsupported arguments type for '${fn.name}'`, {
            name: fn.name,
            got: typeof raw,
          });
        }
        return { action: fn.name, args };
      });
      return { actions };
    },
  };
}
