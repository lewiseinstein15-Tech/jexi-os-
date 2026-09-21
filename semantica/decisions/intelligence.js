/**
 * JEXI OS — Phase 14 Scope C — decision intelligence.
 *
 *   intelligence(log, subject) -> { decisions, path }
 *
 * decisions: every decision recorded on the subject, append order.
 * path: a REAL walk through the backing graph — traverse() from the
 * first decision node following only 'supersedes' edges, filtered to
 * this subject's nodes. No invented links: if the graph has no chain,
 * the path is just the reachable set.
 */
export function intelligence(log, subject) {
  const ds = log.list({ subject });
  let path = [];
  if (ds.length > 0) {
    const g = log.graph();
    const walked = g.traverse(ds[0].decisionId, { depth: Number.MAX_SAFE_INTEGER, edgeKinds: ['supersedes'] });
    const own = new Set(ds.map((d) => d.decisionId));
    path = walked.map((n) => n.id).filter((id) => own.has(id));
  }
  return { decisions: ds, path };
}
