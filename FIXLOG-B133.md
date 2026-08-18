# FIXLOG-B133 — Batch 2: commands + llm-retry + anonymous-id + attachment policy + invariants

**Phase:** B133 · **Branch:** main

Pulled the next DeepSeek Harness subsystems:

1. **interaction/commands** — a slash-command registry the chat route runs
   BEFORE the model: {name, description, match, run}, validated at
   registration (name+description required, duplicates rejected),
   reversible unregister. Built-ins: /help (lists all), /plan, /build,
   /compact, /goal, /do. `GET /api/commands`; unknown commands fail
   honestly with "try /help".
2. **llm/llm-retry** — provider request retries with exponential backoff
   (500ms·2^n + jitter) on transient failures (429/5xx/network/timeout);
   permanent errors (400/401/…) fail fast. Wrapped around the core
   chat/completions fetch so every provider benefits.
3. **identity/anonymous-user-id** — a random UUID persisted as a bare line
   in DATA_DIR/.anonymous-user-id (never derived from host/IP), memoized,
   fresh identity when deleted; used as the telemetry per-device key (no
   PII). `GET /api/identity/id`.
4. **attachment** — upload validation BEFORE storage: type allowlist
   (documents/images/media/archives/data/code-as-text), executables
   (.exe/.msi/.bat/.ps1/…) blocked, path-traversal rejected, 25 MB cap.
   Wired into POST /api/upload.
5. **runtime-diagnostics/invariants** — per-conversation log invariant
   checks: lifecycle bracket balance (turn/step/compaction), tool/call→
   tool/result pairing, seq monotonicity; `GET /api/invariants` (per-conv
   or aggregate). Detects crash/in-flight states honestly.

## Verified
- test-dsh-batch2 35/35 (registry lifecycle + /help, backoff + fail-fast,
  UUID identity + re-mint, attachment allowlist/blocklist/cap, invariant
  detection on a deliberately unbalanced log then clean after closing).
- test-llm-models green (retry wrapper safe); api-surface 87 endpoints 0
  missing; full 55-suite sweep exit 0; lint 0.
- Deployed to Render via hook.
