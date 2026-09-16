# UI REFERENCES — JEXI Console (Phase 6, Scope F research)

> Status: RESEARCH ONLY. No React exists yet — the build is a separate scope
> (Phase 6F-build) gated on user approval of `ui/preview/console.html`.
> Method: reference-driven, per the scope guard. Two prior improvised mockups
> were rejected; this document cites what was studied and what was taken from
> each source, and — just as important — what was rejected and why.

## 1. References studied

### Design systems

| # | Reference | Source | What it contributed | Decision |
|---|-----------|--------|---------------------|----------|
| 1 | **shadcn/ui** | https://ui.shadcn.com | Component primitive set + the "own your components" distribution model (code copied into the repo, styled with Tailwind tokens). For the React build: Dialog/Dropdown/Tooltip/ScrollArea/Table primitives map 1:1 onto the console's needs (model selector, grant editor, event stream). | **ADOPT** (React build scope) |
| 2 | **Radix UI** | https://www.radix-ui.com | The accessible behavior layer under shadcn: focus management, aria wiring, keyboard nav for menus/popovers. The console is keyboard-first (command palette, ⌘K); Radix is what makes that accessible without hand-rolling. | **ADOPT** (React build scope) |
| 3 | **Vercel Geist** | https://vercel.com/geist · https://vercel.com/font | The sans + mono PAIRING discipline: one geometric sans for labels/UI, one mono for everything data-shaped (ids, timestamps, tool args, durations). Also the "flat, fast, no decorative noise" posture and the systematic gray ramp (950→100) that keeps dark UIs from drifting muddy. | **ADOPT** (pairing + gray ramp discipline) |
| 4 | **Linear** | https://linear.app · https://linear.app/blog/how-we-redesigned-the-linear-ui-2 | Dark-first density: near-black canvas (#08090a family), LCH-tuned hues so status colors stay perceptually uniform, tight 4px spatial rhythm, keyboard-everything, borders instead of shadows for separation (flat panels on flat canvas), and status vocabulary expressed as small tinted pills — never as big colored blocks. | **ADOPT** (density, borders-over-shadows, pill language, LCH discipline) |
| 5 | **Anthropic Console** | https://platform.claude.com/dashboard | Layout grammar for agent products: persistent left sidebar → wide mission/work surface → event stream with timestamps at the bottom. Also the honest-observability tone: system messages rendered in the same feed as model output, nothing glamorized. Warm-neutral accent family confirms the existing JEXI warm-orange direction. | **ADOPT** (layout grammar, event-stream-as-first-class-panel) |
| 6 | **OpenClaw Mission Control** | https://github.com/abhi1693/openclaw-mission-control | Agent-fleet dashboard patterns: per-agent cards with state pills, task assignment view, fleet-level rollups. Confirms that "Active Agents" deserves its own panel (not buried in a table) and that each agent needs: identity, state, current task, resource load. | **ADOPT** (per-agent card anatomy) |
| 7 | **agent-monitor repos (class)** | GitHub search: agent dashboards (e.g. openclaw-mission-control, agent-monitor style fleet views) | The common failure mode of this class: widgets-first dashboards (big charts, no state). What survives review is STATE-FIRST dashboards: what is running, since when, on what, costing what. | **ADOPT the lesson, reject the widget clutter** |
| 8 | **Lattice (workforce UI patterns)** | https://lattice.com (product surface study) | Workforce/roster surfaces: people-rows with role, status, and load; group-by-team navigation. Contributed the "roster as first-class resource" idea — JEXI's Employees (Zola, Forge, Vera, Nyx, Atlas, Echo, Scout, Kito, Ada) are stable identities, and the UI must present them as staff, not as model IDs. | **ADOPT** (staff-roster presentation) |

### Tools surfaced by the user

| # | Reference | Source | What it contributed | Decision |
|---|-----------|--------|---------------------|----------|
| 9 | **HorizonX / Horizon UI (Tailwind dark kits)** | https://github.com/horizon-ui/horizon-tailwind-react | Dark-kit component economy (cards, stat tiles, tables). Also a cautionary tale: its decorative gradients and oversized rounded cards are the OPPOSITE of an operator instrument. Take the card inventory, reject the decoration. | **PARTIAL** (card inventory only) |
| 10 | **Magic Patterns** | https://www.magicpatterns.com | AI → shadcn/Tailwind generation workflow. Relevant later for speed-running the React build from the approved preview; contributes nothing to the design itself. | **ADOPT as build tooling** (not a design source) |
| 11 | **Relume** | https://www.relume.io | Structure-only discipline: sitemaps and wireframes before styling. This research doc + the static preview ARE the Relume step for the console: structure approved before a single React line. | **ADOPT the method** |
| 12 | **Framer** | https://www.framer.com | Rejected for the app surface (marketing-site tool). Relevant ONLY if the console ever needs a public landing page. | **REJECT** (out of scope) |
| 13 | **Phase** | https://phase.com | Micro-interaction polish (easing, spring curves). Deferred: interactions come after layout approval. | **DEFER** (later polish) |

### Agent-control-plane patterns

| # | Reference | Source | What it contributed | Decision |
|---|-----------|--------|---------------------|----------|
| 14 | **ECC Control Plane (affaan-m/ECC)** | https://github.com/affaan-m/ECC (patterns as supplied in the phase-6 brief + public repo context: an agent harness with skills, memory, hooks, evaluations) | The HUD Status Contract — the operator glance must answer: `context` (budget/pressure), `toolCalls`, `activeAgents`, `todos`, `checks`, `cost`, `risk`, `queueState`, `sessionControls`. Also the operator-surface inventory: sessions, queues, skills, memory, evidence, releases; and the live 2D projection idea (a spatial map of the work graph rather than a static list). | **ADOPT the HUD contract** as the mission-header + status-pill checklist |

## 2. Chosen visual direction

**One sentence:** a dark, dense operator's instrument in the Linear/Geist
posture, carrying JEXI's existing warm-orange identity — flat surfaces,
borders over shadows, monospace for data, warm accent used sparingly.

### Palette (continuity with the existing `src/jexi-theme.css` identity)

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#0B0E14` | Canvas (slightly blue-black, matches existing app bg) |
| `--panel` | `#10141C` | Panel surface (flat, one step up from canvas) |
| `--panel-2` | `#151A24` | Raised element (pills, inputs, hover) |
| `--line` | `#1F2733` | Borders — the ONLY separator (no shadows) |
| `--ink` | `#E8ECF1` | Primary text |
| `--muted` | `#8B94A3` | Secondary text, labels |
| `--dim` | `#5C6675` | Tertiary (timestamps, disabled) |
| `--accent` | `#FF8A3D` | THE warm accent (existing `--mag`) — active nav edge, primary buttons, focus, running states |
| `--accent-dim` | `rgba(255,138,61,.13)` | Tinted background behind accent states |
| `--ok` | `#3FB68B` | Success/verified (green, LCH-tuned, not neon) |
| `--ok-dim` | `rgba(63,182,139,.12)` | Verified-pill background |
| `--warn` | `#D8A83E` | Amber: waiting/attention (existing token) |
| `--warn-dim` | `rgba(216,168,62,.13)` | Waiting-pill background |
| `--err` | `#E5484D` | Failed/refused |
| `--err-dim` | `rgba(229,72,77,.12)` | Failed-pill background |
| `--info` | `#4A9EFF` | Info/system events (existing token) |

Rules carried over from the existing theme's own law (it already bans these —
this research confirms and extends the ban): **no glassmorphism, no gradient
text, no glow, no purple, no decoration gradients.** Separation is 1px borders
on flat surfaces (Linear lesson). Status colors always appear as small pills
ON tinted backgrounds (`*-dim`), never as saturated blocks (Linear lesson).

### Typography

- **Sans (labels, nav, prose):** Inter (`Inter, -apple-system, 'Segoe UI', sans-serif`) — neutral, dense, the Geist/Linear posture without shipping a custom font. NOT geometric-display faces (Poppins/Outfit family: too marketing).
- **Mono (all data):** `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace` — zero-download system stack, identical to the existing app's `--mono`. Mono is for: node ids, timestamps, tool names, args, durations, token/cost figures, event types. **The data/label split is the single hardest rule of this design.**
- **Sizes:** 12px base for panel data (dense operator surface), 11px labels/uppercase tracking for section headers, 13px for nav, 20px/600 for the mission title. Line-height 1.45 body, 1.2 data rows.
- **Handwriting (Caveat):** present in the existing app on short display lines only. In the CONSOLE it appears exactly once — the wordmark region — and never on data. (Legibility lesson of 2026-09-08 stands.)

### Density

- 4px spatial rhythm; panel padding 12px; row height 26–28px (Linear-grade density, not dashboard-grade airiness).
- One screen = the whole mission: sidebar (fixed 232px) + mission header + three-column body + event stream docked bottom (always visible, ~176px).
- Nothing hidden behind tabs in v1: operator glance must answer the full ECC HUD contract without a click.

## 3. Panel-by-panel rationale

1. **Sidebar (232px, fixed)** — nav groups **Executive** (Mission, Work Graph, Agents, Sessions), **Resources** (Memory, Skills, Knowledge, Connectors), **Extensions** (Plugins, MCP Servers, Scheduler, Model). Grouped like Anthropic Console; active item = accent-tinted row with a 2px accent LEFT EDGE (existing `.jx-mi.active` pattern — continuity). Footer = **model selector** (`/model` integration): provider + model id in mono, a single click opens the picker; beneath it the ONE-KEY status ("1 key · Gemini · healthy") because ONE-KEY is a system invariant worth surfacing.
2. **Mission header (topbar)** — mission title + status pill (RUNNING green-tint), elapsed timer (mono), then the ECC HUD contract as inline stats: context % (with pressure color: cool/warm), tool calls, active agents, todos, checks, cost ($, mono), risk pill, queue state. Session controls (pause/stop) on the right. This single row IS the HUD Status Contract.
3. **Work Graph (left-center, 1.6fr)** — the Director's work graph as nodes: state dot (pending dim / running accent pulse / verified green / failed red), node title, owner avatar + name, verification badge (✓ VERIFIED or ⚠ REFUSED) where verification ran, dependency edges drawn as simple 1px elbow lines (the "live 2D projection" idea, kept modest: DOM+SVG, not canvas). Nodes are rows-with-edges, not floating cards — density.
4. **Active Agents (right-center, 1fr)** — one card per live employee (Zola, Forge, Vera, Nyx, Atlas, Echo, Scout, Kito, Ada): initials avatar (accent-tinted circle, NOT photos), name + role, state pill (working / idle / blocked), current task line (mono, truncated), resource bar (context window used, thin 3px bar — accent at >70% warm, red at >90%).
5. **Recent Tool Calls (right column, below Active Agents)** — the last N calls: tool name (mono), compact args preview (mono, dim, truncated), status pill (ok/warn/err), duration (mono, right-aligned). Ties the work graph to ground truth: what actually ran.
6. **Live Event Stream (docked bottom, always visible)** — timestamp (mono, dim) · type chip (TOOL/AGENT/PLAN/STREAM/SYS with per-type hue) · message (sans for prose, mono for embedded data). Auto-scrolls, pauses on hover, never collapsible below 140px: the stream is the console's honesty layer — Anthropic Console pattern.
7. **Model selector (sidebar footer)** — see sidebar above; it is the `/model` integration point.

## 4. What was rejected and why

- **Glassmorphism / translucent panels** — banned by the existing JEXI theme law; also legibility-hostile at density.
- **Gradient text and glow states** — same ban; the wordmark is solid warm ink (already fixed once in `jexi-theme.css`).
- **Purple/violet accent** — the default "AI product" look; JEXI's identity is warm graphite, established and approved.
- **Dashboard widgets-first layouts (Horizon-class kits as-is)** — big charts, KPI tiles with no state: answers "how impressive" not "how is it running". The console is state-first.
- **Framer-style marketing layouts** — wrong artifact class for an operator console.
- **Light theme** — rejected for v1: the operator surface is watched long-form in dark rooms; Linear/Anthropic precedent; and the entire existing app is dark-first.
- **Canvas/WebGL graph projection (full ECC-style live 2D projection)** — deferred: DOM+SVG edges deliver the readability of the projection without a rendering-engine dependency in v1.
- **Custom icon font / CDN icons** — the preview and the build both use inline SVG only (offline-safe, zero-dependency; matches the scope's no-CDN rule).
- **Photos/illustrations for agents** — the 9 employees are stable identities; consistent initials-avatars in accent tints keep the roster legible at 26px rows.

## 5. Preview

`ui/preview/console.html` — single self-contained file, inline SVG only, no
external dependencies, opens with zero setup. It renders the full console:
sidebar + mission header (full HUD contract) + work graph + active agents +
tool calls + live event stream, with the real palette, the real typography
rules, and real JEXI content (Forge fixing a failing test, Vera verifying,
the 9-employee roster, ONE-KEY status). It looks the way the React app is
required to look.

**Approval gate:** the React build (Phase 6F-build) starts ONLY after this
preview (and this document) are approved.
