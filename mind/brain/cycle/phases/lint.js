/** Deterministic gate: reject structurally unsafe pages/facts before writes. */
import { SemanticaError } from '../../../../services/semantica/_internal.js';

export const name = 'lint';
export const gate = true;

export async function run({ repo, state }) {
  if (state.forceLintFailure) throw new SemanticaError('E_LINT_GATE', String(state.forceLintFailure));
  const pages = repo && typeof repo.list === 'function' ? repo.list() : [];
  const pageIds = new Set();
  for (const page of pages) {
    const id = `${page.kind}/${page.slug}`;
    if (pageIds.has(id)) throw new SemanticaError('E_LINT_GATE', `duplicate page ${id}`);
    if (!page.title || typeof page.compiledTruth !== 'string') throw new SemanticaError('E_LINT_GATE', `invalid page ${id}`);
    pageIds.add(id);
  }
  const factIds = new Set();
  for (const fact of state.facts) {
    if (!fact.id || factIds.has(fact.id)) throw new SemanticaError('E_LINT_GATE', `invalid or duplicate fact ${String(fact.id)}`);
    factIds.add(fact.id);
  }
  return { durationMs: 0, budgetUsed: 0, details: { pagesChecked: pages.length, factsChecked: state.facts.length } };
}

export default Object.freeze({ name, gate, deterministic: true, run });
