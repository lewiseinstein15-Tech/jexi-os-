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
    <td width="50%"><img src="docs/assets/screenshots/console-hero.png" alt="JEXI executive console"><br><strong>Executive console</strong> — current local brain, HUD, event stream, and plan.</td>
    <td width="50%"><img src="docs/assets/screenshots/chat-toolcards.png" alt="Phase 24 chat tool cards"><br><strong>Tool receipts</strong> — deterministic Phase 16 read call and result.</td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/settings-provider.png" alt="Provider settings"><br><strong>Provider settings</strong> — provider, model, and key reference; no inline secret.</td>
    <td><img src="docs/assets/screenshots/workgraph-nodes.png" alt="Work graph"><br><strong>Work graph</strong> — honest live state: the selected mission currently has no work items.</td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/agents-view.png" alt="Agent fleet"><br><strong>Agent fleet</strong> — contracts loaded from the live brain.</td>
    <td><img src="docs/assets/screenshots/chat-modes.png" alt="Chat modes"><br><strong>Full / act</strong> — approval plus started/completed tool receipts.</td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/chat-multiagent.png" alt="Multi-agent execution"><br><strong>Multi-agent execution</strong> — real roster and named pipeline; the model is visibly unresolved.</td>
    <td><img src="docs/assets/screenshots/checkpoint.png" alt="Workspace checkpoint controls"><br><strong>Workspace checkpoints</strong> — live Files surface; current checkpoint history is empty.</td>
  </tr>
</table>

## Quick Start

> **Requirement:** Node.js **22 or newer**. This repository uses APIs that degrade under Node 20.

1. **Clone the repository.**

   ```bash
   git clone https://github.com/lewiseinstein15-Tech/jexi-os-.git
   cd jexi-os-
   ```

2. **Install the locked root and brain dependencies.**

   ```bash
   npm ci
   npm --prefix server ci
   ```

3. **Configure one provider through Settings → Model.** Export a valid hosted-provider key first, for example `OPENAI_API_KEY`, then choose its provider/model and enter the environment-variable name or approved keyring reference after the console opens. The key-reference field must not contain the secret itself; at least one configured provider with a valid key is required for provider-backed execution.

4. **Run the brain and web console.**

   ```bash
   # terminal 1 — brain on :3002
   npm --prefix server start

   # terminal 2 — Vite on :3000
   npm run dev
   ```

   Open <http://localhost:3000>. `npm run dev:full` is the one-terminal equivalent.

> Capture-host provider execution: **NOT VERIFIED - requires provider**. Health, deterministic chat runtime, settings, agents, and console rendering were verified without claiming a configured model.

## Roadmap

| Stage | Status | Outcome |
|---|---|---|
| **Phases 0–27** | **Merged** | Core OS, brain, workforce, tools, memory, autonomy, Phase 16 chat runtime, Phase 24 console rebuild, and provider profiles. |
| **Phase 28** | **In flight** | Memory, retrieval, knowledge-graph, reranking, and evaluation work is backend-only; no UI is claimed. |
| **Phase 29** | **In flight** | Backend-only system work; no visible surface is fabricated for it. |
| **Phase 30** | **In flight** | Harness parity, agent patterns, documentation, and the final regression gate. |
| **Benchmark** | **Next** | Run the frozen benchmark and publish comparable evidence. |
| **Go Live** | **Next** | Complete release checks, deployment, monitoring, and operator handoff. |

## Architecture

The Executive Kernel owns intent, policy, budgets, scheduling, and recovery. It staffs agents through stable contracts; agents use brain services for reasoning, context, memory, and verification; permission-gated tools touch the outside world; every surface consumes the same observable events. The visual chain above is the short form, while [REBUILD-MAP.md](docs/REBUILD-MAP.md) maps the broader rebuild to its implementation and proof.

```mermaid
flowchart TB
    S[Surfaces: Web · Android · API] --> K[Executive Kernel]
    K --> A[Agent workforce]
    A --> B[Brain services: providers · context · memory]
    B --> T[Permission-gated tools]
    T --> C[Computer · browser · shell · files · MCP]
    C --> E[Evidence · receipts · world state]
    E --> K
```

```text
SURFACES
   ↓ commands / ↑ events
KERNEL → AGENTS → BRAIN → TOOLS → COMPUTER + EXTERNAL SYSTEMS
   ↑                                            │
   └──────── evidence, receipts, verification ──┘
```

## Documentation

Start with the complete, linked [documentation index](docs/README-INDEX.md). It inventories every file under `docs/`, including architecture, audits, implementation reports, research, screenshots, and Scope H evidence.

## Quality

- The repository contains **4,000+ automated checks** across the brain, agents, tools, memory, autonomy, security, browser routing, and UI contracts.
- Run the full backend suite with `npm test`; run the production frontend build with `npm run build`.
- Screenshots in this README are generated by [`scripts/phase30-readme-shots.mjs`](scripts/phase30-readme-shots.mjs) against `localhost`, not by a design mock.
- Provider-dependent behavior must be reported as not verified when no valid provider is configured.

## Contributing

Use a **branch per scope**, keep each change inside its declared zone, and attach raw verification evidence. Prefer small, reviewable commits; do not combine unrelated scopes or claim a surface that was not exercised.

## License

Code is licensed **MIT** — see [LICENSE](LICENSE). Data obtained from external
providers is **NOT** covered by MIT: every external data source carries its own
license and terms, documented per source in [DATA_SOURCES.md](DATA_SOURCES.md).
Dependency licenses are aggregated in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

*Built by Lewis & the JEXI agent · MIT · 100% free-tier infrastructure, no credit card, ever.*
