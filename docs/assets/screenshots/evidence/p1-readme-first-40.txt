$ sed -n '1,40p' README.md
# JEXI OS

**An agentic operating system that plans, acts, remembers, and proves.**

<p>
  <a href="https://github.com/lewiseinstein15-Tech/jexi-os-/actions/workflows/ci.yml"><img src="docs/assets/screenshots/badges/build.svg" alt="CI build status"></a>
  <a href="LICENSE"><img src="docs/assets/screenshots/badges/license.svg" alt="MIT license"></a>
  <a href="package.json"><img src="docs/assets/screenshots/badges/node.svg" alt="Node.js 22 or newer"></a>
  <a href="#roadmap"><img src="docs/assets/screenshots/badges/phases.svg" alt="Phases 0 through 30"></a>
  <a href="#quality"><img src="docs/assets/screenshots/badges/tests.svg" alt="More than 4,000 checks"></a>
</p>

![JEXI OS executive console running against the live local brain](docs/assets/screenshots/console-hero.png)

## What is JEXI?

JEXI is an agentic operating system that turns an objective into observable, resumable work. Its brain combines deterministic routing, provider-backed reasoning, memory, scheduling, recovery, and evidence. Specialized agents plan, delegate, execute, critique, and verify through stable contracts instead of pretending that one model did everything. Permission-gated computer control connects the system to browsers, files, shells, devices, and external tools while reporting unavailable workers honestly.

![Kernel to Agents to Brain to Tools to Surfaces architecture](docs/assets/screenshots/architecture.svg)

## Feature matrix

Screens are captured from the current local console; a labeled icon is used where a capability has no wired UI. Nothing below is a product mockup.

| Capability | What exists today | Surface evidence |
|---|---|---|
| **Executive kernel** | Deterministic-first intent, policy, budget, scheduling, recovery, and verification seams. | <img src="docs/assets/screenshots/placeholder-runtime-only.svg" alt="Runtime-only capability placeholder" width="180"> |
| **Brain and providers** | Provider/model selection, key-reference handling, health, context, memory, and provider-independent routing. A hosted provider requires a valid key. | <img src="docs/assets/screenshots/settings-provider.png" alt="Live provider settings" width="180"> |
| **Agent workforce** | Stable employee contracts, capability staffing, runtime bench controls, and per-agent execution history. | <img src="docs/assets/screenshots/agents-view.png" alt="Live agent fleet" width="180"> |
| **Chat and tool receipts** | The Phase 16 runtime routes narration, tool calls, results, approvals, and terminal turn state into the Phase 24 console. | <img src="docs/assets/screenshots/chat-toolcards.png" alt="Live chat tool cards" width="180"> |
| **Modes and approvals** | Inline through full display modes plus plan/act interaction controls; destructive work is approval-gated. | <img src="docs/assets/screenshots/chat-modes.png" alt="Live full mode and approval receipts" width="180"> |
| **Persistent work graph** | Mission graph route with deterministic layout, node details, zoom/pan, and an explicit empty state. The current capture reports zero nodes rather than seeding fake work. | <img src="docs/assets/screenshots/workgraph-nodes.png" alt="Live work graph route in its current state" width="180"> |
| **Multi-agent execution** | The executive chat shows the live plan, selected roster, named pipeline events, and tool routing. Phase 16 split/nested projections remain runtime-only. | <img src="docs/assets/screenshots/chat-multiagent.png" alt="Live multi-agent plan" width="180"> |
| **Computer control** | Browser Router, desktop, Android, shell, file, and MCP seams are permission-gated. No local desktop worker was available during this capture. | <img src="docs/assets/screenshots/placeholder-computer-control.svg" alt="No local desktop worker placeholder" width="180"> |
| **Workspace checkpoints** | The classic Files surface exposes real checkpoint, diff, and rollback controls. This is separate from the runtime-only Phase 16 chat checkpoint module. | <img src="docs/assets/screenshots/checkpoint.png" alt="Live workspace checkpoint surface" width="180"> |

## Gallery

<table>
  <tr>

$ file docs/assets/screenshots/readme-rendered.png
docs/assets/screenshots/readme-rendered.png: PNG image data, 1440 x 1000, 8-bit/color RGB, non-interlaced
$ stat -c '%s bytes' docs/assets/screenshots/readme-rendered.png
189709 bytes
