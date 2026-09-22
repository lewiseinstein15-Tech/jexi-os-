/** Reconcile accepted Scope F hot facts into cycle-owned fact state. */
export const name = 'extract-facts';
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export async function run({ hot, state }) {
  const sources = new Set(state.sourceIds);
  for (const fact of state.facts) if (fact.source_id) sources.add(fact.source_id);
  if (sources.size === 0) sources.add('default');
  const byId = new Map(state.facts.map((fact) => [fact.id, fact]));
  if (hot && typeof hot.recall === 'function') {
    for (const sourceId of [...sources].sort(compareText)) {
      for (const fact of hot.recall({ sourceId })) if (!byId.has(fact.id)) byId.set(fact.id, { ...fact });
    }
  }
  state.facts = [...byId.values()].sort((a, b) => compareText(a.id, b.id));
  const label = hot && typeof hot.extractor === 'function'
    ? hot.extractor().label : 'rule-based — LLM extraction NOT VERIFIED';
  return { durationMs: 0, budgetUsed: 0, label, details: { facts: state.facts.length } };
}

export default Object.freeze({ name, deterministic: true, run });
