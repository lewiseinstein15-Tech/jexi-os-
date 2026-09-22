# FIXLOG B207 — thinking panel breaks the layout on phone width

**Found by:** the USER, live on the APK, from the B206 screenshot (`jexi-thinking-live.png`).
**Symptom:** while she's thinking, the panel blows the whole app sideways — text runs
off the right edge of the screen. Fine again once the answer lands.

## Measurements (390×844 APK viewport, Playwright, live thinking)

- panel up to **1077px wide on a 390px screen** (3× the viewport)
- 28/29 samples had out-of-viewport offenders; 5 activity rows clipped mid-character
- the whole app interior (`jx-workbench` and below) inflated to **722px**
- collapsed back to a correct 360px panel the moment thinking ended
- deployed build at rest: 0px overflow (live-thinking-only break)

## Root cause — one flexbox trap, three layers

A flex item's default `min-width: auto` refuses to shrink below its content's
min-content width. Unbreakable content (a `white-space: nowrap` activity line,
a long token) therefore inflates every ancestor that doesn't explicitly opt out:

1. **`.jx-workbench`** — the app shell itself, the only `min-width: auto` item
   left in the shell chain. Content width leaked INTO the shell: everything
   below it rendered 722px wide inside the 390px `.jx-app`, which has
   `overflow: hidden` — so the UI was silently chopped at the screen edge.
2. **AI message wrapper** `div.w-full.group` — flex item with default
   `min-width: auto`, same trap one level down.
3. **`.jx-agent-row-what`** — `white-space: nowrap` with `overflow: hidden` +
   ellipsis. `overflow: hidden` does NOT remove the cell's contribution to an
   ancestor's intrinsic width in Chrome — the full nowrap line (measured 598px)
   still counts as the row's min-content. Latent twin: `.jx-agent-reason` used
   `word-break: break-word`, which also does not zero min-content.

## Fix (belt, braces, and suspenders)

| Layer | Fix |
|---|---|
| App shell | `.jx-workbench` + `min-width: 0` — the shell is sized by the viewport, never by content. This kills the whole class of blowouts for every view. |
| Message wrapper | `w-full group` → `w-full min-w-0 group` (ChatWindow.jsx) — no message content can inflate the column. |
| Panel | `.jx-agent` + `max-width: 100%; min-width: 0`. |
| Activity rows | `.jx-agent-row` → `display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr)` — zero-minimum grid tracks contribute ZERO to any ancestor's min-content (flex rows can't guarantee this in Chrome). Plus `min-width: 0` on who/what/label cells. |
| Reasoning | `.jx-agent-reason` `word-break: break-word` → `overflow-wrap: anywhere` — the only value that zeroes min-content. |
| Tables | already wrapped in `overflow-x-auto` (swipeable) — verified truly contained, not page-breaking. |

## Verification

- Live audit during thinking, 14 samples: panel max **360px**, workbench max
  **390px**, **0** out-of-viewport elements, **0** clipped rows, **0px** page
  overflow.
- After the answer lands (markdown tables included): workbench 390, 0px
  overflow, **0 true offenders** (elements inside a scrollable ancestor are
  clipped by design, not page breaks).
- `server/test-b207.js` — 9 source-contract checks (always run) + live 390px
  layout audit with a scroll-aware offender definition (self-skips in CI /
  when the panel doesn't render; panel existence is b206c's job). Wired into
  the npm test chain.

## Lesson (user correction, now standing policy)

DOM-presence / no-crash E2E passed while the UI was visually broken. Visual
layout must be MEASURED — horizontal overflow, bounding rects vs viewport,
clipping — at phone width, not inferred from selectors.
