# FIXLOG-B52 — Close Remaining Weaknesses After B50/B51

Every Priority: before/after evidence + exact `cd server && npm test` result.
Worked top to bottom. B50/B51 structure was not re-built; only closed the
concrete residual weaknesses.

Non-negotiable invariants enforced by this build:
1. NO PROCESS NARRATION in final answers (sanitizer as last defence).
2. NO RESEARCH/STUDY PIPELINE for simple definitional questions.
3. NO WEB/BROWSER BY DEFAULT on lightweight intents (enforced in code).
4. GRAPH DRIVES the code-gate, research-verify, and review/security paths.
5. FAILURE → HISTORY → CORRECT → VERIFY (bounded; no blind infinite retry).
6. PROGRESSIVE LOADING is real: summaries at plan time, bodies only on use.
7. NO UNVERIFIED RESULT → FINAL OUTPUT on major answer paths.

---

## Priority 1 — Legacy flat skills removed; progressive folders are the only source ✅

### Before
```
$ ls server/skills/
21-platform-reliability.md
engineer.md          <- flat pipeline skill (shadow)
product.md           <- flat pipeline skill (shadow)
reviewer.md          <- flat pipeline skill (shadow)
security-officer.md  <- flat pipeline skill (shadow)
```
The progressive folders lived under `server/plugins/coding-pipeline/skills/`,
but `loadSkill()`'s flat-file fallback (`listSkillFiles().find(...-<slug>.md)`)
could still resolve the pipeline skills from the stale flat files — a
confusion risk and a second source of truth.

### After
```
$ ls server/skills/
platform-reliability/
$ ls server/skills/platform-reliability/
SKILL.md
```
- Deleted: `server/skills/engineer.md`, `product.md`, `reviewer.md`,
  `security-officer.md` (the pipeline skills now resolve ONLY from
  `plugins/coding-pipeline/skills/<slug>/`).
- Migrated `21-platform-reliability.md` → `server/skills/platform-reliability/
  SKILL.md` (progressive folder, same frontmatter/body).
- `server/test-skill-progressive.js` gained B52 assertions: every pipeline
  slug must load `progressive: true && !synthesized`; the five legacy flat
  filenames must not exist under `server/skills/`; `platform-reliability`
  resolves as a progressive folder.

### Evidence
```
$ node test-skill-progressive.js
✅ B52 engineer loads ONLY as a progressive folder (never flat/synthesized)
✅ B52 coder loads ONLY as a progressive folder (never flat/synthesized)
... (all 7 pipeline skills + platform-reliability)
=== RESULT: 65 passed, 0 failed ===
$ cd server && npm test
exit=0 · 21 suites · 0 ❌
```

---

## Priority 2 — GraphRunner drives the code-gate, research-verify, review/security paths ✅

### Before
- The main Orchestrator ran large case-based `N.*` handlers: research did an
  inline `verifyAnswer` + `state.outcome = 'retry'` re-entry; qaGate did an
  inline `fixFromQA → debugger` cycle; securityGate did an inline BLOCKED fix
  round. The GraphRunner primitives existed (B50 P6) but these high-stakes
  paths were ad-hoc sequential code, not graph runs.

### After
- **New `server/src/services/PipelineGraphs.js`** — three REAL `createGraph`
  runs, each with typed nodes (`agent` | `verifier` | `gate`), outcome-driven
  `when()` edges, node-visit history (runner pushes every node into
  `state.history`), bounded retries, and durable `failureHistory[]` on state:
  1. `runCodeGateGraph` — gate → (NEEDS FIX → fix → re-run → re-verify,
     bounded 1 round) → accept.
  2. `runResearchVerifyGraph` — verifier → (issues → revise WITH the specific
     missing claims → verifier, bounded) → final draft.
  3. `runReviewSecurityGraph` — reviewer → security-gate → (BLOCKED → fix →
     re-run → re-review, bounded) → final verdict.
- **Wired into the Orchestrator**: `N.research` runs the verify+revise path
  through `runResearchVerifyGraph`; `N.qaGate` runs the NEEDS FIX recovery
  through `runCodeGateGraph`; `N.securityGate` runs through
  `runReviewSecurityGraph`. All three merge the graph's `failureHistory` into
  `state.context.failureHistory` (P7).
- Injection seams (`verifyFn`, `searchFn`, `qaVerdictFn`, `securityFn`, `fixFn`,
  `runFn`) keep production defaults identical and make failure paths
  deterministic-testable.
- `server/test-b52.js` proves the node sequences on SUCCESS and on forced
  FAILURE → recovery (e.g. `['gate','fix']`, `['verify','revise','verify']`,
  `['reviewer','security-gate','fix-sec']`) plus the recorded failure reasons.

### Evidence (graph definitions + test output)
```
$ node test-b52.js
✅ P2 codeGateGraph success visits only the gate
✅ P2 codeGateGraph failure → recovery node visited          (history ['gate','fix'])
✅ P2 codeGateGraph recorded durable failure history
✅ P2 researchVerifyGraph visits verify → revise → verify    (bounded revision)
✅ P2 researchVerifyGraph failure history carries the specific claim (Dartmouth)
✅ P2 reviewSecurityGraph visits reviewer → gate → fix-sec
✅ P2 reviewSecurityGraph final verdict CLEARED after fix round
✅ P2 Orchestrator research node calls runResearchVerifyGraph
✅ P2 Orchestrator qaGate calls runCodeGateGraph
✅ P2 Orchestrator securityGate calls runReviewSecurityGraph
$ cd server && npm test
exit=0 · 22 suites · 0 ❌
```

---

## Priority 3 — direct_answer hard-locked (no research/study leakage) ✅

### Before
- Planner step 9's research regex still matched bare `what is|who is|where is|
  explain|meaning|capital|population` — any order mistake sent simple
  definitional questions into the research pipeline.
- The B50 domain router swallowed queries WITH explicit research cues
  ("research the history of computer science" → `domain:computer-science`),
  collapsing a real research request into a direct field answer.

### After
- Step 8.95 (`direct_answer`) runs BEFORE the research fallback and is
  unchanged in position; step 9's research regex was NARROWED to real research
  cues only (`search|research|find out|look up|when did|why does|how to|latest|
  breaking|news|current|history of|deep dive|investigate|report on|sources|
  compare|analyze|trends|benefits of|types of|top N|who was…`) — bare
  definitional phrases are no longer research signals.
- The domain router (step 8.9) now YIELDS to strong research cues
  (`/research|search|latest|breaking|news|sources|compare|deep dive|investigate|
  report on|current/i`), so "research the history of computer science" runs the
  RESEARCH pipeline. "What is X" academic questions stay on their field teams,
  which resolve to DIRECT answer nodes (generic → model knowledge, books
  first) — never study/research.
- The `direct_answer` Orchestrator node never calls the Trusted Library study
  pipeline, web search, or browser (asserted by tests).

### Regression results (all four directive cases + guards)
```
what is computer science            → domain:computer-science (direct answer node, NOT research/study)
what is the capital of Kenya        → direct_answer
study computer science for my exam  → study_exam
research the history of computer science → research
$ cd server && npm test
exit=0 · 22 suites · 0 ❌
```
Two pre-B52 assertions updated to the new contract: `test-planner-routing.js`
"search the internet for quantum computing news" and "research solar panels…"
now expect `research` (explicit research cues beat field routing — B52 P3).

---

## Priority 4 — Tool discipline enforced in CODE, not only prompts ✅

### Before
- Tool selection was prompt rules + the composed team; nothing hard-blocked a
  lightweight intent from pulling web/browser/study tools if the Planner or
  AgentLoop attached them.

### After
- **`server/src/services/ToolRegistry.js`** — new `TOOL_INTENT_ALLOWLIST` map
  (`direct_answer`, `conversation`, `self_check` → memory/knowledge tools only)
  and `enforceToolAllowlist(intent, slug)` (unlisted intents unrestricted).
- **`server/src/services/ToolRuntime.js`** — `executeTool({ slug, …, intent })`
  refuses any tool outside the intent's allowlist BEFORE execution
  (`{ ok:false, blocked:true, byAllowlist:intent }` + `tool.refused` event).
- The knowledge decision table (`knowledge/tools`) stays as documentation;
  the allowlist is the enforcement point.
- `toolsForIntent('direct_answer')` resolves to MEMORY-ONLY tools (memory-
  recall, rolling-summary, knowledge-load, …) — zero web/browser/study.

### Evidence
```
$ node test-b52.js
✅ P4 direct_answer tool set is MEMORY-ONLY (no web/browser/study)
✅ P4 allowlist refuses web-search on direct_answer
✅ P4 allowlist refuses trusted-library on direct_answer
✅ P4 executeTool BLOCKS web-search for direct_answer
$ cd server && npm test
exit=0 · 22 suites · 0 ❌
```

---

## Priority 5 — Single final-output gate + forbidden-phrase sanitizer ✅

### Before
- Verification was path-dependent (some nodes called `verifyAnswer` inline,
  some not) and narration stripping relied on the responder's sanitizer only.

### After
- **New `server/src/services/Finalizer.js`** — `finalizeAnswer({ query, draft,
  sources, domain, verify, sendEvent, opts })`: runs verification when
  appropriate (skipped with `verify:false` where the graph/team already
  verified), ALWAYS strips forbidden process narration via the AnswerSanitizer
  (last line of defence), returns `{ summary, verification, sources }`.
- Routed through `finalizeAnswer`: `direct_answer`, `research`
  (verify:false — the graph verified), `study_topic`, `knowledge_recall`,
  `news` (verify:false — freshness is the verification), and the `code`
  build report (verify:false — code was gate-verified). One shared path.

### Evidence
```
$ node test-b52.js
✅ P5 finalizeAnswer strips forbidden narration
✅ P5 finalizeAnswer keeps the real content
✅ P5 finalizeAnswer returns verification metadata
$ cd server && npm test
exit=0 · 22 suites · 0 ❌
```

---

## Priority 6 — CodingLoop on the production code_task path ✅

### Before
- CodingLoop was proven in isolation; the directive asked for proof on the
  real path.

### After
- The `N.debugger` node (the write → run → observe → fix loop for every
  `code_task`) runs `runCodingLoop` with the machine-checkable predicate
  `successCriterion: 'exit-zero-no-error-text'`, bounded attempts
  (`MAX_DEBUG_ATTEMPTS`), and exact error feedback into the next fix turn.
  QA/security fix rounds inside the graphs are bounded single-patch
  re-verifications ending at gates (never blind retries).
- `test-b52.js` P6 proves multi-iteration fix behaviour on the PRODUCTION
  configuration (same predicate + bounded budget): a broken first attempt is
  fixed across 3 iterations with the exact error recorded.

### Evidence
```
$ node test-b52.js
✅ P6 debugger node runs the production CodingLoop
✅ P6 production loop uses a machine-checkable predicate
✅ P6 production-path loop iterates until predicate passes (attempts=3)
✅ P6 exact error was fed back and recorded
$ cd server && npm test
exit=0 · 22 suites · 0 ❌
```

---

## Priority 7 — Durable failure history + repeated-failure guard ✅

### Before
- `attempt` / `failureHistory[]` / `lastError` existed partially (B51 P5
  research retry) but not as consistent state every correction path reads.

### After
- All three graphs maintain `state.context.attempt`, `failureHistory[]`
  (reason + node + timestamp, capped at 8) and `lastError` via `recordFailure`;
  the Orchestrator merges them into `state.context.failureHistory` so the NEXT
  iteration of the responsible agent receives the last error + reasons.
- CodingLoop's identical-error guard (B51 P5) escalates at 3 repeats — no
  blind retry — and the fixer's prompt receives the EXACT previous error.
- `test-b52.js` P7 proves: (a) the second-iteration fixer context contains the
  first failure reason; (b) identical failure escalates at attempt 3;
  (c) the Orchestrator merges graph failure history into state.

### Evidence
```
$ node test-b52.js
✅ P7 fixer received the first failure reason in its context
✅ P7 identical failure escalates at 3 (attempts=3)
✅ P7 Orchestrator merges graph failure history into state
$ cd server && npm test
exit=0 · 22 suites · 0 ❌
```

---

## Priority 8 — Progressive L0/L1/L2 loading locked by tests ✅

### Before
- B50 added the folders; tests existed but the directive wanted the tiered
  behaviour (and the no-silent-full-injection guarantee) proven together.

### After
- L0 = always-on `JEXI.md` only (injected into every session prompt);
  L1 = short `knowledge-load <category>` overviews on demand; L2 = full
  `reference.md` / deep knowledge only when the skill actually runs.
- `test-b52.js` P8 + `test-skill-progressive.js` + `test-knowledge-base.js`
  assert: planning context contains NO full reference.md bodies (small
  JSON, no OWASP/checklist leaks); progressive bodies appear ONLY after
  `knowledge-load`; all four categories loadable.

### Evidence
```
$ node test-b52.js
✅ P8 knowledge category conventions/architecture/formatting/tools present
✅ P8 always-on JEXI.md is L0 (injected, non-empty)
✅ P8 knowledge-load loads L1/L2 bodies on demand
✅ P8 planning context has no full reference.md bodies
✅ P8 planning context stays small
$ cd server && npm test
exit=0 · 22 suites · 0 ❌
```

---

## Final state
`cd server && npm test` → **exit 0 · 22 suites (incl. new `test-b52.js`, 58 checks) · 0 ❌**.
Server boot verified (`🧠 JEXI OS BRAIN running on port 3002`, all new imports load).
