# FIXLOG B221 — Finish the prompt: all-screen design system + the spec's missing screens

**Directive:** "first fix or finish everything that was in the prompt and the frontend everything that was there."

**What B221 found on the ground:** the audit's stale notes overstated the decay. B159–B216 had
progressively adopted the design idioms (surface-cards, tracked kickers, honest empties, AgentPipeline
already operational-honest since B173). The real violations were concentrated, not diffuse — so B221
is a color-authority purge + typography-voice sweep + wiring the spec's orphaned screens, not 30 rewrites.

## What shipped

### 1. Color authority — the ONE green, everywhere (index.css)
- `--mag`/`--mag2` (`#c026d3`/`#a855f7`) remapped to `#00D26A` in **both** `:root` blocks. Every
  brand-role usage (send button, menu active, focus rings, caret, wordmark, pills, plus-menu, agent
  chips) snapped to the system in one move — 0 component rewrites needed (components had 0 direct magenta refs).
- All hardcoded purple/magenta rgba + hexes swept to green equivalents; `#b96bff`→`#00b95c`, `#7a3dd8`→`#00a85a`.
- `--amber` `#ff9d2e` → `#D8A83E` (system amber). Added `--ok/--warn/--bad` status vars.
- Wordmark neon glow removed (§4: no dark-mode neon) — quiet gradient line, `box-shadow: none`.
- Neon green `#00FF9D` source-fixed to `text-brand`/`#00D26A` across 7 components (PanelHeader,
  DownloadPanel, MemoryPanel, ConnectorsScreen, ComputerPanel, SkillsScreen, SourceCard). CSS shim kept as safety net.
- **Deliberate exception:** official brand SVG + favicon + chart palette keep the legacy green —
  they match the shipped Android app icon; changing only the web mark would desync the icons (Android infra = honest BLOCKED).

### 2. Typography voices (§2) — 29 components, mechanical sweep
- Every tracked operational label (`font-bold tracking-wider/widest`) now carries `font-mono`
  (JetBrains Mono): kickers, status chips, tab labels, panel headers, nav labels.
- Display voice (Space Grotesk) on screen titles: `.jx-vtitle`, `.jx-h2` (CSS) + HomeView greeting,
  Tasks/Research headers, DownloadPanel hero (JSX). Fonts were already loaded with `display=swap` + preconnect (§8 ✓).
- `.jx-kick` utility added (mono 10px, 0.12em tracked) for the section-label idiom.
- Header cyan "79 AGENTS" pill → brand green (global chrome joins the system).

### 3. The spec's missing screens — wired back in (UI-DESIGN-PROMPT A–F complete)
The audit assumed Memory/Knowledge/Download were Workshop children. **They were orphans** — 17
screens had zero importers (dead since a shell refactor). The spec's C/D/F now live:
- **C Memory bank** — new `MemoryView.jsx` (hydrates `/api/memory` on mount + 15s poll), wired as view `memory`, menu "Memory".
- **D Books library** — `KnowledgePanel` wired as view `books`, menu "Books" (self-fetching).
- **F App installer** — `DownloadPanel` wired as view `app`, menu "Get the app".
- MenuIcon: +3 icons (database / book-open / smartphone). Menu now 9 items — full-height drawer, fits.
- Spec map now: A Home=Chat ✓ · B Agents=Team (roster browser) ✓ · C Memory ✓ · D Books ✓ · E Settings ✓ · F App ✓.

### 4. Repairs found by verification
- **DownloadPanel was broken** — orphaned mid-refactor, referenced `installer`/`updater` objects that
  no longer existed (instant render crash). Rebuilt both from real `updateCenter` primitives
  (`checkForUpdate` / `downloadAndInstall` / `isNativeAndroid` / `INSTALLED_TAG` — now exported).
  Web build: button hands the APK to the browser; native: in-app download + progress + installer handoff.
- **Header clip at 390px** — `.jx-ctx` had no truncation, so longer view labels pushed the fixed
  status cluster ~10px off-screen (invisible to scrollWidth checks on fixed elements). Fixed per B207:
  `.jx-ctx` truncates with ellipsis, `.jx-right` is `flex-shrink: 0`.

## Verification (B207 programmatic, 390×844, real brain + access key)
- All **9 views PASS**: scrollWidth=390, zero overflowing elements, zero console errors, each view
  render-proofed by waiting for its content (burger → menu → label → proof text).
- Desktop 1280 spot-check: Memory/Books/App/Missions OK, 0 console errors.
- Screenshots in `b221-shots/` (uncommitted, workspace-only).
- Full server chain: **EXIT=0, 0 ❌, 497s** (`/tmp/chain-b221.log` pattern).

## Honest limits
- **17 screens remain unwired** (Tasks, Goals, Models, Connectors, Terminal, Research, Conversations,
  Notifications, MCP, Plugins, Workspace, Projects, CommandCenter + shell parts). They're beyond the
  spec's 6 screens and are dead code, not broken code — left in place as future menu candidates
  (or deletion candidates). Nothing faked, nothing deleted.
- Memory/Books/App panels keep their v1.2-era internal layouts (already system-conformant after the
  voice sweep — surface-cards, mono kickers, hairlines). No redesign theater.
- ActivityWindow keeps its per-agent identity colors (tiny 8px labels — identity coding, not state).
- Audit rows still open: Part 20 (tool discovery), Part 29 (SSE — spec permits polling), Part 56/60
  docs, Part 13 (Android — honest BLOCKED).
- Verification notes: vite OOM needs the preview server killed during builds; pkill patterns must not
  match their own command line (`[c]hrome` trick); `.js`→`.cjs` for CJS scripts in this ESM package.
