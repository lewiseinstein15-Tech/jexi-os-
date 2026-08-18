# FIXLOG B136 — "Pull all, replace with JEXI": the next DSH packages, JEXI-branded

**Date:** 2026-08-18 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

The user said **"Pull all"** and **"replace with JEXI"** — keep porting every
DeepSeek Harness package AND brand everything JEXI (`dsh` → `jexi` in every
user-facing name, log line, and module doc). This batch lands nine more DSH
packages + one latent-bug fix, all named and labelled JEXI.

---

## What landed

### 1. `session/session-projection` (+`session-projection-cache`) → `SessionProjection.js`
- Char-budgeted projection of a conversation log: newest-first view, explicit
  `dropped` count + marker so the model knows it sees a projection, stable
  `stateVersion` (last seq).
- Cache (10 s TTL) invalidated on every append — the hot chat path never
  re-reads the log twice.
- Wired into the chat history (`conversationSummaryContext`): every answer's
  context now carries the projected conversation block.
- `GET /api/sessions/:conv/projection`, `GET /api/projection/cache`.

### 2. `context/agent-instructions` → `AgentInstructions.js`
- **AGENTS.md support** (the file DSH ships as its workspace-instruction
  format): discovery (root + nested, depth ≤ 3, `~/.jexi/AGENTS.md`),
  sha256 digests, bounded prompt rendering (8 KB budget, truncation notes),
  and a seen-state store — only genuinely NEW instruction versions re-enter
  the context.
- Rendered as a **-55 project-instructions section** in PromptAssembly
  (marked seen on render); fs tools that touch a nested AGENTS.md mark it
  seen (inbox reconciliation).
- `GET /api/project/instructions`, `POST /api/project/instructions/seen`.

### 3. `fs/fs-sandbox` → `FsSandbox.js`
- In-process filesystem containment: lexical fast path + filesystem-identity
  (dev/ino) fallback for alias spellings; **fail-closed** — writes outside
  the workspace are refused, never silently allowed.
- Mode gates: read-only → no writes, no outside reads; workspace-write →
  writes inside only; danger-full-access → everything (approval gates stay).
- Wired into the coding plugin's `write`/`read`/`edit` tools (per-session
  sandbox mode from the conversation log).
- `GET /api/sandbox/fs-probe?op=&path=&mode=`.

### 4. `shell/shell-env` → `ShellEnv.js`
- The canonical scrubbed shell environment: parent env minus secrets by name
  pattern AND value shape (long high-entropy blobs, `sk-…`, `ghp_…`,
  `github_pat_…`, `AIza…`), plus JEXI identity vars (`JEXI_WORKSPACE`,
  `JEXI_DATA_DIR`, `JEXI_SESSION`, `JEXI_SHELL`).
- Wired into persistent bash + terminal sessions (their spawn env is now
  scrubbed).

### 5. `subprocess/subprocess-local` → `SubprocessLocal.js`
- Managed process-tree provider: scrubbed env, bounded output tail, tree-
  scoped SIGTERM → SIGKILL escalation (POSIX groups / taskkill /T /F), honest
  spawn failures, timeout ladder.
- `GET /api/subprocess`, `DELETE /api/subprocess/:id`.

### 6. `workspace/workspace` → `WorkspaceEntity.js`
- The single workspace entity: `.jexi/workspace.json` with id/name/createdAt/
  updatedAt/roots/sessions, durable mutations with one-stamp updatedAt,
  canonical `pathInWorkspace` containment.
- Entity created at boot; every chat conversation is attached to it.
- `GET|PUT /api/workspace/entity`.

### 7. `boot/app-boot` (profile + config-dump) → `BootProfile.js`
- Durable boot profile under DATA_DIR (node/platform/phase/commit/feature
  flags/env NAMES only — never values) + a config dump that strips secrets.
- `GET /api/boot/profile`, `GET /api/boot/config`.

### 8. `bundle/headless` → `server/cli.js` (JEXI headless CLI)
- Run JEXI without the server: `node cli.js "<question>"` routes through the
  SAME Planner → AgentLoop pipeline as the web app; `--conv <id>` continues a
  conversation; `--json` machine output; `--self-test` runs offline
  determinism checks (registry, plugins, fs sandbox fail-closed, projection,
  instructions); `--list` built-in commands. Exit codes 0/1/2.

### 9. `host/plugin-inventory` → `PluginInventory.js`
- The "what is actually running" surface: plugins with per-plugin tool/skill
  counts, the merged registry ∪ plugin tool list with origin tags, skill
  list, totals.
- `GET /api/plugins/inventory`.

### Latent bug fixed: PluginContext `_plugin` stamp
`loadPlugins` counted `t._plugin === name` but nothing ever stamped it — every
plugin showed 0 tools. `register()` now stamps the current plugin name onto
tools/skills (set/cleared around `apply()`), so per-plugin counts are real
(verified live: `coding: 5 tools, 1 skill`).

## Verification
- `npm test` (Node 22) — **exit 0, 67 suites green**, incl. new
  `test-dsh-batch5.js` (10 sections, ~90 checks: projection budget/cache/
  invalidation, AGENTS.md discovery/digest/render/seen-state, fs containment
  lexical+identity+mode gates, shell-env scrubbing, subprocess spawn/kill/
  timeout, workspace entity, boot profile, CLI self-test 7/7, inventory).
- Registry stays **206 tools** (no new registry tools — this batch is
  services + seams, exactly like DSH).
- `AGENT-CATALOG.md` regenerated: **252 agents · 508 skills · 206 tools ·
  100% reachable** (audit PASSED).
- `eslint` — 0 errors on all new/changed files.
- Boot smoke test: all 10 new endpoints live (boot profile, config dump,
  workspace entity, inventory, instructions, projection cache, subprocess,
  fs-probe fail-closed on `/etc/passwd`).

## Still on the map (next "Pull all")
`ui-*` frontends · `typert` editor · `client/` modules · `examples/` ·
`test-support` · `subagent-*` providers (claude-code/codex/dsh-sdk) ·
`session-projection` wire cells/React hooks · `fs` fence for bash `cd`
escapes · `preset/persona` flavors · `schedule` runtime · `interaction`
permission presets · `host/webserver` + `frontend-static` · `api/gateway` ·
`code-runtime` worker bootstrap hardening · `context` composition seams ·
`guard` invariants · `credentials` UI · `boot` HMR/config-reload.
