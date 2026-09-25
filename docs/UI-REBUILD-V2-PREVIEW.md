# UI REBUILD v2 — Preview & Verify Runbook (palette D — SIGNAL)

Branch: `ui/rebuild-premium-v2` · Base: `bd4787cd` · Preview only — NOT merged to main.

## Boot

```bash
cd ~/jexi-os-fresh            # (sandbox: /home/z/my-project/jexi-29)
git checkout ui/rebuild-premium-v2
npm ci                        # optional — node_modules already present
npm run dev:full
# brain: http://localhost:3002/api/health -> {"ok":true,...}
# ui:    http://localhost:3000/
```

Then type `hello` in the chat. The turn renders as the Arena-style trace:
thinking block (when the model streams reasoning) → step list → command /
tool blocks (when the turn emits them) → streaming answer → turn footer.

## Component demo harness (fixed real-shaped rows)

`http://localhost:3000/interfaces/console/transcript-demo.html` — mounts the
REAL Transcript orchestrator with rows copied from real captured events.
Purpose: the sandbox preview is keyless (no model provider), so `think`
events cannot be produced live; the demo shows ThinkingBlock + paired
ToolUseBridge tool rows with clearly-labeled fixed data. The live chat path
never reads this file.

## Screenshots (docs/ui-rebuild-v2-screens/)

| File | Source |
|---|---|
| 00-boot-shell.png | live boot |
| 01-chat-thinking-expanded.png | demo harness (think needs a live model leg) |
| 02-chat-steps-running.png | live `hello` turn mid-flight |
| 03-chat-command-block.png | live `/gui status` turn (real command + output) |
| 04-chat-tool-call.png | demo harness (ToolUseBridge pair shapes) |
| 05-chat-final-answer.png | live `hello` turn, completed |
| 06-chat-full-turn.png | live `hello` turn, full trace |
| 07-settings-with-provider-custom.png | live Settings → Model (CUSTOM present) |
| 08-agents-roster.png | live Agents view (real /api/roster) |
| 09-work-graph.png | live Work Graph (honest empty state) |
| 10-mobile-collapsed.png | live 390×844 viewport |
| 11-light-theme.png | live theme toggle (D paper variant) |

## Streaming event → component map (real wire)

| NDJSON event (/api/chat) | Row family (mount) | Component |
|---|---|---|
| `think` `{text}` | narration.line recon (merged per turn) | ThinkingBlock |
| `plan` `{steps[]}` | narration.line decision | StepList (pending steps) |
| `log` `{agent, message}` | narration.line progress | StepList (executed steps) |
| `narration` `{text}` | narration.line finding | StepList (executed steps) |
| `tool_use` `{id, tool, status, duration_ms, detail}` (ToolUseBridge) | tool-use / tool-result / tool-error (paired by id) | CommandBlock (`$` detail) / ToolCallBlock |
| `stream` `{text}` (merged) | message.delta text (jexi) | FinalAnswer (cursor → coral border) |
| `done` `{summary, success, statistics}` | turn-end-ok / turn-end-fail | TurnFooter (real ms; no token figure — not streamed) |
| runtime `tool.*` events (runtime-registered tools, `/gui` dispatch) | tool-use / tool-result / tool-error | CommandBlock / ToolCallBlock |
| `heartbeat`, `team`, `intel`, `agent.done`, `subagent.aggregate`, `agent.log` | telemetry — skipped | — |

Honesty rules: no block renders without its real event; unknown events render
as muted system lines; the turn footer shows `provider unresolved` (muted red)
when no provider is configured; token counts are never faked.
