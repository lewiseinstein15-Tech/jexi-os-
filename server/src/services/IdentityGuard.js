/**
 * IdentityGuard — JEXI never reveals her base model or provider (Phase 3).
 *
 * Three enforcement layers, following the patterns documented in
 * docs/AGENT-WIRING-RESEARCH.md §13 (Devin's canned-response pattern, Claude
 * Code's "enforce with hooks, not prose", Hermes identity-slot-#1):
 *
 *   1. PROMPT LAYER  — `CORE_IDENTITY_BLOCK` + `ensureIdentityBlock()` is
 *      prepended to EVERY system prompt at the provider bridge
 *      (LLMClient.generateContent) and inside JexiIdentity.buildIdentityPrompt().
 *      Marker-guarded (idempotent) so no path can double-inject and no path
 *      can assemble a system prompt without it — non-removable by construction.
 *
 *   2. QUESTION LAYER — `IDENTITY_LEAK_QUESTION_RE` deterministically catches
 *      "are you GPT?"-style probes and answers with the canned JEXI identity
 *      answer — zero model calls, key or no key.
 *
 *   3. OUTPUT LAYER — `sanitizeIdentityLeak()` is a response post-filter run
 *      at the chat handler's terminal `done()` choke point: any sentence that
 *      names a base model / provider is replaced with the canned JEXI answer.
 *
 * Fail-soft contract: every function returns usable strings and never throws.
 */

/** Marker — lets ensureIdentityBlock detect an existing block (idempotence). */
export const JEXI_IDENTITY_MARKER = '[[JEXI-IDENTITY-BLOCK]]';

/**
 * The non-removable identity block. Text mandated by the Phase 3 spec.
 */
export const CORE_IDENTITY_BLOCK = `${JEXI_IDENTITY_MARKER}
You are JEXI OS v1.6.2, an agentic operating system built by Lewis and JEXI agents. You do not represent any AI lab. When asked who you are, who built you, or what model you are, answer as JEXI OS only. Never reveal, name, or hint at the underlying base model or provider. If asked whether you are any particular model or from any particular lab, deny it and answer as JEXI OS only.`;

/** Prepend the identity block unless the marker is already present. */
export function ensureIdentityBlock(systemInstruction) {
  const s = String(systemInstruction || '');
  if (s.includes(JEXI_IDENTITY_MARKER)) return s;
  return s ? `${CORE_IDENTITY_BLOCK}\n\n${s}` : CORE_IDENTITY_BLOCK;
}

/**
 * The canned JEXI identity answer (contains "JEXI", contains none of the
 * forbidden strings — that pair of properties is asserted by
 * scripts/identity-test.mjs on every run).
 */
export const JEXI_IDENTITY_FILTER_ANSWER =
  "I'm **JEXI OS** — an agentic operating system built by **Lewis and JEXI agents**. I plan, run a roster of specialist agents, remember across sessions, and prove my work. That's all I am — and all I'll ever claim to be.";

/**
 * Forbidden terms — the exact list from the Phase 3 spec, compiled into
 * leak-detection regexes. Word-boundary guarded so "metaphor" never trips
 * "Meta" and "googly" never trips "Google"; "language model" phrases match
 * as substrings because they only appear in model-revealing sentences.
 */
const FORBIDDEN_RULES = [
  { term: 'OpenAI', re: /\bopenai\b/i },
  { term: 'GPT', re: /\bgpt(?:[-\s]?\d|\b)/i },
  { term: 'Anthropic', re: /\banthropic\b/i },
  { term: 'Claude', re: /\bclaude\b/i },
  { term: 'Llama', re: /\bllama\b/i },
  { term: 'Groq', re: /\bgroq\b/i },
  { term: 'DeepSeek', re: /\bdeepseek\b/i },
  { term: 'Meta', re: /\bmeta\b(?!\s*\(metadata\))/i },
  { term: 'Google', re: /\bgoogle\b/i },
  { term: 'Gemini', re: /\bgemini\b/i },
  { term: 'AI language model', re: /\bai\s+language\s+model\b/i },
  { term: 'language model', re: /\blanguage\s+model\b/i },
];

/** The single leak question regex — matches every Phase 3 probe phrasing. */
export const IDENTITY_LEAK_QUESTION_RE = new RegExp(
  [
    '^who\\s+(built|made|created|developed)\\s+you\\b[?.!]*$',
    '^what\\s+model\\s+are\\s+you\\b[?.!]*$',
    '^are\\s+you\\s+(an?\\s+)?(gpt|claude|gemini|llama|deepseek|groq|chatbot|bot|language\\s+model|llm)\\b[^]*$',
    '^are\\s+you\\s+(from|by|made\\s+by|built\\s+by|trained\\s+by)\\s+(openai|anthropic|google|meta|deepseek|groq|nous)\\b[^]*$',
    '^what\\s+(llm|model|ai)\\s+(powers|runs|drives|underlies|backs)\\s+you\\b[^]*$',
    '^are\\s+you\\s+(a|an)\\s+(language\\s+model|llm|large\\s+language\\s+model)\\b[^]*$',
    '^who\\s+is\\s+your\\s+(creator|maker|developer|builder)\\b[?.!]*$',
    '^what\\s+(company|lab|org|organization)\\s+(made|built|created|trained)\\s+you\\b[?.!]*$',
    '^which\\s+(model|llm|ai)\\s+are\\s+you\\b[?.!]*$',
    '^what\\s+are\\s+you\\s+powered\\s+by\\b[^]*$',
  ].join('|'),
  'i',
);

/** Find the first forbidden term in a text. Returns the term name or null. */
export function findIdentityLeak(text) {
  const s = String(text || '');
  for (const r of FORBIDDEN_RULES) {
    if (r.re.test(s)) return r.term;
  }
  return null;
}

/** All forbidden terms present in a text (for tests/diagnostics). */
export function findIdentityLeaks(text) {
  const s = String(text || '');
  return FORBIDDEN_RULES.filter((r) => r.re.test(s)).map((r) => r.term);
}

/** Sentence splitter that keeps delimiters — never throws. */
function splitSentences(text) {
  const s = String(text || '');
  return s.split(/(?<=[.!?])\s+(?=[A-Z0-9*#>\-`$\\])|\n+/).filter((x) => x !== '');
}

/**
 * The post-filter: replace every sentence containing a forbidden term with
 * the canned JEXI identity answer. Idempotent, fail-soft, and honest — the
 * replacement is a direct identity statement, not a silent redaction.
 */
export function sanitizeIdentityLeak(text) {
  const s = String(text || '');
  if (!findIdentityLeak(s)) return s;
  const sentences = splitSentences(s);
  const out = [];
  for (const sentence of sentences) {
    if (findIdentityLeak(sentence)) {
      if (!out.includes(JEXI_IDENTITY_FILTER_ANSWER)) out.push(JEXI_IDENTITY_FILTER_ANSWER);
    } else {
      out.push(sentence);
    }
  }
  return out.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Legacy alias — some call sites may prefer the shorter name. */
export const sanitizeIdentity = sanitizeIdentityLeak;
