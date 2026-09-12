/**
 * JEXI OS — Provider bridge — message shape normalization.
 *
 * Every provider accepts slightly different message shapes: system as a
 * separate field vs a "system" role message, tool results as role:"tool"
 * vs role:"function", empty assistant content rules, etc. This module
 * centralizes those differences (OpenCode transform pattern) so adapters
 * stay thin and the agent loop never sees them.
 */

/** Normalized message shapes produced by providers. */
export function inPromptMessages(messages) {
  return (messages || []).map(normalizeIncoming);
}

/** Normalize one inbound message from the agent loop into our canonical shape. */
export function normalizeIncoming(m) {
  if (!m || typeof m !== 'object') return { role: 'user', content: String(m ?? '') };
  const role = m.role ?? 'user';
  let content = m.content;
  if (typeof content === 'string') content = [{ type: 'text', text: content }];
  const out = { role, content };
  if (m.name) out.name = m.name;
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  if (m.tool_calls) out.tool_calls = m.tool_calls;
  return out;
}

/** Canonical request shape consumed by adapter chat(). */
export function buildChatRequest({
  messages,
  tools,
  temperature,
  max_tokens,
  stop,
  response_format,
  provider_data,
}) {
  return {
    messages: (messages || []).map(normalizeIncoming),
    ...(tools && tools.length ? { tools } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(max_tokens !== undefined ? { max_tokens } : {}),
    ...(stop ? { stop } : {}),
    ...(response_format ? { response_format } : {}),
    ...(provider_data ? { provider_data } : {}),
  };
}