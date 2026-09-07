# ARENA REBUILD — FINAL REPORT (Sept 7, 2026)

**Status: BUILT, TESTED, PROVEN LIVE. NOT PUSHED — waiting for Lewis's
"PUSH AND COMMIT TO GITHUB".**

The 38-part ARENA spec, executed against the real repository. Audit first
(`docs/REBUILD-MAP.md`), then six phases, each committed with tests. Nothing
faked: every claim below has a test, a live run, or a screenshot behind it.

---

## What was built, phase by phase

### Phase 0 — Audit (`docs/REBUILD-MAP.md`)
All 38 spec parts mapped to EXISTS / PARTIAL / MISSING. Honest finding: about
a third already existed (work graph, capability routing, missions, memory,
security, verification, recovery). The real gaps: speed structure, kernel,
browser architecture, UI.

### Phase 1 — Executive Kernel + performance (the structural speed fix)
- **`server/src/services/JexiKernel.js`** — the gate (pure regex, zero cost)
  and the fast path. Runs after the mission lane, before the Director.
- **`server/src/services/RequestMeter.js`** — every chat turn gets a meter:
  model calls (by provider, failures marked) + per-stage latency, counted
  automatically for every lane via AsyncLocalStorage. The report rides every
  `done` event as `statistics.meter`.
- **Small talk is now ZERO model calls.** Live lesson, proven twice:
  1. The first fast path made ONE small call — on a day Gemini was 503ing, a
     "hello" slid the provider ladder for **65+ seconds**. Rewritten to
     deterministic answer pools (greeting / thanks / bye / identity /
     how-are-you, Swahili included). Immune to provider outages.
  2. The meter then caught a **hidden model call**: the conversation-continuity
     rewriter was charging one call per "hello" before the kernel ever saw it.
     Fixed — small talk skips the rewrite.
- **Ollama as ONE provider** (Lewis's explicit method — no local models in
  the sandbox, ever): a pure HTTP client speaking Ollama's OpenAI-compatible
  `/v1` endpoint on Lewis's own hardware. `MODEL_PROVIDER=ollama` pins it
  FIRST on every ladder; unreachable → honest fast failure → slides to the
  remote rungs. Tested against an in-test mock server only.

### Phase 2 — Work Graph proven as THE mission engine
The mission engine already had dependency-aware parallel execution, budgets,
pause/resume, restart recovery and steering with work preservation. What was
missing was PROOF of the steering contracts. `test-work-graph-steering.js`
now proves: done work is never touched by steering, only the affected
subgraph is superseded, supersede lineage is auditable, restart re-opens
in-flight work honestly, leases prevent double execution.

### Phase 3 — Browser Router (`server/src/services/BrowserRouter.js`)
One policy-gated entry point for all browser work: desktop (real Chromium via
DesktopManager — registers only where a browser exists), android (ADB —
registers only with a connected device), remote (registration protocol; none
assumed). Hard policies before any worker runs: CAPTCHA is never solved or
bypassed, browser-private storage (passwords/cookies/wallets) is never read,
http(s) only, high-impact page actions need explicit authorization, every
task + refusal lands in a bounded audit log. `/api/browser/status` for
observability. On this host it reports honestly: no browser, no device.

### Phase 4 — Memory lifecycle + JEXI's event voice
- **`server/src/services/MemoryLifecycle.js`** — FRESH → AGING → STALE states
  over the existing stores (nothing replaced). Stale memories are marked
  `needsReverify`; recall() results carry their lifecycle state so old
  knowledge can never silently pose as fresh. `/api/memory/lifecycle`.
- **`server/src/services/director/EventInterpreter.js`** — JEXI speaks from
  REAL runtime events in Lewis's "Boss" voice, deterministically (zero model
  calls): mission started/failed/recovered, work done, steering heard/applied,
  browser refused. Unmapped events pass through with their honest summary.

### Phase 5 — Full UI rebuild
- **Warm palette**: neon green `#00D26A` is gone everywhere (Tailwind tokens,
  CSS variables, all component literals) — replaced by orange `#FF8A3D`,
  coral `#FF6F61`, salmon, peach. Verified in the built CSS: zero occurrences
  of the old green.
- **Desktop left rail** (≥901px): Home / Missions / Agents / Memory / Tools /
  Files / Settings — every item a real, API-backed screen. Conversation is
  the hero on Home.
- **Phone**: ☰ hamburger at top, drawer navigation, **no bottom nav bar**.
- **JEXI's voice in handwriting**: Caveat (OFL, bundled in-repo — no CDN)
  renders her dialogue; code/logs/JSON stay clean mono.

### Phase 6 — Proof
- 7 real screenshots from the RUNNING app (Playwright + local Chromium):
  `docs/screenshots/arena-desktop-{home,chat,missions,memory,tools}.png`,
  `arena-phone-{home,drawer}.png`.
- 14/14 DOM verification checks pass (`scripts/arena-ui-verify.mjs`):
  rail items, fixed left nav, hidden burger on desktop, warm palette, no
  neon green, Caveat loaded + applied, phone hamburger, no bottom bar.
- Live benchmark (`scripts/arena-benchmark.mjs`,
  `docs/arena-benchmark-live.json`):

| request | wall time | model calls | lane |
|---|---|---|---|
| hello | 51ms | **0** | fast path |
| thanks boss | 99ms | **0** | fast path |
| see you later | 70ms | **0** | fast path |
| who built you? | 74ms | **0** | fast path |
| how are you | 11ms | **0** | fast path |
| niaje (Swahili) | 66ms | **0** | fast path |
| What is the capital of Kenya? | **445ms** | **1** (groq) | **lean lane** |
| Who wrote Things Fall Apart? | 1.3s | **1** (groq) | lean lane |

**The lean lane (Intent Engine, spec Part 3):** the same capital-of-Kenya
question through the full Director pipeline took **185+ seconds** on Sept 7
(stalled provider pass inside a delegate lane, 130s on one model pass). The
next day's build added a deterministic intent gate: simple self-contained
questions get ONE bounded call through the normal provider ladder — no
ceremony, no lane pinning, budget-capped so a stalling provider can never eat
minutes (proven by test: a hanging server is abandoned at the budget). Real
work is never intercepted — the gate refuses build/write/research/file/URL
requests conservatively. **185s → 0.45s, ~1 call instead of ~6.**

---

## Honest notes (the things that didn't go perfectly)

1. **Real-question latency — FIXED by the lean lane.** The original run
   (Sept 7) saw a one-line question burn 185+ seconds: the Director's
   ~6-call ceremony landed on a provider lane that stalled mid-generation
   (130s on a single pass) while Gemini's free quota was exhausted and an old
   background goal competed for rate slots. Diagnosis from the live logs led
   to the Intent Engine lean lane (above): simple questions now answer in
   under half a second with one call. The Director still owns real work;
   hard/research/coding asks keep the full pipeline.
2. **Browser Router workers.** The router is real, but on this host there is
   no Chromium and no paired Android device — it says so honestly instead of
   pretending. The APK WebView channel (JEXI driving the phone's own browser)
   is the next real build: protocol defined, APK work not done — not
   promised until tested.
3. **The spec file** (`docs/ARENA-REBUILD-SPEC.md`) is a faithful
   reconstruction from working notes; the verbatim 38-part message was lost
   to session compaction. Flagged in the file. Swap-in ready if re-sent.
4. **Git history was rebuilt twice** — the sandbox resets kept eating the
   local commit history (working files always survived). Patch backups now
   live outside `.git` in `/home/user/arena-backup-patches/`.

## Test status

ARENA test files (all in the package.json chain):
`test-jexi-kernel.js` 8/8 · `test-ollama-provider.js` 5/5 ·
`test-request-meter.js` 5/5 · `test-work-graph-steering.js` 6/6 ·
`test-browser-router.js` 8/8 · `test-memory-lifecycle.js` 9/9 ·
`test-intent-lean.js` 4/4

Regressions green: api-surface 19/0, planner-routing, provider-health 14/14,
request-economy 13/13, director-mcp 4/4, world-memory 10/10, long-horizon
mission 14/0. Frontend builds clean (`vite build`).

## Commits (local, on top of deployed 47ed4a0)

ARENA Phase 0 → 1 → 1b → spec archive → Phase 1-complete (meter) →
Phase 2-proof → Phase 3 (browser router) → Phase 4 (memory + voice) →
Phase 5+6 (UI rebuild + proof — this commit).

**NOT PUSHED. Waiting for: "PUSH AND COMMIT TO GITHUB".**
