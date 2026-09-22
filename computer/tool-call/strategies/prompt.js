// computer/tool-call/strategies/prompt.js
// Phase 29 Scope H — prompt-engineering strategy (the GUI engine).
//
// TARS lineage: GuiToolCallEngine serves tools through the PROMPT instead
// of request params — the tool schema is rendered into a <computer_env>
// segment (env-tag style, T5/OmniTARS discipline), and the model answers
// with GUI action lines inside a <computer_env> block:
//
//   <computer_env>
//   <tool name="click">{"start_box":{"kind":"box"}}</tool>
//   ...
//   </computer_env>
//
// preparePrompt  -> one text segment carrying the tool schema per tool;
//                   GUI names without explicit parameters get the Scope A
//                   frozen arg schema (grammar authority stays Scope A).
// prepareRequest -> the segment is merged into the system message; NO
//                   function tools are sent (prompt mode).
// parseStreaming -> chunks accumulate; every COMPLETE <computer_env> block
//                   is parsed as it closes; incomplete tails stay buffered.
// parseFinal     -> the FIRST complete <computer_env> block wins; each line
//                   whose leading token is a Scope A action name is parsed
//                   by action.parse (E_UNKNOWN_ACTION / E_MALFORMED_ACTION
//                   propagate UNCHANGED); non-action lines (Thought: ...)
//                   are skipped; a block with zero action lines is
//                   E_TOOL_CALL_MALFORMED (no fabricated progress).
//
// Deterministic: first-block rule, no clock, no randomness, stable key
// order from the Scope A frozen tables.

import { ComputerError } from '../../errors.js';
import { action, ACTIONS } from '../../action/index.js';
import { normalizeTools, responseContent, contentDelta } from '../engine.js';

const OPEN = '<computer_env>';
const CLOSE = '</computer_env>';
const CALL_SHAPE = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
const GUI_SPACE = new Set(action.space());

/** Scope A arg schema for a GUI action name, or null outside the space. */
function guiSchemaFor(name) {
  const schema = ACTIONS[name];
  return schema ? schema.args : null;
}

/** Parse every GUI action line inside one tag-block body (shared by final + streaming). */
function extractBlockActions(inner) {
  const actions = [];
  for (const line of inner.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = CALL_SHAPE.exec(trimmed);
    if (!m || !GUI_SPACE.has(m[1])) continue; // Thought: / unknown names are not GUI actions
    actions.push(action.parse(trimmed)); // Scope A errors propagate UNCHANGED
  }
  if (actions.length === 0) {
    throw new ComputerError(
      'E_TOOL_CALL_MALFORMED',
      'prompt: no GUI action line inside <computer_env> block',
      { block: inner.slice(0, 200) }
    );
  }
  return actions;
}

export function createPromptEngine() {
  return {
    strategy: 'prompt',

    initialState() {
      return { buffer: '', consumed: 0 };
    },

    /** promptSegments: one <computer_env> text segment embedding the tool schema. */
    preparePrompt(tools) {
      const descriptors = normalizeTools(tools);
      const lines = descriptors.map((d) => {
        const params = d.parameters !== null && d.parameters !== undefined ? d.parameters : guiSchemaFor(d.name);
        const schemaJson = params === null || params === undefined ? '' : JSON.stringify(params);
        return `<tool name="${d.name}">${schemaJson}</tool>`;
      });
      const content = `${OPEN}\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${CLOSE}`;
      return [
        {
          type: 'text',
          tag: 'computer_env',
          content,
          tools: descriptors,
        },
      ];
    },

    /**
     * Prompt mode request: the segment is merged into the system message
     * (prepended when absent); NO function tools travel in the request.
     */
    prepareRequest(params) {
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'prompt: params must be an object', {});
      }
      if (!Array.isArray(params.messages)) {
        throw new ComputerError('E_INVALID_ARGUMENT', 'prompt: params.messages must be an array', {});
      }
      const segment = this.preparePrompt(params.tools)[0].content;
      const first = params.messages[0];
      const messages =
        first !== null && typeof first === 'object' && first.role === 'system' && typeof first.content === 'string'
          ? [{ ...first, content: `${first.content}\n\n${segment}` }, ...params.messages.slice(1)]
          : [{ role: 'system', content: segment }, ...params.messages];
      return { messages };
    },

    /**
     * Streaming parse: { state: { buffer, consumed }, actions }. Every
     * COMPLETE <computer_env> block is emitted exactly once, in order;
     * state.consumed only ever advances past closed blocks.
     */
    parseStreaming(chunk, state) {
      const prev = state === null || state === undefined ? this.initialState() : state;
      const buffer = prev.buffer + contentDelta(chunk);
      const actions = [];
      let consumed = prev.consumed;
      for (;;) {
        const open = buffer.indexOf(OPEN, consumed);
        if (open === -1) break;
        const close = buffer.indexOf(CLOSE, open + OPEN.length);
        if (close === -1) break; // block not closed yet — stays buffered
        actions.push(...extractBlockActions(buffer.slice(open + OPEN.length, close)));
        consumed = close + CLOSE.length;
      }
      return { state: { buffer, consumed }, actions };
    },

    /** Final parse: the FIRST complete <computer_env> block wins. */
    parseFinal(response) {
      const content = responseContent(response);
      const open = content.indexOf(OPEN);
      if (open === -1) {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'prompt: no <computer_env> block in response', {});
      }
      const close = content.indexOf(CLOSE, open + OPEN.length);
      if (close === -1) {
        throw new ComputerError('E_TOOL_CALL_MALFORMED', 'prompt: unterminated <computer_env> block', {});
      }
      return { actions: extractBlockActions(content.slice(open + OPEN.length, close)) };
    },
  };
}
