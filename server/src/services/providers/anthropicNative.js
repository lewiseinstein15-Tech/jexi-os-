/**
 * JEXI OS — Anthropic native adapter (Messages API).
 *
 * Anthropic is the one major provider WITHOUT an OpenAI-compatible endpoint,
 * so it gets a small native adapter with translators in both directions:
 *
 *   toAnthropicRequest(openAiMessages, openAiTools)
 *     system → top-level `system`; assistant tool_calls → tool_use blocks;
 *     { role:'tool' } → user-role tool_result blocks.
 *
 *   fromAnthropicResponse(data)
 *     content blocks → { text, think, toolCalls[], rawToolCalls[] } where
 *     rawToolCalls are OpenAI-shaped so the generic tool loop can replay
 *     them verbatim (the translator re-converts every round).
 *
 * Streaming: SSE `content_block_delta` events → onToken/onThink.
 * `fetchImpl` injectable for offline tests.
 */

import { parseRetryAfterMs, DEFAULT_TIMEOUT_MS, DEFAULT_STREAM_TIMEOUT_MS } from './openaiCompat.js';

export const ANTHROPIC_VERSION = '2023-06-01';
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function textOf(block) {
  if (typeof block === 'string') return block;
  if (block && typeof block.text === 'string') return block.text;
  return '';
}

/**
 * Convert OpenAI-shaped messages (+tools) into an Anthropic request body.
 * Returns { system, messages, tools? }.
 */
export function toAnthropicRequest(openAiMessages = [], openAiTools = null) {
  const systemParts = [];
  const messages = [];
  for (const m of openAiMessages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'system') {
      const t = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (t.trim()) systemParts.push(t);
      continue;
    }
    if (m.role === 'tool') {
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id || 'call_unknown',
          content: String(m.content ?? ''),
        }],
      });
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: String(m.content) });
      for (const tc of m.tool_calls) {
        let input = {};
        try { input = JSON.parse(tc?.function?.arguments || '{}'); }
        catch { input = { _raw: String(tc?.function?.arguments || '').slice(0, 2000) }; }
        content.push({ type: 'tool_use', id: tc.id || `call_${content.length}`, name: tc?.function?.name || '', input });
      }
      messages.push({ role: 'assistant', content });
      continue;
    }
    if (m.role === 'assistant') {
      messages.push({ role: 'assistant', content: String(m.content ?? '') });
      continue;
    }
    // user (or anything else): pass through; Anthropic image blocks already
    // use { type:'image', source:{...} } — translate OpenAI image_url too.
    if (Array.isArray(m.content)) {
      const content = [];
      for (const part of m.content) {
        if (part?.type === 'image_url') {
          const url = String(part.image_url?.url || '');
          const dm = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
          if (dm && dm[3]) {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: dm[1] || 'image/jpeg', data: dm[3] },
            });
          } else if (url) {
            content.push({ type: 'image', source: { type: 'url', url } });
          }
        } else if (part?.type === 'text') {
          content.push({ type: 'text', text: String(part.text || '') });
        } else if (part && typeof part === 'object' && part.type) {
          content.push(part); // already Anthropic-shaped
        }
      }
      messages.push({ role: 'user', content });
      continue;
    }
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') });
  }
  // Anthropic requires alternating roles: merge consecutive same-role turns.
  const merged = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      const a = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content ?? '') }];
      const b = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
      prev.content = [...a, ...b];
    } else {
      merged.push(m);
    }
  }
  const body = { messages: merged };
  if (systemParts.length) body.system = systemParts.join('\n\n');
  if (Array.isArray(openAiTools) && openAiTools.length) {
    body.tools = openAiTools
      .filter((t) => t?.type === 'function' && t.function?.name)
      .map((t) => ({
        name: t.function.name,
        description: String(t.function.description || '').slice(0, 1000),
        input_schema: t.function.parameters && typeof t.function.parameters === 'object'
          ? t.function.parameters
          : { type: 'object', properties: {} },
      }));
  }
  return body;
}

/** Convert an Anthropic response (or accumulated stream) into JEXI's shape. */
export function fromAnthropicResponse(data = {}) {
  let text = '';
  let think = '';
  const rawToolCalls = [];
  for (const block of data?.content || []) {
    if (block?.type === 'text') text += textOf(block);
    else if (block?.type === 'thinking') think += typeof block.thinking === 'string' ? block.thinking : textOf(block);
    else if (block?.type === 'redacted_thinking') think += '[redacted reasoning]';
    else if (block?.type === 'tool_use') {
      rawToolCalls.push({
        id: block.id || null,
        type: 'function',
        function: { name: block.name || '', arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const toolCalls = rawToolCalls.map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    return { id: tc.id, name: tc.function.name, arguments: args };
  }).filter((tc) => tc.name);
  return { text, think, toolCalls, rawToolCalls, stopReason: data?.stop_reason || null, usage: data?.usage || null };
}

/**
 * Accumulate an Anthropic SSE stream. Fires onToken(text)/onThink(reasoning).
 * Returns fromAnthropicResponse-shaped { text, think, toolCalls, rawToolCalls }.
 */
export async function readAnthropicStream(res, { onToken = null, onThink = null, meta = {} } = {}) {
  if (!res || !res.body || typeof res.body.getReader !== 'function') {
    throw Object.assign(new Error('stream requested but the response has no readable body'), { code: 'STREAM', retryable: true, provider: 'anthropic' });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let think = '';
  const blocks = new Map(); // index → { type, id?, name?, textJson }
  let event = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) { event = ''; continue; }
      if (t.startsWith('event:')) { event = t.slice(6).trim(); continue; }
      if (!t.startsWith('data:')) continue;
      let json;
      try { json = JSON.parse(t.slice(5).trim()); } catch { continue; }
      if (event === 'content_block_start') {
        const b = json?.content_block || {};
        blocks.set(json.index, { type: b.type || 'text', id: b.id || null, name: b.name || '', textJson: '' });
      } else if (event === 'content_block_delta') {
        const b = blocks.get(json.index) || { type: 'text', textJson: '' };
        const d = json?.delta || {};
        if (d.type === 'text_delta' && d.text) {
          text += d.text;
          try { onToken?.(d.text, meta); } catch {}
        } else if (d.type === 'thinking_delta' && d.thinking) {
          think += d.thinking;
          try { onThink?.(d.thinking, meta); } catch {}
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
          b.textJson += d.partial_json;
          blocks.set(json.index, b);
        }
      }
    }
  }
  const rawToolCalls = [];
  for (const b of blocks.values()) {
    if (b.type === 'tool_use' && b.name) {
      rawToolCalls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: b.textJson || '{}' } });
    }
  }
  const toolCalls = rawToolCalls.map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    return { id: tc.id, name: tc.function.name, arguments: args };
  }).filter((tc) => tc.name);
  return { text, think, toolCalls, rawToolCalls };
}

function toError(status, bodyText, retryAfterMs) {
  let code = 'HTTP_ERROR';
  let retryable = false;
  let message = `Anthropic HTTP ${status}: ${String(bodyText || '').slice(0, 200)}`;
  if (status === 401) { code = 'AUTH'; message = 'invalid Anthropic API key (401)'; }
  else if (status === 403) { code = 'FORBIDDEN'; message = `forbidden (403): ${String(bodyText).slice(0, 160)}`; }
  else if (status === 404) { code = 'MODEL_NOT_FOUND'; message = `model not found (404): ${String(bodyText).slice(0, 160)}`; }
  else if (status === 429) { code = 'RATE_LIMIT'; retryable = true; }
  else if (status === 400) {
    code = 'BAD_REQUEST';
    if (/tool|input_schema/i.test(String(bodyText))) message = `tool schema rejected (400): ${String(bodyText).slice(0, 200)}`;
  }
  else if ([500, 502, 503, 504, 529].includes(status)) { code = 'SERVER'; retryable = true; }
  const e = new Error(message);
  e.code = code; e.status = status; e.retryable = retryable; e.retryAfterMs = retryAfterMs;
  e.provider = 'anthropic';
  return e;
}

/**
 * One Anthropic Messages call. Same return shape as the OpenAI adapter:
 * { text, think, toolCalls, rawToolCalls, model, usage, toolsFallback }.
 */
export async function anthropicMessages({
  apiKey, model, messages, system = '', tools = null,
  temperature = 0.3, maxTokens = 4096,
  stream = false, onToken = null, onThink = null, meta = {},
  timeoutMs = null, retries = 2, fetchImpl = null,
  baseUrl = 'https://api.anthropic.com/v1', signal = null,
} = {}) {
  if (!apiKey) throw Object.assign(new Error('Anthropic API key is required'), { code: 'AUTH' });
  if (!model) throw Object.assign(new Error('model is required'), { code: 'CONFIG' });
  const fetchFn = fetchImpl || fetch;
  const url = `${String(baseUrl).replace(/\/+$/, '')}/messages`;
  const timeout = timeoutMs ?? (stream ? DEFAULT_STREAM_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const openAiMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...(Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages ?? '') }]),
  ];
  let lastError = null;
  for (let attemptIdx = 0; attemptIdx <= Math.max(0, retries); attemptIdx += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeout}ms`)), timeout);
    const onAbort = () => { try { controller.abort(signal?.reason); } catch {} };
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const reqBody = toAnthropicRequest(openAiMessages, tools);
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          ...(stream ? { accept: 'text/event-stream' } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          ...reqBody,
          ...(stream ? { stream: true } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const err = toError(res.status, bodyText, parseRetryAfterMs(res.headers, bodyText));
        if (!err.retryable || attemptIdx >= retries) throw err;
        lastError = err;
        await sleep(Math.min(15000, err.retryAfterMs ?? (1000 * 2 ** attemptIdx)));
        continue;
      }
      if (stream) {
        const out = await readAnthropicStream(res, { onToken, onThink, meta });
        return { ...out, model, usage: null, toolsFallback: false };
      }
      const data = await res.json().catch(() => ({}));
      return { ...fromAnthropicResponse(data), model: data?.model || model, toolsFallback: false };
    } catch (e) {
      if (e && e.code && !e.retryable) throw e;
      if (e && e.code && e.retryable && attemptIdx < retries) {
        lastError = e;
        await sleep(Math.min(15000, e.retryAfterMs ?? (1000 * 2 ** attemptIdx)));
        continue;
      }
      if (!(e && e.code) && attemptIdx < retries) {
        const m = String(e?.message || e);
        const wrapped = new Error(/abort|timeout/i.test(m) ? `request timed out (${m.slice(0, 100)})` : `network error: ${m.slice(0, 140)}`);
        wrapped.code = /abort|timeout/i.test(m) ? 'TIMEOUT' : 'NETWORK';
        wrapped.retryable = true;
        wrapped.provider = 'anthropic';
        lastError = wrapped;
        await sleep(Math.min(15000, 1000 * 2 ** attemptIdx));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError || new Error('request failed');
}
