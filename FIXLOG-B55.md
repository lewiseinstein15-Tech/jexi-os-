# FIXLOG-B55 — OpenWorker Risk-Tiered Execution Model (non-destructive upgrade)

Every Priority: before/after evidence + `cd server && npm test` result. Additive
wrapper/targeted fixes only — no existing feature, agent, connector, memory
schema, or orchestration layer was removed or rewritten.

**Final test evidence:**
```
$ cd server && npm test
... 43 test files ...
RESULT: 43 passed, 0 failed   (new test-b55.js — B55 acceptance)
0 ❌ across every suite        (audit 65, B53 50, build47 37, tools 55, …)
$ npm run build  → ✓ built in 16.77s (frontend clean)
```

---

## Report-first audit (what already satisfied the directive → untouched)

| Directive item | Status before B55 | Action |
|---|---|---|
| #3 Model-agnostic routing | **Already present.** `LLMClient.js` walks 8 providers (Groq, Gemini, OpenRouter, Cerebras, DeepInfra, Mistral, xAI, HuggingFace) with health-aware failover (`ProviderRouter.js`) + per-intent preference (`ModelRouting.js`). | None — left untouched. |
| #4 MCP compatibility | **Present as a hosted MCP server** (`server/mcp-server.js`, allowlist tools + resources, internal `mcp-call` path, `/mcp` endpoint). Missing: attaching *generic* MCP tools as a capability. | Additive: `registerMcpTool()` external registry. Custom connectors untouched. |
| #1 Risk gating skeleton | Partial: `toolPermission` (safe/medium/risky) + profiles + `RiskGuard` (call-level HIGH blocking) + hooks + allowlists. Missing: the typed 4-tier READ/WRITE_LOCAL/EXEC/EXTERNAL model and the hard rule that EXTERNAL always requires ONE approval with real finalized details. | Wrapper added on top (`toolTier` + approval gate). |
| #5 No fabricated completion | Partial: `executeTool` fails closed on validation, mcp failures propagate, registry-only tools return an honest `routed` result. Gap: `routed` had `ok:true`, so loops could count it as a completed step. | `isToolDone()` predicate + AgentLoop honours it. |
| #2 State re-asking | **Bug found:** `hasConversationalReference()` returns true for ANY message < 25 chars, so a short message that already carries its own details (`"remind me friday 3pm"` = 21 chars) was rewritten against the transcript by an LLM — the rewrite could drop the date, the plan ran without it, and JEXI asked "what date?" for info already given. | Minimal targeted fix in `resolveConversationalQuery` (+ guards). |

---

## Priority 1 — Risk-tiered tool calls (typed 4-tier wrapper)

### Before
`ToolRuntime.js` classified slugs as `safe | medium | risky` for permission
profiles; nothing enforced "money/send/irreversible ⇒ one human approval with
real finalized details" except the github node's own `IRREVERSIBLE_RE`.

### After (additive — permission/RiskGuard/hooks untouched)
- `toolTier(slug, args) → 'read' | 'write_local' | 'exec' | 'external'`
  (`server/src/services/ToolRuntime.js`):
  - READ: search/lookup/comparison — always autonomous, never confirm.
  - WRITE_LOCAL: memory/knowledge/workspace writes — always autonomous.
  - EXEC: `code-run` — autonomous by default, logged, reversible only
    (RiskGuard still blocks HIGH/irreversible calls).
  - EXTERNAL: `github-cli`, `browser-drive`, `form-fill`, non-builtin
    `mcp-call` targets — ALWAYS requires one explicit human approval.
- `executeTool()` accepts an optional `confirm` callback. When `tier === 'external'`:
  - `confirm` present → `confirm({ risk:'irreversible', tier, tool, action, details, question })` with the **real finalized details** built by `buildFinalizedDetails()` (never placeholders). `false` → declined; `'paused'` → parks on the graph's `confirmationPause`; `true` → runs.
  - `confirm` absent → refused with `{ ok:false, approvalRequired:true, details }` — never auto-runs.
- `getToolCatalog()` exposes `tier` per tool (Settings UI can show it).
- `AgentLoop` threads `opts.confirm` into `executeTool` (SubagentRuntime already spreads `opts`), so agent-driven EXTERNAL calls pause for approval through the same machinery.

### Evidence
```
$ node test-b55.js
✅ web-search is READ · memory-write is WRITE_LOCAL · code-run is EXEC · github-cli is EXTERNAL
✅ EXTERNAL tool without a confirm callback → approvalRequired (never auto-runs)
✅ approval carries the REAL finalized details — command: gh repo create jexi-x --public
✅ EXTERNAL + confirm(false) → declined, exactly one approval asked
✅ EXTERNAL + confirm("paused") → parks for the graph pause/resume
✅ EXTERNAL + confirm(true) → runs once approved
✅ READ-tier tool runs autonomously — no confirmation asked
```

---

## Priority 2 — State re-asking bug (minimal targeted fix)

### Before (`server/src/services/MemoryManager.js`)
```js
export function hasConversationalReference(query) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (q.length < 25) return true; // "continue", "go on", "more", "yes"…
  return ANAPHORA_RE.test(q);
}
// resolveConversationalQuery() then REWRITES any such message via LLM…
```
`"remind me friday 3pm"` (21 chars) → rewritten against the transcript → the
rewrite could drop the date → plan runs without it → **JEXI re-asks for the
date it was already given.**

### After
1. **Pre-check:** a short message that already carries its own concrete
   details (date/time/number/amount via new `hasOwnDetails()`) AND has no
   pronoun/reference is returned unchanged (`resolved:false`) — never rewritten.
2. **Post-rewrite guard:** any LLM rewrite that drops a detail token from the
   original is rejected by `rewritePreservesDetails()` (normalized compare) —
   the user's original message wins, so no detail can be lost in translation.
3. Genuine continuations ("continue it") still resolve exactly as before.

### Evidence
```
✅ "remind me friday 3pm" passes through UNCHANGED (no lossy rewrite, no re-ask)
✅ a rewrite that DROPS the time is rejected
✅ a rewrite that KEEPS all details passes
✅ genuine continuation ("continue it") still resolves against context
```

---

## Priority 4 — MCP attach capability (additive, custom connectors untouched)

### Before
`callMcpTool()` resolved only the 5 built-in allowlist handlers; there was no
way to attach an additional generic MCP-compliant tool.

### After (`server/mcp-server.js`)
- `registerMcpTool({ name, description, inputSchema, handler, tier })` — attaches
  a generic MCP tool, callable through the same schema-validated, fail-closed
  `mcp-call` path. **Tier is hard-enforced to `'external'`** — third-party
  capabilities can never silently downgrade the risk model; they always get the
  one-time human approval first.
- `listMcpTools()` (built-ins + attached, with tiers) feeds `/api/mcp/status`;
  `mcpToolTier()` is used by ToolRuntime's `toolTier` for `mcp-call`.
- Built-in allowlist, resources, `/mcp` endpoint: untouched.

### Evidence
```
✅ cannot shadow a built-in MCP tool name
✅ attached tools may ONLY register as EXTERNAL tier (hard-enforced risk model)
✅ attached MCP tool is callable through the validated mcp-call path
✅ listMcpTools() includes attached tools with their tier
✅ built-in allowlist still listed (custom connectors untouched)
```

---

## Priority 5 — No fabricated completion

### Before
Registry-only tools returned `{ ok:true, routed:true, result:"…routed to X" }`;
an `ok:true` in AgentLoop counted as a completed step, so a tool that never ran
could be reported as done.

### After
- New `isToolDone(res)` predicate: only a real completed tool response is done.
  `routed`, `paused`, `approvalRequired`, `blocked`, and `ok:false` are never done.
- `AgentLoop` uses `isToolDone` for completion, logs routed calls as
  *"did NOT execute here — not counted as a completed step"*, and breaks the
  loop when an EXTERNAL call parks for approval.
- Unapproved unknown-tool calls are refused before execution; approved-but-
  unavailable tools still fail closed with the real error.

### Evidence
```
✅ routed-but-not-executed is NEVER done
✅ paused/awaiting-approval is never done
✅ registry-only tool returns routed=true (honest) and is NOT counted as done
✅ unapproved external call is refused BEFORE any execution (fail closed)
✅ unavailable tool is reported honestly (fail-closed)
```

---

## Constraint compliance
- **Nothing removed/rewritten:** permission profiles, RiskGuard, hooks,
  allowlists, MCP built-ins, memory schema, Orchestrator graph, planners — all
  unchanged. Every change is a new wrapper/function or a targeted patch.
- **Backward compatible:** `executeTool` without a `confirm` arg behaves as
  before for READ/WRITE_LOCAL/EXEC; only EXTERNAL-tier calls gained the gate.
- **Full suite green after every change:** 43 test files, 0 failures;
  frontend `vite build` clean.
