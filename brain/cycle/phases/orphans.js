/** Deterministic report of pages with no extracted inbound/outbound edge. */
export const name = 'orphans';
const canonical = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export async function run({ repo, state }) {
  const pages = repo && typeof repo.list === 'function' ? repo.list() : [];
  const linked = new Set();
  for (const edge of state.edges) {
    linked.add(canonical(edge.from));
    linked.add(canonical(edge.to));
    if (edge.resolved_to) linked.add(canonical(edge.resolved_to));
  }
  state.orphans = pages.filter((page) =>
    !linked.has(canonical(page.slug)) &&
    !linked.has(canonical(page.title)) &&
    !linked.has(canonical(`${page.kind}/${page.slug}`)))
    .map((page) => `${page.kind}/${page.slug}`).sort(compareText);
  return { durationMs: 0, budgetUsed: 0, details: { count: state.orphans.length, pages: [...state.orphans] } };
}

export default Object.freeze({ name, deterministic: true, run });
