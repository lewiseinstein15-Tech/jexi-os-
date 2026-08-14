# FIXLOG-B51 — Kill Narration, Enforce Tool Discipline, Harden Graph+Loop

Every Priority: before/after evidence + exact `npm test` command and result.
Worked top to bottom. B49/B50 structure was not re-done; built on top of it.

Non-negotiable runtime invariants this build enforces:
1. NO PROCESS NARRATION IN FINAL ANSWERS
2. NO UNNECESSARY WEB / STUDY FOR SIMPLE QUESTIONS
3. NO UNVERIFIED RESULT → FINAL OUTPUT
4. FAILURE → ANALYZE → CORRECT → EXECUTE → VERIFY AGAIN (bounded)
5. CHEAPEST CORRECT TOOL FIRST

---

## Priority 1 — Destroy process narration forever ✅

### Before
`server/src/services/Orchestrator.js` built user-facing summaries that
announced the pipeline instead of answering:

- `N.studyTopic` (was line 655):
  ```js
  results.summary = `### 📚 JEXI SCHOLAR\n\nI studied **${topic}** using the Trusted Library (Wikipedia, Project Gutenberg, arXiv, Open Library) and saved it to my knowledge library.\n\n${content.slice(0, 4000)}`;
  ```
- `answerFromKnowledge` (was lines 156 & 165): `### 📚 JEXI OS — FROM YOUR BOOKS\n\nI found this in **${top.title}** (direct quote — no AI key needed):` and `### 📚 JEXI OS — FROM YOUR BOOKS\n\n${reply}`
- `N.research` FROM-MEMORY fast path (was line 596): `### 🧠 JEXI OS — FROM MEMORY\n\n${remembered.answer}`
- `N.newsTeam` FROM-MEMORY fast path (was line 691): `### 🧠 JEXI OS — FROM MEMORY (news I just gathered)\n\n${fresh.answer}`
- `N.codePipeline` FROM-MEMORY fast path (was line 885): `### 🧠 JEXI OS — RECALLED FROM MEMORY\n\nI solved this before, so I'm giving you the verified solution.\n\n...`
- Coding final summary (was line 1161): `### 💻 JEXI TEAM — PLANNED, BUILT, TESTED & SHIPPED\n\n✅ The full agent team worked together: planned, wrote, ran, QA-tested...` + `**🏢 Team:** Product → Designer → ...`

### After
- `N.studyTopic` → `## ${topic}` + content (verified, see P4). No Scholar narration.
- `answerFromKnowledge` → plain quoted/structured answer with clean `## <title>` headers; the no-key path quotes the passage directly.
- All FROM-MEMORY fast paths → the answer content only (no memory header, no "I solved this before").
- Coding final summary → clean result header + files + real test output + links; the "full agent team worked together" sentence and the "🏢 Team" pipeline list are gone.
- New always-on rule (JEXI.md + formatting knowledge + JexiPrompt VOICE_RULES):
  NEVER narrate process to the user. Forbidden: "I studied…", "I researched…",
  "I used the Trusted Library…", "I saved this to my knowledge library…",
  "I remember this from memory…", "According to my knowledge library…",
  "FROM MEMORY" / "RECALLED FROM MEMORY" / "JEXI SCHOLAR" headers.
- New `server/src/services/AnswerSanitizer.js` — `sanitizeFinalAnswer()` strips
  forbidden narration + scaffolding from any summary; wired into `N.responder`
  so no user-facing path can leak process narration (belt-and-braces for P7).

### Evidence
```text
$ node test-b51.js
✅ P1 sanitizer removes the JEXI SCHOLAR header + narration paragraph
✅ P1 real content survives the sanitizer
✅ P1 FROM MEMORY header stripped
✅ P1 JEXI TEAM banner stripped
✅ P1 "full agent team worked together" stripped
✅ P1 Orchestrator has no JEXI SCHOLAR / FROM YOUR BOOKS / JEXI TEAM banner
... (54 checks total, 0 failed — covers all 7 priorities)
$ cd server && npm test
exit=0 · full suite (21 suites incl. new test-b51.js) · 0 ❌
```

**Fix found while writing the proof:** the sanitizer's emoji header regex used a
literal emoji character class (`[📚🧠…]`), which matches UTF-16 code units and
never hit a real emoji — `### 🧠 JEXI OS — FROM MEMORY` survived. Replaced with
`\p{Extended_Pictographic}` under the `u` flag, and the "full agent team worked
together" line regex now allows an emoji bullet (✅). Regression-covered in
test-b51.js (headers + phrases + legitimate-content-unchanged).

---

## Priority 2 — Simple questions get direct answers ✅

### Before
"what is X" questions fell through to the `research` intent (web search +
browser + synthesize) or the heavy study pipeline.

### After
- New `direct_answer` intent in Planner (INTENTS, TEAM_PLAN, ClassificationSchema).
- Regex fast-path before the research fallback: simple definitional /
  factual questions (`what is X`, `define X`, `who is X`, `where is X`,
  `capital of X`, `meaning of X`, `what does X mean`) that do NOT ask for
  latest/news/multi-source → `direct_answer` (team: jexi + context-manager).
- New `N.directAnswer` Orchestrator node: model knowledge + optional short
  memory/knowledge-load — NO web search, NO Trusted Library, NO study pipeline.
- Negative examples added to the LLM classification prompt:
  "what is computer science" → direct/explain, "what is the capital of Kenya"
  → direct, "study computer science for my exam" → study_topic.
- Router maps `direct_answer` → `directAnswer`.

### Evidence
```text
$ node test-planner-routing.js
"what is the capital of Kenya" → direct_answer
"define photosynthesis"       → direct_answer
"study calculus for my exam"  → study_topic
$ node test-b51.js — planner asserts simple questions never plan web/browser agents
```

---

## Priority 3 — Tool selection discipline ✅

### Before
Single loose TOOL USAGE table inside `formatting/KNOWLEDGE.md`; no
authoritative decision table loaded by tool-using turns, and simple intents
could still auto-attach web/browser agents.

### After
- New progressive knowledge folder `server/knowledge/tools/KNOWLEDGE.md` —
  the authoritative decision table (situation → preferred tools → do NOT use).
  Auto-discovered by KnowledgeBase (`listKnowledgeCategories` scans dirs), so
  `knowledge-load tools` returns it; added to the JEXI.md pointer list.
- JEXI.md + system prompt gained the Tool discipline rules:
  - Do not browse/search for questions answerable from knowledge or project knowledge.
  - Do not launch a full research/study pipeline for a one-line definitional question.
  - Prefer the cheapest correct tool; every tool call must be justified by intent.
- Enforcement: `direct_answer` team carries NO web/browser/study agents;
  `study_topic` only reachable on explicit learn/study language (P2).

### Evidence
```text
$ node test-b51.js
✅ knowledge-load tools returns the decision table
✅ simple factual query plans zero web/browser/search agents
✅ research/study intents still attach the correct agents
```

---

## Priority 4 — NO UNVERIFIED RESULT → FINAL OUTPUT ✅

### Before
`studyTopic` and the new direct path returned drafts with no verification gate;
several Orchestrator cases set `results.summary` and returned straight through.

### After
- `studyTopic` now runs the draft through `verifyAnswer` (critique → revise,
  bounded 2 rounds) before final summary.
- `directAnswer` runs through `verifyAnswer` as well.
- Research path already had verifyAnswer + verifyDomainAnswer (deterministic) —
  confirmed intact.
- Generic path already has the deterministic groundedness check — confirmed.
- Test: a deliberately bad draft (unsupported claim) is revised before it
  becomes the final summary (mock verifier seam via injectable opts).

### Evidence
```text
$ node test-b51.js
✅ studyTopic draft goes through verification before summary
✅ directAnswer draft goes through verification before summary
✅ bad draft is revised, never shipped unchanged
```

---

## Priority 5 — Correction paths + repeated-failure behaviour ✅

### Before
GraphRunner had success/retry/fallback primitives and CodingLoop existed, but
repeated identical failures could still re-run the same step blindly, and the
research path had no failure state feeding the responsible node.

### After
- `CodingLoop.js` gained a **repeated-failure guard**: identical error text
  seen N times (3) → escalates (returns failure with `escalated: true` +
  the repeating error) instead of blindly re-fixing; the caller (debugger)
  records it in `state.context.code.failureHistory`.
- Research path: verification FAIL stores the specific issues in
  `state.context.failureHistory` and sets `state.outcome='retry'` (bounded)
  so the responsible node re-enters with the concrete missing claims; a
  second failure escalates to a clean honest answer instead of looping.
- Tests prove: forced identical failure stops/escalates at the guard; research
  failure carries the specific issues into the next pass.

### Evidence
```text
$ node test-b51.js
✅ identical-error guard escalates at 3 repeats (no blind re-fix)
✅ research failure re-enters with the specific missing claims
✅ escalation produces an honest final answer, no infinite loop
```

---

## Priority 6 — B50 progressive knowledge + skills locked ✅

### Before
B50 structures existed (progressive skill folders in the coding-pipeline
plugin, knowledge-load, always-on JEXI.md) — needed runtime confirmation that
nothing regressed and no flat legacy file shadows the folders.

### After
- Confirmed: `server/skills/` flat files (`product.md`, `engineer.md`,
  `reviewer.md`, `security-officer.md`) are now thin redirects — the
  progressive folders live in `server/plugins/coding-pipeline/skills/` and
  `SkillChain.skillFolder` prefers them (existing P1 tests re-verified).
- Confirmed: always-on context contains JEXI.md and NOT the progressive folder
  bodies until `knowledge-load` is called (existing P2 tests re-verified).
- Confirmed: PluginRegistry discovers `coding-pipeline` (7 packaged skills).
- New B51 assertions re-run these checks inside the same suite.

### Evidence
```text
$ node test-skill-progressive.js   → 50 passed
$ node test-knowledge-base.js      → 18 passed
$ node test-plugins.js             → 18 passed
```

---

## Priority 7 — Response quality + garbage removal ✅

### Before
Internal process phrases could still reach the user on paths that had them.

### After
- `server/src/services/AnswerSanitizer.js` — `sanitizeFinalAnswer(text)`:
  removes forbidden narration phrases (studied/researched/Trusted Library/
  saved to my knowledge library/remember from memory/according to my
  knowledge library/as an AI/I will now/FROM MEMORY/RECALLED FROM MEMORY/
  JEXI SCHOLAR headers) and collapses the leftover blank space.
- Wired into `N.responder` — every final summary passes through it before
  `normalizeAgentResult`.
- Formatting knowledge gained a **VOICE & GARBAGE RULES** block: lead with the
  answer, no process narration, no "as an AI…", sources only when actually
  used and listed cleanly.
- Tests prove the forbidden phrases cannot reach final output through the
  responder, and that legitimate content is untouched.

### Evidence
```text
$ node test-b51.js
✅ sanitizer strips every forbidden phrase from final output
✅ legitimate content unchanged
✅ responder output carries zero forbidden phrases
```

---

## Final state
`cd server && npm test` → green (exit 0), full suite (21 suites) incl. the new
`server/test-b51.js` (54 checks) registered in the chain.

Tests that encoded pre-B51 behavior were updated to the new contract:
- `test-chat-books.js`: "answer is labeled FROM YOUR BOOKS" → asserts the label
  is GONE and the book is still cited.
- `test-audit-b47.js`: LLM-failure fallback for "capital of kenya" → now
  `direct_answer` (was `research`).
- `test-reliability.js`: "ordinary questions unchanged" → `direct_answer`.
- `test-coding-loop.js`: budget-cap case now uses VARYING error text so the B51
  identical-error escalation (covered in test-b51.js) does not trip it.
