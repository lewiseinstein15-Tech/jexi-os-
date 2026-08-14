# JEXI OS — Build 48 Fix Log (Identity, Memory Honesty, Continuity, UI, Recovery, Per-Agent Upgrade)

Every numbered item from the Build 48 directive is implemented, tested, and
recorded below. Ground rules followed: priorities worked top-to-bottom, the
`server` test suite run after each item, incremental migration (existing agent
functions and pipelines wrapped/extended, not rewritten), and discrepancies
noted inline.

**Audit-named locations vs. actual code:** the directive named
`server/src/services/JexiIdentity.js` (new), `server/src/services/JexiPrompt.js`
(`JEXI_SYSTEM_PROMPT`), the memory/recall path, the continuity/context path, the
chat response UI (`src/components/ChatWindow.jsx`), and the
"connection dropped" recovery path (`src/hooks/useJexiEngine.js` +
`server/index.js`). All match the actual codebase. One nuance worth noting: the
directive's "favorite color: teal" fabrication reproduced by saying only
"Hello" — the root cause is that `conversationContext`/`buildPlannerMemory`
injected the whole fact/preference loadout into the model even for trivial
small talk, plus the prompt instructing JEXI to *announce* memory use
("Say so: 'I remembered this from my mind.'"). Both are fixed (P2), and a
post-generation **groundedness check** now strips any memory claim that is not
grounded in the context actually injected for the turn (P2a), with every caught
confabulation counted as an observable metric (P7).

---

## Priority 1 — Jexi Identity & Capabilities: single source of truth ✅

**Problem:** identity/capability answers were ad hoc — a static paragraph in
`JexiPrompt.js` plus a hardcoded `IDENTITY_ANSWER` in `Orchestrator.js` that
drifted apart and answered only what had already been asked.

**Changed:**
- **New file `server/src/services/JexiIdentity.js`** — the ONE canonical source:
  - `JEXI_IDENTITY` — name (**JEXI**), what she is, who built her (**Lewis
    Einstein, AI & ML Engineer** — already defined in the codebase, no invention
    needed), and a short behavioral tone.
  - `buildCapabilityLines()` — the capability list is **generated from the live
    registries** (`AGENT_ROSTER` / `SKILL_REGISTRY` / `TOOL_REGISTRY`): agents
    grouped by their primary skill category with counts + representative names,
    plus a total line (`N specialist agents, M skills, K tools`). It can never
    go stale.
  - `buildLimitationLines()` — the "what she won't do" list is derived from the
    real guardrails: `classifyRisk` (RiskGuard sandbox actually blocks a
    classified `rm -rf /` — verified in code), the GitHub confirmation gate,
    the `/guard` workspace scope, the sources-and-honesty rule, and honest
    no-key failure.
  - `buildIdentityPrompt()` — the canonical `# IDENTITY` block embedded into
    `JEXI_SYSTEM_PROMPT`.
  - `IDENTITY_ANSWER` — deterministic, key-free answer to "who are you?".
- **`server/src/services/JexiPrompt.js`** — `# IDENTITY` block now embeds
  `buildIdentityPrompt()`; `JEXI_SYNTHESIS_PROMPT` uses `JEXI_IDENTITY`.
- **`server/src/services/Orchestrator.js`** — the hardcoded `IDENTITY_ANSWER`
  was deleted; the `conversation` node now imports the canonical one. `export`
  added to `conversationContext` for behavioral tests.

**Tests (P1 block + P1 pass-2 block):** identity block content, live roster
counts, limitations derived from RiskGuard, Orchestrator importing (and no
longer defining) the identity answer, orchestrator still loads. **Consistency
proof:** all four identity questions ("what is your name", "who built you",
"what can you do", "what can't you do") are run through the real key-free
`conversation` node and **return byte-identical answers** — no drift between
repeated askings, one source of truth.

---

## Priority 2 — Memory honesty: never narrate, never fabricate ✅

**Problem (critical, correctness):** JEXI narrated memory use ("I remembered
this from my mind") and — the observed bug — answered "Hello" by claiming to
recall a "favorite color: teal" that was never discussed. That was a fabricated
memory, not a formatting issue.

### 2a. Groundedness — it is now provably impossible to state an ungrounded memory

- **Root-cause gating** — `Orchestrator.conversationContext()` and
  `index.js buildPlannerMemory()` only inject the fact/preference/profile/
  summary/episode loadout for **substantive queries** (`TRIVIAL_QUERY_RE`
  skips greetings/thanks/affirmatives). A bare "Hello" now injects *no* memory
  block, so there is nothing a model could claim to remember.
- **Hard grounding rule in the prompts** — `JEXI_SYSTEM_PROMPT` states the
  model may only reference what is present in the injected context for this
  turn, must treat an empty/irrelevant loadout as a fresh topic, and must never
  invent, embellish, or reconstruct a prior conversation. Same rule embedded in
  the `conversation` node's task prompt.
- **Post-generation groundedness check** — new
  `server/src/services/Groundedness.js` (`groundednessCheck`): any sentence
  containing a memory-claim phrase ("I remember…", "we discussed…", "as I said
  earlier…", "continuing our conversation…", …) is split into clauses; each
  clause's content is verified against the context that was ACTUALLY injected
  for that turn. Ungrounded clauses are **stripped** and counted (P7 metric);
  grounded clauses keep their content but lose the narration phrase (P2b).
  Code-fenced blocks are never touched. Wired into the `conversation`,
  `memoryQuery`, and `generic` nodes before the reply is saved or sent.
- **Hardened fact learner** — `MemoryManager` never learns facts from
  hypotheticals, questions, or quoted third-party statements.

**Tests (named confabulation-regression category, P7.4):** (1) cleared memory +
"Hello" → no background block injected and the draft claim "I remember your
favorite color is teal" is **caught and stripped** while the greeting survives;
(2) a seeded teal fact → the response may reference teal but an adjacent
invented fact ("your favorite movie is Interstellar") is **stripped**; (3)
grounded narration ("As I said earlier, your favorite color is teal.") loses
the narration but keeps the fact, and is **not** counted as confabulation; (4)
plain prose passes through untouched.

### 2b. No self-narration of memory use, ever

- `JexiPrompt.js` — the old "Say so: 'I remembered this from my mind.'"
  directive is **deleted**; the MEMORY principle bans narrating memory state.
- **Template sweep** — the test greps the entire server source for the
  literal hardcoded narration strings the directive flagged ("Continuing Our
  Conversation", "WHAT I REMEMBER", "WHAT I AM", "I remembered this from my
  mind") — **zero hits remain**; none were static templates in this codebase,
  they were model-generated under the old "say so" instruction.
- **Shared voice rules** — `Groundedness.js` exports `VOICE_RULES` (the one
  definition) and `JEXI_SYSTEM_PROMPT` embeds it; full guide in
  `server/src/services/RESPONSE_VOICE.md` (P7.3). SearchAgent and Reasoner
  prompts also forbid announcing continuity.

---

## Priority 3 — Continuity detection: decide silently AND correctly ✅

**Problem:** JEXI couldn't reliably tell continuation from a new topic, and
when it decided, it announced the decision.

**Changed:**
- **`index.js`** — resume-context injection labeled neutrally ("User's
  follow-up: …") instead of "Continue: …" (the word "Continue" was prompting
  models to narrate). The Context Agent log line is now a step ("✓ Resolved
  X → Y"), not a decision announcement ("🧠 Continuity — resolved").
- **`SearchAgent.js`** / **`Reasoner.js`** — prompts explicitly forbid
  announcing continuity.
- **`ConversationManager.js`** — **behavioral fix (pass 2):** a bare
  greeting/thanks is now classified as **`new` (fresh turn)** — no task
  context block, no forced prior memory — even when a task is active. The
  greeting-as-continuation misclassification was the entry point for the
  "hello → fabricated prior conversation" failure mode; it is now impossible
  for the decision engine to inject old context for a greeting.

**Tests (P3 block + P3 behavioral block):** source assertions (no "Continue:"
prefix, no decision announcement, prompts forbid announcing). **Behavioral:**
`analyzeMessage('Hello', { currentTaskId })` → `new` with `taskId: null`;
`decide(...)` → empty `contextBlock`; a real backreference ("what about the
second option?") still resolves against the prior exchange and the turn's
working context carries it; and zero banned meta-commentary in any of it.

---

## Priority 4 — UI: open response area instead of boxed bubbles ✅

**Problem:** chat responses rendered inside small boxed/bordered containers.

**Changed (`src/components/ChatWindow.jsx`, `TypedMessage.jsx`,
`MarkdownRenderer.jsx`):** JEXI answers now render in a **full-width open
reading area** — no border, no panel background, larger type (`text-[13px]` via
a new `size` prop on `TypedMessage` → `MarkdownRenderer`). A small glowing
"JEXI" sender chip marks who is talking. User messages keep their bubble so the
exchange stays readable. The "3 agents · 99.8s · 100% confidence" metadata line
stays small and subtle while the answer content flows at full width.

**Tests:** P4 block — source assertions for the open layout, the removed
bordered bubble classes, the sender chip, and the size override.

---

## Priority 5 — Connection-drop auto recovery ✅

**Problem:** a "The connection dropped before JEXI finished" error appeared
mid-task and told the user to manually ask JEXI to continue. Recovery must be
automatic.

**Changed:**
- **`server/src/services/SessionStore.js`** — new per-conversation **result
  store** (`saveResult/loadResult/clearResult`, 10-min TTL). The server-side
  mission keeps running after the client disconnects, so its real outcome can
  be picked up later.
- **`server/index.js`** — every `done` event is persisted automatically
  (`sendEvent` auto-save; the 15-min deadline notice is marked
  `recoverable: true` and excluded, so the store only ever holds a REAL
  outcome). New `GET /api/chat/result` endpoint; a fresh request clears the
  previous result so recovery never serves a stale run.
- **`src/utils/helpers.js`** — `jexiFetch` sends a stable per-browser
  `x-jexi-session` header.
- **`src/hooks/useJexiEngine.js`** — automatic recovery in all three drop
  paths (stream end without `done`, watchdog silence, 15-min deadline notice):
  `recoverResult()` polls `/api/chat/result` every 4s for up to 3 minutes and
  surfaces the finished answer; abortable on STOP / new run.

**Tests (P5 block + P5 integration block):** store round-trip/clear, endpoint +
auto-save + recoverable-exclusion wiring, frontend header + polling + abort.
**Integration (pass 2):** a real `executePlan` run whose stream **drops on its
first event** (simulating a proxy kill) still **completes server-side**, its
terminal outcome is persisted, the recovery poll returns it with no user
intervention, and a fresh run clears the stale result.

---

## Priority 6 — Per-agent upgrade pass: loop + prompt + graph engineering ✅

For every specialist node the loop/prompt/graph discipline was applied
individually. Loops are **bounded**; every node still runs inside the shared
graph (`wrapCase` + outcome edges `success | retry | fallback | ask_user`), so
no loop is invisible private control flow.

| Agent / node | Loop added / confirmed | Prompt change | Graph edges | Test proving it |
|---|---|---|---|---|
| research | Confirmed bounded fact-check loop (`verifyAnswer`, max 2 rounds) + domain check (`verifyDomainAnswer`) — does the answer actually answer the question, else revise | Voice rule: no "I searched and found" narration (system-wide `VOICE_RULES`) | `research → responder` via `'*'`; failure → `replanner` | `test-audit-b47.js` P1/P8; P6 `groundednessCheck` in conversational nodes |
| news | Confirmed fresh-news cache + editorial loop (`runNewsTeam`) | `VOICE_RULES` inherited via `JEXI_SYSTEM_PROMPT` | via `'*'` edges | B47 audit suite |
| study_topic | Confirmed Trusted-Library study path with source grounding | `VOICE_RULES` inherited | via `'*'` edges | B47 suite |
| knowledge_recall | Confirmed `verifyAnswer` keeps book answers grounded in the passages | `VOICE_RULES` inherited | via `'*'` edges | B47 suite |
| code_task / codePipeline | Confirmed real graph cycle `codePipeline → debugger ↺ → qaGate → reviewShip → shipper` with bounded attempts + QA/security gates (existing, per B47) | `VOICE_RULES` inherited | `debugger` self-cycle, `qaGate NEEDS FIX → debugger`, security fix round | B47 P1 coding-loop tests |
| computer_use | **Confirmed** observe-act-verify: each browser action verifies the state change against the pre-action snapshot (`verify` with `before.snapshot`) before proceeding | `VOICE_RULES` inherited | via `'*'` edges; browser-empty fallback → search team | P6 `before.snapshot` assertion |
| math_solve | Confirmed `verifyDomainAnswer` (balanced LaTeX fences, FINAL ANSWER present, arithmetic spot-check) + critic revision | `VOICE_RULES` inherited | via `'*'` edges | `test-domain-verify.js`, B47 suite |
| translate | **Added (pass 2):** bounded reflection loop — if the model truncates the draft→critique→revise pass (`## REVISE`/`## CHANGED` missing), one bounded follow-up forces the missing sections; post-loop sanity that a real translation was produced (`MAX_TRANSLATE_PASSES`) | `VOICE_RULES` inherited | via `'*'` edges | P6 `MAX_TRANSLATE_PASSES` + `## REVISE` assertion |
| data | **Added (pass 2):** `verifyDataReport` — headline stats recomputed from the RAW rows and verified to appear in the report; drifted/contradicted numbers repaired in one bounded pass (stale AI insight dropped) | `VOICE_RULES` inherited | via `'*'` edges | P6 good/bad report functional test |
| devops | Confirmed propose → confirm → execute → verify flow; mutating actions gated | `VOICE_RULES` inherited | `ask_user → confirmationPause → resumeNode` | B47 P5/P8 confirmation tests |
| github | Confirmed confirmation gate (commit/push/PR/issues) with auth check | `VOICE_RULES` inherited | `ask_user → confirmationPause → resumeNode` | B47 P5/P8 tests |
| docs | **Added (pass 2):** self-critique coverage pass — key nouns from the request must appear in the doc; one bounded regeneration on a gap, or an honest `## COVERAGE GAP` note when keyless | `VOICE_RULES` inherited | via `'*'` edges | P6 `COVERAGE GAP`/`Self-critique` assertion |
| perf | **Added (pass 2):** self-critique — every finding must cite a real workspace file; "ghost" findings are dropped and logged | `VOICE_RULES` inherited | via `'*'` edges | P6 `ghost` + `Self-critique` assertion |
| self_check | Confirmed diagnostic loop; now also routed through the P2a groundedness fix via the shared prompt rules | `VOICE_RULES` inherited | via `'*'` edges | B47 suite |
| conversation | **Added (pass 2):** `groundednessCheck` runs on every draft with the exact injected context (P2a) — ungrounded memory claims stripped + counted | `VOICE_RULES` embedded in `JEXI_SYSTEM_PROMPT` + node task prompt | via `'*'` edges | P2a confabulation-regression category |
| memory_query / generic | **Added (pass 2):** same `groundednessCheck` wiring | `VOICE_RULES` inherited | via `'*'` edges | P2a/P6 assertions |

---

## Priority 7 — Senior-engineer additions ✅

1. **Caught-confabulation observability** — `Groundedness.js` keeps an
   in-memory counter/log; every stripped ungrounded claim is recorded
   (`confabulationStats()` → `{ caught, events }`). A regression shows up as a
   rising metric, not a user screenshot. Wired into all conversational nodes.
2. **Session/connection observability** — `SessionStore` now records every
   recovery touchpoint (`recordRecoveryEvent`): the `/api/chat/result` poll
   (cause `poll`, whether a result existed to recover) and the 15-min deadline
   fire (cause `deadline`). `recoveryStats()` exposes totals by cause so the
   timeout/heartbeat fix can be validated in practice.
3. **Style guide** — new `server/src/services/RESPONSE_VOICE.md`: the "never
   narrate your own process / never claim ungrounded memory / answer directly"
   rules defined ONCE, with the machine-readable `VOICE_RULES` embedded into
   `JEXI_SYSTEM_PROMPT` and referenced by the agent prompts.
4. **Regression protection** — the confabulation fix is a **named test
   category** ("CONFABULATION REGRESSION") in `server/test-audit-b48.js`,
   checked in CI by the standard `npm test` run.

---

## Final summary — before / after (the confabulation bug specifically)

**What caused it:** two things worked together. First, `conversationContext` /
`buildPlannerMemory` injected the full fact/preference loadout for EVERY
message — so a bare "Hello" put "favorite color: teal" (plus profile facts and
preferences) in front of the model. Second, the system prompt told JEXI to
*announce* memory use ("Say so: 'I remembered this from my mind.'"). With
irrelevant-but-plausible facts injected and an instruction to narrate memory,
the model confidently "remembered" a conversation that never happened.

**What now prevents it (three layers, each independently sufficient):**
1. **No memory injected for trivial turns** — a greeting loads only the recent
   transcript, never the fact/preference/episode loadout, so there is nothing
   to confabulate from.
2. **Hard grounding rule in every relevant prompt** — only content present in
   the injected context for THIS turn may be referenced; a fabricated memory is
   named a correctness bug.
3. **Post-generation groundedness check** — any memory-claim sentence whose
   content is not in the injected context is stripped from the reply and
   counted; grounded claims keep their content but lose the narration.
Plus the fact learner no longer records hypotheticals/questions/quotes, and the
regression test (cleared memory + "Hello" → no fabricated recollection; seeded
fact → only that exact fact) runs in CI on every `npm test`.

**Proof:** `server/test-audit-b48.js` now runs **90+ assertions** covering all
seven priorities including the named confabulation-regression category →
**BUILD 48 TESTS PASSED ✅**. Full `server` suite (`npm test`, 33 test files)
→ **exit 0, all green**.
