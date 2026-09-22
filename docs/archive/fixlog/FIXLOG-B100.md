# FIXLOG-B100 — Compaction + Spill (DeepSeek Harness `compaction-basic` + `spill-local`/`spill-policy` mirror)

**Phase:** B100 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
DeepSeek Harness never lets context grow unbounded:
- **Compaction** (`compaction-basic`) — when a session's history crosses a token-pressure
  threshold (default 80%), the LLM summarizes the OLDER range into one structured
  checkpoint that replaces it in the surface, keeping the newest tail verbatim
  (`thresholdRatio`/`retainRatio`). The `/compact` command forces it. Shadowed events
  stay replayable; a durable `compaction/start…end` bracket is the lock.
- **Spill** (`spill-local` + `spill-policy`) — oversized tool results are saved to
  private session-scoped files; the model gets a bounded preview + an opaque locator +
  retrieval guidance instead of a giant blob in context.

B100 ports both, exactly on those contracts.

## What was built

### `server/src/services/SpillStore.js` (new — dsh spill-local mirror)
- `saveText({owner, source, suggestedName, content})` → `{locator, bytes, retrievalHint}`;
  files at `DATA_DIR/spills/<owner>/<name>-<ts>.txt` (session-namespaced).
- `readSpill(locator)` — path-safe (`spill://<owner>/<file>.txt` only, traversal refused).
- `listSpills(owner)` metadata + `spillStats`; `SPILL_THRESHOLD` 14k chars.

### Spill policy in ToolRuntime (dsh spill-policy mirror)
- Results whose **uncapped** serialization exceeds the threshold are spilled
  automatically (measured before `formatResult`'s 8k cap — otherwise nothing would ever
  spill); the model receives `[📦 Result spilled — N bytes → spill://…]` + a 2k preview.
- New **`spill-read`** tool (registry 186 → **187**, tier read): pulls the full body by
  locator (capped 30k); never re-spills its own output.

### `server/src/services/CompactionEngine.js` (new — dsh compaction-basic mirror)
- **Pressure**: `conversationPressure` (chars + events + approx tokens),
  `AUTO_COMPACT_THRESHOLD_CHARS` 45k (80% of a ~56k-char budget), `RETAIN_RATIO` 16%
  / `MIN_RETAIN_CHARS` 6k.
- **Cut selection**: retain the newest tail at a clean exchange boundary (the tail
  starts at a user message — a user→JEXI pair is never split; dsh tool-pairing analog).
- **Checkpoint rewrite** (dsh surfaceOp.replace): the log becomes
  `[compaction/start, <checkpoint>, ...tail, compaction/end]`; the checkpoint is a
  user-role event with `meta.op:'replace'` + shadowed range/counts. Markers bracket the
  operation = the durable lock (`compaction/start` without `compaction/end` = crashed
  compaction, detectable); an in-process set + lock file refuse concurrent compactions
  (`busy`).
- **Summarization**: one-shot LLM call with the DSH structured checkpoint contract
  (`<compacted-summary>` with Primary Request and Intent / Key Technical Concepts /
  Files and Code / Errors and Fixes / Pending Jobs / Decisions and Preferences).
  Injectable `summarizer` seam for tests.
- `compactionAwareHistory(convId)` — checkpoint + retained tail for context builders;
  `compactionStatus(convId)`; `maybeCompact` (auto) / `compactNow` (force).

### Integration
- **/api/chat**: `/compact` command (dsh command-compact) → force-compact THIS
  conversation and reply with the checkpoint; **auto-compaction** runs after every
  successful turn (fire-and-forget, non-blocking, streams a `📦 Auto-compacted` log);
  `conversationSummaryContext(convId)` is compaction-aware (checkpoint + last 6 turns).
- **SimpleTask/Orchestrator**: `conversationContext(query, convId)` injects the
  checkpoint + retained tail into coworker prompts; `spillOwner` threads the
  conversation id so spills land in the right namespace.
- **API**: `GET /api/conversations/:id/compact/status`, `POST /api/conversations/:id/compact`,
  `GET /api/spills?owner=`.
- **Frontend (ConversationsScreen)**: **COMPACT** button per conversation, pressure
  line ("43k chars · auto-compacts at 45k"), 📦 COMPACTED CHECKPOINT cards in the event
  log (markers hidden), compaction result message.

### Tests & fixes
- **`test-compaction.js` — 44 checks**: spill store (bytes, locators, traversal
  safety), ToolRuntime spill policy via a gated plugin tool, spill-read through the
  gate, pressure/cut/checkpoint rewrite, marker bracket + lock semantics (busy while
  in flight), compaction-aware history, idempotence, auto path (under → null, over →
  compacts). **44/44 green.**
- Dev debugging caught the recursive-spill footgun (a spill-read result re-spilled
  itself) — excluded, covered by the suite.

## Verification
- `npm test` full sweep (42 suites): **exit 0** · `eslint`: **0 errors**
- audit-roster: 251 agents · 507 skills · **187 tools** · 100% reachable ·
  AGENT-CATALOG.md regenerated
- Frontend esbuild compile OK (real build in CI).

## How the user sees it
Long conversations no longer grow forever: JEXI quietly writes structured checkpoints
of the older turns (visible as 📦 COMPACTED CHECKPOINT cards in Conversations), keeps
the recent tail verbatim, and can resume with full context. Say **/compact** anytime to
force one. Huge tool outputs (big research dumps) get spilled to files and pulled back
only when needed — the model's context stays clean.
