/**
 * JEXI OS — Provider bridge — normalize entry point.
 *
 * OpenCode transform.ts equivalent: normalizeRequest / normalizeResponse /
 * normalizeToolCall / normalizeError. Adapters delegate to these to stay thin.
 */

import { buildChatRequest } from './messages.js';
import { normalizeToolCalls, normalizeToolCall } from './toolCalls.js';
import { extractReasoning, extractVisibleContent } from './reasoning.js';
import { NormalizedResponse } from '../interface/NormalizedResponse.js';
import { classifyError } from '../error/classify.js';

/** Normalize an agent-loop request into the adapter's input shape. */
export function normalizeRequest(req, provider) {
  const request = buildChatRequest(req ?? {});
  return (provider && typeof provider.transformRequest === 'function')
    ? provider.transformRequest(request)
    : request;
}

/** Normalize a raw provider response into the canonical NormalizedResponse. */
export function normalizeResponse(raw, provider, opts = {}) {
  if (raw instanceof NormalizedResponse) return raw;
  const isOpenAI = Array.isArray(raw?.choices) && raw.choices[0]?.message;
  const message = isOpenAI ? raw.choices[0].message : raw?.message ?? raw;
  const choice = isOpenAI ? raw.choices[0] : raw;

  const reasoning = extractReasoning(message) ?? extractReasoning(raw);
  const content = opts.content ?? (isOpenAI ? message.content : extractVisibleContent(raw));

  // Tool calls: OpenAI style (raw/message.tool_calls), Anthropic style
  // (tool_use blocks inside content), or already-normalized arrays.
  let toolCalls = normalizeToolCalls(raw?.tool_calls ?? message?.tool_calls ?? []);
  if (!toolCalls.length) {
    const contentBlocks = Array.isArray(message.content) ? message.content
      : Array.isArray(raw?.content) ? raw.content : [];
    const blockCalls = contentBlocks
      .filter((b) => b?.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input ?? {} }));
    toolCalls = normalizeToolCalls(blockCalls);
  }

  const usage = isOpenAI ? raw?.usage : raw?.usage ?? {};
  const finishReason = isOpenAI ? choice.finish_reason : raw?.stop_reason ?? raw?.finish_reason;
  return new NormalizedResponse({
    content,
    tool_calls: toolCalls,
    finish_reason: finishReason,
    reasoning,
    usage: {
      inputTokens: usage.inputTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? opts.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? usage.completion_tokens ?? usage.output_tokens ?? opts.outputTokens ?? 0,
      totalCost: usage.totalCost ?? usage.cost ?? opts.totalCost ?? 0,
    },
    ...(opts.provider_data || raw?.provider_data ? { provider_data: opts.provider_data ?? raw.provider_data } : {}),
  });
}

/** Normalize a raw thrown value into a ClassifiedError. */
export function normalizeError(raw, provider) {
  return classifyError(raw, provider?.id ?? 'unknown');
}

export { normalizeToolCall };
export { buildChatRequest };