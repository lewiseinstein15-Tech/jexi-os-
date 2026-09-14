/**
 * JEXI OS — Provider bridge — real SSE streaming helper (Scope D part 1).
 *
 * Replaces the placeholder `ChatClientBase.stream()` with a REAL reader for
 * both wire formats:
 *
 *   openai    — `data: {...choice delta...}` lines on /chat/completions
 *                with `stream: true` (works for every OpenAI-compatible
 *                provider: OpenAI, Groq, Mistral, DeepSeek, OpenRouter…).
 *   anthropic — `event: content_block_delta` / `data: {...}` fragments on
 *                /messages with `stream: true`.
 *
 * Both produce the same normalized ChatChunk contract:
 *   { type: 'chunk', text, delta: { content?, reasoning?, tool_calls? } }
 * plus a final `{ type: 'done', ... }` chunk carrying the assembled usage
 * and any tool call fragments.
 */

const decoder = new TextDecoder();

/** Split an incoming data chunk into complete `data:` lines (keeps a tail). */
export function splitSSELines(buf, chunk) {
  buf += decoder.decode(chunk, { stream: true });
  const lines = buf.split('\n');
  const tail = lines.pop() || '';
  return { lines, tail };
}

/** Parse one SSE line into `{ event, data }` or null for non-data lines. */
export function parseSSELine(line, fallbackEvent = 'message') {
  const t = String(line).trim();
  if (!t) return null;
  if (t.startsWith(':')) return null; // SSE comment (keep-alive)
  if (t.startsWith('event:')) return { event: t.slice(6).trim(), data: null };
  if (!t.startsWith('data:')) return null;
  return { event: fallbackEvent, data: t.slice(5).trim() };
}

/**
 * Open a streaming fetch and yield raw `{ event, data }` records.
 * `signal` is optional; the reader is closed when the caller disconnects.
 */
export async function* readSSE({ url, headers, body, signal }) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    err.status = res.status;
    throw err;
  }
  const reader = res.body.getReader();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const { lines, tail } = splitSSELines(buf, value);
    buf = tail;
    let event = 'message';
    for (const line of lines) {
      const parsed = parseSSELine(line, event);
      if (!parsed) continue;
      if (parsed.data === null) {
        if (parsed.event) event = parsed.event;
        continue;
      }
      yield { event, data: parsed.data };
    }
  }
}

/** OpenAI-compatible chunk → normalized delta (content / reasoning / tool calls). */
export function openaiChunkToDelta(json, acc) {
  const delta = (json && json.choices && json.choices[0] && json.choices[0].delta) || {};
  const out = {};
  if (typeof delta.reasoning_content === 'string' || typeof delta.reasoning === 'string') {
    out.reasoning = delta.reasoning_content ?? delta.reasoning;
  }
  if (delta.content) out.content = delta.content;
  if (Array.isArray(delta.tool_calls)) {
    out.tool_calls = delta.tool_calls.map((tc) => {
      const idx = tc.index ?? acc.toolCalls.length;
      const slot = acc.toolCalls[idx] || (acc.toolCalls[idx] = { id: `call_${idx}`, type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) slot.id = tc.id;
      if (tc.function && tc.function.name) slot.function.name += tc.function.name;
      if (tc.function && tc.function.arguments) slot.function.arguments += tc.function.arguments;
      return { index: idx };
    });
  }
  return out;
}

/** Anthropic SSE delta → normalized delta (content / reasoning / tool calls). */
export function anthropicDeltaToDelta(data, acc) {
  const out = {};
  const block = data && data.delta;
  if (data?.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
    const idx = acc.toolCalls.length;
    acc.toolCalls[idx] = { id: data.content_block.id || `toolu_${idx}`, type: 'function', function: { name: data.content_block.name || '', arguments: '' } };
    out.tool_calls = [{ index: idx }];
    return out;
  }
  if (data?.type === 'content_block_delta') {
    if (block?.type === 'text_delta' && block.text) out.content = block.text;
    if (block?.type === 'thinking_delta' && block.thinking) out.reasoning = block.thinking;
    if (block?.type === 'input_json_delta' && block.partial_json) {
      const idx = Math.max(0, acc.toolCalls.length - 1);
      const slot = acc.toolCalls[idx];
      if (slot) slot.function.arguments += block.partial_json;
      out.tool_calls = [{ index: idx }];
    }
  }
  return out;
}

/** Accumulate the normalized response pieces from OpenAI-style chunks. */
export function openaiUsage(json, acc) {
  return {
    inputTokens: json?.usage?.prompt_tokens ?? acc.inputTokens,
    outputTokens: json?.usage?.completion_tokens ?? acc.outputTokens,
    totalCost: 0,
    provider_data: { raw: json },
  };
}

/** Accumulate the normalized response pieces from Anthropic events. */
export function anthropicUsage(data, acc) {
  return {
    inputTokens: data?.usage?.input_tokens ?? acc.inputTokens,
    outputTokens: data?.usage?.output_tokens ?? acc.outputTokens,
    totalCost: 0,
    provider_data: { raw: data },
  };
}

/** One accumulated tool call → canonical { id, name, arguments } shape. */
export function finalizeToolCalls(toolCalls) {
  const out = [];
  for (const tc of Object.values(toolCalls)) {
    if (!tc || !tc.function) continue;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    if (tc.function.name) out.push({ id: tc.id || null, name: tc.function.name, arguments: args });
  }
  return out;
}

/** Final `{ type: 'done', ... }` chunk for both wire formats. */
export function parseToolCalls(acc) {
  return finalizeToolCalls(acc.toolCalls);
}