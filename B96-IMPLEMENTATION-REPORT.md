# JEXI OS — DeepSeek Harness Implementation Report (Build 96)

**Aug 17, 2026 · by the Lead Software Engineer**

## What I did (in order)

### 1. Studied DeepSeek Harness's ACTUAL CODE (not just docs)
Cloned `deepseek-ai/deepseek-harness` (138k★) and read the real source:
- **`core/session`** — the append-only `SessionEvent` log (turn/start, step/start,
  tool/call, tool/result, assistant/message…), session **fork** with lineage
  (parentSession + seedLength), session **resume/replay**, versioned format.
- **`core/tools`** — `ToolDefinition`: model-facing schema (allowlisted), mandatory
  **canonical output declaration**, execute() with cancellation signal, per-tool
  timeout, `isConcurrencySafe` for parallel calls, `presentCall/presentResult`.
- **`core/agent-loop`** — the turn/step loop: claim input → assemble prompt+schemas
  → stream → guarded tool execution → durable logging → continue until settled.
- **`session-query` / `tool-session-query`** — the model can SEARCH prior sessions
  (`session_search`) and read event traces.
- **`subagent` / `tool-subagent`** — delegation to child agents with own context,
  foreground or background, depth-bounded, report back.
- **`skill` / `tool-skill`** — skills as files (`SKILL.md`) with provider discovery
  priority (project → user → bundled) + progressive disclosure (list cheap, load on use).
- **`todo`, `plan`, `goal`** — model-managed task lists, plans, objectives.
- **`spill`, `compaction`, `session-persistence`** — memory + context management.
- **Cordis plugin kernel** — everything (models, tools, sessions, loops, UI) is a
  swappable plugin; reversible effects; typed events as extension points.

### 2. Mapped DSH → JEXI (what exists vs what's missing)
**Already matched:** graph+loop engineering, guarded ToolRuntime, event log + Redis
mirror, progressive skills, provider-agnostic routing with health/cooldowns.
**Missing (implemented this build):** append-only conversation logs with fork,
cross-session memory (the model can search its past), subagent delegation tool,
skill-load tool, todo/plan tools, dsh-style step events, conversations UI.

### 3. Implemented (all on `main`, CI green, apk-build-100)

| DSH piece | JEXI implementation |
|---|---|
| `core/session` append-only log | `SessionConversations.js` — `.jsonl` per conversation; /api/chat appends every user msg + JEXI answer |
| session fork (lineage) | `forkConversation()` + `POST /api/conversations/:id/fork` |
| session-query (search prior) | `searchConversations()` + `GET /api/conversations/search` + **`session-search` tool** |
| session list/titles | `GET /api/conversations` (titled by first message) + **`session-list` tool** |
| tool-subagent (delegate) | **`subagent` tool** → `runSubagent()` (child agent, own context, report) |
| tool-skill (progressive) | **`skill-load` tool** → loads skill body into context |
| todo | **`todo` tool** + `TodoStore.js` (persisted) |
| plan | **`plan` tool** + `PlanStore.js` (persisted) |
| step/tool events | AgentLoop now emits **step/start · tool/call · tool/result · step/end**; 10 iterations / 20 tool calls |
| session UI | **Conversations screen** — list/open/search/fork/delete, in the sidebar |

**Tool count: 177 → 184.**

### 4. Tested it myself
- New suite `test-sessions-b96` — **24/24**: append-only log + seq, titles/counts,
  fork lineage + independence, cross-session search, delete, todo CRUD, plan CRUD.
- **24-suite full sweep green** · lint 0 · CI green (caught + fixed: registry count
  assertion, regenerated AGENT-CATALOG.md) · live e2e: chat → conversation logged →
  list/fork/search all verified; `todo` + `session-list` tools execute through the
  gated ToolRuntime.
- Frontend esbuild-clean; APK build green (apk-build-100).

## How JEXI now behaves like DeepSeek Harness
- **Conversations are durable, titled, forkable** — she never forgets a session.
- **The model can remember the past**: `session-search` lets JEXI query every
  conversation she ever had and use what she learned.
- **The model manages its own work**: `todo` + `plan` keep an explicit visible plan;
  `subagent` delegates subtasks; `skill-load` pulls specialized procedures on demand.
- **Every tool call is a durable, observable step** (step/tool events), like dsh's
  append-only session log.

## Next steps (the rest of the DSH map, in order)
1. **Plugin/extension seam** — mount tools/skills/agents as registrable plugins
   (the "everything is a plugin" core). Biggest remaining gap.
2. **Canonical output contracts for ALL 184 tools** + per-tool timeout + cancellation.
3. **Skill auto-discovery** from project dirs (`.jexi/skills`) with watch/invalidate.
4. **Session resume/fork from the UI** (pick up any conversation in the chat itself).
5. **Code-mode (PTC)** — model emits one program that runs in a sandbox.
6. **Compaction/spill** — dsh-style context management for very long sessions.
