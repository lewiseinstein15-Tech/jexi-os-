/**
 * JEXI OS — Phase 8 Scope G — FINDING VERIFICATION ENTITY.
 *
 * Contract: { id, findingId, vulnerabilityId, exploitId, status,
 *             verifierAgent, exploitedBy, methodsRequired, methodsSucceeded,
 *             methods[], evidence[], evidenceHash, refusalRule,
 *             verifiedAt, invalidatedAt }
 * Required: findingId, vulnerabilityId (must exist), status ∈
 *   VERIFIED|REJECTED|INCONCLUSIVE|REFUSED|INVALIDATED, verifierAgent,
 *   evidenceHash. Natural key: findingId — ONE current verification per
 *   finding; re-verification replaces the row (snapshot refreshed,
 *   invalidatedAt cleared). Immutable-snapshot doctrine lives in
 *   verification/verifiers/: this repo only stores what the verifier
 *   observed and the hash it committed to.
 */

import { GraphValidationError } from '../../store.js';

export const VERIFICATION_STATUSES = ['VERIFIED', 'REJECTED', 'INCONCLUSIVE', 'REFUSED', 'INVALIDATED'];

export class VerificationEntity {
  constructor(storeHandle) {
    this.handle = storeHandle;
    this.db = storeHandle.db;
  }

  validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new GraphValidationError('Verification', 'input', 'expected an object');
    }
    const {
      id, findingId, vulnerabilityId, exploitId, status, verifierAgent, exploitedBy,
      methodsRequired, methodsSucceeded, methods, evidence, evidenceHash, refusalRule,
      verifiedAt, invalidatedAt,
    } = input;

    if (id !== undefined && (typeof id !== 'string' || !id.trim())) {
      throw new GraphValidationError('Verification', 'id', 'must be a non-empty string when provided');
    }
    if (findingId === undefined || findingId === null || String(findingId).trim() === '') {
      throw new GraphValidationError('Verification', 'findingId', '"findingId" is required — a verification belongs to one finding');
    }
    if (vulnerabilityId === undefined || vulnerabilityId === null || vulnerabilityId === '') {
      throw new GraphValidationError('Verification', 'vulnerabilityId', '"vulnerabilityId" is required — the verified finding lives in the graph');
    }
    if (!this.db.prepare('SELECT id FROM vulnerabilities WHERE id = ?').get(vulnerabilityId)) {
      throw new GraphValidationError('Verification', 'vulnerabilityId', `referenced vulnerability "${vulnerabilityId}" does not exist in the graph`);
    }
    if (exploitId !== undefined && exploitId !== null && exploitId !== '') {
      if (!this.db.prepare('SELECT id FROM exploits WHERE id = ?').get(exploitId)) {
        throw new GraphValidationError('Verification', 'exploitId', `referenced exploit "${exploitId}" does not exist in the graph`);
      }
    }
    if (!VERIFICATION_STATUSES.includes(status)) {
      throw new GraphValidationError('Verification', 'status', `"status" must be one of ${VERIFICATION_STATUSES.join('|')} — got ${JSON.stringify(status)}`);
    }
    if (verifierAgent === undefined || verifierAgent === null || String(verifierAgent).trim() === '') {
      throw new GraphValidationError('Verification', 'verifierAgent', '"verifierAgent" is required — every verdict names its verifier');
    }
    if (evidenceHash === undefined || evidenceHash === null || String(evidenceHash).trim() === '') {
      throw new GraphValidationError('Verification', 'evidenceHash', '"evidenceHash" is required — the immutable snapshot commitment');
    }
    for (const [k, val] of [['methodsRequired', methodsRequired], ['methodsSucceeded', methodsSucceeded]]) {
      if (val !== undefined && val !== null && (!Number.isInteger(val) || val < 0)) {
        throw new GraphValidationError('Verification', k, 'must be a non-negative integer');
      }
    }
    for (const [k, val] of [['methods', methods], ['evidence', evidence]]) {
      if (val !== undefined && (!Array.isArray(val) || val.some((e) => typeof e !== 'string' && typeof e !== 'object'))) {
        throw new GraphValidationError('Verification', k, 'must be an array of strings or plain objects (methods are stored as JSON attempts)');
      }
    }
    return {
      id: id || `verif-${findingId}`,
      findingId: String(findingId),
      vulnerabilityId,
      exploitId: exploitId || null,
      status,
      verifierAgent: String(verifierAgent),
      exploitedBy: exploitedBy || null,
      methodsRequired: methodsRequired === undefined || methodsRequired === null ? 1 : methodsRequired,
      methodsSucceeded: methodsSucceeded === undefined || methodsSucceeded === null ? 0 : methodsSucceeded,
      methods: methods || [],
      evidence: evidence || [],
      evidenceHash: String(evidenceHash),
      refusalRule: refusalRule || null,
      verifiedAt: verifiedAt || new Date().toISOString(),
      invalidatedAt: invalidatedAt || null,
    };
  }

  /** Upsert by natural key (findingId): re-verification replaces in place. */
  create(input) {
    const v = this.validate(input);
    const existing = this.db.prepare('SELECT id FROM finding_verifications WHERE natural_key = ?').get(v.findingId);
    if (existing) {
      this.db.prepare(`
        UPDATE finding_verifications SET
          vulnerability_id = ?, exploit_id = ?, status = ?, verifier_agent = ?,
          exploited_by = ?, methods_required = ?, methods_succeeded = ?,
          methods_json = ?, evidence_json = ?, evidence_hash = ?,
          refusal_rule = ?, verified_at = ?, invalidated_at = ?
        WHERE id = ?
      `).run(
        v.vulnerabilityId, v.exploitId, v.status, v.verifierAgent,
        v.exploitedBy, v.methodsRequired, v.methodsSucceeded,
        JSON.stringify(v.methods), JSON.stringify(v.evidence), v.evidenceHash,
        v.refusalRule, v.verifiedAt, v.invalidatedAt,
        existing.id,
      );
      return { created: false, row: this.get(existing.id) };
    }
    this.db.prepare(`
      INSERT INTO finding_verifications (
        id, finding_id, vulnerability_id, exploit_id, status, verifier_agent,
        exploited_by, methods_required, methods_succeeded, methods_json,
        evidence_json, evidence_hash, refusal_rule, verified_at, invalidated_at, natural_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      v.id, v.findingId, v.vulnerabilityId, v.exploitId, v.status, v.verifierAgent,
      v.exploitedBy, v.methodsRequired, v.methodsSucceeded, JSON.stringify(v.methods),
      JSON.stringify(v.evidence), v.evidenceHash, v.refusalRule, v.verifiedAt,
      v.invalidatedAt, v.findingId,
    );
    return { created: true, row: this.get(v.id) };
  }

  get(id) {
    const r = this.db.prepare('SELECT * FROM finding_verifications WHERE id = ?').get(id);
    return r ? rowToObject(r) : null;
  }

  getByFinding(findingId) {
    const r = this.db.prepare('SELECT * FROM finding_verifications WHERE natural_key = ?').get(findingId);
    return r ? rowToObject(r) : null;
  }

  list() {
    return this.db.prepare('SELECT * FROM finding_verifications ORDER BY finding_id').all().map(rowToObject);
  }

  count() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM finding_verifications').get().n;
  }

  /**
   * P5 doctrine: post-verification tampering invalidates the verification.
   * Only the verifier layer decides WHEN to call this (hash mismatch) —
   * the repo just records the outcome.
   */
  markInvalidated(findingId, { at = new Date().toISOString() } = {}) {
    const r = this.db.prepare('SELECT id FROM finding_verifications WHERE natural_key = ?').get(findingId);
    if (!r) return null;
    this.db.prepare('UPDATE finding_verifications SET status = ?, invalidated_at = ? WHERE id = ?')
      .run('INVALIDATED', at, r.id);
    return this.get(r.id);
  }
}

function rowToObject(r) {
  return {
    id: r.id,
    findingId: r.finding_id,
    vulnerabilityId: r.vulnerability_id,
    exploitId: r.exploit_id,
    status: r.status,
    verifierAgent: r.verifier_agent,
    exploitedBy: r.exploited_by,
    methodsRequired: r.methods_required,
    methodsSucceeded: r.methods_succeeded,
    methods: JSON.parse(r.methods_json || '[]'),
    evidence: JSON.parse(r.evidence_json || '[]'),
    evidenceHash: r.evidence_hash,
    refusalRule: r.refusal_rule,
    verifiedAt: r.verified_at,
    invalidatedAt: r.invalidated_at,
  };
}
