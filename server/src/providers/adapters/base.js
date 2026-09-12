/**
 * JEXI OS — Provider bridge — adapter base helpers.
 *
 * Shared session/fetch + normalize machinery for the thin per-vendor
 * adapters: baseURL resolution, auth header, plain chat-completions POST,
 * streaming SSE passthrough, token estimation, and self-test.
 */

import { normalizeResponse } from '../transform/normalize.js';
import { normalizeToolCall } from '../transform/toolCalls.js';
import { NormalizedResponse } from '../interface/NormalizedResponse.js';

const DEFAULT_HEADERS = { 'Content-Type': 'application/json' };

/** Resolve the effective base URL for a provider config. */
export function resolveBaseUrl(id, cfg, env = process.env) {
  if (cfg?.baseUrl) return cfg.baseUrl;
  const envUrl = env[id.toUpperCase() + '_BASE_URL'];
  return envUrl || cfg?.defaultBaseUrl || `https://api.${id}.com/v1`;
}

/** Build auth headers from the configured key (env-resolved). */
export function buildAuthHeaders(cfg, env = process.env) {
  const key = cfg?.keyEnv ? env[cfg.keyEnv] : null;
  const headers = { ...DEFAULT_HEADERS };
  if (cfg?.adapter === 'anthropic') {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  if (cfg?.headers) Object.assign(headers, cfg.headers);
  return headers;
}

/** Shared chat-completions POST for OpenAI-compatible providers. */
export async function chatCompletionsRequest({ baseUrl, headers, request }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw buildHttpError(res);
  return res.json();
}

/** Anthropic Messages API POST. */
export async function anthropicMessagesRequest({ baseUrl, headers, request }) {
  const url = `${baseUrl.replace(/\/$/, '')}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.timeoutMs ?? 180_000),
  });
  if (!res.ok) throw buildHttpError(res);
  return res.json();
}

function buildHttpError(res) {
  const err = new Error(`HTTP ${res.status} from provider`);
  err.status = res.status;
  return err;
}

/** Very rough token estimator (~4 chars/token, 75% rule for non-Latin). */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const ascii = (s.match(/[\x00-\x7F]/g) || []).length;
  const other = s.length - ascii;
  return Math.ceil(ascii / 4 + other / 0.75);
}

/** Simple cost from model config price table. */
export function estimateCost(usage, modelConfig) {
  if (!modelConfig) return 0;
  const inPerTok = (modelConfig.priceInPer1M ?? 0) / 1_000_000;
  const outPerTok = (modelConfig.priceOutPer1M ?? 0) / 1_000_000;
  return usage.inputTokens * inPerTok + usage.outputTokens * outPerTok;
}

/** Helper: request body for OpenAI-compatible chat completions (tools-aware). */
export function toOpenAIRequest(request) {
  const { messages, tools, temperature, max_tokens, stop, response_format } = request;
  const body = { messages };
  if (tools?.length) body.tools = tools.map(toOpenAITool);
  if (temperature !== undefined) body.temperature = temperature;
  if (max_tokens !== undefined) body.max_tokens = max_tokens;
  if (stop) body.stop = stop;
  if (response_format) body.response_format = response_format;
  return body;
}

export function toOpenAITool(tool) {
  if (tool?.type === 'function' || tool?.function) return tool;
  return { type: 'function', function: { name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? { type: 'object', properties: {} } } };
}

/** Transform OpenAI-compatible wire response → NormalizedResponse. */
export function fromOpenAIResponse(json) {
  const choice = json?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name ?? '',
    arguments: safeArgs(tc.function?.arguments),
    provider_data: { type: 'openai' },
  }));
  return new NormalizedResponse({
    content: message.content ?? '',
    tool_calls: toolCalls,
    finish_reason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason ?? 'stop',
    reasoning: message.reasoning_content ?? undefined,
    usage: {
      inputTokens: json?.usage?.prompt_tokens ?? 0,
      outputTokens: json?.usage?.completion_tokens ?? 0,
      totalCost: 0,
    },
    provider_data: { raw: json },
  });
}

export function safeArgs(args) {
  if (!args) return {};
  if (typeof args === 'object') return args;
  try { return JSON.parse(args); } catch { return {}; }
}

export { normalizeResponse, normalizeToolCall };