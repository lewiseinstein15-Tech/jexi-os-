# FIXLOG B216 — THE MISSION INSTRUMENT (Human-First UI Evolution, Phase 1)

User directive: the master spec's Parts 32–51 (frontend evolution), after the
B215 audit established that the backend autonomy architecture was already
shipped (B208–B213) and the frontend was the genuinely open work.

## What this build delivers

**The design language, defined and enforced** — `docs/DESIGN_SYSTEM.md`:
- Three type voices with jobs: Space Grotesk (display: titles, objectives),
  JetBrains Mono (operational: statuses, ids, timestamps, graph labels),
  Inter (prose only). Rule in code: if it changes at runtime, it's mono.
- One brand color (green = JEXI + success + live work); amber = needs-you;
  rose = failure. Capability accents only as tiny identity dots.
- Surfaces elevate by shade + hairline, never shadow stacks. Pills reserved
  for status chips. No purple gradients, no glass, no card grids (the anti-
  slop rules are written INTO the system doc with reasons).

**The missions experience rebuilt as an instrument** (`MissionsScreen.jsx` v2,
structure mirrors execution per Part 35):
OBJECTIVE (display voice) → live phase line (latest REAL event, mono clock —
never a "Thinking…" spinner) → progress rail (real item counts, no percentage
fiction) → WORK GRAPH as a tiered dependency ladder (levels computed from
dependsOn; nodes carry status/employee/attempts/discovered-origin/failure
reason/per-item retry) → WORKFORCE strip (real workers from real results,
absent when unstaffed) → ACTIVITY STREAM (real HH:MM:SS timestamps from the
append-only log, capped 300 kept / 80 rendered) → ENVIRONMENT panel (B215
world state: last command + exit code, files, browser availability — only
real entries, absent when empty) → ERROR SURFACE (what happened + the
verifier's real finding when verification rejected the mission + what you
can do) → FINAL REPORT.

**Semantic motion, four animations total** (Part 39–41): node-in 240ms (a
node JOINS the graph — first render settles, reconnects never replay),
breath 2.4s (running work is alive — the glyph only), settle 300ms (work
landed), rail-in 360ms (graph shape changed). One `prefers-reduced-motion`
kill-switch in index.css disables all of it (verified in-drive:
`animationName: none` under emulation).

## How it was verified (real, not claimed)

Browser drive at 390×844 (B207 standard) against a REAL mission created on
prod (ms-mtn39z9l-001, "write a tiny node script that prints the first 8
fibonacci numbers, run it to verify") — pointing the local production build
at the real backend:

- The mission ran for real and FAILED HONESTLY mid-drive: Forge claimed
  `node fib.js` ran; Vera's verification caught the execution contradiction
  (real execution was `node fibonacci.js`; the claimed file was never
  tested) → mission FAILED with all 8 items DONE. The UI showed exactly
  this: FAILED chip, all-DONE tier ladder, Vera's real finding in the error
  surface, the real command + files in the environment panel. The honesty
  machinery survived contact with the UI.
- Verified in-drive: phase line with real clock, 5 tiers, 8 nodes, workforce
  names (Zola/Forge delivered), 102-event activity stream with real
  timestamps, environment lines (`node fibonacci.js → exit 0 · 703ms`,
  `2 files: fib.js, fibonacci.js`), error surface with the verifier's why,
  final report, ZERO console errors, ZERO horizontal overflow, ZERO
  unintended clipping (deliberate truncate-ellipsis only), Space Grotesk
  applied, reduced-motion kill-switch working.

## Files

- NEW `docs/DESIGN_SYSTEM.md`, `docs/HUMAN_UI_AUDIT.md`
- REBUILT `src/components/MissionsScreen.jsx` (real-API contract unchanged
  except +`/api/missions/:id/world` — covered by the api-surface test)
- `src/index.css` (+motion keyframes, graph tier ladder, reduced-motion
  kill-switch), `index.html` (+Space Grotesk), `tailwind.config.js`
  (+display font family)
- Workspace evidence (untracked): `b216-mission-detail.png` drive screenshot

## Honest limits (not converted to DONE)

- The MISSIONS screen is the flagship and is fully migrated; the other
  screens (chat, history, team, workshop, settings) keep the existing v3
  styling — same tokens, consistent base, not yet restructured to §5.
  Next phase.
- Chat-lane streaming visuals (Parts 37–38) keep the existing token stream +
  action feed; the operational-timeline treatment is future polish.
- Still adaptive polling (spec permits the existing fabric).
- The failed fibonacci mission is REAL and stays in the record (honest
  failure; retryable from the UI).
