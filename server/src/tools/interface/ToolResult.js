/**
 * JEXI OS — tools — normalized ToolResult.
 *
 * The canonical tool-execution shape fed back to the provider layer:
 * id, name, result, optional ClassifiedError, durationMs, usage.
 */

import { ClassifiedError, classifyError } from '../../providers/error/classify.js';

export class ToolResult {
  constructor({ id, name, result = null, error = null, durationMs = 0, usage = null }) {
    this.id = id ?? '';
    this.name = name ?? '';
    this.error = error;
    if (error) {
      this.ok = false;
    } else {
      this.ok = true;
      this.result = result;
    }
    this.durationMs = durationMs;
    if (usage) this.usage = usage;
  }

  static ok(id, name, result, { durationMs = 0, usage } = {}) {
    return new ToolResult({ id, name, result, durationMs, usage });
  }

  static fail(id, name, error, { durationMs = 0 } = {}) {
    const raw = error ?? new Error('tool failed');
    const classified = raw instanceof ClassifiedError
      ? raw
      : classifyError(raw, 'tool');
    return new ToolResult({ id, name, error: classified, durationMs });
  }

  /** Render to a provider-specific tool-result message block. */
  toProvider(wire, { provider } = {}) {
    if (wire === 'anthropic') {
      return { type: 'tool_result', tool_use_id: this.id, content: typeof this.result === 'string' ? this.result : JSON.stringify(this.result ?? null) };
    }
    return { role: 'tool', tool_call_id: this.id, content: typeof this.result === 'string' ? this.result : JSON.stringify(this.result ?? null) };
  }

  toJSON() {
    return this.error
      ? { id: this.id, name: this.name, ok: false, error: this.error.toJSON?.() ?? this.error.message, durationMs: this.durationMs }
      : { id: this.id, name: this.name, ok: true, result: this.result, durationMs: this.durationMs };
  }
}