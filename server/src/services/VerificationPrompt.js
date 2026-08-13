/**
 * JEXI OS — Shared verification prompt pattern (anti-hallucination).
 *
 * Every verifier call site (VerificationLoop, DomainVerifier, and any future
 * gate) builds its critique prompt through buildVerificationPrompt and parses
 * the response with parseVerificationVerdict. The contract is structured:
 *
 *   { verdict: 'CLEAN' | 'ISSUES', issues: string[] }
 *
 * The parser accepts strict JSON first, then the legacy
 * "VERDICT: CLEAN / ISSUES / ISSUES:" lines format, so a non-compliant model
 * response never crashes a chat — it is normalized instead.
 */

/** Build the critique prompt for any verifier. */
export function buildVerificationPrompt({
  role = 'strict verifier',
  task,
  sources = [],
  draft,
  rules = 'Catch hallucinations and unsupported claims. Never praise.',
  format = 'JSON',
}) {
  const srcText = (sources || [])
    .slice(0, 6)
    .map((s) => `- ${s.title || s.name || s.link || s}`)
    .join('\n');

  const formatBlock =
    format === 'JSON'
      ? `Reply with EXACTLY one JSON object, no prose, no markdown fences:\n` +
        `{"verdict": "CLEAN"}\n` +
        `or\n` +
        `{"verdict": "ISSUES", "issues": ["<one concrete problem>", "<another>"]}`
      : `Reply with EXACTLY this format:\n` +
        `VERDICT: CLEAN\n` +
        `or\n` +
        `VERDICT: ISSUES\n` +
        `ISSUES:\n- <one concrete problem per line>`;

  return (
    `You are a strict ${role}. Rules: ${rules}\n\n` +
    `TASK: ${task}\n` +
    (srcText ? `\nSOURCES (the ONLY things the answer may rely on):\n${srcText}\n` : `\n(No external sources were provided — flag any specific factual claim the model could not know from the task itself.)\n`) +
    `\nDRAFT ANSWER TO AUDIT:\n"""\n${String(draft || '').slice(0, 9000)}\n"""\n\n` +
    `Audit the draft. Mark ISSUES only for REAL problems (invented facts, contradictions, unsupported specific claims, missing citations for sourced material, off-task content). Do NOT flag style or brevity. If everything is grounded, say CLEAN.\n\n` +
    formatBlock
  );
}

/**
 * Parse a verifier response into { clean, issues }.
 * Accepts strict JSON first, then the legacy VERDICT:/ISSUES: lines format.
 */
export function parseVerificationVerdict(raw) {
  const text = String(raw || '').trim();
  if (!text) return { clean: false, issues: [] };

  // 1) Strict JSON: {"verdict": "CLEAN"} or {"verdict": "ISSUES", "issues": [...]}
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const verdict = String(parsed.verdict || '').toUpperCase();
      if (verdict === 'CLEAN') return { clean: true, issues: [] };
      if (verdict === 'ISSUES') {
        const issues = Array.isArray(parsed.issues)
          ? parsed.issues.map((i) => String(i).trim()).filter(Boolean).slice(0, 8)
          : [];
        return { clean: false, issues };
      }
    } catch (e) { /* fall through to legacy format */ }
  }

  // 2) Legacy format: VERDICT: CLEAN|ISSUES + "- issue" lines.
  const verdictLine = text.match(/VERDICT:\s*(CLEAN|ISSUES)/i);
  const clean = verdictLine ? verdictLine[1].toUpperCase() === 'CLEAN' : !/VERDICT:\s*ISSUES/i.test(text);
  const issues = text
    .split('\n')
    .filter((l) => l.trim().startsWith('-'))
    .map((l) => l.trim().replace(/^-/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  return { clean, issues };
}

/** Centralized revise instruction reused by every verifier's fix pass. */
export function buildRevisionPrompt({ task, sources = [], issues, draft, extra = '' }) {
  const srcText = (sources || [])
    .slice(0, 6)
    .map((s) => `- ${s.title || s.name || s.link || s}`)
    .join('\n');
  return (
    `Rewrite the answer below so it fixes EVERY issue the verifier found. Rules:\n` +
    `- Fix only the listed problems. Keep the structure, tone and length similar.\n` +
    `- NEVER invent new facts. If a claim cannot be supported by the task or sources, remove it or say it explicitly as an assumption.\n` +
    `- Keep the same heading/markdown style so the reader sees an improved version, not a different answer.\n` +
    (extra ? `${extra}\n` : '') +
    `\nTASK: ${task}\n` +
    (srcText ? `\nSOURCES:\n${srcText}\n` : '') +
    `\nVERIFIER'S ISSUES:\n${(issues || []).map((i) => `- ${i}`).join('\n') || '(unspecified — re-check grounding and unsupported claims)'}\n\n` +
    `DRAFT TO REVISE:\n"""\n${String(draft || '').slice(0, 9000)}\n"""\n\n` +
    `Output ONLY the revised answer.`
  );
}
