/** Take proposal seam. No injected LLM means no fabricated proposals. */
export const name = 'propose-takes';
export const LLM_PHASE_LABEL = 'rule-based — LLM phase NOT VERIFIED';
const clone = (value) => JSON.parse(JSON.stringify(value));

export async function run({ state, llm, budgetCap }) {
  if (!llm || typeof llm.proposeTakes !== 'function') {
    return {
      durationMs: 0, budgetUsed: 0, label: LLM_PHASE_LABEL,
      details: { skipped: true, reason: 'no injected LLM capability', proposed: 0 },
    };
  }
  const result = await llm.proposeTakes({ facts: clone(state.facts), budgetCap });
  const proposals = Array.isArray(result?.takes) ? clone(result.takes) : [];
  return {
    durationMs: 0,
    budgetUsed: Number(result?.costUsd ?? 0),
    label: result?.label ?? 'injected LLM capability',
    details: { skipped: false, proposed: proposals.length },
    commit: () => { state.takes.push(...proposals); },
  };
}

export default Object.freeze({ name, deterministic: false, llmBacked: true, label: LLM_PHASE_LABEL, run });
