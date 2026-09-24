/** Deterministically resolve edge labels to canonical Scope A page ids. */
export const name = 'resolve-symbol-edges';
const canonical = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export async function run({ repo, state }) {
  const pages = repo && typeof repo.list === 'function' ? repo.list() : [];
  const lookup = new Map();
  for (const page of pages) {
    const id = `${page.kind}/${page.slug}`;
    for (const key of [page.slug, page.title, id]) if (!lookup.has(canonical(key))) lookup.set(canonical(key), id);
  }
  let resolved = 0;
  state.edges = state.edges.map((edge) => {
    const target = lookup.get(canonical(edge.to));
    if (!target) return { ...edge };
    resolved += 1;
    return { ...edge, resolved_to: target };
  }).sort((a, b) => compareText(`${a.from}\0${a.to}\0${a.verb}`, `${b.from}\0${b.to}\0${b.verb}`));
  return { durationMs: 0, budgetUsed: 0, details: { resolved, unresolved: state.edges.length - resolved } };
}

export default Object.freeze({ name, deterministic: true, run });
