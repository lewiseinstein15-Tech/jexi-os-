/** Scope A repo manifest reconciliation. */
export const name = 'sync';

export async function run({ repo, state }) {
  const result = repo && typeof repo.sync === 'function'
    ? repo.sync()
    : { added: [], modified: [], removed: [] };
  state.sync = result;
  return { durationMs: 0, budgetUsed: 0, details: result };
}

export default Object.freeze({ name, deterministic: true, run });
