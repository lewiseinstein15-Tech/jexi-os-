/**
 * JEXI OS — Provider bridge — normalized response.
 *
 * The Hermes canonical response shape that EVERY adapter produces. The agent
 * loop consumes only this shape — never provider-specific wire formats.
 *
 *   {
 *     content: 'text…',
 *     tool_calls: [ NormalizedToolCall, … ],
 *     finish_reason: 'stop' | 'tool_calls' | 'length' | 'error',
 *     reasoning: '…' | undefined,
 *     usage: { inputTokens, outputTokens, totalCost },
 *     provider_data: { … }          // escape hatch
 *   }
 */

import { NormalizedToolCall } from './NormalizedToolCall.js';

export class NormalizedResponse {
  constructor({
    content = '',
    tool_calls = [],
    finish_reason = 'stop',
    reasoning,
    usage = {},
    provider_data,
  } = {}) {
    this.content = content;
    this.tool_calls = (tool_calls || []).map((tc) =>
      tc instanceof NormalizedToolCall ? tc : NormalizedToolCall.from(tc));
    this.finish_reason = normalizeFinishReason(finish_reason, this.tool_calls.length);
    if (reasoning !== undefined) this.reasoning = reasoning;
    this.usage = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalCost: usage.totalCost ?? 0,
    };
    if (provider_data !== undefined && provider_data !== null) this.provider_data = provider_data;
  }

  static from(raw, opts = {}) {
    if (raw instanceof NormalizedResponse) return raw;
    const content = raw?.content ?? raw?.text ?? '';
    const toolCalls = [];
    const rawCalls = raw?.tool_calls ?? [];
    for (const tc of Array.isArray(rawCalls) ? rawCalls : []) {
      toolCalls.push(NormalizedToolCall.from(tc));
    }
    return new NormalizedResponse({
      content,
      tool_calls: toolCalls,
      finish_reason: normalizeFinishReason(raw?.finish_reason, toolCalls.length),
      reasoning: raw?.reasoning ?? raw?.reasoning_content ?? undefined,
      usage: {
        inputTokens: raw?.usage?.inputTokens ?? raw?.usage?.prompt_tokens ?? raw?.usage?.input_tokens ?? 0,
        outputTokens: raw?.usage?.outputTokens ?? raw?.usage?.completion_tokens ?? raw?.usage?.output_tokens ?? 0,
        totalCost: raw?.usage?.totalCost ?? raw?.usage?.cost ?? 0,
      },
      ...(opts.provider_data ? { provider_data: opts.provider_data } : {}),
    });
  }

  toJSON() {
    return {
      content: this.content,
      tool_calls: this.tool_calls.map((tc) => tc.toJSON()),
      finish_reason: this.finish_reason,
      ...(this.reasoning !== undefined ? { reasoning: this.reasoning } : {}),
      usage: this.usage,
      ...(this.provider_data ? { provider_data: this.provider_data } : {}),
    };
  }
}

function normalizeFinishReason(rawReason, callCount) {
  if (rawReason === 'tool_calls' || rawReason === 'tool_use' || rawReason === 'function_call') {
    return 'tool_calls';
  }
  if (rawReason === 'length' || rawReason === 'max_tokens') return 'length';
  if (rawReason === 'error') return 'error';
  if (callCount > 0) return 'tool_calls';
  return 'stop';
}