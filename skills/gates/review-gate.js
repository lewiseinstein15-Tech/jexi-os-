/**
 * JEXI OS — HARD GATE — review (merge/push).
 *
 * BLOCKS any merge/push until an independent review verdict exists.
 * Mirrors JEXI's verification-independence rule (AgentVerifier refuses
 * same-agent verification): the reviewer MUST NOT be the author.
 *
 * ctx.author:      string — who produced the change
 * ctx.review = {
 *   reviewer: string,          // !== author required
 *   verdict: 'approve',        // only 'approve' passes
 *   diffReviewed: string       // hash/id of the exact diff that was reviewed
 * }
 */
import { createHash } from 'node:crypto';
import { appendAudit } from './state.js';

export default {
  id: 'review-gate',

  when: (ctx) => ctx?.action === 'push' || ctx?.action === 'merge',

  async check(ctx) {
    const r = ctx?.review;
    if (!r || typeof r !== 'object') {
      return deny('no review', ['review-approval'],
        'Request a review from an agent OTHER than the author; pass review = { reviewer, verdict: "approve", diffReviewed }.');
    }
    if (!r.reviewer || !r.verdict || !r.diffReviewed) {
      return deny('review record incomplete (needs reviewer, verdict, diffReviewed)', ['review.reviewer', 'review.verdict', 'review.diffReviewed'],
        'A review without the reviewed diff id cannot be audited. Record exactly what was reviewed.');
    }
    if (ctx.author && r.reviewer === ctx.author) {
      return deny('self-review refused (reviewer === author)', ['independent-reviewer'],
        'The author cannot approve their own change — same rule as JEXI AgentVerifier. Get a second agent.');
    }
    if (r.verdict !== 'approve') {
      return deny(`review verdict is '${r.verdict}', not 'approve'`, ['review-approval'],
        'Address the review findings first, then re-request review on the updated diff.');
    }
    const evidence = `approved by '${r.reviewer}' on diff ${shortHash(r.diffReviewed)}`;
    appendAudit({ gate: 'review-gate', blocked: false, evidence });
    return { allowed: true, reason: evidence };
  },
};

function shortHash(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
}

function deny(reason, missing, hint) {
  appendAudit({ gate: 'review-gate', blocked: true, reason, missing });
  return { allowed: false, reason, missing, hint };
}
