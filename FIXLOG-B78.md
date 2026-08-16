# FIXLOG-B78 — Event-sourced logging + token-threshold compaction + filesystem-native coworkers

**Date:** 2026-08-16

## User request
Two architecture upgrades borrowed from Google Antigravity Managed Agents
(lighter versions, no sandbox provisioning): (1) an event-sourced log replaces
the flat `chatHistory` as the source of truth, (2) context compaction switches
from a fixed 28-turn counter to a token-threshold trigger, (3) coworker
roles/personas move out of composite prompts into filesystem-native definitions
under `/jexi-agents/`.

---

## 1. Event-sourced logging — `server/src/services/EventLog.js` (new)

Every meaningful thing is a structured, ordered event: `user_message`,
`orchestrator_decision`, `coworker_call`, `coworker_result`, `tool_call`,
`tool_result`, `context_compaction`, `error`. Each event carries
`{ ts, type, session, payload }`; the log is append-only, per-session capped
(500/session, 3,000 global), payloads sanitized (strings ≤ 4,000 chars, arrays
25 × 200) so it stays lean and never stores raw keys.

**Persistence — same Redis-backed mechanism as the memory core, not a second
system.** `EventLog` reuses `MemoryManager.getRedis()` and the exact
file + Redis-mirror pattern (`server/data/events.json` + `jexi:events` with the
same 30-day TTL). Boot-time `hydrateEventLogFromRedis()` (wired in `index.js`)
restores the log after a redeploy; `getRedis()` is now exported from
MemoryManager for this purpose.

**Debug endpoint — `GET /api/events?session=X&limit=50&type=…`** (in
`server/index.js`): read-only, sanitized, GET-open like the connector inbound
log, returns `{ ok, count, events, stats }`.

**Who writes events:**
| Event type | Written by |
|---|---|
| `user_message` | `/api/chat` (via `ChatEventLogger.js` middleware — records the real query, source: chat, keyed by conversation), `/api/agent` (source: agent), connector webhooks (source: email with the **creator flag**, source: github_webhook) |
| `orchestrator_decision` | `SimpleTask.js` (SIMPLE path: complexity + reason + coworker + coworker file) |
| `coworker_call` / `coworker_result` | `WorkerRouter.runWorker` — every provider attempt + the outcome (ok / fell back / failed), with the attempt trail |
| `tool_call` / `tool_result` | `ToolRuntime.executeTool` wrapper — real slug, args, tier, gated outcome, duration |
| `context_compaction` | `MemoryManager.rollingConversationSummary` (see §2) |
| `error` | chat failures + the 15-min deadline (via the middleware, which watches the NDJSON stream and logs what was actually emitted), `/api/agent` catch, `runWorker` total-failure path (component `worker:<role>`, fallback info) |

## 2. Token-threshold compaction — `MemoryManager.js`

The fixed `SUMMARY_THRESHOLD = 28` counter is gone. The trigger is now the
**estimated token size of the running context** (summary + every chat turn,
~4 chars/token): compact only when it crosses the ceiling.

- Default ceiling **110,000 estimated tokens** (inside the 100k–135k band the
  models in use handle well), override with `JEXI_COMPACTION_TOKENS`.
- A short but frequent chat no longer compacts too early (it never crosses the
  ceiling); a few very long/dense turns blow past the ceiling and compact
  BEFORE they exceed what the models can take.
- Every compaction appends a `context_compaction` event: trigger
  (token_threshold | manual), threshold, the real token estimate, how many
  turns were compressed, summary length, and the reason.
- New `estimateTokens()` export; test seam `__generate` (same contract as
  `generateContent`) so tests fire real compactions without network/keys.

## 3. Filesystem-native coworker definitions — `/jexi-agents/` + `CoworkerFiles.js` (new)

```
jexi-agents/
  ORCHESTRATOR.md            ← core rules: complexity judgment, routing, truthfulness
  coworkers/
    coding.md                ← coder mandate (DeepSeek → Qwen fallback)
    memory.md                ← memory mandate (Gemini + Qwen pairing)
    research.md              ← researcher mandate (Grok + fallbacks)
    email.md                 ← email mandate (creator recognition, tone)
    github.md                ← github mandate (file operations allowed)
```

Each file has YAML frontmatter (`name`, `description`, `models`) + a mandate
body. `CoworkerFiles.js` (`parseFrontmatter`, `loadCoworker`, `loadOrchestrator`,
`orchestratorPromptFragment`, `listCoworkers`) reads the assigned coworker's
file AT the routing point — no composite prompt stuffing, no cache, a live edit
is picked up immediately, and one file's edit never leaks into another
(proven below). The orchestrator rules are appended to every coworker run.

**Wired into:**
- `SimpleTask.js` (SIMPLE path) — loads the coworker mandate, announces the
  file in the log event, appends the rules + mandate to the system prompt.
- `Orchestrator.js` — the github node loads `coworkers/github.md` and announces
  its operating rules at routing time.
- `jexi-agents/` dir overridable via `JEXI_AGENTS_DIR` (test seam).

---

## Verification (real output)

### New B78 suite — `cd server && node test-b78.js` → 45 passed, 0 failed
```
== B78 — EVENT LOG ==
  ✅ all 8 event types appended and read back
  ✅ every event has ts/type/session/payload
  ✅ events come back in TRUE order (oldest → newest)
  ✅ session filter isolates sessions  ✅ type filter works  ✅ limit works
  ✅ unknown event type is rejected (store unchanged)
  ✅ long strings capped at 4000 chars; arrays capped at 25 × 200
  ✅ per-session ceiling enforced (got 500)
  ✅ hydrateEventLogFromRedis() no-ops cleanly without REDIS_URL

== B78 — COWORKER FILES ==
  ✅ all five coworkers present + listed (coder, memory, researcher, email, github)
  ✅ every coworker file has name + description + models[] + body
  ✅ ORCHESTRATOR.md loads with a body; fragment reaches every coworker run
  ✅ coding.md edit is picked up by the coder definition
  ✅ the same edit does NOT leak into email.md (one file = one coworker)

== B78 — TOKEN-THRESHOLD COMPACTION (fresh process, 2,000-token ceiling) ==
  ✅ short chat: no summary, LLM seam NEVER called, zero events (no early compaction)
  ✅ long chat: exactly one context_compaction event; summary generated
  ✅ event trigger=token_threshold, threshold=2000, estimatedTokens=2310, turnsCompressed=28
  ✅ force:true compacts regardless of size, logged trigger=manual

== B78 — RUNTIME WIRING ==
  ✅ runWorker logs coworker_call (coworker+provider) + coworker_result ok:true
  ✅ runSimpleTask logs orchestrator_decision SIMPLE + coworker + coworker file
  ✅ executeTool logs tool_call + tool_result with the real slug + outcome
```

### Full suite — `cd server && npm test` → EXIT=0, 0 ❌ (all 50 suites incl. the new one)
### Frontend — `npm run build` → ✓ built in 22.95s

## Notes
- Chat `user_message` + terminal `error` events are recorded by a small
  middleware (`ChatEventLogger.js`) mounted after `express.json()`: it logs
  what the NDJSON stream ACTUALLY emitted, so a deadline or degraded failure
  becomes a real `error` event with the fallback noted — never fabricated.
- The inbound email webhook now also logs `user_message` events with
  `creator: true` when the sender is `lewiseinstein15@gmail.com` — the same
  recognition the reply loop uses; it never bypasses safety/approval gates.
