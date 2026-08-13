# JEXI OS — Build 47 Fix Log (Independent Audit)

Every numbered item from the audit is implemented, tested, and recorded below.
Ground rules followed: priorities worked top-to-bottom, `npm test` run after each
item, incremental migration (no rewrite — existing agent functions, tool
integrations, verification loops and QA/security gates were wrapped, not
discarded), and discrepancies against the audit's named locations noted inline.

**Audit-named locations vs. actual code:** the audit named
`server/src/services/Orchestrator.js` (`Orchestrator.executePlan`),
`server/src/services/Planner.js` (`Planner._classify`), `server/index.js`
(`/api/chat` pendingTask), `server/mcp-server.js` (`ask_jexi`),
`server/src/services/JexiPrompt.js` (`JEXI_SYSTEM_PROMPT`),
`PreferenceLearner.js`, `MemoryManager.js` (`resolveConversationalQuery`) —
all exist at those exact paths and were edited in place. No renames required.

---

## Priority 1 — Real graph orchestrator ✅

**Problem:** `Orchestrator.executePlan` was a linear `switch (plan.intent)` plus a
fixed sequential phase loop for compound tasks — no branching, no mid-execution
replanning, no general cycles.

**Changed:**
- **New file `server/src/services/GraphRunner.js`** — the hand-rolled graph runtime:
  `Map<nodeName, nodeFn>` + per-step edge-resolver functions + a run loop with a
  `maxSteps` guard (128 in the orchestrator) against infinite cycles. No external
  dependency — this codebase has not outgrown a hand-rolled runner (XState /
  LangGraph.js deliberately not added).
- **New file `server/src/services/SessionStore.js`** — conversation-scoped run
  store (also serves Priority 5 / Priority 9).
- **`server/src/services/Orchestrator.js`** — `executePlan` now **delegates to the
  graph runner**; there is no `switch` on intent in `executePlan` anymore. The
  dispatch switch moved into the `router` node's `nodeForIntent()` helper
  (`buildGraph`, ~line 1095), which is exactly what a router node is supposed to do.
- **`RunState`** — single canonical state object flowing through every node:
  `query, resolvedQuery, plan, memoryLoadout, intermediateResults, currentNode,
  status, retryCount, lastError, needsConfirmation, confirmationPayload, history,
  agentResult, context`. Every field's meaning and shape is documented in the
  JSDoc `@typedef` block at the top of `GraphRunner.js` (lines 13–45).
- **Nodes implemented** (wrapping the existing specialists, internals preserved):
  `start → contextResolve → memoryRead → planner → router →` one node per
  specialist (`searchTeam`-equivalent `research`, `newsTeam`, `codePipeline`,
  `computerUse`, `mathSolve`, `translate`, `data`, `devops`, `github`, `selfCheck`,
  `conversation`, plus `studyTopic`, `knowledgeRecall`, `linkAnalysis`,
  `imageRecognition`, `memoryQuery`, `clearMemory`, `explainTeam`, `compoundTask`,
  `docs`, `perf`, `generic`) — then `replanner`, `confirmationPause`,
  `memoryWrite`, `responder`.
- **Conditional edges** (in `buildGraph`):
  - `planner → router → <specialist>` by classified intent
  - `'*'` fallback edge: `ask_user/needsConfirmation → confirmationPause`,
    `retry → same node`, `fallback|lastError → replanner`, else `responder`
  - **Coding path is a real cycle, not a special case:** `codePipeline → debugger
    → (runSuccess → qaGate | debugAttempts ≥ MAX → qaGate | else debugger)`,
    `qaGate → (NEEDS FIX ∧ rounds < 1 ∧ !debugAsk → debugger | else reviewShip)`,
    `reviewShip → shipper → responder`
  - `confirmationPause → resumeNode` on "yes" (Priority 5), `→ end` otherwise
- **Thrown errors** are converted by the runner's `onError` into structured
  `lastError` + `outcome: 'fallback'`, so they route through `replanner` instead
  of killing the request (this was a real bug found while testing — thrown
  exceptions initially bypassed the `'*'` edge).

**Tests (all in `server/test-audit-b47.js`):** P1 forced low-confidence branch
through `replanner`; P1 forced node failure routed through `replanner`; P1 coding
debug-loop exercised as graph edges (`debugger` re-entering itself, `qaGate`
NEEDS FIX → `debugger`). Full suite: `cd server && npm test` → **exit 0, 609 ✅, 0 ❌**.

---

## Priority 2 — Structured routing (replace regex-cascade classification) ✅

**Problem:** `Planner._classify` was a long regex cascade; the primary routing
decision was deterministic regex, not schema-validated classification.

**Changed (`server/src/services/Planner.js`):**
- **Added a Zod `ClassificationSchema`** enumerating every intent the planner
  produces (`intent`, `confidence ∈ [0,1]`, `teamSlugs`, `reasoning`) — exported
  for tests.
- **New primary path:** `_classifyWithLLM` calls `generateContent` with a
  tool-call-style prompt (few-shot **positive and negative examples**, including
  the confusable pair this codebase actually has: *"build a study planner"* →
  `code_task` must NOT be confused with *"study calculus"* → `math_solve`) and
  validates the response against `ClassificationSchema`. On valid, high-confidence
  output it is the routing decision.
- **Regex cascade demoted to fallback:** used first only for a short list of
  unambiguous exact patterns, and used as fallback when the LLM path returns
  low confidence or fails schema validation — never as the primary path for
  ambiguous input.
- **Hardened:** the LLM call itself is try/caught so a provider throw falls back
  to regex instead of crashing classification.

**Tests:** P2 ambiguous case ("study calculus" vs "build a study planner") routes
to the right intents; low-confidence → regex fallback; schema-validation failure
routes to `replanner` (P1's error edge) instead of crashing; `ClassificationSchema`
validates.

---

## Priority 3 — Single shared state contract ✅

**Problem:** Planner returned ad hoc shapes reinterpreted per-case by the
Orchestrator; agents returned free-form `{ summary, sources, success, ... }`.

**Changed:**
- Largely satisfied by the `RunState` object (Priority 1) — documented in
  `GraphRunner.js` and `ARCHITECTURE.md`.
- **`AgentResult` schema** — every specialist node normalizes its agent's output
  at the node boundary into:
  `{ success: boolean, summary: string, data: unknown, sources: Array, error: { code, message } | null }`
  (JSDoc'd on `RunState.agentResult` and in `ARCHITECTURE.md`).
- Agents themselves were **not** rewritten; their ad hoc outputs are translated
  at the node boundary (minimal blast radius), exactly as the audit permitted.
- `intermediateResults[nodeName]` holds each node's `AgentResult`, so `replanner`,
  `responder`, and `confirmationPause` read prior results from one shape.

**Tests:** audit suite asserts node-to-node handoffs run through `RunState`
shapes (P1 tests inspect `intermediateResults`); P3 acceptance documented in
`ARCHITECTURE.md`.

---

## Priority 4 — Explicit validated contracts for every agent/tool ✅

**Problem:** most agent/tool entry points accepted free-form strings/objects;
the planner → orchestrator path didn't enforce schemas.

**Changed (`server/src/services/ToolRuntime.js`, `ToolRegistry.js`):**
- `ToolRuntime` already carried input schemas; it now **validates inputs at the
  boundary** via `validateToolArgs` and **validates outputs** via
  `validateToolOutput` + the exported `TOOL_OUTPUT_SCHEMAS` map.
- **Fail closed:** a validation failure returns a structured
  `{ code: 'SCHEMA_VALIDATION_FAILED', message, node, raw }` error — it never
  silently becomes an empty or hallucinated reply, and the graph's error edge
  routes it to `replanner`.
- Registered **`mcp-call`** as tool #152 in `ToolRegistry` (Priority 7) with its
  own input/output schemas; `test-tools.js` count updated 151 → 152.

**Tests:** P4 missing-required-arg fails closed with `SCHEMA_VALIDATION_FAILED`;
P4 malformed tool output (`deep-read` returning `{ kind }` instead of `{ content }`)
is caught and routed, not swallowed.

---

## Priority 5 — True confirmation-resume ✅

**Problem:** `server/index.js`'s `/api/chat` held `pendingTask = { at, query }` (a
module-level singleton); on "yes" it called `planner.planConfirmed(original)` and
re-ran `executePlan` from scratch — no mid-plan checkpoint survived.

**Changed:**
- **New `server/src/services/SessionStore.js`** — in-memory `Map` keyed by
  conversation ID with `saveRun / loadRun / clearRun / clearAllSessions` (plus
  `saveOffer / loadOffer / clearOffer` for the confirm-offer payloads).
- **`server/index.js`** — the old `pendingTask` object is gone. On a confirm-
  requiring plan, the **full `RunState`** is persisted under the conversation ID;
  on "yes" the graph runner is resumed **at the exact paused node** with restored
  intermediate results (`executePlan` accepts `opts.startNode` + a persisted
  state); on "no"/timeout the stored state is cleared.
- `GraphRunner.run` honors `initialState.startNode` and resets `status` so a
  resumed run doesn't inherit `'paused'`.
- **Note (per audit):** in-memory map is the right size for today; a Redis /
  durable store is the documented future upgrade if multi-instance deployment is
  ever needed (`ARCHITECTURE.md`).

**Tests:** P5 pauses mid-run, "confirms", and asserts execution resumes from the
paused node with prior intermediate results intact — not from `planner` (asserted
via `history[0]` + preserved `intermediateResults`).

---

## Priority 6 — Inject memory into the Planner ✅

**Problem:** memory was used inside the Orchestrator but the Planner classified
intent without it, so context-dependent queries mis-routed.

**Changed (`server/index.js` + `Orchestrator.js`):**
- The graph's `memoryRead` node now runs **before** `planner` (edge:
  `contextResolve → memoryRead → planner`), populating
  `RunState.memoryLoadout = { preferences, facts, semantic, agentNotes }`.
- `Planner.analyzeIntent` accepts a `memoryContext` slice; `index.js` builds it
  from `buildPlannerMemory()` (preferences + semantic recall + rolling summary)
  and passes it into the classification prompt, so the LLM classification path
  sees remembered preferences/facts at decision time.

**Tests:** P6 — a query that is only correctly classifiable given a remembered
fact ("continue building it" with memory "User is building a weather app") now
classifies as `code_task` with the memory present.

---

## Priority 7 — MCP as an internal graph capability ✅

**Problem:** `server/mcp-server.js` exposed `ask_jexi` as an external entry point
but internal agents never called MCP tools; MCP was a parallel interface.

**Changed:**
- **`server/mcp-server.js`** — refactored the tool registry into named handlers;
  exported **`callMcpTool(tool, args)`** that dispatches through the same
  validated path as internal tools.
- **`server/src/services/ToolRegistry.js`** — new internal tool **`mcp-call`**
  (schema-validated: `{ tool: string, args: object }` → `{ result }`), so any
  specialist node can call an external MCP tool through `executeTool` exactly
  like an internal tool.
- `ToolRuntime.js` resolves `mcp-call` to `callMcpTool` (fixed an import-path bug
  found while testing — mcp-server.js lives two levels up from `src/services/`).
- `ARCHITECTURE.md` documents how to add more MCP tools.

**Tests:** P7 — `callMcpTool('ask_jexi', { query, ... })` round-trips through the
internal path and returns a validated result; `mcp-call` is in the registry
(`test-tools.js` count = 152).

---

## Priority 8 — General failure handling: retry / fallback / ask-user ✅

**Problem:** only the coding path had a debug loop; every other intent just
caught, logged, and returned an apologetic summary.

**Changed:**
- **Every node** can emit `success | retry | fallback | ask_user` via
  `state.outcome` (documented on `RunState.outcome`).
- **Edges** (`'*'` fallback): `retry` re-enters the same node up to the bounded
  `retryCount` (runner increments per same-node re-entry); `fallback`/`lastError`
  routes to `replanner`; `ask_user` routes to `confirmationPause` with a
  clarifying-question payload instead of a generic error summary.
- **Reusable retry sub-graph:** the coding debug loop was promoted into a named
  pattern (`debugger`/`qaGate` edges — see Priority 1), and the *same* mechanism
  (outcome-based `retry` + bounded `retryCount`) is available to every other
  intent without duplicating the coding logic.
- `GraphRunner` stops a run when a node sets `status: 'done'`, so nothing can
  loop through the responder forever (bug found in testing).

**Tests:** P8 forced failures on research / data / github intents now retry or
fall back instead of returning a polite summary; P8 `ask_user` (github mutating
action without a token) parks at `confirmationPause` with a structured payload.

---

## Priority 9 — Cleanup: dedupe paths, kill the singleton race ✅

**Problem:** overlapping research/knowledge paths; `pendingTask` was a module-level
singleton that raced under concurrent chats.

**Changed:**
- Research/knowledge consolidation: `research`, `newsTeam`, `studyTopic`,
  `knowledgeRecall` are the single nodes every research/knowledge request routes
  through (via `nodeForIntent`); duplicate ad hoc paths removed from
  `executePlan`.
- **`pendingTask` is gone everywhere** — grep confirms no remaining references to
  the old singleton pattern; `SessionStore` (conversation-scoped Map) replaced it
  in `server/index.js`.
- `SessionStore` exposes `clearAllSessions` for tests.

**Tests:** P9 — two concurrent conversations both hitting `confirmationPause`
simultaneously show **no cross-talk** (each `saveRun`/`loadRun` is keyed by its
own conversation ID; clearing one leaves the other intact).

---

## Prompt engineering fixes ✅

1. **Planner classification** — covered by Priority 2: schema-validated tool-call
   output with positive/negative few-shots for the actually-confusable pairs
   (`server/src/services/Planner.js`).
2. **`JEXI_SYSTEM_PROMPT`** (`server/src/services/JexiPrompt.js`) — added a
   mandatory **# SOURCES & HONESTY** block ("NEVER invent sources…", no fabricated
   quotes/statistics/links) and a **# OUTPUT FORMAT BY INTENT** block constraining
   the final user-facing answer shape per intent (research, coding, math,
   translation, data, link/document/video, conversation).
3. **Preference extraction** (`server/src/services/PreferenceLearner.js`) — the
   extraction prompt now carries **4 negative few-shot examples** of what must NOT
   be extracted (one-off task requests, hypotheticals, quoted third-party
   statements, transient complaints) alongside the existing positive rules.
4. **Context resolution** (`server/src/services/MemoryManager.js`,
   `resolveConversationalQuery`) — prompt now demands "Return ONLY the rewritten
   text… your entire reply must be exactly the rewritten user message and nothing
   else", and includes **3 negative examples** of self-contained messages that
   must pass through unchanged.
5. **Verification prompts centralized** — new
   `server/src/services/VerificationPrompt.js` exports `buildVerificationPrompt`
   (structured `{ verdict: 'CLEAN'|'ISSUES', issues: string[] }` JSON contract),
   `parseVerificationVerdict` (JSON-first, legacy `VERDICT:/ISSUES:` tolerated so a
   non-compliant model never breaks a chat), and `buildRevisionPrompt`.
   **Both verifier call sites** — `VerificationLoop.js` and `DomainVerifier.js` —
   now build critique prompts and parse verdicts through this shared module.
6. System prompts are versioned exported constants where isolated
   (`JEXI_SYSTEM_PROMPT`, `JEXI_SYNTHESIS_PROMPT`); the new shared verification
   prompts are a dedicated module so every call site uses one pattern.

**Tests:** PROMPT section in `test-audit-b47.js` — JSON CLEAN/ISSUES parsing,
legacy-format tolerance, prose-tolerant parsing, JSON contract present in the
prompt, revise prompt reused, both verifiers import the shared pattern, and the
three prompt files contain the required instructions (verified by reading the
files in the test).

---

## Final summary — before / after

**Before (a chatbot with specialists):** one big `executePlan` switch picked a
specialist per intent; compound tasks ran a hard-coded phase order; the coding
"debug loop" was a special case; the regex cascade owned routing; agents returned
whatever shape they felt like; "yes" to a confirmation re-planned from scratch and
lost all partial work; memory was only injected after classification; MCP was a
parallel external door; every non-coding failure ended in a polite "we hit an
error" summary; and the pending-confirmation state was one global variable that
raced between users.

**After (a real agent system):** every request flows through a graph — context
resolution → memory read → schema-validated classification → router → specialist
→ verify → respond — where edges (not a switch) decide what happens next. Nodes
branch on confidence, retry themselves up to a bounded count, fall back to
replanning, or pause for the user; the coding pipeline's run→fix→QA loop is a
named cycle any intent can reuse; a thrown error becomes a structured
`lastError` routed to `replanner` instead of a crash; every tool input/output and
every node handoff is validated against a documented contract
(`RunState` / `AgentResult`); confirmations resume from the exact paused node
with prior results intact, per conversation, with no cross-talk; memory reaches
the planner before it decides; internal agents can call external MCP tools
through the same validated path as internal ones; and all verification shares one
structured prompt pattern. JEXI now *decides how to accomplish an objective* —
it does not just pick a regex bucket and run one function.
