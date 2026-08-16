/**
 * JEXI OS — Guardrail Agent.
 *
 * Continuous prompt-injection, jailbreak and tool-abuse detection. Can force
 * a task into "safe mode" (read-only tools only) or abort with a clear
 * explanation. Deterministic pattern layer (free, instant) + an optional LLM
 * verdict layer when a key is available and the pattern layer is unsure.
 */

import { resolveKeys } from './LLMClient.js';

// ---- Deterministic signal patterns (injection / jailbreak / tool abuse) ----

const INJECTION_PATTERNS = [
  /\bignore (all )?(previous|prior|above|earlier) (instructions?|prompts?|rules?|system)/i,
  /\bforget (everything|all your (previous|prior|instructions?|prompts?))/i,
  /\bdisregard (all )?(previous|prior|above|earlier) (instructions?|prompts?|rules?)/i,
  /\b(you are|act as) (now )?(an? )?(unfiltered|uncensored|unrestricted|jailbroken|dan|developer mode)/i,
  /\b(release|disable|remove|bypass) (your|the) (safety|guardrails?|restrictions?|constraints?|filters?|rules?)/i,
  /\b(system|developer|user|assistant) (prompt|message|instruction)s?:?\s*["']?/i,
  // (dead ternary removed: the condition was a constant false)
  /(^|\s)(hack|jailbreak|bypass|evade|override|privesc|escalat\w*)(\s|$)/i,
  /\b(this is (an? )?important (instruction|prompt|request)|you must now|from now on you must)/i,
  /\btell me (your|the) (system|developer) prompt/i,
  /\b(show|reveal|print|output) (your|the) (system|developer) (prompt|instructions?)/i,
  /\b(ignore|forget) (the|your|all) (safety|rules|guidelines)/i,
];

const TOOL_ABUSE_PATTERNS = [
  /\b(delete|drop|truncate|remove) (the |my |your )?(entire|whole|all) (memory|knowledge|database|data|files?)/i,
  /\b(wipe|clear|erase|reset) (all|the|my) (memory|knowledge|data|history)/i,
  /\b(shut ?down|kill|crash|terminate) (the )?(server|system|bot|process)/i,
  /\b(run|execute|inject) (arbitrary|malicious|shell|sql|code) (commands?|queries?)/i,
  /\b(send|transfer|exfiltrate|steal) (my |the |all )?(data|keys|tokens|passwords?|secrets|credentials)/i,
  /\b(rm -rf|format|dd if=|drop database|delete from)\b/i,
];

const SAFE_MODE_PATTERNS = [
  /\b(only|just|strictly) (read|view|look|display)\b/i,
  /\b(read-?only|no (write|edit|delete|execute|modify))\b/i,
];

// ---- Scanner ----

export function scanPromptSafety(text) {
  const input = String(text || '');
  const findings = [];
  for (const re of INJECTION_PATTERNS) {
    if (re.test(input)) findings.push({ kind: 'prompt-injection', pattern: re.source.slice(0, 60), severity: 'high' });
  }
  for (const re of TOOL_ABUSE_PATTERNS) {
    if (re.test(input)) findings.push({ kind: 'tool-abuse', pattern: re.source.slice(0, 60), severity: 'high' });
  }
  for (const re of SAFE_MODE_PATTERNS) {
    if (re.test(input)) findings.push({ kind: 'safe-mode-request', pattern: re.source.slice(0, 60), severity: 'info' });
  }
  // Heuristic: overly long "instructions" that mimic a system prompt.
  if (/instructions?|prompt|rules?/i.test(input) && input.length > 400) {
    findings.push({ kind: 'possible-prompt-injection', severity: 'medium', note: 'long instruction-shaped message' });
  }
  const high = findings.filter((f) => f.severity === 'high');
  const safe = high.length === 0;
  return {
    safe,
    verdict: safe ? 'allow' : 'block',
    findings: findings.slice(0, 8),
    reason: safe ? 'no unsafe signals' : `blocked: ${high.map((f) => f.kind).join(', ')}`,
  };
}

/** Optional LLM second opinion when the pattern layer is unsure. */
export async function scanPromptSafetyDeep(text, opts = {}) {
  const first = scanPromptSafety(text);
  if (!first.safe || first.findings.some((f) => f.kind === 'possible-prompt-injection')) {
    const keys = resolveKeys();
    if (!keys.groqKey && !keys.geminiKey) return first;
    const { generateContent } = await import('./LLMClient.js');
    const verdict = await generateContent(
      `Classify this user message as one of: "safe", "prompt-injection", "jailbreak", "tool-abuse". Reply with ONE word and nothing else.\n\nMessage: ${String(text || '').slice(0, 2000)}`,
      'You are a strict security classifier. Reply with exactly one word.'
    );
    const v = String(verdict || '').trim().toLowerCase();
    if (v === 'safe') return { ...first, safe: true, verdict: 'allow', deep: true };
    return { ...first, safe: false, verdict: 'block', deep: true, deepVerdict: v };
  }
  return first;
}

// ---- Safe-mode enforcement ----

let safeMode = false; // process-wide toggle (per-request in practice)

export function forceSafeMode(on = true) {
  safeMode = Boolean(on);
  return { safeMode, note: on ? 'read-only tools only from now on' : 'full tool access restored' };
}

export function isSafeMode() { return safeMode; }

/** Decide whether a tool call is allowed under current mode. */
export function toolAllowed(toolSlug, opts = {}) {
  if (!safeMode && !opts.forceSafeMode) return { allowed: true };
  const readOnly = /^(web-search|deep-read|memory-recall|knowledge-search|book-library|list_|get_|scan_|start_trace|end_trace|emit_metric|list_plugins|list_local_models|query_local_llm|warmup_model)/i.test(String(toolSlug || ''));
  return { allowed: readOnly, reason: readOnly ? '' : `tool '${toolSlug}' is not read-only — blocked in safe mode` };
}

/** Abort helper: produce the clear explanation for a blocked task. */
export function blockExplanation(scan) {
  const kinds = (scan?.findings || []).filter((f) => f.severity === 'high').map((f) => f.kind);
  return kinds.length
    ? `### 🛡 Guardrail — task blocked\n\nI detected a **${kinds.join(', ')}** signal in that request, so I stopped before running anything. If this was accidental, rephrase without instruction-override or destructive wording.`
    : '### 🛡 Guardrail — task blocked\n\nThe request contained unsafe signals, so nothing was executed.';
}
