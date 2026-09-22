# FIXLOG — B211 Autonomy Engineering Upgrade (+ B212 gap closure)

**Build:** B211 (all four phases) + B212 (honest-limitation closure)
**Commits:** `a9afee7` (A+B1) → `3db5b8a` (B2) → `37cfda6` (B3) → `7cfca51` (B4) → B212
**Full evidence report:** `docs/AUTONOMY_IMPLEMENTATION_REPORT.md` (23 sections)
**Capability truth table:** `docs/CAPABILITY_MATRIX.md`

## What shipped

- **B1 — the mission spine:** persistent Work Graph (typed relations, leases,
  supersede/invalidate-downstream, atomic persistence), Mission state machine
  with validated transitions + budgets, MissionRunner (background loop that
  REUSES the Director machinery — never a copy), chat bridge with replay,
  `/api/missions/*`, "Continue." resume with zero re-planning, discovered
  work with lineage, mid-mission steering with impact. 111 tests.
- **B2 — intelligence:** ComplexityAnalyzer (LLM-first, heuristic floor,
  `decidedBy` honesty; CRITICAL risk = approval gate before anything runs;
  a non-approval answer steers the plan), ImaginationEngine (≤3 branches,
  ≤2 calls, SELECTED/REJECTED with reasons, SIMULATION_UNAVAILABLE never
  faked, PREDICTED-vs-ACTUAL review at mission end), operational Lessons
  (failure/recovery/deviation → persisted, deduped, retrieved into plan and
  replan prompts). 74 tests.
- **B3 — computer:** Atlas = Computer Operations (`computer` capability,
  `browser-act` tool, enforced `COMPUTER` permission). `ComputerOps.js` on
  the real DesktopManager/ComputerRuntime stack; ```browser loop mirroring
  the proven B210 ```run loop (observe→act→observe→verify, bounded);
  honest COMPUTER_BLOCKED when the environment has no browser; live
  ComputerPanel (real telemetry + real screenshots only). 57 tests.
- **B4 — proof:** `tests/autonomy/` — long-horizon mission (unguided
  build+test+fix+verify with REAL node --test fail→fix→pass and a zero-trust
  independent re-run), failure-injection (429s, BAD_OUTPUT, lane death,
  verify-fail correction, tool failure, imagination-down, lessons
  propagation), backend-restart (REAL SIGKILL across process boundaries;
  DONE never redone), browser-disconnect (viewer death mid-stream and
  dead-on-arrival; replay on reconnect). 53 tests.
- **B212 — gap closure:** fix-in-place artifact rewrites (FILE_UPDATED; the
  employee's own `cat` proves the fixed file is on disk), `control(answer)`
  API path (+ empty answers no longer silently unblock a gated mission),
  **MissionsScreen** (mission control over the real API: list, snapshot,
  graph, live event feed, pause/resume/cancel/retry, steering, answers).
  13 tests.

## Real fixes the proofs drove

1. Mission-scoped workspaces — later items build on earlier items' files.
2. Sanitized subpath artifacts (`public/index.html` survives).
3. Same-session fix-in-place rewrites (was: silently skipped).
4. Empty answers can't unblock a risk gate.
5. The `data/employees.json` stale-shadow trap killed at the root (roster
   under DATA_DIR; the test that wrote it now deletes it).

## The live production E2E (limitation #2) — what running it for real found

Two live missions were fired at the production brain
(`ms-mtmir1dp-001`, `ms-mtmkdn6b-001`) with one objective: open
example.com in the real browser and report the exact title + link text.

**Run 1 (pre-fix):** the full autonomy loop ran live (analyze → plan →
execute → verify-fail → REPLAN → recovery → lesson → real browser attempt →
verify-fail → honest MISSION_FAILED) — and exposed two real bugs:

6. `observeViaDesktop()` fetched the page text a second time and discarded
   it with `&& ''` — the observed title was ALWAYS empty, even on a loaded
   page. Fixed: the title now comes from the interactive map's
   `document.title`. Proven by a real-browser round-trip in `test-b212.js` §3b.
7. `runBrowserRound()` trusted the advertised provider capabilities
   (`browser: true`) without probing the host — on the slim deploy image
   (`JEXI_NO_BROWSER=1`, no Chromium by design for 512MB hosts) that meant a
   whole round of dead actions and an empty observation instead of the
   documented COMPUTER_BLOCKED. Fixed: the desktop path probes
   `ensureBrowser()` first — one honest COMPUTER_BLOCKED with the true
   reason, zero dead actions. `test-b212.js` §3a replays the exact prod case.

**Run 2 (post-fix, verified live):** COMPUTER_BLOCKED fired at the first
browser attempt with the true reason; the browser item reported
`browserAvailable: false` with empty values (no hallucination); the
fallback server-side fetch produced the REAL title and link text
("Example Domain" / "More information...") with provenance; the mission
still ended in an honest FAILED because replan items fabricated methods
("headless_browser", "real_browser") and one link text — and Vera refused
to pass the incoherent deliverable. No success was ever faked.

Also fixed on the way: the CI-only failure the first B212 push hit —
MissionsScreen built its events URL with an inline conditional query, which
the frontend↔server API-surface contract test couldn't normalize. The
endpoint literal is now whole (`MISSION_EVENTS_URL`), 101 endpoints checked,
0 missing. Process lesson recorded: run the FULL `npm test` chain locally,
not a curated suite list.

## Honest state at close

Director lane: **560 checks** (B208 89 · B209 92 · B210 64 · B211 295 ·
B212 20), all green; CI 5/5; Render live. Remaining known limitations are
listed in `docs/CAPABILITY_MATRIX.md` (cross-mission worker pool, LLM
narrative lessons, employee provenance discipline) — deferred by design,
never converted to PASS.
