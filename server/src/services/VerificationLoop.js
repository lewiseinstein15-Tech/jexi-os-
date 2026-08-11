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
      `You are a strict FACT CHECKER. Your job is to catch hallucinations and unsupported claims — never to praise.\n\n` +
      `TASK: ${query}\n` +
      (srcText ? `\nAVAILABLE SOURCES (the ONLY things the answer may rely on):\n${srcText}\n` : `\n(No external sources were provided — flag any specific factual claim the model could not know from the task itself.)\n`) +
      `\nDRAFT ANSWER TO AUDIT:\n"""\n${current.slice(0, 9000)}\n"""\n\n` +
      `Audit the draft. Reply with EXACTLY this format:\n` +
      `VERDICT: CLEAN\n` +
      `or\n` +
      `VERDICT: ISSUES\n` +
      `ISSUES:\n- <one concrete problem per line, e.g. "Claims X but the sources say Y" or "States Z with no source">\n\n` +
      `Rules: mark ISSUES only for REAL problems (invented facts, contradictions, unsupported specific claims, missing citations for sourced material, off-task content). Do NOT flag style or brevity. If everything is grounded, say CLEAN.`,
      JEXI_SYSTEM_PROMPT + '\nYou are the Fact Checker agent. Be strict, precise, and brief.',
      null,
      { temperature: 0.1 }
    );

    const verdictLine = String(critique || '').match(/VERDICT:\s*(CLEAN|ISSUES)/i);
    const isClean = verdictLine ? verdictLine[1].toUpperCase() === 'CLEAN' : !/VERDICT:\s*ISSUES/i.test(critique || '');
    issues = String(critique || '').split('\n').filter((l) => l.trim().startsWith('-')).map((l) => l.trim().replace(/^-/, '').trim()).filter(Boolean).slice(0, 8);

    if (isClean) {
      if (sendEvent) sendEvent('log', { agent: 'Fact Checker', message: '✅ Verified — no unsupported claims found.' });
      return { text: current, changed: current !== original, rounds, verdict: 'verified', issues };
    }

    if (sendEvent) sendEvent('log', { agent: 'Fact Checker', message: `⚠ Found ${issues.length} issue(s) — revising…` });

    // 2. REVISE — rewrite fixing exactly the listed issues.
    const revised = await generateContent(
      `Rewrite the answer below so it fixes EVERY issue the fact checker found. Rules:\n` +
      `- Fix only the listed problems. Keep the structure, tone and length similar.\n` +
      `- NEVER invent new facts. If a claim cannot be supported by the task or sources, remove it or say it explicitly as an assumption.\n` +
      `- Keep the same heading/markdown style so the reader sees an improved version, not a different answer.\n\n` +
      `TASK: ${query}\n` +
      (srcText ? `\nSOURCES:\n${srcText}\n` : '') +
      `\nFACT CHECKER'S ISSUES:\n${issues.map((i) => `- ${i}`).join('\n') || '(unspecified — re-check grounding and unsupported claims)'}\n\n` +
      `DRAFT TO REVISE:\n"""\n${current.slice(0, 9000)}\n"""\n\n` +
      `Output ONLY the revised answer.`,
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
