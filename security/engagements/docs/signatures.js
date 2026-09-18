/**
 * JEXI OS — Phase 8 Scope D — DOCUMENT 8/8: SIGNATURES (authorization proof).
 *
 * Decepticon Soundwave: "Signatures: authorization proof." A signature is
 * { role, name, signedAt, hash } where hash = SHA-256 over the CANONICAL
 * bundle (every field except the signatures array, key-sorted, stable
 * JSON). Any later mutation of the signed content breaks verification —
 * that is the whole point (probe P11).
 */

import { createHash } from 'node:crypto';
import { nowIso, EngagementValidationError } from '../store.js';

export const DOC_ID = 'signatures';
export const DOC_TITLE = 'Signatures — authorization proof';

export function build(draft) {
  if (!draft || typeof draft !== 'object') {
    throw new EngagementValidationError('draft', `${DOC_ID}: expected a plan draft object`);
  }
  if (draft.signatures !== undefined && !Array.isArray(draft.signatures)) {
    throw new EngagementValidationError('signatures', `${DOC_ID}: signatures must be an array when provided`);
  }
  return { signatures: [] };
}

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The canonical signed content: the engagement minus the signatures array
 * (self-reference) and minus `approvals` (operational state merged from its
 * own table by Engagements.get() — granting an approval after signing must
 * NOT invalidate the signed plan; tampering with the plan must).
 */
export function canonicalize(engagement) {
  const { signatures, approvals, ...rest } = engagement;
  return stableStringify(rest);
}

export function bundleHash(engagement) {
  return createHash('sha256').update(canonicalize(engagement)).digest('hex');
}

/** Produce the new signatures array after signing the CURRENT content. */
export function signBundle(engagement, { role, name } = {}) {
  if (!role || typeof role !== 'string' || !name || typeof name !== 'string') {
    throw new EngagementValidationError('signature', `${DOC_ID}: signing requires non-empty role and name`);
  }
  const entry = { role, name, signedAt: nowIso(), hash: bundleHash(engagement) };
  return [...(engagement.signatures || []), entry];
}

/** Verify every signature against the CURRENT content. */
export function verifySignatures(engagement) {
  const expected = bundleHash(engagement);
  const results = (engagement.signatures || []).map((s) => ({
    role: s.role,
    name: s.name,
    signedAt: s.signedAt,
    valid: s.hash === expected,
    expectedHash: expected,
    signedHash: s.hash,
  }));
  return { valid: results.every((r) => r.valid) && results.length > 0, results, currentHash: expected };
}

export default { DOC_ID, DOC_TITLE, build, bundleHash, signBundle, verifySignatures };
