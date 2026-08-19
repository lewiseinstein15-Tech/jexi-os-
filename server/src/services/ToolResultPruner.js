/**
 * B144 — TOOL RESULT PRUNER (DeepSeek Harness
 * `packages/compaction/compaction-tool-result-pruner` mirror, JEXI-branded).
 *
 * Prune oversized tool results before they enter the model context:
 * results above the spill threshold are spilled (dsh spill-policy) and the
 * in-context copy is replaced with a locator, so long outputs never blow
 * the context budget. The pruner is the policy; ToolRuntime applies it.
 */

import { SPILL_THRESHOLD, saveText } from './SpillStore.js';
import { retainHeadTail } from './OutputRetention.js';

/** One prunable result: { text, kind, convId } → { text, spilled? }. */
export function pruneToolResult({ text, kind = 'tool', convId = 'default' } = {}) {
  const s = String(text ?? '');
  if (s.length <= SPILL_THRESHOLD) return { text: s, spilled: false };
  try {
    const spill = saveText({ owner: String(convId || 'default'), source: kind, suggestedName: `${kind}-${Date.now()}`, content: s });
    if (spill.ok && spill.locator) {
      return {
        text: `[${kind} output was ${s.length.toLocaleString()} chars — spilled to ${spill.locator}. Read it with spill-read if needed.]`,
        spilled: true,
        locator: spill.locator,
        bytes: s.length,
      };
    }
  } catch { /* fall through to head-tail */ }
  return { ...retainHeadTail(s), spilled: true };
}
