/**
 * JEXI OS — Phase 8 Scope C — QUERY: coverage (what's known vs unknown).
 *
 * The engagement-at-a-glance answer: how much surface has been discovered,
 * how much of it has been probed, validated, and credentialed. Gaps are the
 * "unknown" half — services with no vulnerability coverage, hosts with no
 * recovered credentials.
 */

export function coverage(graph) {
  const db = graph.store.db;
  const one = (sql) => db.prepare(sql).get().n;
  const edgesByType = {};
  for (const r of db.prepare('SELECT type, COUNT(*) AS n FROM edges GROUP BY type ORDER BY type').all()) {
    edgesByType[r.type] = r.n;
  }

  const servicesScanned = one('SELECT COUNT(*) AS n FROM services');
  const hostsDiscovered = one('SELECT COUNT(*) AS n FROM hosts');
  const vulnsFound = one('SELECT COUNT(*) AS n FROM vulnerabilities');
  const exploitsValidated = one('SELECT COUNT(*) AS n FROM exploits WHERE succeeded = 1');

  const servicesWithoutVulnCoverage =
    db.prepare('SELECT id FROM services WHERE id NOT IN (SELECT DISTINCT service_id FROM vulnerabilities) ORDER BY id').all().map((r) => r.id);
  const hostsWithoutCredentials =
    db.prepare('SELECT id FROM hosts WHERE id NOT IN (SELECT DISTINCT host_id FROM credentials) ORDER BY id').all().map((r) => r.id);
  const vulnsWithoutValidatedExploit =
    db.prepare("SELECT id FROM vulnerabilities WHERE id NOT IN (SELECT vulnerability_id FROM exploits WHERE succeeded = 1) ORDER BY id").all().map((r) => r.id);

  return {
    known: {
      hostsDiscovered,
      servicesScanned,
      vulnerabilitiesFound: vulnsFound,
      exploitsValidated,
      exploitsAttempted: one('SELECT COUNT(*) AS n FROM exploits'),
      credentialsObtained: one('SELECT COUNT(*) AS n FROM credentials'),
      edgesByType,
    },
    unknown: {
      servicesWithoutVulnCoverage,
      hostsWithoutCredentials,
      vulnsWithoutValidatedExploit,
    },
  };
}
