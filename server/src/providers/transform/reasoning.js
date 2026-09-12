/**
 * JEXI OS — Provider bridge — reasoning payload placement.
 *
 * Providers expose chain-of-thought in different fields:
 *   - DeepSeek:    reasoning_content
 *   - OpenAI o1:   reasoning field on the chunk
 *   - Anthropic:   thinking blocks in content
 *   - Google:      usageMetadata / thought blocks
 *
 * This module extracts reasoning into our canonical `reasoning` field and
 * strips it from the visible content so the agent loop sees one shape and
 * can decide how to handle reasoning (log it, discard it, use for eval).
 */

/** Extract reasoning text from a raw provider response object. */
export function extractReasoning(raw) {
  if (!raw || typeof raw !== 'object') return undefined;

  if (typeof raw.reasoning_content === 'string') return raw.reasoning_content;
  if (typeof raw.reasoning === 'string') return raw.reasoning;

  const content = raw.content;
  if (Array.isArray(content)) {
    const textParts = [];
    for (const block of content) {
      if (block?.type === 'thinking' && typeof block.thinking === 'string') return block.thinking;
      if (block?.type === 'reasoning' && typeof block.text === 'string') return block.text;
      if (block?.type === 'text' && typeof block.text === 'string') textParts.push(block.text);
    }
  }
  return undefined;
}

/** Build clean visible content, removing reasoning blocks. */
export function extractVisibleContent(raw) {
  if (!raw || typeof raw !== 'object') return raw ?? '';
  if (typeof raw.content === 'string') return raw.content;
  const content = raw.content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }
  return '';
}