/** Deterministic Scope C edge extraction over Scope A pages. */
import { extract } from '../../kg/index.js';

export const name = 'extract';
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export async function run({ repo, state }) {
  const pages = repo && typeof repo.list === 'function' ? repo.list() : [];
  state.edges = pages.flatMap((page) => extract(page).edges)
    .sort((a, b) => compareText(`${a.from}\0${a.to}\0${a.verb}\0${a.evidence}`, `${b.from}\0${b.to}\0${b.verb}\0${b.evidence}`));
  return { durationMs: 0, budgetUsed: 0, details: { pages: pages.length, edges: state.edges.length } };
}

export default Object.freeze({ name, deterministic: true, run });
