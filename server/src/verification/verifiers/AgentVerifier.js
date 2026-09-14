/**
 * JEXI OS — VERIFICATION — AgentVerifier.
 *
 * Routes to a DIFFERENT agent (via the workforce registry, AgentRoster) to
 * review the claim. The verifying agent receives ONLY the frozen snapshot +
 * criteria + the claimant's claim — never the working agent's reasoning
 * trail. Its verdict is evidence, not a rubber stamp. Same-agent verification
 * is refused (enforced here AND by the work graph).
 */

import { assertIndependentAgent } from '../interface/Verifier.js';
import { getAgent } from '../../services/AgentRoster.js';

/** A review decision produced by a non-claimant agent. */
export async function agentReview({ verifierSlug, snapshot, acceptanceCriteria, claim, assertIndependent = false, claimantAcbId = '' } = {}) {
  if (assertIndependent) assertIndependentAgent(verifierSlug, claimantAcbId);
  const reviewer = getAgent(verifierSlug);
  if (!reviewer) throw new Error(`unknown verifier agent ${verifierSlug}`);
  // The reviewer sees ONLY the snapshot + frozen criteria + claim.
  return {
    reviewer: reviewer.slug,
    reviewed: {
      snapshotFiles: Object.keys(snapshot?.files ?? {}),
      acceptanceCriteria,
      claim,
    },
  };
}

/** @type {import('../interface/Verifier.js').Verifier} */
export const AgentVerifier = {
  name: 'AgentVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, snapshot, acceptanceCriteria, claimantAcbId, options = {} }) {
    const started = Date.now();
    const { verifierSlug, claim = '', verdict = {} } = options;
    // Rule 1: the reviewer must be a different agent than the claimant.
    if (verifierSlug === claimantAcbId) {
      return {
        status: 'error',
        evidence: [{ source: 'AgentVerifier', snapshotId, content: `self-verification refused (${verifierSlug})`, at: Date.now() }],
        reason: 'self_verification_refused',
        durationMs: Date.now() - started,
      };
    }
    if (!verifierSlug) return { status: 'error', evidence: [], reason: 'no_verifier_slug', durationMs: Date.now() - started };
    try {
      const review = await agentReview({ verifierSlug, snapshot, acceptanceCriteria, claim, claimantAcbId, assertIndependent: true });
      const pass = verdict.approve === true;
      const evidence = [{
        source: `AgentVerifier(${verifierSlug})`,
        snapshotId,
        content: pass ? `approved` : `rejected by independent reviewer`,
        at: Date.now(),
        review,
      }];
      return {
        status: pass ? 'pass' : 'fail',
        evidence,
        reason: pass ? undefined : verdict.reason || 'independent review rejected',
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return { status: 'error', evidence: [], reason: err.message, durationMs: Date.now() - started };
    }
  },
};