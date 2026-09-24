/**
 * JEXI OS — Phase 8 Scope C — QUERY: findings-by-severity.
 *
 * Groups vulnerabilities by severity — the graph's answer to "what did we
 * find, ranked?" without touching any agent memory. Deterministic order:
 * severity rank (critical→info), then id.
 */

const RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function findingsBySeverity(graph) {
  const rows = graph.store.db
    .prepare('SELECT id, service_id, cve, severity, description FROM vulnerabilities ORDER BY id')
    .all();
  const groups = { critical: [], high: [], medium: [], low: [], info: [] };
  for (const r of rows) {
    groups[r.severity].push({
      id: r.id,
      serviceId: r.service_id,
      cve: r.cve,
      description: r.description,
    });
  }
  const counts = {};
  for (const sev of Object.keys(groups).sort((a, b) => RANK[b] - RANK[a])) {
    counts[sev] = groups[sev].length;
  }
  return { total: rows.length, counts, groups };
}
