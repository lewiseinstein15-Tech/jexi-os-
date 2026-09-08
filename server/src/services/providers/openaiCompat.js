/**
 * JEXI OS — OpenAI-compatible wire adapter.
 *
 * ONE implementation drives every OpenAI-compatible provider (OpenAI, Groq,
 * DeepSeek, OpenRouter, Mistral, xAI, NVIDIA NIM, SambaNova, Cerebras,
 * DeepInfra, HuggingFace router, Gemini OpenAI endpoint, Ollama, LM Studio,
 * vLLM, Together, Fireworks, proxies…).
 *
 * Features: non-stream + SSE stream, native tool calling, reasoning-channel
 * passthrough, timeouts, bounded retries with Retry-After support, honest
 * error classification, and graceful tools→plain-text fallback for weak or
 * local models that reject the `tools` parameter.
 *
 * Pure fetch — no SDK. `fetchImpl` is injectable for offline tests.
 */

export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_STREAM_TIMEOUT_MS = 150_000;

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Classify a failure. Never throws. */
export function classifyError({ status = 0, bodyText = '', networkError = null } = {}) {
  if (networkError) {
    const m = String(networkError.message || networkError);
    if (/aborted|timeout|timed out|etimedout/i.test(m)) return { code: 'TIMEOUT', retryable: true, message: `request timed out (${m.slice(0, 120)})` };
    return { code: 'NETWORK', retryable: true, message: `network error: ${m.slice(0, 160)}` };
  }
  const body = String(bodyText || '');
  if (status === 401) return { code: 'AUTH', retryable: false, message: 'invalid API key (401) — check the key for this provider' };
  if (status === 403) return { code: 'FORBIDDEN', retryable: false, message: `forbidden (403): ${body.slice(0, 160) || 'key lacks access'}` };
  if (status === 402) return { code: 'PAYMENT', retryable: false, message: 'payment required (402) — this account/route needs funding' };
  if (status === 404) {
    if (/model/i.test(body)) return { code: 'MODEL_NOT_FOUND', retryable: false, message: `model not found (404): ${body.slice(0, 160)}` };
    return { code: 'NOT_FOUND', retryable: false, message: `endpoint not found (404): ${body.slice(0, 160) || 'check the base URL'}` };
  }
  if (status === 429) return { code: 'RATE_LIMIT', retryable: true, message: `rate limited (429): ${body.slice(0, 160) || 'slow down'}` };
  if (status === 400) return { code: 'BAD_REQUEST', retryable: false, message: `bad request (400): ${body.slice(0, 200)}` };
  if (RETRYABLE_STATUS.has(status)) return { code: 'SERVER', retryable: true, message: `provider error (${status}): ${body.slice(0, 160)}` };
  if (status >= 400) return { code: 'HTTP_ERROR', retryable: false, message: `HTTP ${status}: ${body.slice(0, 160)}` };
  return { code: 'UNKNOWN', retryable: false, message: body.slice(0, 200) || 'unknown error' };
}

/** Parse Retry-After (seconds or HTTP date) → ms. Null when absent/unparseable. */
export function parseRetryAfterMs(headers, bodyText = '') {
  try {
    const get = typeof headers?.get === 'function' ? (k) => headers.get(k) : (k) => headers?.[k] ?? headers?.[k.toLowerCase()];
    const raw = get('retry-after') ?? get('Retry-After') ?? get('retry-after-ms') ?? get('x-retry-after-ms');
    if (raw != null && String(raw).trim() !== '') {
      const s = String(raw).trim();
      if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
      const t = Date.parse(s);
      if (Number.isFinite(t)) return Math.max(0, t - Date.now());
    }
  } catch { /* fall through to body scan */ }
  const m = String(bodyText || '').match(/retry in ([\d.]+)\s*(ms|s|seconds?|minutes?|m)?/i);
  if (m) {
    const n = Number(m[1]);
    const unit = (m[2] || 's').toLowerCase();
    const mult = unit.startsWith('ms') ? 1 : unit.startsWith('m') ? 60000 : 1000;
    if (Number.isFinite(n)) return Math.round(n * mult);
  }
  return null;
}

/** Does this 400 mean "I don't support tools"? (weak/local models) */
export function isToolsRejection(status, bodyText) {
  if (status !== 400 && status !== 422) return false;
  return /tool|function|schema|additional properties|response_format|strict|parallel/i.test(String(bodyText || ''));
}

function toError(classified, { status = 0, retryAfterMs = null, provider = '' } = {}) {
  const e = new Error(classified.message);
  e.code = classified.code;
  e.status = status;
  e.retryable = classified.retryable;
  e.retryAfterMs = retryAfterMs;
  if (provider) e.provider = provider;
  return e;
}

/**
 * Parse OpenAI tool_calls into { id, name, arguments }. Args that fail JSON
 * parsing are repaired best-effort ({} fallback) — never throws.
 */
export function parseToolCalls(message) {
  return ((message && message.tool_calls) || [])
    .filter((tc) => tc && tc.function)
    .map((tc) => {
      let args = {};
      const raw = tc.function.arguments;
      if (typeof raw === 'object' && raw !== null) args = raw;
      else if (typeof raw === 'string' && raw.trim()) {
        try { args = JSON.parse(raw); }
        catch {
          try { args = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } // trailing commas
          catch { args = { _raw: raw.slice(0, 2000) }; }
        }
      }
      return { id: tc.id || null, name: tc.function.name || '', arguments: args };
    })
    .filter((tc) => tc.name);
}

/**
 * Accumulate one SSE stream into { text, think, toolCalls, rawToolCalls }.
 * `onDelta(textChunk, meta)` / `onThink(reasoningChunk, meta)` fire live.
 */
export async function readSseStream(res, { onDelta = null, onThink = null, meta = {} } = {}) {
  if (!res || !res.body || typeof res.body.getReader !== 'function') {
    throw Object.assign(new Error('stream requested but the response has no readable body'), { code: 'STREAM', retryable: true });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let think = '';
  const rawToolCalls = [];
  let doneRead = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') { doneRead = true; break; }
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json?.choices?.[0]?.delta;
      if (!delta) continue;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) {
        think += reasoning;
        try { onThink?.(reasoning, meta); } catch { /* consumer must never break the stream */ }
      }
      if (delta.content) {
        text += delta.content;
        try { onDelta?.(delta.content, meta); } catch { /* never break */ }
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = Number.isInteger(tc.index) ? tc.index : rawToolCalls.length;
          if (!rawToolCalls[idx]) rawToolCalls[idx] = { id: `call_${idx}`, type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) rawToolCalls[idx].id = tc.id;
          if (tc.function?.name) rawToolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) rawToolCalls[idx].function.arguments += tc.function.arguments;
        }
      }
    }
    if (doneRead) break;
  }
  return { text, think, toolCalls: parseToolCalls({ tool_calls: rawToolCalls }), rawToolCalls };
}

function buildHeaders(apiKey, extraHeaders = {}) {
  const h = { 'Content-Type': 'application/json', ...extraHeaders };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/**
 * One chat completion (stream or not).
 *
 * @returns { text, think, toolCalls, rawToolCalls, model, usage, toolsFallback }
 */
export async function chatCompletions({
  baseUrl, apiKey = '', model, messages, tools = null,
  temperature = 0.3, maxTokens = null,
  stream = false, onToken = null, onThink = null, meta = {},
  timeoutMs = null, retries = 2, fetchImpl = null, extraHeaders = {},
  providerLabel = 'openai-compatible', signal = null,
} = {}) {
  if (!baseUrl) throw Object.assign(new Error('baseUrl is required'), { code: 'CONFIG' });
  if (!model) throw Object.assign(new Error('model is required'), { code: 'CONFIG' });
  if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error('messages are required'), { code: 'CONFIG' });
  const fetchFn = fetchImpl || fetch;
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const timeout = timeoutMs ?? (stream ? DEFAULT_STREAM_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  let useTools = Array.isArray(tools) && tools.length > 0 ? tools : null;
  let toolsFallback = false;
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
      const res = await fetchFn(url, {
        method: 'POST',
        headers: buildHeaders(apiKey, extraHeaders),
        body: JSON.stringify({
          model,
          messages,
          ...(useTools ? { tools: useTools, tool_choice: 'auto' } : {}),
          temperature,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          stream: !!stream,
        }),
        signal: controller.signal,
      }).catch((e) => { throw e; });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        // Weak/local model rejected tools → ONE retry without tools.
        if (useTools && !toolsFallback && isToolsRejection(res.status, bodyText)) {
          useTools = null;
          toolsFallback = true;
          continue;
        }
        const classified = classifyError({ status: res.status, bodyText });
        const retryAfterMs = parseRetryAfterMs(res.headers, bodyText);
        const err = toError(classified, { status: res.status, retryAfterMs, provider: providerLabel });
        if (!classified.retryable || attemptIdx >= retries) throw err;
        lastError = err;
        await sleep(Math.min(15000, retryAfterMs ?? (1000 * 2 ** attemptIdx)));
        continue;
      }

      if (stream) {
        const out = await readSseStream(res, {
          onDelta: onToken ? (t) => onToken(t, meta) : null,
          onThink: onThink ? (t) => onThink(t, meta) : null,
          meta,
        });
        return { ...out, model, usage: null, toolsFallback };
      }
      const data = await res.json().catch(() => ({}));
      const msg = data?.choices?.[0]?.message || {};
      return {
        text: msg.content || '',
        think: msg.reasoning_content || msg.reasoning || '',
        toolCalls: parseToolCalls(msg),
        rawToolCalls: msg.tool_calls || [],
        model: data?.model || model,
        usage: data?.usage || null,
        toolsFallback,
      };
    } catch (e) {
      if (e && (e.code === 'CONFIG' || e.code === 'AUTH' || e.code === 'FORBIDDEN' || e.code === 'PAYMENT' || e.code === 'MODEL_NOT_FOUND' || e.code === 'NOT_FOUND' || e.code === 'BAD_REQUEST')) throw e;
      const classified = e && e.code ? { code: e.code, retryable: !!e.retryable, message: e.message } : classifyError({ networkError: e });
      const err = e && e.code ? e : toError(classified, { provider: providerLabel });
      // AbortError from OUR timeout carries retryable TIMEOUT classification.
      if (!classified.retryable || attemptIdx >= retries) throw err;
      lastError = err;
      const wait = err.retryAfterMs ?? (1000 * 2 ** attemptIdx);
      await sleep(Math.min(15000, wait));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError || new Error('request failed');
}

/**
 * List models (GET {base}/models). Returns string[] or null when the
 * endpoint is absent/unauthorized — a probe, never fatal.
 */
export async function listModels({ baseUrl, apiKey = '', fetchImpl = null, timeoutMs = 15000, extraHeaders = {} } = {}) {
  if (!baseUrl) return null;
  const fetchFn = fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${String(baseUrl).replace(/\/+$/, '')}/models`, {
      headers: buildHeaders(apiKey, extraHeaders),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const ids = (data?.data || []).map((m) => m?.id).filter(Boolean);
    return ids.length ? ids : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
