// computer/tool-call/strategies/structured.js
// Phase 29 Scope H — structured outputs strategy.
//
// preparePrompt  -> [] (declared: the schema travels in request params).
// prepareRequest -> { messages, response_format: { type:'json_schema',
//                   json_schema: { name:'tool_call', schema } } } where the
//                   schema constrains the answer to { name, arguments? } —
//                   `name` is an enum of the given tool names (input order),
//                   `arguments` is an open object. Strict-mode tuning is a
//                   deployment concern; the declared schema is honest about
//                   that and never claims constraints it does not carry.
// parseStreaming -> content deltas accumulate; the FIRST time the buffer
//                   parses as JSON the single action is emitted (declared:
//                   one structured action per response).
// parseFinal     -> content must be JSON { name, arguments? } — invalid
//                   JSON, a missing name, or a non-object arguments is
//                   E_TOOL_CALL_MALFORMED.
//
// Deterministic: no clock, no randomness, stable key order.

import { ComputerError } from '../../errors.js';
import { normalizeTools, responseContent, contentDelta } from '../engine.js';

export function createStructuredEngine() {
  return {
    strategy: 'structured',

    initialState() {
      return { buffer: '', emitted: false };
    },

    /** Structured mode carries no prompt segments. */
    preparePrompt() {
      return [];
    },

    /** Structured-outputs request shape (json_schema response_format). */
    prepareRequest(params) {
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'structured: params must be an object', {});
      }
      if (!Array.isArray(params.messages)) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'structured: params.messages must be an array', {});
      }
      const names = normalizeTools(params.tools).map((d) => d.name);
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', enum: names },
          arguments: { type: 'object', default: {} },
        },
        required: ['name'],
        additionalProperties: false,
      };
      return {
        messages: [...params.messages],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'tool_call', schema },
        },
      };
    },

    /**
     * Streaming parse: { state: { buffer, emitted }, actions }. The action
     * is emitted exactly once — at the first buffer state that parses.
     */
    parseStreaming(chunk, state) {
      const prev = state === null || state === undefined ? this.initialState() : state;
      const buffer = prev.buffer + contentDelta(chunk);
      const actions = [];
      let emitted = prev.emitted;
      if (!emitted && buffer.length > 0) {
        let parsed;
        try {
          parsed = JSON.parse(buffer);
        } catch {
          parsed = undefined; // incomplete — keep accumulating
        }
        if (parsed !== undefined) {
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new ComputerError('E_TOOL_CALL_MALFORMED', 'structured: streamed payload is not an object', {});
          }
          if (typeof parsed.name !== 'string' || parsed.name.length === 0) {
            throw new ComputerError('E_TOOL_CALL_MALFORMED', 'structured: streamed payload carries no tool name', {});
          }
          emitted = true;
          actions.push({ action: parsed.name, args: parsed.arguments === undefined ? {} : parsed.arguments });
        }
      }
      return { state: { buffer, emitted }, actions };
    },

    /** Final parse of a structured-outputs response. */
    parseFinal(response) {
      const content = responseContent(response);
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'structured: response content is not valid JSON', {});
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'structured: response payload is not an object', {});
      }
      if (typeof parsed.name !== 'string' || parsed.name.length === 0) {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'structured: payload carries no tool name', {});
      }
      const args = parsed.arguments === undefined ? {} : parsed.arguments;
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'structured: arguments must be an object', {
          name: parsed.name,
        });
      }
      return { actions: [{ action: parsed.name, args }] };
    },
  };
}
