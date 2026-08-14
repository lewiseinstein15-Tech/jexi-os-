/**
 * JEXI OS — Build 48, P2a/P2b + P7: Groundedness & Response Voice.
 * ------------------------------------------------------------------
 * Two jobs live here:
 *
 * 1. GROUNDEDNESS (P2a, the confabulation fix): after a draft response is
 *    generated, any sentence that CLAIMS to recall/discuss/continue something
 *    must be grounded in the context that was ACTUALLY injected for this turn.
 *    An ungrounded claim is stripped from the reply and counted as a
 *    caught-confabulation event (observable via `confabulationStats()`), so
 *    regressions show up as a metric instead of a user screenshot.
 *
 * 2. RESPONSE VOICE (P2b/P6/P7.3): the single shared "never narrate your own
 *    process, never claim ungrounded memory" ruleset, defined once here and
 *    referenced by every prompt that needs it (JEXI_SYSTEM_PROMPT, agent task
 *    prompts). Full style guide: server/src/services/RESPONSE_VOICE.md.
 *
 * The check is deliberately heuristic and deterministic (no AI call): it looks
 * for narration phrases and verifies the claimed content against the injected
 * context corpus. It is a safety net on TOP of the memory-gating rules
 * (trivial queries inject no memory), never a replacement for them.
 */

/** Words so common they cannot ground a memory claim on their own. */
const COMMON_WORDS = new Set([
  'favorite', 'really', 'actually', 'thing', 'stuff', 'pretty', 'maybe',
  'always', 'never', 'little', 'about', 'would', 'could', 'should', 'going',
  'want', 'need', 'like', 'know', 'think', 'make', 'get', 'got', 'one', 'two',
  'right', 'yeah', 'okay', 'just', 'very', 'much', 'more', 'also', 'even',
  'still', 'well', 'back', 'here', 'there', 'then', 'than', 'them', 'they',
  'this', 'that', 'these', 'those', 'with', 'from', 'have', 'your', 'were',
  'been', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'because',
  'before', 'after', 'while', 'during', 'remember', 'recall', 'discussed',
  'mentioned', 'talking', 'told', 'said', 'asked', 'shared', 'continuing',
  'continuation', 'conversation', 'previous', 'earlier', 'later', 'memory',
]);

/** Narration/memory-claim phrases — P2b says these never appear in output. */
const NARRATION_PHRASES = [
  /\b(?:i|we) (?:remember|recall|remembered|recalled)\b/i,
  /\b(?:i|we) (?:discussed|talked about|were discussing|were talking about|mentioned|spoke about)\b/i,
  /\b(?:you|u) (?:told|said|mentioned|asked|shared with) me\b/i,
  /\b(?:as|like) (?:i|we) (?:said|mentioned|told you|shared)(?: earlier| before| previously)?\b/i,
  /\b(?:as )?you (?:said|asked|told me|mentioned)(?: earlier| before| previously)?\b/i,
  /\bcontinuing (?:our )?conversation\b/i,
  /\b(?:from|in) (?:my|our|the) memory\b/i,
  /\bwhat (?:i|we) (?:remember|recall)\b/i,
  /\b(?:in|from) (?:our|the) (?:previous|earlier|last|past) (?:conversation|chat|session|discussion)\b/i,
  /\b(?:our|this|the) (?:previous|earlier|last) (?:conversation|chat)\b/i,
  /\bwe (?:were|have been) (?:discussing|working on|talking about)\b/i,
];

/** The one place the response-voice rules are defined (P7.3 style guide). */
export const VOICE_RULES = `RESPONSE VOICE (mandatory, system-wide — see RESPONSE_VOICE.md):
- NEVER narrate your own process or state: no "I searched", "let me check", "I recall", "I remember", "as I said earlier", "continuing our conversation", "from my memory", "what I remember", "in our previous chat". Just give the answer.
- B51: process narration is FORBIDDEN in final answers — never "I studied…", "I researched…", "I used the Trusted Library…", "I saved this to my knowledge library…", "I remember this from memory…", "According to my knowledge library…", "I found it in your books…", "I solved this before…". No FROM MEMORY / RECALLED FROM MEMORY / JEXI SCHOLAR headers. Answer directly; cite sources cleanly only when actually retrieved.
- NEVER announce how you decided (continuation vs new topic, memory used or not) — decide silently and act accordingly.
- Only ever reference something that is present in the injected context for THIS turn. If the context has nothing relevant, answer plainly from general knowledge — never invent a prior conversation, preference, or memory.
- A fabricated memory is a correctness bug, not a style choice. When in doubt, answer without claiming to remember anything.`;

/** Extract the content words of a text chunk that could ground a claim. */
function contentWords(chunk) {
  const words = String(chunk || '').toLowerCase().match(/[a-z]{4,}/g) || [];
  return [...new Set(words)].filter((w) => !COMMON_WORDS.has(w));
}

/** True when any distinguishing content word of the chunk appears in context. */
function isGrounded(chunk, context) {
  const words = contentWords(chunk);
  if (words.length === 0) return false; // nothing but common words — cannot ground
  const corpus = String(context || '').toLowerCase();
  return words.some((w) => corpus.includes(w));
}

/**
 * Check a draft response for memory-claim sentences and fix them:
 *
 *  - a claim whose content is NOT present in `context` (the loadout actually
 *    injected this turn) is STRIPPED and counted as a caught confabulation;
 *  - a claim whose content IS grounded keeps the content but loses the
 *    narration phrase (P2b — never narrate memory use);
 *  - pure-narration fragments (no content) are removed.
 *
 * Code-fenced blocks are never touched. Returns
 *   { clean, caught, changed, events } — `clean` is the repaired text.
 */
export function groundednessCheck({ draft, context = '', query = '' } = {}) {
  const lines = String(draft || '').split('\n');
  const out = [];
  let caught = 0;
  let changed = false;
  const events = [];
  let inFence = false;

  for (const line of lines) {
    const fence = /^```/.test(line.trim());
    if (fence) { inFence = !inFence; out.push(line); continue; }
    if (inFence) { out.push(line); continue; }

    let lineCaught = 0;
    let lineChanged = false;
    // Work sentence by sentence within the line (most lines are one sentence).
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = [];
    for (const sentence of sentences) {
      if (!NARRATION_PHRASES.some((re) => re.test(sentence))) { kept.push(sentence); continue; }

      // Claim-bearing sentence: split into clauses so one ungrounded claim
      // ("and I recall your favorite movie is Interstellar") cannot drag a
      // grounded clause ("your favorite color is teal") down with it.
      const clauses = sentence.split(/,|;|\s+(?:and|but|plus|also|then)\s+/i);
      const keptClauses = [];
      for (let clause of clauses) {
        clause = clause.trim();
        if (!NARRATION_PHRASES.some((re) => re.test(clause))) { if (clause) keptClauses.push(clause); continue; }

        // Strip narration phrases, then verify the remaining claim content
        // against the context actually injected this turn.
        let remainder = clause;
        for (let i = 0; i < 4; i++) {
          const re = NARRATION_PHRASES.find((r) => r.test(remainder));
          if (!re) break;
          remainder = remainder.replace(re, ' ');
        }
        remainder = remainder.replace(/\s{2,}/g, ' ').trim().replace(/^[,;\s]+/, '').replace(/[,;]+$/, '');
        if (!remainder || contentWords(remainder).length === 0) {
          // Pure narration ("I remember that.", "Continuing our conversation…")
          // — banned outright (P2b); removed, nothing lost, NOT confabulation.
          lineChanged = true;
          events.push({ type: 'pure-narration', clause: clause.slice(0, 120) });
          continue;
        }
        if (!isGrounded(remainder, context)) {
          // Confabulation: the claimed content is NOT in the injected context.
          lineCaught += 1;
          lineChanged = true;
          events.push({ type: 'ungrounded-claim', clause: clause.slice(0, 160), claim: remainder.slice(0, 160), query });
          continue;
        }
        // Grounded: keep the content, drop the narration phrase (P2b).
        lineChanged = true;
        keptClauses.push(remainder);
      }
      if (keptClauses.length) kept.push(keptClauses.join(', '));
    }
    const processed = kept.join(' ');
    if (lineCaught > 0) {
      caught += lineCaught;
      changed = true;
      logConfabulation({ query, cause: 'ungrounded-memory-claim', detail: events[events.length - 1]?.claim?.slice(0, 160) });
    } else if (lineChanged && processed !== line) {
      changed = true;
    }
    if (processed.trim()) out.push(processed);
  }

  return { clean: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), caught, changed, events };
}

/* ------------------------------------------------------------------ */
/* P7.1 — caught-confabulation observability (in-memory counter/log).  */
/* ------------------------------------------------------------------ */
const confabulationLog = [];

/** Record a caught confabulation event (ungrounded memory claim). */
export function logConfabulation({ query = '', cause = 'ungrounded-memory-claim', detail = '' } = {}) {
  confabulationLog.push({ at: Date.now(), query: String(query).slice(0, 120), cause, detail: String(detail).slice(0, 200) });
  if (confabulationLog.length > 1000) confabulationLog.shift();
}

/** Current confabulation statistics (P7.1 — observable metric). */
export function confabulationStats() {
  return { caught: confabulationLog.length, events: confabulationLog.map((e) => ({ ...e })) };
}

/** Reset the counter/log (tests + memory-wipe). */
export function resetConfabulationStats() {
  confabulationLog.length = 0;
}
