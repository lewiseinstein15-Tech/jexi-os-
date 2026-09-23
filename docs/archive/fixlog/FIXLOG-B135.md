# FIXLOG B135 — "Pull all" batch 4: the remaining DeepSeek Harness packages

**Date:** 2026-08-18 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

The user said **"Pull all"** — keep porting every DeepSeek Harness package until
nothing is left. This batch lands the remaining DSH packages in one sweep,
mirroring each package's real contracts (validators, fail-closed rules, event
shapes) rather than loose approximations.

---

## What landed

### 1. `util/home-paths` → `server/src/services/HomePaths.js`
- Single JEXI home root: explicit path → `$JEXI_HOME` → `~/.jexi`
  (blank `$JEXI_HOME` treated as unset — never resolves to cwd).
- Tilde expansion, symbolic display (`~/.jexi` / `$JEXI_HOME`),
  `canonicalizeWatchPath` (deepest-existing-ancestor realpath).

### 2. `util/launch-environment` → `server/src/services/LaunchEnvironment.js`
- Immutable boot snapshot: `process` > project `.env` > JEXI-home `.env`,
  `get(name)` + `getFrom(name, sources)` with canonical trust order.
- Filled at boot (`[launch-environment] ✓ snapshot ready`), fallback to a
  process-only snapshot for tests/compositions.

### 3. `settings/settings-file` → `server/src/services/SettingsFile.js`
- ONE JSON or YAML document (`DATA_DIR/settings.yaml`) carries every namespace
  section; atomic whole-file rewrites; leaf-level patches.
- YAML subset parser (nested maps + block scalar lists) — no native deps.
- Hot-publishes external edits via a poll watcher.
- Endpoints: `GET/PUT /api/settings/file`.

### 4. `storage/storage-json` + `storage-sqlite` → `server/src/services/StorageHub.js`
- `json` backend: one human-readable `<unit>.json` per unit, atomic rewrite,
  version stamps. `sqlite` backend: one DB file (WAL), document-per-row.
- Unit-name validation (`^[a-z0-9][a-z0-9._-]{0,63}$`), **single live handle
  per unit** (double-open = caller bug), fail-closed after `close()`.
- Endpoints: `GET /api/storage`, `GET|PUT|DELETE /api/storage/:unit`
  (GET uses a handle-free `peek` so the REST layer never trips the contract).

### 5. `session/session-persistence-sqlite` → `server/src/services/SessionPersistenceSqlite.js`
- SQLite mirror of the append-only session log (`sessions` + `session_events`
  tables, WAL, batched writes ~150 ms, torn-tail heal at boot).
- Wired through a new `onConversationEvent()` observer on
  `appendConversationEvent` — every writer (chat, plan mode, sandbox events,
  lifecycle) is mirrored with ZERO call-site churn.
- `GET /api/session-persistence` reports backend/rows/journal mode.

### 6. `shell/tool-bash-persistent` → `server/src/services/BashPersistent.js`
- **`bash` is now PERSISTENT** (dsh tool-bash-persistent): one long-running
  interactive shell per CONVERSATION (owner = convId, threaded through the
  plugin-handler meta) — cwd + exported env survive across calls.
- DSH marker protocol: `printf START; eval -- <quoted>; status=$?; printf END:`
  with last-occurrence status parsing (interactive shells echo the input line
  back — the parser accepts only the real `<digits><newline>` marker suffix).
- DSH notes verbatim: `<response clipped>`, lost-prefix note, shell-reset
  note, `PERSISTENT_BASH_TIMEOUT` (command left running, drainable).
- Truncation at the plugin's 12 000-char budget; `reset` arg; shell eviction.

### 7. `hooks/hooks-codex` + `hooks-claude-code` → `server/src/services/HookBridges.js`
- Bridges for UNMODIFIED Codex `hooks.json` and Claude Code hooks configs:
  PreToolUse / PostToolUse / SessionStart / UserPromptSubmit / Stop (+
  SubagentStart/Stop for CC). Command hooks only; async/non-command hooks are
  skipped with a reason, never silently run.
- Dialect fidelity: Codex = snake_case payloads, no substitution, exit-2
  blocking; Claude Code = camelCase payloads, `${CLAUDE_PLUGIN_ROOT}` /
  `${CLAUDE_PROJECT_DIR}` substitution, JSON `decision` + exit-2 blocking,
  `CLAUDE_PROJECT_DIR` exported.
- Regex matchers validated at load (invalid regex rejects the config);
  **only blocking decisions are honored — everything else is recorded**;
  fail-open (a hook that errors/times out never blocks JEXI).
- Wired into ToolRuntime (Pre/PostToolUse around every engine call) and the
  chat route (SessionStart once per conversation, UserPromptSubmit, Stop).
  Config: `DATA_DIR/hooks.codex.json`, `DATA_DIR/hooks.claude.json`.
- `GET /api/hooks/bridges`.

### 8. `workflow/tool-ralph` → `server/src/services/RalphRunner.js` + registry tool `ralph`
- Foreground fresh-agent loop: ONE immutable objective, a FRESH structured
  child per round, bounded structured handoff (16 KB default).
- Exact DSH report validation: normalized strings; continue needs nextSteps +
  empty blocker; complete needs evidence + no nextSteps + empty blocker;
  blocked needs a concrete blocker; oversize handoff rejected.
- Terminal statuses: `complete | blocked | budget-limited | round-failed`;
  deployment ceiling 64 rounds (default 12) to protect the free tier.
- `ralph` registered in TOOL_REGISTRY (**registry 205 → 206**), with argument
  schema, output contract, and a provider-injection test seam (roundFn).

### 9. `mcp/mcp-client` → `server/src/services/McpClient.js`
- JEXI now CONNECTS OUT to external MCP servers (stdio child or Streamable
  HTTP/SSE) via `@modelcontextprotocol/sdk` Client.
- Tools registered on the plugin seam under DSH-qualified public names
  `mcp__<serverName>__<rawName>` → they pass the SAME gates as built-ins.
- serverName pattern `[A-Za-z0-9_-]{1,32}`, one live instance per namespace
  (duplicates rejected, no silent shadowing), per-call timeout, capped
  exponential-backoff reconnect, `failOnStartupError`.
- Config: `DATA_DIR/mcp.json`; endpoints `GET|POST /api/mcp/servers`,
  `DELETE /api/mcp/servers/:serverName`.

### 10. `sandbox/sandbox-local` + `e2b` → `server/src/services/SandboxLocal.js`
- Confinement probe (once per lifetime): detects usable `bwrap` on Linux and
  **fails closed** — when no OS runner exists, enforcement is reported as the
  in-process ToolRuntime/SandboxMode fence (never pretend confinement).
- Per-session PRIVATE temp dirs (`DATA_DIR/sandbox-tmp/sess-<id>`), separate
  per conversation, age/count reaping, revocable.
- `GET /api/sandbox` (enforcement facts + temp dirs),
  `GET|DELETE /api/sandbox/tmp/:conv`.

### Bonus hardening
- **ToolRuntime P8 failure envelope** now carries the structured engine result
  (`result`, real exit `code`) — the model sees actual bash output/exit codes
  on failure (dsh presentResult parity).
- **Weather plugin resilience**: `weather-now` falls back to open-meteo
  (geocoding + forecast) when wttr.in is unreachable — same free/no-key model,
  provider field added.
- `runEngine` now receives `spillOwner`, so per-conversation ownership
  (persistent bash, ralph, pending questions) is truly per-conversation.

## Verification
- `npm test` (Node 22) — **exit 0, 67 suites green** (incl. new
  `test-dsh-batch4.js` — 11 sections, ~120 checks).
- Registry count assertions updated **205 → 206** (test-tools, test-b49,
  test-tool-contracts, test-plugins-all, test-plan-mode, test-dsh-batch,
  test-gaps-b106, test-lsp, test-marketplace, test-workflow).
- `AGENT-CATALOG.md` regenerated: **252 agents · 508 skills · 206 tools ·
  100% reachable** (audit-roster PASSED, zero orphans/dangling refs).
- `eslint` — 0 errors.
- Boot smoke test: launch-environment, settings-file, sqlite mirror, storage
  (json+sqlite), sandbox facts, hooks bridges, mcp servers all live.

## Still on the map (remaining DSH packages, next "Pull all")
`ui-*` frontends, `typert` editor, `bundle` headless, `boot` app-boot/cmdline,
`client/` modules, `examples/`, `test-support`, `session-projection*`,
`subagent-*` providers (claude-code/codex/dsh-sdk), `fs-sandbox`,
`shell-env`, `subprocess-*`, `guard`, `preset` runtime wiring, `schedule`,
`interaction`, `api`, `host`, `code-runtime`, `workspace`, `context`.
