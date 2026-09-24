/** Take grading seam. No injected LLM means no fabricated grades. */
export const name = 'grade-takes';
export const LLM_PHASE_LABEL = 'rule-based — LLM phase NOT VERIFIED';
const clone = (value) => JSON.parse(JSON.stringify(value));

export async function run({ state, llm, budgetCap }) {
  if (!llm || typeof llm.gradeTakes !== 'function') {
    return {
      durationMs: 0, budgetUsed: 0, label: LLM_PHASE_LABEL,
      details: { skipped: true, reason: 'no injected LLM capability', graded: 0 },
    };
  }
  const result = await llm.gradeTakes({ takes: clone(state.takes), budgetCap });
  const grades = Array.isArray(result?.grades) ? clone(result.grades) : [];
  return {
    durationMs: 0,
    budgetUsed: Number(result?.costUsd ?? 0),
    label: result?.label ?? 'injected LLM capability',
    details: { skipped: false, graded: grades.length },
    commit: () => {
      const byId = new Map(grades.map((grade) => [grade.id, grade]));
      state.takes = state.takes.map((take) => byId.has(take.id) ? { ...take, grade: byId.get(take.id) } : take);
    },
  };
}

export default Object.freeze({ name, deterministic: false, llmBacked: true, label: LLM_PHASE_LABEL, run });
