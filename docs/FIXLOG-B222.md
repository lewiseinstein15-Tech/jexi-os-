# FIXLOG B222 — The unwired screens, wired

**Directive:** "Continue and these unwired or 17 screens… and also constraints what is the issue of you implementing it."

**The constraint, answered with facts (not guesses):** orphaned code rots against a living system.
The screens were built for an old shell that got replaced; while unwired, the APIs underneath them kept
evolving. Wiring them isn't hard — *verifying* them is the work, because a broken screen doesn't stay
politely hidden: all views mount at boot (hidden), so one bad render crashes the whole app. B222 found
exactly that, twice. Every screen had to be render-probed against the real brain before it could ship.

## What shipped

### 12 screens wired into the app (21 views total)
Menu now groups: **WORK** (Tasks, Goals, Projects, Files, Terminal) · **INTELLIGENCE** (Skills,
Research, Models, MCP) · **SYSTEM** (Notifications, Connectors, Plugins) — plus the existing core
(Chat, Chat history, Team, Missions, Workshop) and tail (Memory, Books, Get the app, Settings).
- Every endpoint they call was verified live on the brain first (`/api/skills`, `/api/models`,
  `/api/connectors`, `/api/computer/status`, `/api/processes`, `/api/goals`, `/api/schedules`,
  `/api/notifications`, `/api/mcp/status`, `/api/plugins`, `/api/workspace*`, `/api/projects`).
- Cross-screen actions go to the engine: Skills "use skill", Research submit, Projects "continue"
  → `engine.runSearch(text)` + jump to Chat.
- 12 new MenuIcon glyphs, grouped-menu rendering with mono kickers, `overflow-y: auto` on the
  drawer/sidebar (21 items scroll; truncation before overflow).

### Rot found and repaired (the proof of the constraint)
1. **McpScreen — instant app-wide crash.** `/api/mcp/status` tools evolved from plain strings to
   `{name, tier, builtin}` objects; the screen rendered `{t}` raw → React error #31 → the ErrorBoundary
   caught the WHOLE app at boot (burger never appeared). Fixed: renders `t.name`, adds the tier as a
   mono chip, tolerates both shapes.
2. **ModelsScreen — 57-second blank screen.** It `Promise.all`'d `/api/models` with
   `/api/health/providers` — and provider health LIVE-TESTS every provider (~1 minute). Split: the
   model roster renders immediately; provider health streams in when it lands, with an honest
   "live-testing providers…" state (§5.8).

### Screens NOT wired, with reasons (honest absence)
- **ConversationsScreen** — duplicates the live Chat history view, but self-contained (not wired to
  the engine's resume flow). Wiring it adds a second, worse door to the same room.
- **CommandCenter, HomeView** — the old home layouts; Chat's home (orb + capability cards) replaced them.
- **TopNav/NavList/Header/BottomNavigation** — alternate chrome, not screens; the B216 shell is the app.
- ActivityWindow rides along inside TasksScreen (now live). ActiveAgents/RosterPanel/TeamManager were
  already live inside Team.

## Verification
- **21/21 views PASS** at 390×844 against the real brain + access key: scrollWidth=390, zero
  overflowing elements, zero console errors, each view render-proofed (burger → menu → label →
  scoped proof text inside the shown view).
- Desktop 1280×720: sidebar scrolls (21 items + 3 group kickers), 0 errors, no overflow.
- Full server chain: **EXIT=0, 0 ❌, 449s**.

## Honest limits
- WorkspaceScreen showed "Workspace is empty" against the live brain — honest render of real
  `/api/workspace` state at verify time, not a bug.
- ModelsScreen provider health genuinely takes ~1 min (it live-tests each configured provider);
  the section now says so instead of hanging.
- The old v1.2 chrome components (TopNav, NavList, Header, BottomNavigation, CommandCenter,
  HomeView, ConversationsScreen) remain in the tree as dead code — deletion is a separate decision.
- Verify-script traps recorded: Playwright `text=` first-matches hidden views (all views mount at
  boot) — scope proofs to `.jx-view.show >> text=…`; `pkill` patterns must not appear literally in
  the running command; kill preview servers before vite builds (OOM).
