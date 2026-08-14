/**
 * JEXI OS — Finalizer (B52 P5).
 *
 * ONE completion helper for every user-facing Orchestrator return:
 *
 *   finalizeAnswer({ query, draft, sources, domain, verify, sendEvent, opts })
 *     → { summary, verification, sources }
 *
 * 1. Runs verification when appropriate (skipped for pure conversation with
 *    nothing to verify — `verify: false`).
 * 2. Strips forbidden process narration as a last line of defence (the
 *    AnswerSanitizer — "I studied…", "FROM MEMORY", "JEXI SCHOLAR", etc.).
 * 3. Returns the clean final summary + verification metadata.
 *
 * Route studyTopic, research, knowledgeRecall, code summary, news and
 * direct_answer through this helper before `results.summary` is set for the
 * client — so no inner-path regression can leak narration or an unverified
 * draft to the user.
 */
import { verifyAnswer } from './VerificationLoop.js';
import { sanitizeFinalAnswer } from './AnswerSanitizer.js';

/**
 * @param {object} opts
 * @param {string} opts.query       the user's question (verification context)
 * @param {string} opts.draft       the draft summary to finalize
 * @param {Array}  [opts.sources]   sources backing the answer
 * @param {string|null} [opts.domain]  domain label for verification metadata
 * @param {boolean} [opts.verify]   run the verification pass (default true)
 * @param {Function} [opts.sendEvent]  live log emitter
 * @param {object} [opts.opts]      verification options (e.g. minLength)
 * @returns {Promise<{summary: string, verification: object|null, sources: Array}>}
 */
export async function finalizeAnswer({ query, draft, sources = [], domain = null, verify = true, sendEvent = () => {}, opts = {} }) {
  let summary = String(draft || '');
  let verification = null;

  if (verify && summary.trim()) {
    try {
      const verified = await verifyAnswer({ query, draft: summary, sources, sendEvent, opts });
      if (verified && verified.changed && verified.text) summary = verified.text;
      verification = {
        rounds: (verified && verified.rounds) || 1,
        verdict: (verified && verified.verdict) || 'verified',
        ...(domain ? { domain } : {}),
      };
    } catch (e) {
      verification = { error: (e && e.message) || String(e) };
    }
  }

  // Last line of defence: no process narration can reach the user.
  summary = sanitizeFinalAnswer(summary);

  return { summary, verification, sources };
}
