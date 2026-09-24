/** Deterministic emotional-weight projection over retained facts. */
export const name = 'recompute-emotional-weight';

const BASE = Object.freeze({ event: 0.6, preference: 0.5, commitment: 0.8, belief: 0.4, fact: 0.3 });

export async function run({ state }) {
  state.facts = state.facts.map((fact) => {
    const confidence = Number.isFinite(fact.confidence) ? Math.max(0, Math.min(1, fact.confidence)) : 1;
    return { ...fact, emotional_weight: Number(((BASE[fact.kind] ?? BASE.fact) * confidence).toFixed(6)) };
  });
  return { durationMs: 0, budgetUsed: 0, details: { factsWeighted: state.facts.length } };
}

export default Object.freeze({ name, deterministic: true, run });
