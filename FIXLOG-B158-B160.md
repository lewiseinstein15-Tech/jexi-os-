# FIXLOG B158–B160 — APK update fixes · Responsive tiers · Streaming step feed · DSH pull-sync · Suite green

**Date:** 2026-08-28 · **Result: full server suite 3,526 ✅ / 0 ❌ (exit 0) — first fully green run in repo history.**

---

## B158 — "Update breaks the app" — root causes fixed

The phone-sideloading update chain had **four** independent breakage classes; all are now closed:

### 1. The versionCode downgrade trap (the big one)
Local builds used **epoch seconds** (~1.75 billion) as `versionCode` while CI used `github.run_number` (~hundreds). Anyone who ever installed a locally-built APK could **never** take a CI update — every Release had a LOWER versionCode and Android rejects downgrades (`INSTALL_FAILED_VERSION_DOWNGRADE` → "App not installed").

**Fix (`android/app/build.gradle`):** both directions safe forever —
- CI builds: `1,000,000 + run_number` (always newest)
- Local builds: hours-since-2026 (~8.8k/yr → stays under 1M until 2139)

### 2. Stale-bundle defense in depth
- **Build-stamp handshake**: every build bakes `<meta name="jexi-build">` (new `jexiBuildStamp` Vite plugin). The inline ES5 bootstrap in `index.html` compares it with the last-seen stamp and wipes **CacheStorage + Service Workers before the bundle loads** — works even if the new bundle itself is broken, and covers the web deploy too. `localStorage` (identity, settings, history) is never touched.
- **`MainActivity`** wipe list extended with the newer `Shared Dictionary` WebView cache dir.
- **Backup rules** (`backup_rules.xml` + `data_extraction_rules.xml`): Android auto-backup can no longer restore stale WebView caches/Service Workers into a fresh install; real user data still backs up.

### 3. Blank-screen self-recovery
If React hasn't painted within 10 s (crashed bundle, ancient WebView), the bootstrap shows a minimal **Reload / Reset-and-reload** recovery card — nobody gets trapped on a black screen after a bad update again.

### 4. Backend-URL self-heal
A stale `localStorage` backend override used to beat the URL **baked into the new APK**, making the updated app look dead. On boot, if the override fails its health check but the baked URL answers, the override is dropped automatically (`App.jsx`).

---

## B159 — True responsive: phone · tablet · laptop

- **≥1024px (laptop/desktop):** the hamburger drawer becomes a **persistent left sidebar rail** (no more hamburger on desktop), content column centers with comfortable max-widths, hover affordances.
- **601–1023px (tablet):** centered chat column, roomier type, 40px touch targets retained, taller workshop preview.
- **≤600px (phone):** unchanged best-in-class mobile shell.
- **Landscape-short phones:** composer stays reachable, textarea capped.
- Verified: build passes; every tier has explicit paddings/max-widths/safe-areas.

## B159 — Streaming step-by-step feed (the "tells you what it's doing" upgrade)

`AgentPipeline` rebuilt as a **live step feed**: every streamed log event becomes a visible step — ✅ completed steps (agent + action), ◌ current step (spinner + live message), `STEP n` counter + live elapsed timer; collapses to `✓ finished · N steps · Xs` when done. The top-bar status now shows the **current agent + action** while working.

---

## B160 — DeepSeek Harness pull-sync (upstream master @ b150a55)

Upstream grew **219 → 227 packages**. All 10 new ones ported (tests in `server/test-dsh-batch14.js`):

| Upstream package | JEXI port |
|---|---|
| `shell/tool-pwsh-persistent` | `PwshPersistent.js` — owner-scoped persistent PowerShell, marker-parsed, graceful `PERSISTENT_PWSH_UNAVAILABLE` |
| `context/file-reference` + `-local` | `FileReference.js` — @file grammar (bare + `[..](file:..)`, ≤16, traversal-safe), bounded fuzzy index, guarded snapshots — **wired into `assemblePrompt` + both chat paths** |
| `credentials/authorization` | `Authorization.js` — conversation credential flows (resolve-first, validate, mask, TTL, ask.user payload) |
| `experimental/agent-team` | `AgentTeams.js` — implicit-Lead roster (names never reusable), durable FIFO mailbox (de-dup, caps), **versioned task DAG** (stale-revision rejection, cycle/self-edge guards, tombstones), `waitForChange` |
| `experimental/tool-agent-team` | `plugins/agent-team` — 8 model-facing team tools |
| `code-runtime/code-runtime-python` | `CodeRuntimePython.js` + `plugins/python-run` — bounded CPython seam (isolated, timeout + output caps) |
| `client/ui-reference` | `src/utils/referenceSource.js` — unified @file/@session autocomplete source |
| `client/ui-renderer` | `src/utils/uiRenderer.jsx` — slot registry + assembled root |
| `client/ui-brand-official` | `src/brand/official.jsx` — official brand occupants for the 3 shipped slots, rendered in the sidebar |

Manifest: **229 tracked** (227 upstream + 2 retained ports annotated as removed-upstream). `DSH-PARITY.md` regenerated.

---

## Repairs to previously-broken main (found while testing)

1. **`npm test` was red on main** (multiple stale/crashing suites). Now **fully green: 3,526 ✅ / 0 ❌, exit 0.**
2. **Goals never reached the prompt** — the `setGoalEngine(goalEngine)` wiring was dropped in a refactor. Re-wired in `index.js`.
3. **User turns weren't in the session lifecycle log** — `lifecycleUserMessage` re-wired into the chat route.
4. **Redis durability probe never worked** (test crashed since its birth commit). Now fully implemented: `redisBootProbe()` (boot-stamps in Redis, cross-restart proof), URL normalization (whitespace/quotes), scheme/hostname validation with actionable errors, bounded timeouts (hang-safe), honest `redisConnectionInfo()` health, mock-Redis `KEYS` support. **28/28 → 37/37 passing.**
5. **jsdom crashed on Node 20** (`worker_threads.markAsUncloneable` is Node 22+) — `NodeCompat.js` shim; server now runs on Node 20 AND 22.
6. **Compaction test seam lost** — `rollingConversationSummary` re-accepts `__generate`, emits `context_compaction` events with real trigger/threshold/estimatedTokens/turnsCompressed; token-pressure trigger (`JEXI_COMPACTION_TOKENS`) added. 45/45.
7. Stale source-grep tests (auto-mode, dsh-research, autonomous-coding, audit-b48) updated to assert the **current** architecture instead of B114-era code strings.
8. `node:sqlite`-gated assertions now SKIP honestly on Node < 22.5 (CI Node 22 runs them fully).

## Verified live (smoke)

Brain boots; `/api/health` reports providers/redis; `/api/chat` streams the full DSH-style event chain (continuity resolution → intel → planner → orchestrator complexity → plan with roster/skills/tools → coworker assignment); `/api/memory/search` live.
