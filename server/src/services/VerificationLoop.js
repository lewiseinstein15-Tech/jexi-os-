/**
 * JEXI OS — Verification Loop (anti-hallucination).
 *
 * Loop engineering for answer quality, inspired by the reflection/self-critique
 * patterns in LangGraph (Reflexion loops), Atomic Agents (predictable outputs),
 * and MetaGPT (self-improving via reflection):
 *
 *   1. CRITIQUE — a strict auditor reads the draft against the task and any
 *      sources, and lists concrete problems: unsupported claims, invented
 *      facts, missing citations, contradictions, unanswered parts.
 *   2. REVISE — if the critique found real issues, the answer is rewritten
 *      fixing exactly those issues (sources preserved, no new invention).
 *   3. Cap — at most MAX_ROUNDS cycles so the loop always terminates.
 *
 * Safety: if no AI key is configured, or the answer is too short to matter,
 * the draft passes through untouched — verification never breaks a reply.
 */

import { generateContent, resolveKeys } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { buildVerificationPrompt, parseVerificationVerdict, buildRevisionPrompt } from './VerificationPrompt.js';

const MAX_ROUNDS = 2;          // critique → revise, at most twice
const MIN_LENGTH = 160;        // skip verification for trivial one-liners
const SOURCES_LIMIT = 6;

/** True when the answer should be verified (keys exist + long enough). */
export function shouldVerify(draft, opts = {}) {
  const keys = resolveKeys();
  if (!keys.groqKey && !keys.geminiKey && !process.env.OPENROUTER_API_KEY) return false;
  if (!draft || String(draft).trim().length < (opts.minLength ?? MIN_LENGTH)) return false;
  return true;
}

/**
 * Run the critique → revise loop on a draft answer.
 * Returns { text, changed, rounds, verdict, issues } where verdict is
 * 'verified' when the final critique found nothing, 'best-effort' after
 * hitting the cap, or 'skipped' when verification was not applicable.
 * `changed` is true when the returned text differs from the draft.
 */
export async function verifyAnswer({ query, draft, sources = [], sendEvent, opts = {} }) {
  const original = String(draft || '').trim();
  if (!shouldVerify(original, opts)) {
    return { text: original, changed: false, rounds: 0, verdict: 'skipped', issues: [] };
  }

  const srcText = (sources || [])
    .slice(0, SOURCES_LIMIT)
    .map((s) => `- ${s.title || s.name || s.link || s}`)
    .join('\n');

  let current = original;
  let issues = [];
  let rounds = 0;

  for (let r = 0; r < MAX_ROUNDS; r++) {
    rounds = r + 1;
    if (sendEvent) sendEvent('log', { agent: 'Fact Checker', message: `🔍 Verification pass ${rounds}/${MAX_ROUNDS} — auditing for unsupported claims…` });

    // 1. CRITIQUE — strict, adversarial. It must say CLEAN or list problems.
    const critique = await generateContent(
      buildVerificationPrompt({
        role: 'FACT CHECKER',
        task: query,
        sources: srcText ? (sources || []) : [],
        draft: current,
        rules: 'Your job is to catch hallucinations and unsupported claims — never to praise.',
      }),
      JEXI_SYSTEM_PROMPT + '\nYou are the Fact Checker agent. Be strict, precise, and brief. Output the JSON object only.',
      null,
      { temperature: 0.1 }
    );

    const { clean: isClean, issues: parsedIssues } = parseVerificationVerdict(critique);
    issues = parsedIssues;

    if (isClean) {
      if (sendEvent) sendEvent('log', { agent: 'Fact Checker', message: '✅ Verified — no unsupported claims found.' });
      return { text: current, changed: current !== original, rounds, verdict: 'verified', issues };
    }

    if (sendEvent) sendEvent('log', { agent: 'Fact Checker', message: `⚠ Found ${issues.length} issue(s) — revising…` });

    // 2. REVISE — rewrite fixing exactly the listed issues.
    const revised = await generateContent(
      buildRevisionPrompt({
        task: query,
        sources: srcText ? (sources || []) : [],
        issues,
        draft: current,
      }),
      JEXI_SYSTEM_PROMPT + '\nYou are the Fact Checker agent. Output only the corrected answer.',
      null,
      { temperature: 0.2 }
    );

    const next = String(revised || '').trim();
    if (!next || next.length < 20) break;         // bad revision — keep the draft
    if (next === current) break;                  // no change — stop looping
    current = next;
  }

  if (sendEvent) sendEvent('log', { agent: 'Fact Checker', message: `⚠ Reached the ${MAX_ROUNDS}-round cap — shipping best effort (grounded as much as possible).` });
  return { text: current, changed: current !== original, rounds, verdict: 'best-effort', issues };
}
