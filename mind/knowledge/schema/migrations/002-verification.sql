-- JEXI OS — Phase 8 Scope G — EXPLOIT VERIFICATION (002-verification.sql)
--
-- Immutable verification records for the "no exploit, no report" gate.
-- One row per finding (natural_key = finding_id): the verifier's current
-- verdict. evidence_hash is a sha256 over the canonical snapshot of the
-- finding's graph state AT VERIFICATION TIME — integrityCheck() recomputes
-- it; a mismatch (post-verification tampering) flips the row INVALIDATED.
--
-- status:
--   VERIFIED     re-executed, >= required independent methods observed
--   REJECTED     re-executed, PoC failed — finding must never be reported
--   INCONCLUSIVE re-executed, some but fewer than required methods observed
--   REFUSED      verifier declined (verifier==doer, RoE violation, ...)
--   INVALIDATED  evidence hash no longer matches the graph — tampered
--                after verification; treated as unverified everywhere

CREATE TABLE IF NOT EXISTS finding_verifications (
  id                TEXT PRIMARY KEY,
  finding_id        TEXT NOT NULL,
  vulnerability_id  TEXT NOT NULL REFERENCES vulnerabilities(id),
  exploit_id        TEXT,
  status            TEXT NOT NULL CHECK (status IN ('VERIFIED','REJECTED','INCONCLUSIVE','REFUSED','INVALIDATED')),
  verifier_agent    TEXT NOT NULL,
  exploited_by      TEXT,
  methods_required  INTEGER NOT NULL DEFAULT 1,
  methods_succeeded INTEGER NOT NULL DEFAULT 0,
  methods_json      TEXT NOT NULL DEFAULT '[]',
  evidence_json     TEXT NOT NULL DEFAULT '[]',
  evidence_hash     TEXT NOT NULL,
  refusal_rule      TEXT,
  verified_at       TEXT NOT NULL,
  invalidated_at    TEXT,
  natural_key       TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_verifications_finding ON finding_verifications (finding_id);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON finding_verifications (status);
