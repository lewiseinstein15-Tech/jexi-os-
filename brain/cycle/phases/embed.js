/** Deterministic Scope B rule-based rebuild; no provider module imported here. */
export const name = 'embed';

export async function run({ index, state }) {
  if (!index || typeof index.rebuild !== 'function') {
    return { durationMs: 0, budgetUsed: 0, details: { skipped: true, reason: 'brain.index unavailable' } };
  }
  const result = await index.rebuild();
  state.embedding = { chunks: result.chunks.length, ...result.embeddings };
  return { durationMs: 0, budgetUsed: 0, label: index.label, details: { ...state.embedding } };
}

export default Object.freeze({ name, deterministic: true, run });
