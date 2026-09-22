# FIXLOG B138 — "Pull all": external subagent providers, code-runtime hardening, config reload, remote agents, tmux context, typing protocol, permission UI

**Date:** 2026-08-18 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

---

## What landed

### 1. `subagent/subagent-claude-code` + `subagent-codex` + `subagent-acp` + `subagent-dsh-sdk` → `SubagentProviders.js`
- JEXI can now delegate a task to a REAL external CLI agent when installed:
  `claude -p <task> --output-format text`, `codex exec <task>`, `acp <task>`;
  `dsh-sdk` and `in-process` stay in-process.
- **Fail-open**: missing binary → honest availability error, never a crash.
  Output bounded (64 KB), scrubbed env (no secrets to the child), tree-kill
  on timeout.
- **`subagent` tool gained a `provider` arg** — the model chooses the provider;
  unknown/empty falls back to in-process.
- `GET /api/subagent/providers` (availability status).

### 2. `code-runtime/code-runtime-worker-thread` (bootstrap/output-json/protocol) → `CodeRuntimeBootstrap.js`
- Strict JSON-only snapshots (rejects BigInt, circular refs, functions),
  UTF-8 byte budgets with an explicit truncation note, worker protocol-message
  validation (start/log/output-limit/done/error) — malformed frames fail
  closed, and an offline `workerBootstrapSelfCheck()` (used by the headless
  CLI `--self-test`).
- `GET /api/code-runtime/bootstrap`.

### 3. `boot/app-boot` (config-reload) → `ConfigReload.js`
- Boot-config hot reload: env + settings fold into one snapshot; settings-file
  changes re-fold it and notify subscribers; reloads that change nothing emit
  no events (timestamps excluded from the diff).
- Wired at boot: settingsFileStore changes → `reloadConfig()`.
- `GET /api/config`, `POST /api/config/reload`.

### 4. `api/remotes` (agent-lookup + remote-events) → `RemoteAgents.js`
- Registered remote JEXI agents (`user@host` handles) in
  `DATA_DIR/remotes.json`; lookup resolves handle → { agent, url, enabled }.
- `GET|PUT /api/remotes`, `DELETE /api/remotes/:handle`,
  `GET /api/remotes/lookup/:handle`.

### 5. `context/tmux-context` → `TmuxContext.js`
- When JEXI runs inside tmux, the assembled prompt gains a small terminal
  context block; outside tmux it is never injected.
- `GET /api/tmux`.

### 6. `typert/protocol` → `TypingProtocol.js`
- JEXI's editor wire protocol: validated messages (open/insert/delete/
  cursor/close) + pure `applyTypingOp`/`applyTypingScript` buffer
  transformations with bounded positions.
- `POST /api/typing/validate`, `POST /api/typing/apply`.

### 7. `ui-permission-presets` (frontend) → `SettingsPanel.jsx`
- New PERMISSION PRESETS card: current preset badge, all four bundles
  (Assistant / Autonomous / Sandboxed / Full Access) with one-tap apply via
  `/api/permissions`, live sandbox + approval readout.

## Verification
- `npm test` — **exit 0, 67 suites green**, incl. new `test-dsh-batch7.js`
  (~65 checks: fake-CLI provider runs, honest missing-binary failures,
  bootstrap self-checks, config diff determinism ×3 runs, remotes CRUD +
  lookup, tmux env detection, typing protocol pure ops, tool provider
  routing, frontend panel presence).
- Registry stays **207 tools** (no new registry tools — this batch is
  providers + seams, like DSH).
- `AGENT-CATALOG.md` regenerated: **252 agents · 508 skills · 207 tools ·
  100% reachable**.
- `eslint` — 0 errors, 0 warnings in new files; frontend JSX verified with
  esbuild (CI builds the real bundle).
- Boot smoke test: providers list, config snapshot/reload, remotes CRUD,
  tmux status, bootstrap checks, typing validate/apply all live.
