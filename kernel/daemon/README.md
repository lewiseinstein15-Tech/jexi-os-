# Codegraph Coordination Daemon (Phase 11 Scope C)

A CBM-style coordination daemon: one shared background process that owns code
graph index jobs and file watchers for ALL agent sessions, with per-session
registration, an admission barrier, and crash recovery from a documented
cache dir. Real process — TCP on 127.0.0.1, endpoint published in the cache
dir. Index jobs run as supervised child processes
(`scripts/phase11-index.mjs`), so cancel and crash semantics are real process
semantics, not flags.

## Contract

1. **First session starts the daemon.** `DaemonClient.open()` finds the live
   endpoint in the cache dir; if absent (or dead), it spawns the daemon
   against the same cache root and waits for listen.
2. **Sessions register on open** (`register`, optional namespace) and
   **unregister on close** (explicit `unregister` or socket death).
3. **Closing a session cancels ONLY its own work** — queued/running jobs and
   watcher refs owned by that session; work needed by other sessions
   continues untouched.
4. **Crash-safe admission lease.** Every connection must `handshake` before
   any other method; the barrier checks exact build, runtime ABI, and cache
   root (below) and refuses with a specific reason.
5. **Recovery replays from the cache dir.** Checkpoint (`state.json`, written
   at stable points: terminal job states, session/watcher changes) +
   append-only journal (`events.journal`); on restart, the journal tail after
   the checkpoint watermark is replayed, jobs found `running|queued` are
   marked `interrupted`, stale worker pids recorded in the journal are
   verified (argv must be `phase11-index.mjs`) and SIGKILLed, and sessions
   are NOT resurrected — their sockets died with the crash; the journal keeps
   their history and clients re-register (CBM semantics).

## Admission barrier

| check | client presents | refuse code |
|---|---|---|
| exact-build | sha256 (16 hex) over the daemon source files | `BUILD_MISMATCH` |
| ABI | `{nodeMajor, platform, arch}` | `ABI_MISMATCH` |
| cache-root | absolute cache dir, realpath-compared | `CACHE_ROOT_MISMATCH` |
| wire protocol | `protocolVersion` (currently 1) | `PROTOCOL_VERSION_MISMATCH` |

## Cache layout (documented, CBM-style)

```
<cacheRoot>/daemon.json      live endpoint {pid, port, host, protocolVersion,
                             build, abi, cacheRoot, startedAt} — removed on clean stop
<cacheRoot>/state.json       checkpoint {jobs, watchers, seq} — atomic tmp+rename
<cacheRoot>/events.journal   append-only JSONL: session-registered, session-closed,
                             job-started, job-completed, job-cancelled,
                             watcher-registered, watcher-triggered, watcher-stopped,
                             daemon-started, daemon-stopped
<cacheRoot>/logs/daemon.log  lifecycle log
```

Default cache root: `capability/code/graph/db/daemon` (inside the graph db dir,
gitignored with it). Override: `--cache-dir DIR` / client `open({cacheRoot})`.

## Wire protocol

Newline-delimited JSON over TCP 127.0.0.1 (port 0 = ephemeral, published in
`daemon.json`). Request `{id, method, params}` → `{id, result}` |
`{id, error:{code, message}}`. Methods: `handshake, ping, register,
unregister, index, job-status, graph-status, watch, status, shutdown`.

## Lifecycle

```
session 1 opens  → daemon spawns (if down) → handshake → register
sessions 2..n    → handshake → register (namespace per session)
work             → index jobs (serial queue, supervised children, stats journaled)
                 → shared watchers (refcounted; debounce 300ms → incremental index job)
session closes   → its jobs cancelled + watcher refs dropped; others unaffected
last socket ends → daemon stays resident until `shutdown` (or crash → recovery)
shutdown         → checkpoint + journal `daemon-stopped` + endpoint removed → exit 0
SIGKILL          → no cleanup; next start recovers from checkpoint + journal
```

## Run

```bash
node kernel/daemon/codegraph-daemon.js --cache-dir capability/code/graph/db/daemon --verbose
```

Probe (P1–P8): `node scripts/phase11-probe-c.mjs --fresh`
