# M13 — Native JEXI TUI

The terminal interface for JEXI OS. It drives the **real** agent engine over the
local backend's NDJSON `/api/chat` stream. Nothing is faked: no canned rows, no
invented progress, no bypass of the engine's permission/risk/approval gates.

## What already existed (reused, not rewritten)

`interfaces/cli/` is a zero-dependency Node client to a local backend
(`127.0.0.1:<port>`, `server/index.js`). A substantial TUI already shipped:

| Module | Responsibility |
|---|---|
| `jexi.js` | CLI entrypoint: `init`, `tui`, one-shot, `run`, doctor, backend lifecycle |
| `lib/backend.js` | spawn/adopt the local backend, port + workspace wiring |
| `lib/api.js` | `JexiApi`: health, providers, NDJSON `chatStream`, secrets, missions |
| `lib/tui/app.js` | raw terminal: alt screen, key decoding, resize, streaming turn, writer |
| `lib/tui/rows.js` | wire event → row mapping (accepts both the flat chat vocabulary and the Phase-16 console taxonomy) |
| `lib/tui/transcript.js` | pure reducer: streaming append, tool rows updated in place by id, stats |
| `lib/tui/render.js` | pure frame composition (header / transcript / composer / status) |
| `lib/tui/ansi.js` | width/wrap/truncate/paint; palette already coral/ember/peach |
| `test-tui.js` | 40+ offline checks (ansi, rows, reducer, frame math, key decoding, headless loop) |

M13 therefore **extends** the existing TUI. It does not duplicate it.

## Architecture (separation of concerns)

```
stdin ──▶ readKeys (app.js)        raw key decoding, never a second consumer
            │
            ▼
        commands.js                pure slash-command parser + registry
            │
            ▼
        app.js                     control flow: turn lifecycle, approvals,
            │                      session switching, cancellation
            ├──▶ api.js            HTTP/NDJSON to the real backend
            │       │
            │       ▼
            │   server/index.js    the real engine (AgentLoop, ToolRuntime,
            │                      RiskGuard, permissions, memory, skills)
            ▼
        transcript.js              pure reducer  ──▶  render.js (pure)  ──▶ writer
            ▲
        rows.js + redact.js        wire → row, secrets redacted at the boundary
```

UI rendering, input handling, session management and engine communication are
separate modules. Every one except `app.js` is pure and testable without a TTY.

## What M13 adds

1. **`commands.js`** — a parser + registry for the full command set:
   `/help /clear /new /resume /model /tools /skills /memory /status /exit`
   plus `/doctor /permissions /approve /deny /cancel`. Local commands never
   touch the backend; backend commands read real endpoints.
2. **`redact.js`** — secret redaction applied at the transcript boundary:
   every event, local notice and list item is scrubbed before it is stored, so
   nothing sensitive ever reaches a row. GitHub tokens, `sk-` keys, AWS ids,
   bearer headers, URL credentials and PEM blocks are replaced with
   `[redacted]`.
3. **New `api.js` methods** — `tools`, `toolsUnified`, `skills`, `memory`,
   `health`, `sessions`, `conversation`, `permissions`, `setPermissions`,
   `providersCatalog`, `setSession`. All read real endpoints that already exist.
4. **`app.js`** — wires the commands, session resume (real conversation replay
   via `x-jexi-session`), an approval prompt that submits the engine's own
   `yes`/`no` confirmation, input history, and `Ctrl+C` cancel.
   The key loop is a **key pump**: stdin is read continuously into an inbox and
   a chat turn runs *detached* from it, so keys are processed during a
   streaming turn. This is what makes mid-turn cancellation real — the earlier
   loop awaited the whole turn before reading the next key, so `Ctrl+C` during
   a turn did nothing. `runTui` awaits any in-flight turn before teardown, so
   the answer is never truncated by exiting.
5. **`rows.js` / `render.js`** — an `approval` row for the engine's real
   `approvalRequired` / `paused` / `declined` tool results; a `list` row for
   `/resume`, `/tools`, `/skills`, `/memory`, `/status` output.
6. **`bench-tui.mjs`** — a benchmark driver that runs tasks **through the TUI
   loop** (`runTui` headless with a scripted input stream), never through a
   private API path.

## Non-goals / preserved behaviour

- `jexi "task"`, `jexi run`, `jexi missions`, the web console and the HTTP API
  are unchanged. The TUI is one more client of the same engine.
- No paid dependency is added. `interfaces/cli` stays zero-dependency.
- Permission, RiskGuard and approval gates are untouched: the TUI can only
  *ask*, the engine still decides.

## Testing

- `test-tui.js` — extended with commands, redaction, approval, resume and
  narrow-terminal checks (offline, no backend).
- `server/tests/agi/test-tui-engine.js` — an integration suite that boots the
  real backend against a **controlled local provider** (a mock
  OpenAI-compatible server on `127.0.0.1`) and drives a turn through the TUI's
  own `JexiApi` + transcript, proving streaming, tool events and the terminal
  event reach the interface.
