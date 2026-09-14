/**
 * JEXI OS — VERIFICATION — Verifier contract.
 *
 * Verification is always: run a verifier against an immutable snapshot,
 * against frozen acceptance criteria, where the verifier is a DIFFERENT
 * agent than the one that did the work. Agent self-report is never
 * sufficient.
 *
 * @typedef {object} VerifyContext
 * @property {string} nodeId              — work graph node being verified
 * @property {string} snapshotId          — immutable source snapshot id
 * @property {string} acceptanceCriteria  — frozen before work starts
 * @property {string} claimantAcbId       — agent that did the work
 * @property {object} [options]           — verifier-specific options
 *
 * @typedef {object} VerifyResult
 * @property {'pass'|'fail'|'error'} status
 * @property {import('../../workgraph/nodes/WorkNode.js').Evidence[]} evidence
 * @property {string} [reason]
 * @property {number} durationMs
 *
 * @typedef {object} Verifier
 * @property {string} name
 * @property {(context: VerifyContext) => Promise<VerifyResult>} verify
 */

/**
 * Enforces rule 1: the verifier's agent identity must differ from the
 * claimant (the agent that did the work). Same-agent verification is refused.
 * Double enforcement with the work graph is intentional.
 * @throws {Error} when verifierAgentId === claimantAcbId
 */
export function assertIndependentAgent(verifierAgentId, claimantAcbId) {
  if (verifierAgentId && verifierAgentId === claimantAcbId) {
    throw new Error(`self-verification refused: verifier ${verifierAgentId} is the claimant`);
  }
}

/**
 * Enforces rules 2: verification must read from the immutable snapshot, never
 * the live workspace. If the snapshot store has no record for snapshotId, the
 * verification is REFUSED (no silent re-snapshot).
 * @param {Map<string, object>} snapshotStore
 * @param {string} snapshotId
 * @returns {object} the frozen snapshot
 * @throws {Error} when snapshot is missing
 */
export function requireSnapshot(snapshotStore, snapshotId) {
  const snap = snapshotStore.get(snapshotId);
  if (!snap) throw new Error(`snapshot ${snapshotId} missing — verification refused`);
  return snap;
}

/** Wrap any verifier body with duration + error-to-'error' normalization. */
export function timed(promise) {
  const started = Date.now();
  return Promise.resolve(promise).then(
    (result) => ({ ...result, durationMs: Date.now() - started }),
    (err) => ({ status: 'error', evidence: [{ source: 'verification', content: err.message, at: Date.now() }], reason: err.message, durationMs: Date.now() - started }),
  );
}

/**
 * Enforces rules 4+5: a 'fail' result becomes a blocker, and its evidence is
 * returned so it can be attached to the work-graph node.
 */
export function resultIsBlocking(result) {
  return result.status === 'fail' || result.status === 'error';
}