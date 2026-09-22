/** Concept synthesis seam. No injected LLM means an honest no-op. */
export const name = 'synthesize-concepts';
export const LLM_PHASE_LABEL = 'rule-based — LLM phase NOT VERIFIED';
const clone = (value) => JSON.parse(JSON.stringify(value));

export async function run({ state, llm, budgetCap }) {
  if (!llm || typeof llm.synthesizeConcepts !== 'function') {
    return {
      durationMs: 0, budgetUsed: 0, label: LLM_PHASE_LABEL,
      details: { skipped: true, reason: 'no injected LLM capability', concepts: 0 },
    };
  }
  const result = await llm.synthesizeConcepts({
    facts: clone(state.facts),
    edges: clone(state.edges),
    budgetCap,
  });
  const concepts = Array.isArray(result?.concepts) ? clone(result.concepts) : [];
  return {
    durationMs: 0,
    budgetUsed: Number(result?.costUsd ?? 0),
    label: result?.label ?? 'injected LLM capability',
    details: { skipped: false, concepts: concepts.length },
    commit: () => { state.concepts.push(...concepts); },
  };
}

export default Object.freeze({ name, deterministic: false, llmBacked: true, label: LLM_PHASE_LABEL, run });
