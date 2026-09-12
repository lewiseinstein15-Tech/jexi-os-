/**
 * JEXI OS — Provider bridge — tool call ID normalization.
 *
 * Providers disagree on tool-call IDs:
 *   - OpenAI:  "call_abc123"
 *   - Anthropic: "toolu_01ABC…"
 *   - Google:  "1234abcd" (functionCall id)
 *   - Ollama local: sometimes absent.
 *
 * The transform guarantees a stable, non-empty id per call so the agent loop
 * can always correlate a result back to its call.
 */

import { NormalizedToolCall } from '../interface/NormalizedToolCall.js';

let counter = 0;

function generateId() {
  counter += 1;
  return `call_${Date.now().toString(36)}_${counter}`;
}

/**
 * Normalize a raw provider tool call into a NormalizedToolCall with a
 * guaranteed non-empty id.
 */
export function normalizeToolCall(raw) {
  const tc = raw instanceof NormalizedToolCall ? raw : NormalizedToolCall.from(raw);
  if (!tc.id) tc.id = generateId();
  return tc;
}

/** Normalize a provider response's tool_calls array. */
export function normalizeToolCalls(rawCalls) {
  if (!Array.isArray(rawCalls)) return [];
  return rawCalls.map(normalizeToolCall);
}

/** Build an assistant message carrying normalized tool calls (OpenAI shape). */
export function toAssistantToolMessage(tc) {
  return { role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } }] };
}

/** Build a tool-role result message (OpenAI shape). */
export function toToolResultMessage(tc, result) {
  return {
    role: 'tool',
    tool_call_id: tc.id,
    content: typeof result === 'string' ? result : JSON.stringify(result),
  };
}