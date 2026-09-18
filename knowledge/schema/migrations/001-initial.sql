-- JEXI OS — Phase 8 Scope C — KNOWLEDGE GRAPH: attack chain (001-initial.sql)
--
-- Decepticon-pattern attack chain on SQLite (no Neo4j dependency — JEXI is
-- zero-dep: SQLite via node:sqlite, same storage family as Phase 4 memory
-- and work graph). Entities are the five contract nouns; edges live in one
-- typed table with endpoint-type checks. natural_key columns make every
-- write idempotent (re-runs and resume() never duplicate rows).
--
-- Array-valued contract fields (tags, evidence) are stored as JSON text.

CREATE TABLE IF NOT EXISTS hosts (
  id            TEXT PRIMARY KEY,
  ip            TEXT,
  hostname      TEXT NOT NULL,
  os            TEXT,
  discovered_at TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',
  natural_key   TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS services (
  id         TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES hosts(id),
  port       INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  protocol   TEXT NOT NULL,
  banner     TEXT,
  product    TEXT,
  version    TEXT,
  natural_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_services_host ON services (host_id);

CREATE TABLE IF NOT EXISTS vulnerabilities (
  id          TEXT PRIMARY KEY,
  service_id  TEXT NOT NULL REFERENCES services(id),
  cve         TEXT,
  severity    TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  description TEXT,
  evidence    TEXT NOT NULL DEFAULT '[]',
  natural_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_vulns_service ON vulnerabilities (service_id);
CREATE INDEX IF NOT EXISTS idx_vulns_severity ON vulnerabilities (severity);

CREATE TABLE IF NOT EXISTS exploits (
  id               TEXT PRIMARY KEY,
  vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id),
  method           TEXT NOT NULL,
  payload          TEXT,
  succeeded        INTEGER NOT NULL DEFAULT 0 CHECK (succeeded IN (0,1)),
  verified         INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  natural_key      TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_exploits_vuln ON exploits (vulnerability_id);

CREATE TABLE IF NOT EXISTS credentials (
  id           TEXT PRIMARY KEY,
  host_id      TEXT NOT NULL REFERENCES hosts(id),
  kind         TEXT NOT NULL,
  username     TEXT NOT NULL,
  scope        TEXT,
  obtained_via TEXT,
  natural_key  TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_creds_host ON credentials (host_id);

CREATE TABLE IF NOT EXISTS edges (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('connects-to','exploits','escalates-to','moves-lateral-to')),
  src_type           TEXT NOT NULL,
  src_id             TEXT NOT NULL,
  dst_type           TEXT NOT NULL,
  dst_id             TEXT NOT NULL,
  via_credential_id  TEXT,
  privilege          TEXT,
  created_at         TEXT NOT NULL,
  natural_key        TEXT NOT NULL UNIQUE,
  CHECK (
    (type = 'connects-to'      AND src_type = 'service'      AND dst_type = 'host') OR
    (type = 'exploits'         AND src_type = 'exploit'      AND dst_type = 'vulnerability') OR
    (type = 'escalates-to'     AND src_type = 'credential'   AND dst_type = 'credential') OR
    (type = 'moves-lateral-to' AND src_type = 'host'         AND dst_type = 'host')
  )
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges (src_type, src_id, type);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges (dst_type, dst_id, type);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type);
