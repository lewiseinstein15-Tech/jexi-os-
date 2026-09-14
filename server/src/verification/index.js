/**
 * JEXI OS — VERIFICATION subsystem facade.
 *
 * The executable verifiers that WorkGraph VerificationNodes invoke.
 *
 *   - VerificationNode runs ✔ → calls a Verifier from this subsystem
 *   - The "verifier ≠ claimant" rule is enforced BOTH here (rule 1) and by
 *     the work graph (Scope C) — double enforcement is intentional.
 *
 * Integration contract (clean, no new node types in Scope C):
 *   const result = await VerificationRunner.run(context)
 *   if (result.status === 'pass')
 *     await workGraph.completeVerification(verificationNodeId,
 *        { owner: verifierAgentId, evidence: result.evidence })
 *   else → result is a blocker ('fail'/'error' propagates as a blocker).
 */

import { TestVerifier } from './verifiers/TestVerifier.js';
import { LintVerifier } from './verifiers/LintVerifier.js';
import { BuildVerifier } from './verifiers/BuildVerifier.js';
import { FileStateVerifier } from './verifiers/FileStateVerifier.js';
import { AgentVerifier, resolveReviewerAgent, agentReview, spawnReview } from './verifiers/AgentVerifier.js';
import { acceptCriterion, createFrozenCriteriaStore } from './acceptance/criteria.js';
import { captureSnapshot, snapshotId } from './acceptance/snapshot.js';
import { autoVerify, verifyAfterEdit, realVerifyLayer, VERIFY_LAYER_ORDER } from './loop/auto-verify.js';
import {
  assertIndependentAgent,
  requireSnapshot,
  resultIsBlocking,
} from './interface/Verifier.js';

/** Registry of verifiers by name. */
export const VERIFIERS = {
  TestVerifier,
  LintVerifier,
  BuildVerifier,
  FileStateVerifier,
  AgentVerifier,
};

/** Choose a verifier; default to TestVerifier. */
export function verifierFor(name) {
  return VERIFIERS[name] ?? TestVerifier;
}

/**
 * Run a verifier against a frozen snapshot + criteria, with independence.
 * @param {object} args
 * @param {string} args.verifier
 * @param {string} args.nodeId
 * @param {string} args.snapshotId
 * @param {object} [args.snapshot]
 * @param {string} args.acceptanceCriteria
 * @param {string} args.claimantAcbId
 * @param {string} args.verifierAgentId
 * @param {object} [args.options]
 */
export async function runVerification({
  verifier, nodeId, snapshotId: snapshotIdValue, snapshot, acceptanceCriteria,
  claimantAcbId, verifierAgentId, options = {},
}) {
  try {
    assertIndependentAgent(verifierAgentId, claimantAcbId);
    if (snapshot == null) requireSnapshot(new Map(), snapshotIdValue);
  } catch (err) {
    return {
      status: 'error',
      evidence: [{ source: verifier, content: err.message, at: Date.now() }],
      reason: err.message,
      durationMs: 0,
    };
  }
  const v = verifierFor(verifier);
  return v.verify({
    nodeId,
    snapshotId: snapshotIdValue,
    snapshot,
    acceptanceCriteria,
    claimantAcbId,
    options: { ...options, verifierAgentId },
  });
}

/** Best-effort runner that attaches evidence the work graph can persist. */
export async function verifyVerificationNode({ verifier, context, verifierAgentId, options = {} }) {
  return runVerification({ ...context, verifier, verifierAgentId, options });
}

export const VerificationRunner = { run: runVerification };

export {
  TestVerifier, LintVerifier, BuildVerifier, FileStateVerifier, AgentVerifier,
  acceptCriterion, createFrozenCriteriaStore, captureSnapshot, snapshotId,
  autoVerify, verifyAfterEdit, realVerifyLayer, VERIFY_LAYER_ORDER,
  assertIndependentAgent, requireSnapshot, resultIsBlocking,
  resolveReviewerAgent, agentReview, spawnReview,
};