/** Deterministic reverse-edge projection. */
import { extract } from '../../kg/index.js';

export const name = 'backlinks';

const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export async function run({ repo, state }) {
  const pages = repo && typeof repo.list === 'function' ? repo.list() : [];
  const edges = pages.length > 0
    ? pages.flatMap((page) => extract(page).edges)
    : state.edges;
  const projected = new Map();
  for (const edge of edges) {
    const target = String(edge.to);
    if (!projected.has(target)) projected.set(target, new Set());
    projected.get(target).add(String(edge.from));
  }
  state.backlinks = [...projected.entries()].sort((a, b) => compareText(a[0], b[0]))
    .map(([target, from]) => ({ target, from: [...from].sort(compareText) }));
  return { durationMs: 0, budgetUsed: 0, details: { edgesScanned: edges.length, backlinks: state.backlinks.length } };
}

export default Object.freeze({ name, deterministic: true, run });
