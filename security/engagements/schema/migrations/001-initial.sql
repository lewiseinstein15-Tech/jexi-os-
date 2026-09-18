-- JEXI OS — Phase 8 Scope D — ENGAGEMENT STORE — initial schema.
-- Mirrors the knowledge-graph storage family: zero new dependencies
-- (node:sqlite DatabaseSync), WAL journal, foreign keys ON, migrations
-- applied idempotently. Full-line comments only: the migration runner
-- strips comment lines, then splits on ';'.

CREATE TABLE IF NOT EXISTS engagements (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  bundle     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  granted_by    TEXT,
  note          TEXT,
  granted_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approvals_eid ON approvals(engagement_id, action);

CREATE TABLE IF NOT EXISTS engagement_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  ts            TEXT NOT NULL,
  kind          TEXT NOT NULL,
  action        TEXT,
  target        TEXT,
  allowed       INTEGER,
  rule          TEXT,
  reason        TEXT,
  detail        TEXT
);

CREATE INDEX IF NOT EXISTS idx_engagement_audit_eid ON engagement_audit(engagement_id, id);
