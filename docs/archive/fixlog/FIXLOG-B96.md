# FIXLOG-B96.md — DeepSeek-Harness-Style Session Model + Agent Tools

Build 96 (Aug 17, 2026) — first concrete implementation from the DeepSeek
Harness study (DEEPSEEK-HARNESS-REPORT.md).

## What was added (mapped 1:1 from dsh's architecture)

### 1. Conversations = append-only session logs (dsh core/session + session-query)
- New `SessionConversations.js`: every conversation is an append-only
  **.jsonl event log** (DATA_DIR/conversations/<id>.jsonl) — seq, at, role,
  text. /api/chat appends every user message AND JEXI's answer.
- `listConversations()` — titled by the FIRST user message (dsh title),
  message counts, lastActive.
- `forkConversation()` — dsh's session fork: seed a NEW conversation from an
  existing one with lineage (parentSession + seedLength).
- `searchConversations()` — full-text search across EVERY past conversation.
- API: GET /api/conversations · GET /:id · POST /:id/fork · DELETE /:id ·
  GET /search.

### 2. Model-facing tools (dsh tool-session-query / tool-subagent / tool-skill / todo / plan)
Registered in the ToolRegistry + engines in ToolRuntime:
- **session-list** — list all past conversations (titles, counts, activity).
- **session-search** — search all past conversations; JEXI can remember what
  she did before (dsh's session_search).
- **session-fork** — fork the current conversation.
- **subagent** — delegate a sub-task to a child agent with its own context
  (dsh tool-subagent; `runSubagent` added to SubagentRuntime).
- **skill-load** — load a skill body into context, progressive disclosure
  (dsh tool-skill).
- **todo** — model-managed visible task list (dsh todo/write), persisted.
- **plan** — explicit multi-step plan with per-step status (dsh plan),
  persisted.

### 3. Agent loop upgraded to dsh's step model
- MAX_ITERATIONS 4 → 10, MAX_TOOL_CALLS 8 → 20 (rate limiter protects free
  tiers).
- Emits dsh-style events on the wire: step/start, tool/call, tool/result,
  step/end — every tool call is observable per step.

### 4. Frontend — Conversations screen
- New **ConversationsScreen**: list every past conversation (titled), open
  any one to read its full log, SEARCH across all, FORK with lineage,
  DELETE. Wired into the sidebar (SYSTEM → Conversations).

## Verification
- New suite test-sessions-b96 (24/24, isolated temp DATA_DIR): append-only
  log, seq, titles/counts, fork lineage + independence, cross-session search,
  delete, todo CRUD, plan CRUD.
- Full 24-suite sweep green · lint 0 · live e2e: chat → conversation logged →
  list/fork/search all work; todo + session-list tools execute through the
  gated ToolRuntime.
