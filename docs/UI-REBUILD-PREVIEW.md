# JEXI OS — Premium Console UI Rebuild — Preview & Verify Guide

Branch: `ui/rebuild-premium` @ `bd1a3df1` (7 commits, off main @ `bd4787cd`, tag `pre-ui-rebuild`)

## Live preview (lead runbook)

```bash
cd ~/jexi-os-fresh
git fetch origin
git checkout ui/rebuild-premium
npm ci
cd server && npm ci && cd ..
npm run dev:full
# UI  -> http://localhost:3000  (Vite, ~200ms)
# brain -> http://localhost:3002 (JEXI OS brain)
```

`npm run build` verified green on this branch (vite 5.4.21, ~15s; pre-existing
chunk-size warnings only).

## What to check

| Route | Expect |
|---|---|
| `#/chat` | premium empty state; send "hello" -> queue ack -> real `/api/chat` NDJSON stream rows -> `turn completed: <id> · <ms> ms` footer |
| `#/settings` | PROVIDER (17-provider live catalog incl. **Custom** w/ Base URL + API key + model, Save / Test connection), MODES, GENERAL theme, APPEARANCE (accent / font size / density) |
| `#/graph` | real `/api/missions` graph or honest "No work graph data" empty state |
| `#/agents` | roster from `/api/roster` (252 agents / 508 skills), tier chips, search, click -> detail panel |
| Header | model chip resolves from `/api/providers/active`; hamburger + drawer <600px; theme toggle |
| Sidebar | lucide nav, model indicator (red "unresolved" until configured), backend dot |
| Anywhere | `Cmd/Ctrl + /` shortcuts overlay; `g`+`c/s/w/a/t` nav/theme; toasts top-right on provider save |

## Screenshots (this directory)

1. `01-chat-empty.png` — chat empty state
2. `02-chat-with-message.png` — real turn (user bubble right, JEXI rows left, completed footer)
3. `03-settings-provider-custom.png` — Provider section, Custom selected
4. `04-work-graph.png` — work graph honest empty state
5. `05-agents-list.png` — roster + Planner detail panel
6. `06-mobile-collapsed.png` / `06b-mobile-nav-open.png` — <600px drawer
7. `07-light-theme.png` — light theme (optional)

## Sandbox notes (verification context)

- Dev boot in the authoring sandbox: VITE ready in 217 ms; brain on 3002
  ok:true; no AI provider key configured (keyless pollinations leg answered
  the probe turn — real pipeline output, not the old stub).
- The chat turn in `02-chat-with-message.png` ran through the REAL pipeline
  (`POST /api/chat`): queue ack -> server log rows -> streamed answer ->
  `turn completed: console-main:turn-1 · 58 ms`.
