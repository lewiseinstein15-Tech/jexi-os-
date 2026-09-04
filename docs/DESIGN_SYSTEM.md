# JEXI OS — DESIGN SYSTEM (B216)

> JEXI's identity: **an operating environment for autonomous work** — not a chat
> box with cards around it. The UI is her instrument panel: it shows what she
> understood, what she's doing, who's doing it, what's blocked, what's verified.
> Every visual decision below has a product reason. Anything that can't state
> its reason gets removed (Part 40 rule: motion without meaning goes).

## 1. Design principles

1. **The work is the interface.** Hierarchy mirrors execution:
   OBJECTIVE → MISSION → WORK GRAPH → EMPLOYEES → ACTIONS → OBSERVATION →
   VERIFICATION → RESULT. Nothing decorative sits above this chain.
2. **Real state only.** Every status, pulse and count comes from the backend
   record. The frontend never invents operational state (event-sourcing rule).
3. **Calm during long missions.** JEXI runs for minutes; the UI must be
   comfortable to leave open. Hierarchy is controlled: primary strong, active
   noticeable, secondary quieter, background subtle.
4. **Instrument, not dashboard.** Operational data in mono, tracked uppercase
   labels, hairline structure. No glassmorphism, no gradient blobs, no
   three-card grids, no statistics that don't mean something to the user.

## 2. Typography (intentional, three voices)

| Voice | Font | Role | Reason |
|---|---|---|---|
| **Display** | Space Grotesk (500/700) | Screen titles, mission objectives, section headers | Technical-humanist character — reads as *engineered*, not *chatbot*; pairs with the mono voice without doubling it |
| **Operational** | JetBrains Mono (400/600/700) | Statuses, ids, timestamps, graph labels, telemetry, events | The instrument-panel voice: fixed-width makes live data readable while it changes; already JEXI's operational identity since v3 |
| **Prose** | Inter (400–700) | Chat text, reports, descriptions | Long-form readability at small sizes; used ONLY where humans read paragraphs — never for data |

Rule: if it changes at runtime, it's mono. If a human wrote it to be read, it's
prose. If it names a thing, it's display.

## 3. Surfaces + structure

- Base `#07070b` → surfaces elevate by shade (`surface-1/2/3`), never by shadow
  stacks. Elevation = one hairline border + one shade step. (Reason: on a phone
  in dark mode, shadows read as mud; shade + hairline stays crisp at 390px.)
- **Hairlines** (`rgba(255,255,255,0.06/0.10)`) are the only separators — no
  drop shadows, no glow.
- Radii: 8px controls, 12px cards, 16px panels. One scale, no pillmania
  (pills reserved for STATUS CHIPS only).
- **Status chip** (mono, 9px, tracked 0.12em, bordered pill): the single most
  repeated element in the system. Border+text carry the state; background
  stays dark (reason: chips sit on every surface — they must never fight them).

## 4. Color — one brand, status only beyond that

- **Brand green `#00D26A`**: JEXI herself — active work, success, verification,
  the live pulse. One brand color, period.
- **Amber `#D8A83E`**: needs-you / warning / recovery.
- **Rose `#FB7185`**: failure, denied, destructive.
- **Graphite text scale** (`text-primary/secondary/tertiary`): everything else.
- Capability accents (research/code/math/…) exist ONLY as small identity dots
  on employee avatars — never as backgrounds or large fills. (Reason: when
  everything is colored, nothing is; color means STATE here, not decoration.)
- No purple gradients. No dark-mode neon. Background noise gradients stay
  ≤5% opacity — they exist to keep large empty areas from banding, nothing else.

## 5. The mission experience (screen: Missions)

### 5.1 Live phase line ("what is happening NOW")
Directly under the header: one line, mono, derived from the LATEST REAL EVENT
(`now → forge · implementation started`). This is Part 37's operational
intelligence in miniature: no "Thinking…" spinner ever. When idle: the phase
line states the terminal state (completed / failed / paused).

### 5.2 Progress rail
A 3px segmented bar from the graph's REAL stats (done / running / ready /
blocked / failed). No percentage fiction — segment widths are item counts.

### 5.3 WORK GRAPH (the signature element)
- **Tiered layout**: dependency depth (from `dependsOn`) becomes vertical
  levels; items in a level are parallel work. On a 390px phone, drawn edges
  between arbitrary nodes are spaghetti — the tier ladder IS the dependency
  truth, readable with a thumb scroll.
- **Node anatomy** (12px title, mono status, hairline card): status glyph,
  title, employee attribution when one has taken it, attempts when >1,
  discovered-origin tag (`origin: discovered`), failure reason + per-item
  retry when failed.
- **Motion semantics** (Part 39): a NEW node enters with a 240ms rise+fade
  (once — it joined the graph); RUNNING nodes carry a slow 2.4s pulse on the
  status glyph (it's alive); DONE settles with a 300ms border-tint transition
  (work landed); FAILED gets no shake — it goes flat rose with the reason
  visible (failure is information, not drama). Reconnecting does not replay
  entrance animations (nodes already known render settled).
- **`prefers-reduced-motion`**: all of the above collapse to instant state
  changes. The pulse becomes a static filled dot.

### 5.4 Employee lane
A compact strip of WHO IS/WAS WORKING: `FORGE · Engineering · running st3`
— real data from graph items (result.employeeName + status). No employee
faces, no fake conversations. Employees appear when they take work; the strip
is absent when the graph is unstaffed (honest absence).

### 5.5 Activity stream
The mission's append-only event log as a timestamped stream: mono HH:MM:SS,
typed glyph, one-line summary, newest first, capped (last 80 rendered / 300
kept) — the record, not a theater.

### 5.6 Environment panel (B215 world state)
Files, last command, browser availability — from `/api/missions/:id/world`.
Only real entries render; an untouched environment renders nothing (the panel
is absent, not empty-stubbed).

### 5.7 Error surface (Part 46)
Mission FAILED renders a structured block: WHAT HAPPENED (the mission's real
failure reason) / WHAT YOU CAN DO (retry failed items, steer, cancel) — the
same controls, framed by need. Never "Something went wrong."

### 5.8 Empty + loading states (Part 47)
Loading names the thing being loaded ("retrieving mission state…"); the empty
state explains the system in one sentence and names the entry action ("say
*as a mission: …* in chat").

## 6. Motion rules (global)

- **Enter** (graph node, panel): 240ms rise 4px + fade, `cubic-bezier(.2,.8,.3,1)`.
- **Live** (running work): 2.4s opacity pulse on the status glyph only.
- **Settle** (done): 300ms border/text tint transition.
- **Never**: scale-bounce cascades, blur-ins, staggered fades on lists,
  shimmering text, anything that moves "because AI interfaces animate".
- `prefers-reduced-motion: reduce` → all animations off, transitions ≤80ms,
  via one media-query kill-switch in `index.css`.

## 7. Responsive behavior

Phone-first (390px) is the design target, not the fallback: single column,
detail-replaces-list navigation, 44px touch targets, truncation before
overflow (B207 rules baked in: min-w-0 the whole chain). Tablet/desktop get
the same column centered at max 680px with wider gutters — the missions
experience is a vertical instrument, not a dashboard split.

## 8. Performance contract (Part 49)

Polling adapts to activity (2.5s active / 8–20s idle). Events: keep 300, render
80. No per-event DOM growth beyond the cap; lists slice, not append. No
animation runs on more than one element class at a time. Fonts: three
families, `display=swap`, preconnected.
