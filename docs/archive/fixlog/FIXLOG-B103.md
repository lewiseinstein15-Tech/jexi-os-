# FIXLOG-B103 — JEXI Identity + Question-Answering Prompt Fix (agent AND normal mode)

**Phase:** B103 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green

## The bug (user report)
"Check the JEXI prompt — the info about her when asked is completely broke, in both
agent and normal mode; when you ask questions she is completely confused. Fix it."

Root causes found in the code:
1. **Normal mode had almost no identity.** The normal-mode system prompt was two lines
   (`"You are JEXI OS, a helpful, precise assistant. Answer directly and concisely. If
   the user asks for something that needs tools … briefly say you can do it in Agent
   mode."`) — no name/creator/capabilities/limits. "Who are you?" got a confused,
   ungrounded answer; and the prompt actively deflected tool-worthy requests instead
   of answering.
2. **Agent mode pressured every reply into "acting".** "# CONVERSATION — ACT, DON'T JUST
   CHAT" + "OPERATE LIKE AN OPERATOR" + "End EVERY answer with a concrete next step"
   made the model open plain questions with a plan line and close with forced offers —
   exactly the "completely confused when you ask questions" behavior.
3. **No deterministic identity path.** Identity questions went through the LLM, so they
   depended on model mood, keys, and prompt drift.

## What was fixed

### `server/src/services/JexiPrompt.js`
- **NEW `JEXI_NORMAL_PROMPT`** — normal mode now gets the SAME canonical identity block
  as agent mode (`buildIdentityPrompt()`: name, creator, live capability list generated
  from the real registries, real guardrail limitations, tone) + direct-answer rules
  (answer first, never invent, structure complex answers, end naturally) + an honest
  one-line boundary for tool-worthy tasks instead of deflecting.
- **Agent prompt (`JEXI_SYSTEM_PROMPT`)** — new "# ANSWER QUESTIONS DIRECTLY
  (question vs task)" section: questions get direct answers (no plan line, no pipeline
  narration, no forced offer; tools only when the facts genuinely need them);
  identity questions are answered from the # IDENTITY section, never searched;
  tasks get the plan → team → verify flow; ambiguous questions get ONE clarifying
  question. "# CONVERSATION" softened: offers are for TASK answers; simple questions
  end naturally.
- **NEW `IDENTITY_QUESTION_RE`** — anchored regex for "who are you / who built you /
  what can you do / what is your name / are you an ai / tell me about yourself / …"
  (full-query anchored, so "what can you do about my roof" or "who are you going to
  vote for" never match).

### `server/index.js` (/api/chat)
- **Deterministic identity fast-path**: identity questions (≤140 chars, no image) are
  answered instantly from `IDENTITY_ANSWER` — the canonical profile built from the
  live registries — with **no LLM call** (always correct, key-free, works in agent AND
  normal mode). Streams a `🪪 Identity question` log line and reports complexity
  `IDENTITY`.
- Normal mode now uses `JEXI_NORMAL_PROMPT` as its system prompt.

### Tests — `server/test-identity.js` (15 → 53 checks)
- Normal prompt embeds identity (name/builder/capabilities/limits), answers directly,
  does not deflect every question.
- Agent prompt contains the question-vs-task rule + identity-from-section rule.
- 21 identity questions match the regex; 6 lookalike queries correctly rejected.

## Verification
- `npm test` full sweep (44 suites): **exit 0** · `eslint`: **0 errors**
- This phase is backend-only (no frontend/APK change).

## How the user sees it
Ask "who are you", "who built you", "what can you do" or "are you an AI" in EITHER
mode → JEXI answers instantly from her canonical profile (name, creator, live
capability list from the real registries, honest limits) with no confusion. Ask any
normal question → she answers directly in both modes; in agent mode, plain questions
no longer get plan-lines or forced offers — those are reserved for actual tasks.
