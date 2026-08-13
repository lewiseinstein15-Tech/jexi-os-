# JEXI OS — Master Architecture Research Report

**Status:** Research complete · Implementation begins in controlled stages (roadmap in §Q).
**Sources used:** the public `xai-org/grok-build` repository (README, crate layout via the GitHub API, `xai-grok-pager` user-guide chapters on MCP servers, skills, hooks), the official xAI announcement *"Grok Build is Now Open Source"*, and docs.x.ai/build/overview. Anything that could not be confirmed from the public source is explicitly marked **"cannot confirm from the public source"** and is not asserted as fact. No xAI source code is copied; this is architectural research only.

---

## A. Grok Build architecture (verified)

Grok Build (`grok`) is SpaceXAI's terminal-based AI coding agent: a **Rust CLI/TUI plus an agent runtime**, published under Apache 2.0 and periodically synced from the SpaceXAI monorepo (a `SOURCE_REV` file records the source commit). The announcement confirms the published source covers four layers:

1. **The agent loop** — how context is assembled, how model responses are parsed, how tool calls are dispatched.
2. **The tools** — how the agent reads, edits, searches code, and runs commands.
3. **The terminal UI** — rendering, input handling, plan review, inline diff viewer.
4. **The extension system** — skills, plugins, hooks, MCP servers, subagents.

It runs in three modes: an **interactive fullscreen TUI**, **headless** (`grok -p "…"`, `--output-format streaming-json`) for scripts/CI, and **embedded via the Agent Client Protocol (ACP)** for editor integration. It is deliberately **local-first**: the README states you can compile it yourself and point it at your own local inference engine, with everything driven from `config.toml`.

Design posture: a *harness* — the repo README and announcement both frame it as a "robust and reliable harness" whose primary job is context assembly and tool-call dispatch on top of a strong model (Grok 4.6). It is not an agent framework for arbitrary web apps; it is a coding-agent runtime with an opinionated TUI.

## B. Grok Build component map (verified from repo layout)

| Crate / area | Role |
|---|---|
| `crates/codegen/xai-grok-pager-bin` | Composition root — builds the `xai-grok-pager` binary (shipped as `grok`). |
| `crates/codegen/xai-grok-pager` | The TUI: scrollback, prompt, modals, rendering; ships the user guide. |
| `crates/codegen/xai-grok-shell` | **Agent runtime** — `agent/` (agent loop), `leader/`, `bin/` entry points (leader/stdio/headless), `extensions/`, `config/`, `inspect/`, `auth/`, `claude_import.rs` (Claude Code migration), `builtin.rs`, `instrumentation.rs`. |
| `crates/codegen/xai-grok-tools` | **Tool implementations** — `implementations/`, `computer/` (computer-use), `bridge.rs` (37 KB dispatcher), `persistence.rs`, `normalization.rs`, `gitignore.rs`, `attribution.rs`, `notification/`. |
| `crates/codegen/xai-grok-workspace` | **Host filesystem, VCS, execution, checkpoints** — `file_system/`, `activity.rs` (98 KB — action/permission activity tracking), `capability.rs`, `config.rs` (47 KB), `discovery.rs`, `envrc.rs`, `export_github.rs`, `error.rs`. |
| Other codegen crates | config, MCP, markdown, sandbox, and the rest of the CLI closure. |
| `crates/common/`, `crates/build/`, `prod/mc/` | Small shared leaf crates. |
| `third_party/` | Vendored upstream (Mermaid diagram stack). |
| `THIRD-PARTY-NOTICES` | Confirms **in-tree source ports of `openai/codex` and `sst/opencode` tool implementations** — i.e. Grok Build reuses battle-tested open tool implementations rather than reinventing them. |

Communication: crates are ordinary Rust modules of one binary (no separate services). The TUI (`pager`) drives the agent runtime (`shell`) via a channel/leader pattern; the runtime calls into tools (`tools`) and workspace primitives (`workspace`); extensions are discovered and loaded by the runtime (`shell/src/extensions/`). Headless and TUI share the same runtime — only the front-end differs.

## C. Grok Build agent execution lifecycle (partially verified)

Confirmed from the announcement + user guide:
1. **Context assembly** — the runtime assembles project context (config sources, instructions/AGENTS.md, skills, plugins, hooks, MCP servers — `grok inspect` lists what was discovered).
2. **Model interaction** — send context+prompt to the configured model (Grok 4.6 default; custom models via `config.toml` `[model.*]` with `base_url` + `env_key`).
3. **Parse model response** — responses parsed into text + tool calls.
4. **Tool-call dispatch** — the runtime dispatches each tool call to the tool layer (with hooks gating around it).
5. **Loop** — results feed back into context and the agent continues until the model finishes.
6. **Turn-end gating** — `Stop` hooks run before the turn actually ends and can keep the agent working ("the test suite hasn't been run yet"), with an 8-continuation cap per turn (verified in the hooks guide).
7. **Subagents** — `spawn_subagent` runs child tasks with their own turns (`SubagentStart`/`SubagentStop` hooks; a native subagent view in the TUI).

What I **cannot confirm from the public source**: the exact token-budget/compaction algorithm, retry counts, and model-specific prompt internals. The user guide references `PreCompact`/`PostCompact` hook events, so conversation compaction exists; its exact policy is not summarized here.

## D. Grok Build tool execution lifecycle (verified)

Confirmed structure:
- **Tools live in `xai-grok-tools`** (`implementations/`, `computer/`, dispatcher `bridge.rs`, `persistence.rs`). Known tool names confirmed via the hooks guide tool-name aliases: `read_file`, `search_replace` (covers Edit/Write/MultiEdit), `run_terminal_command` (Bash), `grep`, `list_dir`, `web_search`, `spawn_subagent` (Task), plus `search_tool` and `use_tool` for MCP.
- **Dispatch**: `PreToolUse` hook (can deny → `{decision: "deny", reason}`) → execute → `PostToolUse` / `PostToolUseFailure`. `PermissionDenied` fires when the permission system blocks a call. Tool results are validated and (for MCP) size-capped (default 20,000 bytes, truncated inline, full payload spilled to session `mcp/`).
- **MCP tools** are routed through `use_tool` and appear as qualified `server__tool` names (e.g. `linear__save_issue`).
- Hooks are **fail-open** by default (record, don't block); only an explicit deny blocks.

Lessons for JEXI: every tool execution is *observable and interceptable* (hooks at dispatch boundaries), tool names are stable and aliased for compatibility, MCP tools are namespaced, and large outputs are truncated with a spill-to-disk path.

## E. Grok Build workspace architecture (verified)

`xai-grok-workspace` owns **host filesystem, VCS, execution, and checkpoints** (per the README layout table). Confirmed modules: `file_system/` (host FS), `activity.rs` (a very large activity/permission tracking module), `capability.rs` (capability gating), `config.rs`, `discovery.rs` (walks cwd → git root discovering `.grok/config.toml`, skills, hooks, MCP), `envrc.rs` (environment-file handling), `export_github.rs`, `error.rs`. The README's one-line description is: "Host filesystem, VCS, execution, checkpoints" — i.e. the workspace is where file edits, shell execution, git operations, and snapshot/checkpoint mechanics live. Checkpoint/diff/rollback details beyond that description are **not confirmed from the public source**; the TUI's "inline diff viewer" and plan-review UI are confirmed by the announcement and README.

## F. Grok Build sandbox architecture (partially verified)

- The repo ships a **sandbox crate** and the user guide covers **sandboxing** (README: "…config, MCP, markdown, sandbox, …" crates; user-guide: "…MCP servers, skills, plugins, hooks, headless mode, sandboxing, and more").
- A third-party wire-level analysis (Hacker News thread, July 2026) claims: read-only working project directory, `.git` read-only, sensitive directories hidden, and an isolated network namespace. **I cannot confirm these specifics from the public source** — treat them as unverified third-party claims to study, not facts.
- The **folder-trust model is verified**: project-local hooks, MCP servers, and LSP servers only run after the user trusts the folder (`~/.grok/trusted_folders.toml`, `/hooks-trust`, `--trust`). This is the verified security gate.

## G. Grok Build extension architecture (verified)

The announcement explicitly names the extension system: **skills, plugins, hooks, MCP servers, and subagents**. The runtime (`xai-grok-shell/src/extensions/`) is the loader. Discovery is unified: `grok inspect` reports config sources, instructions, skills, plugins, hooks, and MCP servers, and tags each item's origin (project / user / bundled / plugin / managed / compat-vendor). Hooks, MCP, and folder-trust are unified under one trust store. Compat surfaces (`.claude/`, `.cursor/`) are scanned by default and can be disabled per vendor.

## H. Grok Build skills architecture (verified in detail)

- A skill is a **directory containing `SKILL.md`** (YAML frontmatter + markdown body). Frontmatter fields: `name`, `description` (drives auto-invocation), `when-to-use` (trigger phrases), `allowed-tools`, `argument-hint`, `user-invocable`, `disable-model-invocation`, `model` (per-skill model override), `effort`, `license`, `compatibility`, `metadata`.
- **Discovery tiers, highest priority first:** `.grok/skills|commands` (local cwd) → repo root `.grok/` → user `~/.grok/` → Claude/Cursor compat dirs. Dedup by name; higher tier wins. Discovery walks every directory between cwd and repo root; skill discovery deliberately does **not** use `.gitignore`.
- **Invocation:** slash command `/name` (with args), plus **automatic model invocation** by matching the prompt against `description`/`when-to-use`. Colliding names stay invocable under qualified names (`/local:commit`, `/acme:login`).
- **Distribution:** project scope (version-controlled), user scope, bundled skills (`~/.grok/bundled/skills/`), and plugin-provided skills (marketplace-published).
- Skills reload on disk changes; `/create-skill` scaffolds new skills interactively; `grok inspect` lists everything.

## I. Grok Build subagent architecture (verified)

- **`spawn_subagent`** is a first-class tool (aliased from Claude's `Task`). Subagents run their own turns with their own context.
- **Lifecycle hooks**: `SubagentStart` / `SubagentStop` (with stop-decision control, gating, and a 600s hook timeout); inside a subagent, Stop hooks remap to `SubagentStop`.
- The TUI has a **native subagent view** (announced with Grok 4.6).
- Detailed spawning policy (max parallel subagents, per-subagent context budgets) is **not confirmed from the public source**.

## J. Grok Build MCP architecture (verified in detail)

- Configured under `[mcp_servers.<name>]` in `~/.grok/config.toml` (user) or `<repo>/.grok/config.toml` (project, medium) or `<cwd>` (highest); walks cwd → git root. Project configs contribute `[mcp_servers]`, `[plugins]`, `[permission]`.
- **Transports:** stdio (`command`/`args`/`env`), HTTP/SSE (`url`), streamable HTTP with session id, with `startup_timeout_sec`, `tool_timeout_sec`, per-tool overrides, and `${VAR}` env expansion.
- **CLI management:** `grok mcp add|list|remove|enable|disable|doctor` (stdio/http/sse transports, `-e` env, project or user scope).
- **Tool discovery/call:** model uses `search_tool` (find tools) and `use_tool` (call fully-qualified `server__tool`), so the agent doesn't need the full tool schema in context up front.
- **OAuth** for hosted servers (tokens in `~/.grok/mcp_credentials.json`, 0600), static bearer via headers, `{{session_id}}` templating.
- **Safety:** result size cap (20 KB default), output spilled to session `mcp/` folder, tool namespacing prevents collisions, compat sources (`.mcp.json`, `.claude.json`, Cursor) merged with native config winning.

## K. Current JEXI architecture (verified from this repo)

JEXI OS today is a **Node.js (Express) agent brain + a Vite/React mobile-first UI**, with a 207-specialist roster, a 495-skill registry, a 151-tool registry with auto tool routing, deep-domain routing, an 8-provider model router (Groq → Gemini → OpenRouter → Cerebras → DeepInfra → Mistral → Grok/xAI → HuggingFace) with failover, memory (tf-idf + vector), a verification loop (critic + revision), search/news/data/devops/github/vision/video/computer-use agents, an MCP server (`/mcp`), and a browser automator (Playwright).

Backend flow: `POST /api/chat` → `Planner.analyzeIntent` (deterministic intent classification + domain detection) → `Orchestrator.executePlan` (runs one specialist at a time, strict handoffs) → NDJSON event stream (`plan`/`log`/`website`/`done`) → UI. Gates: QA PASS / Security CLEAR enforced in `SkillChain`. Provider router: Groq → Gemini → OpenRouter → Cerebras → Together → DeepInfra → Mistral → HuggingFace with cooldowns.

## L. Current JEXI frontend architecture (verified)

- **Shell:** `App.jsx` — `Header` (wordmark + JexiCore ring + status) + `main` + `BottomNavigation` (6 tabs). Desktop ≥768px: chat centered ≤640px, 280px activity rail, tab bar moves into header; mobile: everything stacked with bottom nav.
- **State:** `useJexiEngine` consumes the NDJSON stream (buffered line parsing, cold-start retry, honest failure messages); `useMemory`, `useTypewriter`, `useUpdateChecker`; view-local state per component.
- **Views/components:** Home (ActivityWindow compact + ChatWindow), AgentsScreen (pipeline tabs + roster), MemoryPanel, KnowledgePanel, SettingsPanel, DownloadPanel, VisionPanel; rendering via `MarkdownRenderer` (react-markdown + KaTeX) and `TypedMessage`.
- **Design:** mission-control spec from a prior turn — near-black `#030303` base, neon green `#00FF9D` brand, agent palette, 4px spacing scale, Inter + JetBrains Mono.

**Assessment:** functionally rich but visually cramped and single-surface. Navigation is bottom-bar-only on mobile; everything lives on the Home screen; the conversation is one card among several. It reads as a chat app with extras, not an OS.

## M. Current JEXI backend architecture (verified)

Services under `server/src/services/`: `Planner` (intents + deep-domain routing), `Orchestrator` (pipeline + compound tasks), `SkillChain` (gates), `AgentRoster` (207 agents / 495 skills), `ToolRegistry` (151 tools) + auto tool routing, `LLMClient` + `ProviderRouter` (8-provider failover incl. Grok/xAI), `MemoryManager` (memory + knowledge library + layered/vector memory), `SearchAgent`/`SearchEngine`/`Extractor` (research team), `NewsAgent`, `DataAgent`, `GitHubAgent`, `DevOpsAgent`, `ComputerUseAgent` (Playwright), `VisionAgent`, `VideoAnalyst`, `VerificationLoop`, `Reasoner`, `JexiPrompt` (system prompt), `SelfMonitor`, plus `mcp-server.js` (MCP endpoint) and `index.js` (API routes).

## N. Gap analysis — JEXI vs. Grok Build and modern agentic systems

| Dimension | Grok Build (verified) | JEXI today | Gap |
|---|---|---|---|
| Agent loop | Context assembly → model → parse → tool dispatch → loop, with gated stop | Single-shot specialists chained with strict handoffs; no tool-calling loop | **#1: no unified tool-calling loop.** Agents *write text*, JEXI parses; no `read_file`/`edit`/`terminal` tool execution by the model. |
| Tool layer | First-class tool crate, stable schemas, dispatcher, per-tool timeouts, MCP via `search_tool`/`use_tool` | Tools are hardcoded service modules; no tool schema registry, no permission model per tool | **#2: no tool abstraction.** Adding a tool means editing the orchestrator. |
| Workspace | FS + VCS + execution + checkpoints; diffs; rollback | Workspace dir with generated files; no checkpoint/diff/rollback | **#3: no traceable workspace.** AI edits are not versioned/rollbackable. |
| Sandbox/trust | Sandbox crate + folder-trust gate for project hooks/MCP/LSP | No sandbox; browser/terminal run in-process | **#4: no isolation or trust model.** |
| Skills | `SKILL.md` packages, auto-invocation, tiers, slash commands | Skill *files* exist but are used as specialist prompts, not user-invocable/auto-discovered packages | **#5: skills are not first-class** (no `/skill` UX, no auto-discovery at the UI level). |
| Subagents | `spawn_subagent`, per-turn context, native view | Compound tasks chain phases; no parent/child runtime | **#6: no subagent runtime** (parallel, cancel, timeout, aggregation). |
| Hooks | Lifecycle hooks with blocking decisions | None | **#7: no hook system.** |
| Plugins | Plugin install/enable/disable via marketplaces | None | **#8: no plugin system.** |
| Models | Multi-model config, per-skill model override, local inference | Router with failover but no per-agent model routing UI | **#9: model routing is global, not per-agent/per-skill.** |
| Background tasks | Background tasks + session crons (`/loop`, `scheduler_create`) | Tasks run synchronously in the request | **#10: no background task/cron layer.** |
| Terminal/computer | `run_terminal_command`, computer-use tools | Computer-use agent + desktop manager exist but are request-bound | **#11: no persistent observable terminal/process system.** |
| Events | Streaming JSON headless output; TUI events | NDJSON stream exists (plan/log/website/done) | **#12: event vocabulary too small** (no task/agent/tool/file lifecycle events). |
| Observability | Subagent view, activity, `inspect` | Pipeline logs + roster in UI | **#13: no per-agent status/model/tool/duration model.** |
| Answer rendering | TUI diff viewer, plan review | Markdown + KaTeX already present | **#14: renderer exists but needs upgrade** (GIVEN/FORMULA/RESULT sections, callouts, citations, graphs/diagrams). |

JEXI's strengths to keep: the planner/domain registry (deterministic field detection is genuinely better than nothing — Grok has no equivalent), the provider router with failover, memory, research/news teams, MCP server exposure, and the honest-error culture.

## O. Proposed JEXI architecture

```
┌────────────────────────────── UI (React shell) ──────────────────────────────┐
│ TopNav + Drawer · Home · Command Center · Agents · Tasks · Workspace · …     │
└──────────────────────────────────┬───────────────────────────────────────────┘
        NDJSON events (task.*, agent.*, tool.*, file.*, process.*, verify.*)
┌──────────────────────────────────▼───────────────────────────────────────────┐
│                            ORCHESTRATOR                                       │
│  Planner (intent + Domain Registry) → team graph → execution → gates → report │
├──────────────┬──────────────┬───────────────┬───────────────┬────────────────┤
│ Agent Runtime│ Subagent Mgr │ Skill Manager  │ Hook Engine   │ Event Bus      │
│ (identity,   │ (spawn,      │ (SKILL.md,     │ (before/after │ (task/agent/   │
│  model,      │  parallel,   │  auto-invoke,  │  tool/file/   │  tool/file/    │
│  tools,      │  cancel,     │  /commands)    │  task, gate)  │  process events)│
│  timeout,    │  aggregate)  │                │               │                │
│  retry)      │              │                │               │                │
├──────────────┴──────────────┴───────────────┴───────────────┴────────────────┤
│ TOOL RUNTIME — unified schema: name · description · schema · permissions ·    │
│   timeout · handler · logging · result validation                              │
│ read/write/edit/search · terminal · python · web_search · browser · git ·     │
│ http · calculator · symbolic_math · image · document · package · test · build │
│   └── MCP bridge (search_tool/use_tool, namespaced server__tool)               │
├────────────────────────────── WORKSPACE RUNTIME ─────────────────────────────┤
│ projects · files · git · checkpoints · diffs · rollback · process registry     │
├────────────────────────────── COMPUTER RUNTIME ──────────────────────────────┤
│ RuntimeProvider: local · docker · VM · remote (abstraction; no hardcoded host) │
│   └── Linux + Desktop + Browser + Terminal + Screenshot + Input               │
├────────────────────────────── MEMORY · MODEL ROUTER ──────────────────────────┤
│ user/project/task/decision/knowledge · per-agent model + local inference       │
├────────────────────────────── PLUGINS · AUTOMATION ───────────────────────────┤
│ install/enable/disable/update · hooks · cron-style recurring workflows         │
└───────────────────────────────────────────────────────────────────────────────┘
        Security: permission profiles (read-only → full-dev) · folder-trust ·
        risk classification (low/medium/high) · no silent privilege escalation
```

Backend component rules: every component communicates over **clean internal APIs + the event bus**; adding a tool, skill, hook, or plugin must not require editing the orchestrator; all state is observable.

## P. Proposed JEXI frontend architecture

```
src/
  shell/        AppShell (top nav + drawer + route host) · TopNav · Drawer
  pages/        Home · CommandCenter · Agents · Tasks · Workspace · Files ·
                Memory · Models · Skills · Plugins · Settings
  workspace/    Conversation (reusable) · CommandInput · AnswerRenderer ·
                Callout · MathBlock · CodeBlock · Citation · ResultCard ·
                Chart · Diagram
  agents/       AgentRow · AgentDetail · SubagentTree · AgentActivity
  pipeline/     PlanStream · ToolStream · ProcessView · TerminalView
  state/        useJexiEngine (events → typed store) · useRoster · useTasks
  theme/        tokens (index.css) · icons (lucide, single weight)
```

Rules: one command input per screen; conversation is a reusable workspace component; the AnswerRenderer owns markdown/KaTeX/engineering sections/citations; pages are thin, components are small; everything subscribes to the event bus — no duplicated server state.

## Q. Implementation roadmap (stages, this spec)

| Stage | Work | Status |
|---|---|---|
| 1 | Research + architecture report | ✅ this report |
| 2 | Design system (tokens, palette, type, spacing) | ✅ shipped to main (graphite base, #00D26A brand, semantic accents, 4px rhythm) |
| 3 | Application shell (top nav + drawer, desktop 3-pane) | ✅ shipped to main (TopNav + hamburger drawer + desktop rail) |
| 4 | Navigation (Home / Command Center / Agents / Tasks / …) | ✅ shipped to main (NavList sections + real screens incl. Tasks) |
| 5 | Command Center (plan + agents + tools + logs, live) | ✅ shipped to main (CommandCenter surface) |
| 6 | Conversation + high-quality AnswerRenderer (KaTeX, sections, callouts, citations) | ✅ shipped to main (structured GIVEN/FORMULA/WORKING/FINAL-ANSWER + research section chips, GitHub-style `> [!NOTE]` callouts, numbered citation badges, live mermaid diagrams, KaTeX) |
| 7 | Agent workspace (OS-style list + detail) | ✅ shipped to main (AgentsScreen + roster browser + ActiveAgents) |
| 8 | Task system + events (`task.*`) | ✅ TaskManager (background execution, `task.*` NDJSON streams, disk persistence, cancel/rerun) + TASKS console in the UI |
| 9 | Unified tool runtime (schema registry, permission profiles) | ✅ shipped to main (ToolRuntime: schemas, safe/medium/risky permissions, Auto/Ask/Full profiles, validation, timeouts, tool.* events, /api/tools) |
| 10 | Workspace runtime (projects, checkpoints, diffs, rollback) | ✅ shipped to main (WorkspaceRuntime: recursive file list/read/write with path-escape guards, snapshots to DATA_DIR, LCS line diffs, rollback, 30-cp pruning; Workspace screen with file editor, checkpoint history, diff viewer, one-tap rollback; /api/workspace*) |
| 11 | Terminal/process subsystem (persistent, observable) | ✅ shipped to main (ProcessManager: spawn with timeouts + cwd scoping, ring-buffered logs, running/exited/stopped/interrupted states, disk persistence, NDJSON process.* streams; Terminal screen with run/stop/delete + live log tail; /api/processes*) |
| 12 | Orchestrator v2 (tool-calling loop, gated stop, retry policy) | ✅ shipped to main (AgentLoop: plan → generate → fenced-json tool calls → ToolRuntime → results fed back → final answer; /api/agent NDJSON stream) |
| 13 | First-class skills (auto-invoke, `/commands`, tiers) | ✅ shipped to main (Skills screen: searchable 495-skill registry by live category, detail sheet, one-click invoke that resolves the plan and runs it in the Command Center; /api/skills + /api/skills/invoke) |
| 14 | Subagent runtime (spawn, parallel, cancel, aggregate) | ✅ shipped to main (SubagentRuntime: bounded-parallel AgentLoop subruns, cancellation, deterministic query decomposition, aggregation synthesis; /api/subagents NDJSON) |
| 15 | Memory surfaces (searchable, editable, exportable) | ✅ shipped to main (Memory panel: semantic search across all memories, per-entry delete, JSON export via /api/memory/export + /api/memory/delete) |
| 16 | Verification engine per domain (math/eng/code/research) | ✅ shipped to main (DomainVerifier: no-AI deterministic checks — balanced math/code fences, FINAL ANSWER, arithmetic spot-check, sources — plus per-domain AI critic; wired into math + research pipeline; /api/verify) |
| 17 | Sandbox + folder-trust + risk classification | later |
| 18 | Computer runtime abstraction (provider-independent) | later |
| 19 | Browser agent improvements (screenshots, UI verification) | later |
| 20 | MCP management UI + permission control | ✅ MCP status screen + allowlisted tools (read-only) |
| 21 | Plugin system (install/enable/disable/update) | ✅ shipped to main (PluginRegistry: 6 built-in feature bundles contributing agents/skills/tools, runtime enable/disable persisted, contribution counts + unions; Plugins screen; /api/plugins) |
| 22 | Hook engine (before/after tool/file/task, gates) | ✅ shipped to main (HookEngine: persisted lifecycle hooks with matchers, allow/deny/log actions, fail-open (only explicit deny blocks), wired into ToolRuntime PreToolUse/PostToolUse; /api/hooks CRUD) |
| 23 | Automation (recurring workflows, notifications) | ✅ recurring missions — TaskScheduler fires TaskManager missions on an interval (pause/resume/run-now, persistence, no-stacking); ✅ NotificationCenter — bell in TopNav, unread badge, mark-read/clear, scheduled-mission alerts |
| 24 | Model routing per agent/skill + local inference | ✅ per-domain provider preference — INTENT_PREFERENCE map drives opts.prefer in the agent loop; Models screen shows routing + provider health; local inference later |
| 25 | Cloud/runtime deployment | later |
| 26 | Testing (unit + integration + live domain probes) | in progress |
| 27 | Performance optimization | ✅ memoized static catalogs (/api/roster, /api/skills) + Cache-Control headers; more later |
| 28 | Final UI polish | later |

**No fabricated functionality.** Every stage ships only what actually works; unavailable features are marked as such in the UI.

---

*Research verified against: `xai-org/grok-build` README + crate layout + user-guide chapters 07 (MCP), 08 (Skills), 10 (Hooks); x.ai/news/grok-build-open-source; docs.x.ai/build/overview. Unverified items are labeled "cannot confirm from the public source".*
