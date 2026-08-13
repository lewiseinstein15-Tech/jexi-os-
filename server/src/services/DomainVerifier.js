/**
 * JEXI OS — Domain Verification Engine (roadmap stage 16).
 *
 * The general VerificationLoop audits facts vs sources. This engine adds a
 * PER-DOMAIN layer: deterministic structural checks that never need an AI key
 * (balanced math fences, FINAL ANSWER present, sources linked, code blocks
 * complete) plus a domain-specific critic for the domains JEXI is used for
 * most: math, code, research and engineering.
 *
 * Deterministic checks always run (zero cost). The AI critic runs only when a
 * key is configured and the deterministic pass flagged something or the draft
 * is long enough to matter. The engine never fails a request — worst case the
 * draft ships unchanged with the findings reported.
 */

import { generateContent, resolveKeys } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';

export const DOMAINS = ['math', 'code', 'research', 'engineering', 'general'];

/** Detect the answer domain from the task + draft (no AI). */
export function detectDomain(query = '', draft = '') {
  const q = `${query} ${draft}`.toLowerCase();
  if (/(solve|calculate|compute|integral|derivative|equation|formula|factor|\bmath\b|algebra|calculus|physics|probability|what is \d)/.test(q)) return 'math';
  if (/(engineer|circuit|beam|stress|load|structure|mechanical|civil|structural|moment|deflection)/.test(q)) return 'engineering';
  if (/(code|program|function|debug|error|script|build|app|website|api|python|javascript|react|test)/.test(q)) return 'code';
  if (/(research|what is|who|explain|how does|compare|sources|history|latest|analysis)/.test(q)) return 'research';
  return 'general';
}

/** Count occurrences of a substring. */
const count = (s, needle) => String(s || '').split(needle).length - 1;

/** Safe arithmetic spot-check: "12 * 7" → verify the answer contains the result. */
function arithmeticSpotCheck(query, draft) {
  const m = String(query || '').match(/(-?\d+(?:\.\d+)?)\s*([+*\-/x÷])\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[3]);
  let expected = null;
  switch (m[2]) {
    case '+': expected = a + b; break;
    case '-': expected = a - b; break;
    case '*': case 'x': case '×': expected = a * b; break;
    case '/': case '÷': expected = b === 0 ? null : a / b; break;
  }
  if (expected === null) return null;
  const rounded = Math.abs(expected) >= 1 ? Math.round(expected * 100) / 100 : Math.round(expected * 10000) / 10000;
  const inDraft = new RegExp(String(rounded).replace('.', '\\.')).test(String(draft || ''));
  return { expected: rounded, found: inDraft };
}

/**
 * Deterministic per-domain structural checks — no AI, always run.
 * Returns { ok, issues: string[] }.
 */
export function deterministicChecks(query, draft, domain = 'general') {
  const issues = [];
  const d = String(draft || '');
  const u = d.toUpperCase();

  // Common: code fences must be balanced.
  const fences = count(d, '```');
  if (fences % 2 !== 0) issues.push('Unbalanced code fences (odd count of ```)');

  if (domain === 'math') {
    const dollar = count(d, '$$');
    if (dollar % 2 !== 0) issues.push('Unbalanced display-math fences (odd count of $$)');
    if (!/FINAL ANSWER|THEREFORE|ANSWER:|=\s*[-0-9]/.test(u)) issues.push('No FINAL ANSWER with a numeric result found');
    const spot = arithmeticSpotCheck(query, d);
    if (spot && !spot.found) issues.push(`Arithmetic spot-check failed: expected ${spot.expected} in the answer`);
  }

  if (domain === 'engineering') {
    if (!/\bGIVEN\b/.test(u)) issues.push('Solution tasks should include a GIVEN section (known values)');
    if (!/\bFORMULA\b/.test(u)) issues.push('Solution tasks should include a FORMULA section');
    if (!/FINAL ANSWER|THEREFORE/.test(u)) issues.push('No FINAL ANSWER section found');
  }

  if (domain === 'research') {
    if (!/https?:\/\//.test(d)) issues.push('No source links found in the answer');
    if (d.length > 400 && !/\b(KEY FINDINGS|OVERVIEW|SOURCES|CONCLUSION)\b/.test(u)) issues.push('Long research answers should use KEY FINDINGS / SOURCES structure');
  }

  if (domain === 'code') {
    if (fences === 0) issues.push('No code blocks in the answer (expected fenced code)');
  }

  return { ok: issues.length === 0, issues };
}

const DOMAIN_CRITIC_RULES = {
  math: 'Check every formula and every step. Re-derive the key result. Flag: wrong units, algebra slips, missing steps, answers that do not follow from the working, and any FINAL ANSWER that contradicts the working.',
  code: 'Check the code as a reviewer: does it run? are imports/exports correct? edge cases (empty input, division by zero), obvious syntax errors, and any code that contradicts its own explanation. Do not demand style changes.',
  research: 'Check grounding: every specific factual claim must be supported by the sources. Flag invented facts, unsupported numbers, and missing citations. Ignore wording.',
  engineering: 'Check the engineering solution: are the GIVEN values used? is the right FORMULA applied (units consistent)? is the computed result plausible (order of magnitude)? Flag unit errors and formulas that do not match the problem.',
  general: 'Check for internal contradictions, unsupported specific claims, and off-task content.',
};

/**
 * Run the domain verification pipeline:
 *   deterministic checks → (AI domain critic if keys + flagged/long) → revise.
 * Returns { text, changed, verdict, domain, issues, checks }.
 */
export async function verifyDomainAnswer({ query, draft, domain, sources = [], sendEvent, opts = {} }) {
  const original = String(draft || '').trim();
  const useDomain = domain || detectDomain(query, original);
  const emit = (message) => { try { sendEvent && sendEvent('log', { agent: `Domain Check (${useDomain})`, message }); } catch (e) {} };

  const checks = deterministicChecks(query, original, useDomain);
  if (checks.ok) {
    emit('✅ Domain checks passed (balanced fences, structure, sources).');
    return { text: original, changed: false, verdict: 'verified', domain: useDomain, issues: [], checks };
  }

  emit(`⚠ ${checks.issues.length} deterministic check(s) failed: ${checks.issues.join('; ')}`);

  // AI critic pass — only with keys, only for long-enough drafts.
  const keys = resolveKeys();
  const hasKeys = keys.groqKey || keys.geminiKey || process.env.OPENROUTER_API_KEY || keys.xaiKey;
  if (!hasKeys || original.length < (opts.minLength ?? 120)) {
    return { text: original, changed: false, verdict: 'best-effort', domain: useDomain, issues: checks.issues, checks };
  }

  const srcText = (sources || []).slice(0, 6).map((s) => `- ${s.title || s.name || s.link || s}`).join('\n');
  const rules = DOMAIN_CRITIC_RULES[useDomain] || DOMAIN_CRITIC_RULES.general;

  let current = original;
  let rounds = 0;
  for (let r = 0; r < 2; r++) {
    rounds = r + 1;
    emit(`🔍 Domain critic pass ${rounds}/2 (${useDomain})…`);
    const critique = await generateContent(
      `You are a strict ${useDomain} VERIFIER. Rules: ${rules}\n\nTASK: ${query}\n` +
      (srcText ? `\nSOURCES:\n${srcText}\n` : '') +
      `\nDRAFT:\n"""\n${current.slice(0, 9000)}\n"""\n\nReply EXACTLY:\nVERDICT: CLEAN\nor\nVERDICT: ISSUES\nISSUES:\n- <one concrete problem per line>`,
      JEXI_SYSTEM_PROMPT + `\nYou are the ${useDomain} verifier. Strict and brief.`,
      null,
      { temperature: 0.1 }
    );
    const clean = /VERDICT:\s*CLEAN/i.test(String(critique || ''));
    const aiIssues = String(critique || '').split('\n').filter((l) => l.trim().startsWith('-')).map((l) => l.trim().replace(/^-/, '')).filter(Boolean).slice(0, 8);
    if (clean) {
      emit('✅ Domain critic: clean.');
      return { text: current, changed: current !== original, verdict: 'verified', domain: useDomain, issues: checks.issues, checks };
    }
    const revised = await generateContent(
      `Fix EVERY issue below in the ${useDomain} answer. Keep structure and style. Never invent new facts.\n\nTASK: ${query}\n` +
      (srcText ? `\nSOURCES:\n${srcText}\n` : '') +
      `\nISSUES:\n${aiIssues.map((i) => `- ${i}`).join('\n')}\n\nDRAFT:\n"""\n${current.slice(0, 9000)}\n"""\n\nOutput ONLY the corrected answer.`,
      JEXI_SYSTEM_PROMPT + `\nYou are the ${useDomain} verifier. Output only the corrected answer.`,
      null,
      { temperature: 0.2 }
    );
    const next = String(revised || '').trim();
    if (!next || next.length < 20 || next === current) break;
    current = next;
    if (deterministicChecks(query, current, useDomain).ok) break;
  }

  const finalChecks = deterministicChecks(query, current, useDomain);
  emit(finalChecks.ok ? '✅ Domain checks pass after revision.' : `⚠ Still flagged after ${rounds} round(s) — shipping best effort.`);
  return { text: current, changed: current !== original, verdict: finalChecks.ok ? 'verified' : 'best-effort', domain: useDomain, issues: checks.issues, checks: finalChecks };
}
