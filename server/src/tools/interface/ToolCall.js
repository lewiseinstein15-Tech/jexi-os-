/**
 * JEXI OS — tools — normalized ToolCall.
 *
 * The canonical tool-call shape the agent loop sees, regardless of which
 * provider produced it. Constructor normalizes the three provider shapes:
 *   OpenAI       { id, function: { name, arguments } }
 *   Anthropic    { id, name, input }
 *   Hermes       { id, name, arguments }
 */

import { NormalizedToolCall } from '../../providers/interface/NormalizedToolCall.js';

export class ToolCall {
  constructor(id, name, args, provider_data) {
    this.id = id ?? '';
    this.name = name ?? '';
    this.arguments = args ?? {};
    if (provider_data !== undefined) this.provider_data = provider_data;
  }

  /** Normalize from any provider wire shape (OpenAI / Anthropic / Hermes). */
  static from(raw) {
    if (raw instanceof ToolCall) return raw;
    const n = NormalizedToolCall.from(raw);
    return new ToolCall(n.id, n.name, n.arguments, n.provider_data);
  }

  /** Render to a provider-specific wire format (inverse transform). */
  toProvider(wire, { provider } = {}) {
    if (wire === 'anthropic') {
      return { id: this.id, type: 'tool_use', name: this.name, input: this.arguments };
    }
    return { id: this.id, type: 'function', function: { name: this.name, arguments: JSON.stringify(this.arguments) } };
  }

  toJSON() {
    const out = { id: this.id, name: this.name, arguments: this.arguments };
    if (this.provider_data) out.provider_data = this.provider_data;
    return out;
  }
}

/** Convenience guard: is this a plain provider tool-call object? */
export function isWireToolCall(raw) {
  return Boolean(raw && (raw?.function?.name || raw?.name) && (raw?.id || raw?.call_id || raw?.type === 'tool_use'));
}