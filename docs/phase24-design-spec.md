# Phase 24 — JEXI Console Rebuild: Design Spec + Tokens

Status: Scope 0 — design contract. No UI code in this scope.
Branch: phase-24-rebuild (from main @ 6db21f3). Tag: pre-phase-24-rebuild.

---

## 1. Design system source — PRIMARY: Obsidian Void, concretely the **Linear dark system**

Pick: **Linear** (as catalogued in the awesome-design-md pack: soulcore-dev/soul-design-md
`designs/linear/DESIGN.md`), i.e. the "Obsidian Void" family member that ships a complete,
published dark token set.

Why Linear over the alternatives:
- JEXI is a precision console (Chat / Settings / Work Graph) for an agent runtime — Linear's
  contract is exactly "software for serious engineering work must feel like the tool itself —
  precise, fast, and without ornament." That matches the rebuild mandate (no HUD, no chrome).
- It is the only pack member whose full dark hierarchy (canvas / panel / elevated / text steps /
  single accent) is published with contrast ratios already computed — every token below is
  traceable, nothing invented.
- Single-violet-accent discipline (accent = interactive signal ONLY) enforces the "new palette,
  not the old console" requirement structurally: chrome is achromatic, color means state.
- Raycast/Warp are macOS-native-first (translucency, vibrancy) — wrong medium for a web console.
  PostHog's warm-technical parchment fights the terminal-grade graph surface. Terminal-CLI green
  was considered and rejected: it forces monospace everywhere and hurts the chat reading surface.

Declared SECONDARY source (semantics only): **Vercel deployment-status palette** for
success / error / warn / info, because Linear's published set carries no semantic colors.
Secondary values are used ONLY for the four semantic tokens and the border scale.

---

## 2. Color palette — real hex tokens, every value traceable

| Token                | Hex       | Source (traceable)                                             |
|----------------------|-----------|----------------------------------------------------------------|
| `bg`                 | `#08090a` | Linear "Marketing Black" canvas (DESIGN.md §1)                 |
| `surface`            | `#0f1011` | Linear "Panel Dark" (panel background)                         |
| `surface-elevated`   | `#191a1b` | Linear "Surface Level 3" (elevated surfaces)                   |
| `border`             | `#333333` | Vercel `--border-100` (published dark border scale)            |
| `border-strong`      | `#444444` | Vercel `--border-200`                                          |
| `text-primary`       | `#f7f8f8` | Linear "Primary White" foreground                              |
| `text-secondary`     | `#d0d6e0` | Linear "Silver Gray" body text                                 |
| `text-muted`         | `#8a8f98` | Linear "Tertiary Gray" — 5.4:1 on `#08090a`, AA for text       |
| `text-quiet`         | `#62666d` | Linear "Quaternary" — 3.1:1, placeholder/disabled ONLY (per Linear's own a11y note) |
| `accent`             | `#5e6ad2` | Linear Brand Indigo (CTA fill, brand marks)                    |
| `accent-bright`      | `#7170ff` | Linear Accent Violet (links, active/selected states)           |
| `accent-hover`       | `#828fff` | Linear Accent Hover (hover on accent elements)                 |
| `error`              | `#ff0000` | Vercel `--color-error` (deployment failed)                     |
| `success`            | `#00dc82` | Vercel `--color-success` (deployed)                            |
| `warn`               | `#ffaa00` | Vercel `--color-warning` (building)                            |
| `info`               | `#0070f3` | Vercel `--color-info` / blue (queued) — also backend-status dot |

Radius: 8px (Linear system radius). Accent policy: violet appears ONLY on interactive/active
elements — never as ambient decoration.

## 3. Typography

- UI: **Inter** (Linear uses Inter Variable with OpenType `cv01` + `ss03` globally — adopted).
  Weight **510** for UI emphasis (Linear's signature weight; falls back to 500 if the variable
  axis is unavailable in the bundle).
- Code / ids / graph data / telemetry: **JetBrains Mono** — declared open substitute for
  Linear's proprietary Berkeley Mono (substitution, not extraction; noted honestly).
- Scale (px): 12 (meta) · 13 (dense rows, graph labels) · **14 (base UI)** · 16 (panel titles,
  chat body) · 20 (route titles) · 24 (only the chat hero/empty state).
- Tracking: slightly negative on ≥20px headings (Linear's restrained negative tracking).

## 4. Layout

- Three-region shell? **YES** — fixed sidebar + content + contextual detail panel (the detail
  region exists ONLY on /graph as the node-detail pane; chat and settings use the full content
  column — no third pane there).
- Sidebar width: **240px** fixed, non-collapsible in Scope A (revisit in Scope E if needed).
- Keyboard-driven? **YES** — visible focus rings (`accent-bright`), Tab order left→right
  sidebar→content, Enter sends in composer, Esc closes detail/overlays (hardened in Scope E).
- Spacing: 8px grid (multiples of 4 permitted for icon padding only).

## 5. Chat surface reference

**Custom build adopting the agent-elements / AI Elements *shapes*** (message list, streaming
markdown rows, bordered tool cards with tool-name headers, reasoning/narration as muted rows,
prompt input pinned bottom). Rationale: the repo already ships `react-markdown` + `remark-gfm` +
`rehype-highlight` + `rehype-katex`, and Phase 16's runtime (`ui/web/console/chat/**`) owns all
behavior — mount.js will subscribe to its router and render real taxonomy events. No new
component-library dependency; no runtime rewrites.

## 6. Work graph library

**reaflow** (lead-recommended). Reasons: ELK auto-layout is deterministic (same nodes → same
positions, required by Scope D contract), built-in zoom/pan, node nesting for phase groups,
SVG-based (screenshot-clean, no WebGL flakiness in headless capture — reagraph rejected on that
basis). Graphin/G6 rejected: heavier analysis toolkit than a view-only surface needs.
**Open decision flagged for lead:** reaflow is a new dependency — root `package.json` is not in
my declared zone. Requesting approval to add `reaflow` (+ its `elkjs` peer) at Scope D, OR
direction to vendor/alternative.

## 7. Settings layout

**Grouped list rows** (iOS/Linear-style sections: Provider · Mode · General), single scroll
column, no nested modals — per Scope C contract. Inline validation states render inside the row.

---

## Token delivery (Scope A consumes this)

`ui/web/console/shell/tokens.css` will define the 16 hex tokens above as CSS custom properties
under `:root` (`--jexi-*` prefix), plus radius/spacing/font vars. No other palette exists.
