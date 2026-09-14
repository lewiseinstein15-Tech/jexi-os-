/**
 * JEXI OS — Provider bridge — shared chat-client base.
 *
 * One base class implements the LLMProvider contract with the shared
 * HTTP + normalize machinery; vendor adapters declare ids, base URLs,
 * auth style and a model table. This keeps each vendor file SHORT and
 * the provider-specific surface minimal (less to corrupt, easier to review).
 */

import {
  resolveBaseUrl,
  buildAuthHeaders,
  chatCompletionsRequest,
  anthropicMessagesRequest,
  toOpenAIRequest,
  fromOpenAIResponse,
  estimateTokens,
} from './base.js';
import { NormalizedResponse } from '../interface/NormalizedResponse.js';
import { ClassifiedError } from '../error/classify.js';
import { readSSE, openaiChunkToDelta, anthropicDeltaToDelta, openaiUsage, anthropicUsage, finalizeToolCalls } from './sse.js';

export class ChatClientBase {
  constructor({ id, cfg, env = process.env, adapter = 'openai', wire = 'openai' }) {
    this.id = id;
    this.cfg = cfg || {};
    this.env = env;
    this.baseUrl = resolveBaseUrl(this.id, this.cfg, env);
    this.headers = buildAuthHeaders({ ...this.cfg, adapter }, env);
    this.wire = wire;
    this.modelConfig = {};
  }

  isConfigured() {
    const needsKey = this.cfg.needsKey !== false;
    if (!needsKey) return true;
    const key = this.cfg.keyEnv ? this.env[this.cfg.keyEnv] : null;
    return Boolean(key || this.cfg.apiKey);
  }

  async chat(request) {
    if (!this.isConfigured()) {
      throw ClassifiedError.notConfigured(`${this.id}: no API key configured (${this.cfg.keyEnv ?? 'keyEnv'})`, { provider: this.id });
    }
    const raw = this.wire === 'anthropic'
      ? await this.anthropicChat(request)
      : await this.openaiChat(request);
    return raw instanceof NormalizedResponse ? raw : normalizeFor(this.wire, raw);
  }

  /**
   * Scope D (part 1) — REAL SSE streaming (replaces the D0 placeholder that
   * always yielded a single empty chunk).
   *
   * Opens a real streaming request to the provider and reads the SSE frames:
   *   openai    → POST {baseUrl}/chat/completions with stream:true
   *   anthropic → POST {baseUrl}/messages with stream:true
   *
   * Yields normalized ChatChunk records (same contract as the interface):
   *   { type:'chunk', text, delta:{ content?, reasoning?, tool_calls? } }
   *   { type:'done',  text, delta:{}, usage, tool_calls }
   *
   * Failures are honest: the fetch error (HTTP status / network) is thrown
   * just like `chat()` throws — the caller decides whether to fall back.
   */
  async *stream(request) {
    const base = this.baseUrl.replace(/\/$/, '');
    const url = this.wire === 'anthropic' ? `${base}/messages` : `${base}/chat/completions`;
    let body;
    if (this.wire === 'anthropic') {
      body = this.toAnthropicRequest(request);
      body.stream = true;
    } else {
      body = toOpenAIRequest(request);
      body.model = request.model ?? this.defaultModel();
      body.stream = true;
    }
    const headers = { ...this.headers };

    const acc = { toolCalls: [] };
    let text = '';

    try {
      for await (const { event, data } of readSSE({ url, headers, body })) {
        if (event === 'error') {
          let msg = data;
          try { msg = JSON.parse(data)?.error?.message || data; } catch { /* keep raw */ }
          throw new ClassifiedError(`stream failed: ${msg}`, { id: this.id, provider: this.id, status: 502 });
        }
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        if (this.wire === 'anthropic') {
          if (json.type === 'message_stop') break;
          const delta = anthropicDeltaToDelta(json, acc);
          const usage = json.type === 'message_delta' ? anthropicUsage(json, acc) : null;
          if (usage && (usage.inputTokens || usage.outputTokens)) acc.usage = usage;
          if (delta.content) text += delta.content;
          if (delta.content || delta.reasoning || delta.tool_calls) {
            yield { type: 'chunk', text, delta };
          }
          continue;
        }
        const delta = openaiChunkToDelta(json, acc);
        if (delta.content) text += delta.content;
        if (json.usage) acc.usage = openaiUsage(json, acc);
        const finish = json.choices?.[0]?.finish_reason;
        if (delta.content || delta.reasoning || delta.tool_calls || finish) {
          yield { type: 'chunk', text, delta: { ...delta, finish_reason: finish } };
        }
        if (finish) break;
      }
    } catch (e) {
      if (e instanceof ClassifiedError) throw e;
      throw new ClassifiedError(`stream failed: ${(e && e.message) || e}`, { id: this.id, provider: this.id, status: e?.status || 502 });
    }

    yield {
      type: 'done',
      text,
      delta: {},
      usage: acc.usage || { inputTokens: 0, outputTokens: 0, totalCost: 0, provider_data: {} },
      tool_calls: finalizeToolCalls(acc.toolCalls),
    };
  }

  countTokens(text) {
    return estimateTokens(text);
  }

  estimateCost(request) {
    const model = request?.model ?? Object.keys(this.modelConfig)[0];
    const cfg = this.modelConfig[model];
    if (!cfg) return 0;
    const input = estimateTokens((request?.messages || []).map((m) => JSON.stringify(m)).join(' '));
    const inPerTok = (cfg.priceInPer1M ?? 0) / 1_000_000;
    const outPerTok = (cfg.priceOutPer1M ?? 0) / 1_000_000;
    return input * inPerTok + (request?.max_tokens ?? cfg.maxOutput ?? 0) * 0.5 * outPerTok;
  }

  listModels() {
    return Object.entries(this.modelConfig).map(([id, m]) => ({
      id,
      name: id,
      contextWindow: m.contextWindow ?? 0,
      maxTokens: m.maxOutput ?? 0,
      pricing: {
        inputPer1M: m.priceInPer1M ?? 0,
        outputPer1M: m.priceOutPer1M ?? 0,
      },
      capabilities: {
        toolCalling: this.capabilities?.toolCalling ?? true,
        vision: this.capabilities?.vision ?? false,
        streaming: this.capabilities?.streaming ?? true,
        structuredOutput: this.capabilities?.structuredOutput ?? true,
      },
    }));
  }

  async openaiChat(request) {
    const body = toOpenAIRequest(request);
    body.model = request.model ?? this.defaultModel();
    const json = await chatCompletionsRequest({ baseUrl: this.baseUrl, headers: this.headers, request: { ...body, timeoutMs: request.timeoutMs } });
    return fromOpenAIResponse(json);
  }

  async anthropicChat(request) {
    const body = this.toAnthropicRequest(request);
    const json = await anthropicMessagesRequest({ baseUrl: this.baseUrl, headers: this.headers, request: { ...body, timeoutMs: request.timeoutMs } });
    return fromAnthropicResponse(json);
  }

  toAnthropicRequest(request) {
    const { messages, tools, temperature, max_tokens, system } = request;
    const body = {
      model: request.model ?? this.defaultModel(),
      messages,
      max_tokens: max_tokens ?? 4096,
    };
    if (system) body.system = system;
    if (temperature !== undefined) body.temperature = temperature;
    if (tools?.length) body.tools = tools.map((t) => ({
      name: t.function?.name ?? t.name,
      description: t.function?.description ?? t.description ?? '',
      input_schema: t.function?.parameters ?? t.parameters ?? { type: 'object', properties: {} },
    }));
    return body;
  }

  defaultModel() {
    return Object.keys(this.modelConfig)[0] ?? null;
  }
}

function fromAnthropicResponse(json) {
  const blocks = json?.content ?? [];
  let content = '';
  let reasoning;
  const toolCalls = [];
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') content += b.text;
    else if (b.type === 'thinking' && typeof b.thinking === 'string') reasoning = b.thinking;
    else if (b.type === 'tool_use') {
      toolCalls.push({ id: b.id, name: b.name, arguments: b.input ?? {} });
    }
  }
  const usage = json?.usage ?? {};
  return new NormalizedResponse({
    content,
    tool_calls: toolCalls,
    finish_reason: json?.stop_reason === 'tool_use' ? 'tool_calls' : json?.stop_reason === 'max_tokens' ? 'length' : 'stop',
    reasoning,
    usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, totalCost: 0 },
    provider_data: { raw: json },
  });
}

function normalizeFor(wire, raw) {
  if (wire === 'anthropic') return fromAnthropicResponse?.(raw);
  return raw;
}