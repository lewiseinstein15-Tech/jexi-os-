/**
 * JEXI OS — VERIFICATION — AgentVerifier.
 *
 * Routes to a DIFFERENT agent (via the workforce registry, director/Employees
 * + workforce/registry) to review the claim. The verifying agent receives
 * ONLY the frozen snapshot + criteria + the claimant's claim — never the
 * working agent's reasoning trail. Its verdict is evidence, not a rubber
 * stamp. Same-agent verification is refused (enforced here AND by the work
 * graph).
 *
 * REAL DIFFERENT-AGENT SPAWN (Phase 5 Scope B): the reviewer identity is
 * resolved through the workforce registry (`resolveAgent(['verification'])`
 * or an explicit slug), and the review is dispatched to that agent through
 * the subagent runtime (its OWN context window — SubagentRuntime). If the
 * runtime genuinely cannot spawn a reviewer (no LLM provider configured),
 * the result is an 'error' with the real reason — never a silent pass. An
 * explicit `verdict` option remains the deterministic test seam.
 */

import { assertIndependentAgent } from '../interface/Verifier.js';
import { getAgent } from '../../workforce/registry/index.js';
import { getByAgentId } from '../../workforce/registry/index.js';
import { resolveAgent } from '../../workforce/registry/router.js';
import { runIsolatedSubagent } from '../../services/SubagentRuntime.js';

/** Resolve a reviewer identity: explicit slug (workforce first, legacy
 * roster fallback) or the registry's verification-capable agent. */
export function resolveReviewerAgent(verifierSlug) {
  if (verifierSlug) {
    const workforce = getByAgentId(verifierSlug);
    if (workforce) return { id: workforce.agentId, name: workforce.displayName, role: workforce.role, via: 'workforce' };
    const legacy = getAgent(verifierSlug);
    if (legacy) return { id: legacy.slug, name: legacy.name, role: legacy.role, via: 'roster' };
    return null;
  }
  const voted = resolveAgent(['verification'], { requireWrite: false });
  if (voted) return { id: voted.agentId, name: voted.displayName, role: voted.role, via: 'workforce' };
  const legacy = getAgent('qa') || getAgent('reviewer');
  return legacy ? { id: legacy.slug, name: legacy.name, role: legacy.role, via: 'roster' } : null;
}

/** A review decision produced by a non-claimant agent. */
export async function agentReview({ verifierSlug, snapshot = {}, acceptanceCriteria = '', claim = '', assertIndependent = false, claimantAcbId = '' } = {}) {
  if (assertIndependent) assertIndependentAgent(verifierSlug, claimantAcbId);
  const reviewer = getAgent(verifierSlug);
  if (!reviewer) throw new Error(`unknown verifier agent ${verifierSlug}`);
  return {
    reviewer: reviewer.slug,
    reviewed: {
      snapshotFiles: Object.keys(snapshot.files ?? {}),
      acceptanceCriteria,
      claim,
    },
  };
}

/**
 * Dispatch the review to the resolved agent through the subagent runtime.
 * Uses the real subagent spawn (own context); off by default so a caller
 * that only wants identity routing can stay fully local.
 */
export async function spawnReview({ reviewerId, snapshot: _snapshot, acceptanceCriteria: _acceptanceCriteria, claim: _claim, prompt, sendEvent }) {
  const task = String(prompt || '').slice(0, 2000);
  const out = await runIsolatedSubagent({
    name: reviewerId,
    query: task,
    sendEvent: sendEvent || (() => {}),
    opts: { depth: 1, systemPromptOverride: `You are ${reviewerId}, the independent verifier. Verdict must be a single line starting with APPROVE or REJECT.` },
  });
  // The subagent runtime returns { status, summary, error }. A verdict of
  // APPROVE/REJECT from the reviewer is parsed from its summary.
  if (out.status === 'PASS' || out.status === 'done') {
    const text = String(out.summary || out.answer || '');
    const approve = /^\s*APPROVE/i.test(text) || /^approved/i.test(text);
    return { ok: true, verdict: { approve, reason: text.split('\n')[0]?.slice(0, 300) }, evidence: text.slice(0, 2000) };
  }
  return { ok: false, error: out.error || 'reviewer did not return a verdict', evidence: String(out.summary || '').slice(0, 1000) };
}

/** @type {import('../interface/Verifier.js').Verifier} */
export const AgentVerifier = {
  name: 'AgentVerifier',

  /**
   * @type {(context: import('../interface/Verifier.js').VerifyContext) => Promise<import('../interface/Verifier.js').VerifyResult>}
   */
  async verify({ _nodeId, snapshotId, snapshot, acceptanceCriteria, claimantAcbId, options = {} }) {
    const started = Date.now();
    const { verifierSlug, claim = '', verdict, spawn = spawnReview } = options;
    // Rule 1: the reviewer must be a different agent than the claimant.
    if (verifierSlug && verifierSlug === claimantAcbId) {
      return {
        status: 'error',
        evidence: [{ source: 'AgentVerifier', snapshotId, content: `self-verification refused (${verifierSlug})`, at: Date.now() }],
        reason: 'self_verification_refused',
        durationMs: Date.now() - started,
      };
    }
    let reviewer = null;
    try {
      reviewer = resolveReviewerAgent(verifierSlug);
    } catch { reviewer = null; }
    if (!reviewer) {
      return { status: 'error', evidence: [], reason: verifierSlug ? `no_verifier_agent_${verifierSlug}` : 'no_verification_agent', durationMs: Date.now() - started };
    }

    // Explicit verdict — the deterministic seam (tests / callers that have a
    // verdict already). Still refused if the resolved reviewer IS the claimant.
    if (verdict) {
      try {
        assertIndependentAgent(reviewer.id, claimantAcbId);
      } catch (err) {
        return { status: 'error', evidence: [], reason: err.message, durationMs: Date.now() - started };
      }
      const pass = verdict.approve === true;
      return {
        status: pass ? 'pass' : 'fail',
        evidence: [{
          source: `AgentVerifier(${reviewer.id})`,
          snapshotId,
          content: pass ? 'approved' : 'rejected by independent reviewer',
          at: Date.now(),
          review: { reviewer: reviewer.id, via: reviewer.via, reviewed: { snapshotFiles: Object.keys(snapshot?.files ?? {}), acceptanceCriteria, claim } },
        }],
        reason: pass ? undefined : verdict.reason || 'independent review rejected',
        durationMs: Date.now() - started,
      };
    }

    // REAL spawn path — dispatch the review to the different agent.
    try {
      assertIndependentAgent(reviewer.id, claimantAcbId);
    } catch (err) {
      return { status: 'error', evidence: [], reason: err.message, durationMs: Date.now() - started };
    }
    try {
      const review = await spawn({
        reviewerId: reviewer.id,
        snapshot,
        acceptanceCriteria,
        claim,
      });
      if (!review.ok) {
        return {
          status: 'error',
          evidence: [{ source: `AgentVerifier(${reviewer.id})`, snapshotId, content: review.error || 'reviewer spawn failed', at: Date.now() }],
          reason: review.error || 'reviewer_spawn_failed',
          durationMs: Date.now() - started,
        };
      }
      const pass = review.verdict?.approve === true;
      const evidence = [{
        source: `AgentVerifier(${reviewer.id}@spawn)`,
        snapshotId,
        content: pass ? 'approved' : 'rejected by independent reviewer',
        at: Date.now(),
        review: {
          reviewer: reviewer.id,
          via: reviewer.via,
          reviewed: { snapshotFiles: Object.keys(snapshot?.files ?? {}), acceptanceCriteria, claim },
          evidence: String(review.evidence || '').slice(0, 2000),
        },
      }];
      return {
        status: pass ? 'pass' : 'fail',
        evidence,
        reason: pass ? undefined : (review.verdict?.reason || 'independent review rejected'),
        durationMs: Date.now() - started,
      };
    } catch (err) {
      return { status: 'error', evidence: [], reason: err.message, durationMs: Date.now() - started };
    }
  },
};