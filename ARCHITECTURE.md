# JEXI OS — Agent Graph Architecture (Build 47)

This document describes the final request-execution architecture: the graph
runner, its nodes and edges, the two shared data contracts (`RunState` and
`AgentResult`), confirmation-resume, and MCP as an internal capability.
Everything here is implemented in `server/src/services/` and proven by
`server/test-audit-b47.js` plus the full `server` test suite.

---

## 1. The graph runner

`server/src/services/GraphRunner.js` is a hand-rolled graph runtime — no external
dependency (this codebase has not outgrown one):

- **Nodes** — `Map<nodeName, (state) => RunState>`.
- **Edges** — per-source-node resolver functions `(state) => nextNodeName`; the
  special `'*'` key is the fallback for any node without its own edge. Returning
  `undefined` (or a node with no resolver) ends the run.
- **Run loop** — steps until an edge ends the run, with a `maxSteps` guard (128
  for the orchestrator) so infinite cycles are impossible.
- **Errors** — `onError(state, node)` converts a *thrown* node exception into a
  structured `state.lastError` + `outcome: 'fallback'`, so failures route through
  `replanner` instead of crashing the request.

## 2. RunState — the single state contract

Every node takes and returns this object (JSDoc'd in `GraphRunner.js`). It flows
through every stage of every request:

```js
{
  query:               string,      // raw user message
  resolvedQuery:       string,      // after anaphora/continuity resolution
  plan:                Object|null, // planner output { intent, teamSlugs, reasoning, ... }
  memoryLoadout:       Object,      // { preferences, facts, semantic, agentNotes }
                                   //   populated BEFORE the planner (P6)
  intermediateResults: Object,      // { [nodeName]: AgentResult } — every node's
                                   //   normalized output, keyed by node
  currentNode:         string,      // the node that just ran
  status:              'idle'|'running'|'paused'|'done'|'failed',
  retryCount:          number,      // consecutive re-entries of the SAME node
  lastError:           { code, message, node } | null,
  outcome:             'success'|'retry'|'fallback'|'ask_user'|null, // P8
  needsConfirmation:   boolean,     // parked at confirmationPause
  confirmationPayload: Object|null, // { action, risk, node, summary } to approve
  history:             string[],    // ordered node names visited (audit/resume)
  agentResult:         Object|null, // final AgentResult (see below)
  context:             Object       // node scratch space (coding subgraph state,
                                   //   fallbackUsed, resumeNode, opts, ...)
}
```

## 3. AgentResult — the node-output contract

Every specialist node normalizes its agent's ad hoc output **at the node
boundary** (agents themselves are untouched — minimal blast radius) into:

```js
{
  success: boolean,
  summary: string,            // human-readable result
  data:    unknown,           // structured payload for downstream nodes
  sources: Array<{ title?, name?, link? } | string>,
  error:   { code, message } | null   // e.g. { code: 'SCHEMA_VALIDATION_FAILED', ... }
}
```

`RunState.intermediateResults[nodeName]` stores one `AgentResult` per node, so
`replanner`, `responder`, and `confirmationPause` read prior results from one
shape. Tool I/O is validated at the boundary too (`ToolRuntime.validateToolArgs` /
`validateToolOutput` with the exported `TOOL_OUTPUT_SCHEMAS`); a failure fails
closed with `{ code: 'SCHEMA_VALIDATION_FAILED', message, node, raw }` and routes
to `replanner`.

## 4. Nodes

| Node | Responsibility |
|---|---|
| `start` | Entry — seeds the `RunState` from the request |
| `contextResolve` | Anaphora/continuity rewrite (`resolveConversationalQuery`) |
| `memoryRead` | Semantic recall + preference recall + fact loadout → `memoryLoadout` (runs BEFORE `planner`) |
| `planner` | Schema-validated intent classification (LLM tool-call path, regex fast-path/fallback) |
| `router` | Dispatches to the matching specialist from `plan.intent` |
| `research` / `newsTeam` / `studyTopic` / `knowledgeRecall` | Research & knowledge specialists |
| `codePipeline` (+ `debugger`, `qaGate`, `reviewShip`, `shipper`) | Coding subgraph — real edge cycle |
| `computerUse` | Browser/computer automation |
| `mathSolve` | Math/engineering |
| `translate` | Translation |
| `data` | Data analysis |
| `devops` | DevOps/ops |
| `github` | GitHub actions (ask_user gated) |
| `selfCheck` | Self-diagnostics |
| `conversation` / `generic` / `memoryQuery` / `clearMemory` / `explainTeam` / `docs` / `perf` | Remaining specialists |
| `linkAnalysis` / `imageRecognition` | Link/vision handlers |
| `compoundTask` | Compound/multi-phase requests |
| `verifier` / `domainCheck` | Wraps `VerificationLoop` / `DomainVerifier` (shared `VerificationPrompt` pattern) |
| `replanner` | Re-classify or fall back after low confidence / failure |
| `confirmationPause` | Parks the run; state persisted per conversation (P5) |
| `memoryWrite` | Post-run memory update |
| `responder` | Synthesizes the final user-facing answer |

## 5. Edges / transitions

| From | Condition | To |
|---|---|---|
| `start` | always | `contextResolve` |
| `contextResolve` | always | `memoryRead` |
| `memoryRead` | always | `planner` |
| `planner` | always | `router` |
| `router` | `plan.intent` | matching specialist node |
| `'*'` (fallback) | `needsConfirmation` or `outcome === 'ask_user'` | `confirmationPause` |
| `'*'` | `outcome === 'retry'` | same node (bounded by `retryCount`) |
| `'*'` | `outcome === 'fallback'` or `lastError` | `replanner` |
| `'*'` | otherwise | `responder` |
| `replanner` | `context.fallbackUsed` | `router` (re-dispatch) |
| `replanner` | else | `responder` |
| `confirmationPause` | `confirmationPayload.resolved` | `context.resumeNode` (exact paused node) |
| `confirmationPause` | otherwise | `end` |
| `responder` | always | `end` (terminal) |
| `codePipeline` | `context.code.done` | `responder` |
| `codePipeline` | else | `debugger` |
| `debugger` | `runSuccess` | `qaGate` |
| `debugger` | `debugAttempts >= MAX_DEBUG_ATTEMPTS` | `qaGate` |
| `debugger` | else | `debugger` (run → fix → rerun cycle) |
| `qaGate` | `qaVerdict === 'NEEDS FIX'` ∧ rounds < 1 ∧ `!debugAsk` | `debugger` |
| `qaGate` | else | `reviewShip` |
| `reviewShip` | always | `shipper` |
| `shipper` | always | `responder` |

## 6. Confirmation-resume (P5)

- When any node needs approval it sets `needsConfirmation` +
  `confirmationPayload` (`outcome: 'ask_user'`); the `'*'` edge parks the run at
  `confirmationPause`.
- `server/index.js` persists the **full `RunState`** under the conversation ID in
  `server/src/services/SessionStore.js` (an in-memory `Map` — the documented
  future upgrade is a Redis/durable store if multi-instance deployment is ever
  needed).
- On "yes", `/api/chat` calls `executePlan` with `opts.startNode` = the paused
  node and the restored state; `GraphRunner.run` honors `startNode` and resets
  `status`, so execution resumes **at the exact paused node with all prior
  intermediate results intact** — never by re-running `planner`.
- On "no" or timeout the stored run is cleared for that conversation ID.
- `SessionStore` is keyed per conversation, so concurrent chats cannot cross-talk
  (tested in P9).

## 7. MCP as an internal capability (P7)

- `server/mcp-server.js` still exposes the external `ask_jexi` endpoint, but the
  tool registry is now named handlers with an exported `callMcpTool(tool, args)`.
- The internal `ToolRegistry` has a schema-validated **`mcp-call`** tool
  (`{ tool, args }` → `{ result }`), so any graph node calls an external MCP tool
  through `executeTool` — the same validated path as internal tools.
- **To add another MCP capability:** add a handler in `mcp-server.js`'s registry
  (it becomes callable externally), then either call `callMcpTool` directly from
  a node or rely on `mcp-call` with the tool slug. No other wiring is needed.

## 8. Where the old architecture went

- `Orchestrator.executePlan` no longer contains a `switch` on intent — dispatch
  lives in the `router` node, execution in the graph, cycles in the edges.
- The module-level `pendingTask` singleton is removed; `SessionStore` replaced it
  (grep-verified, P9).
- Regex classification is a fast-path/fallback, not the primary decision path
  (P2).
- Every verifier call site shares one structured `{ verdict, issues, revised }`
  prompt pattern via `server/src/services/VerificationPrompt.js`.
