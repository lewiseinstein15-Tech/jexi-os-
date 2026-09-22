# DeepSeek Harness & The Modern Agent-Framework Landscape
**Research report — how the best agents are built in 2026 (tools, skills, loops, architecture)**
*Compiled Aug 17, 2026 · sources: github.com/deepseek-ai/deepseek-harness (official docs, architecture.md, tools.md, skills.md), atoms.dev, dshai.net, flowtivity.ai, langfuse, uvik.net, digitalapplied, firecrawl, pickaxe*

---

## 1. DeepSeek Harness (dsh) — the framework that just broke the internet

**What it is:** DeepSeek AI's open-source *agent harness* (not a model — the runtime layer that connects a model to files, terminals, tools, sessions, permissions and UIs). Released **Aug 13, 2026**, MIT-licensed, TypeScript, ~**138k GitHub stars in 4 days** (95k in 2 days). It's the same harness DeepSeek used to run its own coding-agent benchmarks for DeepSeek-V4-Flash.

**The core idea: "Everything is a plugin."** Models, tools, skills, sessions, sandboxes, storage, the agent loop itself, scheduling and UI are ALL plugins. There is *no privileged core to patch* — you extend the harness by mounting a plugin beside the others.

### Architecture (from the official docs)

**The Cordis kernel** — a plugin framework providing a shared context (`ctx`), service discovery, typed events, and *reversible effects* (a component's side effects fully revert when it's removed; components declare and reactively manage dependencies). This gives **temporal composability** (unload cleanly) + **spatial composability** (components depend on declared services, not concrete imports).

**Core packages (each owns a `ctx` key):**

| Package | Owns | ctx key |
|---|---|---|
| core/session | append-only SessionEvent log + store (source of truth) | ctx.sessions |
| core/system-prompt | prompt-section + tool-schema assembly | ctx.systemPrompt |
| core/tools | scoped tool registry + **guarded execution pipeline** | ctx.tools |
| core/agent | Agent interface, live registry, agent/* events | ctx.agents |
| core/agent-loop | the default loop driver (agent loop is a PLUGIN) | ctx.agentLoop |
| core/scope | per-agent scoped registrations | — |
| llm/llm | message/stream vocabulary + adapter seam | ctx.llm |

**The Turn Flow (their loop, in their words):**
```
turn/start
  claim next-step input + one queued message
  assemble prompt sections + tool schemas
  agent/pre-step → step/start
  append entered messages as user/message
  derive model history from the log
  agent/request → llm/stream → assistant/message
  tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*
  step/end
  tools owe another request, or next-step input arrived → next step
turn/end
```
A **step** = one model request + its tool calls. A turn = several steps. The loop: claim → assemble → stream → execute guarded tools → log result → decide if another step is owed.

**Events are the extension points.** Session events (durable facts, survive reload), agent events (in-flight observation/interception), capability events, tool events (pre/post execute = guards/hooks), llm events.

**Profiles & bundles:** a running dsh is a plugin tree composed at boot from ordered layers — a **profile** lists bundles + your `cordis.patch.yml`; a **bundle** is a distribution format of config rows + code. `dsh-base` = model adapters, tools, persistence, sandbox, approval policy, settings, credentials, telemetry. `dsh-web-app` adds the browser UI; `dsh-headless` is a one-shot runner. `dsh --profile web --dump-config` prints the whole tree — and ANY row can be replaced by a patch. **Task-specialized agents = different profile/bundle stack, not a different codebase.**

**The four presets:**
- **Standard** — full coding agent: files, shell, search, planning, goals, **skills**, subagents, workflows, approvals.
- **PTC / Code** — the model writes ONE TypeScript program against a generated SDK; `run_code` dispatches nested tool calls (collapses many round trips into one program).
- **Minimal** — tight coding with persistent Bash + str_replace_editor, no compaction.
- **Creator / Cordis** — adds self-referential plugins; the model can write plugins for the live runtime (high trust — treat as shell-level).

### How THEY implement tools (tools.md — the gold standard)
A registered `ToolDefinition` has:
- **ToolSchema** (model-facing: name/description/parameters) — with an explicit **allowlist** so `output`/`execute`/`timeoutMs`/`isConcurrencySafe` NEVER leak to the model.
- **Mandatory canonical output declaration** (`ToolOutputDefinition`): a JSON schema enforced against every successful value, plus a *pure* `render(args, value)` projector to model content, plus optional `presentationMeta`. **Every tool declares its output contract.**
- **execute(args, exec)** — returns only the canonical lossless-JSON value; receives an execution identity + **cancellation signal**; must settle after its owned work reaches quiescence.
- **finalizeContent?** — last-mile transform for model-facing content, invoked exactly once for every outcome (including pipeline failures), must be total and never throw.
- **timeoutMs?** — cooperative timeout budget (enforced by a wrapper, NEVER sent to the model).
- **isConcurrencySafe?(args)** — opts into **parallel execution** (shared state must tolerate concurrent dispatch).
- **presentCall? / presentResult?** — pure UI presentation intents (usable during live streaming AND session-log replay).

First-party tools use `defineTool` (validates + narrows args, infers body return from output schema, types both projectors). Schema DSL: string/number/integer/boolean/null/array/object/author-only `json`/`oneOf`, enums, consts, `additionalProperties: true|false`.

**Guarded pipeline:** validation → **permission** → execution → post-processing → durable result logging. Cancellation is preserved through the registry.

### How THEY implement skills (skills.md)
- Skills = **optional instructions** (not session events), discovered via providers, loaded on demand.
- **Provider registry** (`ctx.skills`): local dirs, remote registries, packaged bundles. Layered host + per-scope; duplicate names resolved by rank → provider order → local order.
- **Local discovery priority:** project `.dsh/skills` (100) → project `.agents/skills` (200) → custom dirs (300) → user dsh skills (400) → user agents skills (500) → bundled (600).
- Skill identity: kebab-case names; accepts **directory bundles `<name>/SKILL.md`** or **flat `<name>.md`** (same format Claude Code popularized).
- Candidates are listed cheaply (summary), full body loaded only when needed (progressive disclosure).
- Watching/invalidation: file watchers on roots, `skills/change` events, bounded LRU.

### Sessions & traceability (the part to copy)
- **Append-only SessionEvent log** is the single source of truth: model history, replay, persistence, resume, **forking**, titles, telemetry and UI all derive from it.
- Sessions can be **resumed, forked, replayed** — full audit trail.

### Their safety model
- Standard preset: `workspace-write` + approval prompts; `danger-full-access` exists but deliberately unconfined.
- Sandbox focuses on filesystem effects (not full machine isolation — documented).
- Tool calls go through permission + guarded execution; events expose every step for policy plugins.

---

## 2. The rest of the 2026 agent-framework landscape (how others do tools/skills/loops)

| Framework | Paradigm | Tools | Skills | Loop / state | Best for |
|---|---|---|---|---|---|
| **LangGraph** | **Graph** (StateGraph + checkpointers) | tools as nodes/edges; conditional edges for retry loops | sub-graphs / middleware | **durable checkpoints, interrupt-resume (human-in-loop)** | complex stateful workflows, retry/refine loops, enterprise |
| **OpenAI Agents SDK** | **Handoff** (delegation IS the primitive) | function tools; **guardrails** (input/output validators) | agents-as-skills; sessions + tracing built in | runner loop; handoffs between agents | OpenAI/multi-provider teams, quick agents |
| **Claude Agent SDK** | **Harness-as-library** | hooks (PreToolUse/PostToolUse), in-process MCP tools | **SKILL.md folders** (progressive disclosure) | production-tested Claude Code loop | Claude-based file/shell agents |
| **CrewAI** | **Role-based crews** | tools per agent; tasks + processes (sequential/hierarchical) | roles ≈ skills | Flows (event-driven) | multi-specialist teams, fast scaffolding |
| **smolagents** | **Code-first** (agent writes Python) | any Python call = tool (no schema overhead) | — | minimal loop (CodeAgent/ToolCallingAgent) | quick automation, data analysis |
| **AutoGen/AG2** | **Actor / event-driven conversation** | function tools; group chat | — | async message passing | multi-agent conversations |
| **Google ADK** | **Workflow + Task API** | tools; multi-agent delegation | — | workflow runtime | Gemini-native, multimodal |
| **Pydantic AI** | **Type-safe** | typed tool signatures | — | durable execution + OTel | Python teams wanting tested agents |
| **Mastra / Vercel AI SDK** | **TS full-stack** | tools; workflows; ToolLoopAgent | — | durable workflows | JS/TS product teams |

**Cross-cutting lessons from the landscape:**
1. **Tools = schema + execution + output contract + permission.** Best-in-class (dsh, Claude) separate the model-facing schema from host-only metadata, declare output schemas, and gate execution.
2. **Skills = progressive-disclosure instructions.** List cheap (name+description), load full body only on use; discover from project/user dirs (`SKILL.md`). Claude Code + dsh both converged on this.
3. **Loops = explicit + bounded + observable.** LangGraph: graph nodes with conditional edges and checkpointed state (retry/refine). dsh: step/turn with typed events. smolagents: minimal code loop. All emit durable events.
4. **Sessions = append-only logs.** dsh's SessionEvent log is the cleanest: everything (history, replay, fork, resume, telemetry) derives from one durable stream.
5. **Permissions are first-class** (not afterthoughts): approval prompts, sandbox scopes, tool-call guardrails, human-in-the-loop interrupts.
6. **Everything replaceable** — dsh's plugin-everything is the extreme; LangGraph's middleware/checkpointer is the practical middle.

---

## 3. What this means for JEXI OS (honest comparison + actionable plan)

**Where JEXI already matches the state of the art:**
- ✅ **Loop+graph engineering**: Orchestrator graph with typed nodes (agent/tool/verifier/gate), bounded feedback loops (QA→fix→verify, research verify→revise, security→fix), failure-history injection — this IS the LangGraph pattern, hand-rolled.
- ✅ **Tool registry + guarded runtime**: TOOL_SCHEMAS (input), zod output validation, permission profiles (auto/ask/full), RiskGuard argument-level classification, EXTERNAL-approval tier, tool events — close to dsh's guarded pipeline.
- ✅ **Durable sessions/events**: EventLog (B78), Redis-mirrored goal jobs, append-only session store, result-store recovery — the dsh "append-only log" idea in essence.
- ✅ **Skills as files**: SkillChain + SKILL.md folders (B50) with progressive disclosure — matches Claude/dsh skill discovery.
- ✅ **Provider-agnostic routing** with health/cooldowns — ahead of most frameworks.

**Where JEXI falls short (vs dsh/Claude):**
1. **No true plugin architecture** — JEXI's ~84 services are imported directly; adding a capability = editing code. dsh: mount a plugin. *(Biggest architectural gap.)*
2. **Tool schemas lack a canonical OUTPUT declaration** per tool (we have zod checks for a few; dsh mandates it for all, with pure render/present projectors).
3. **No per-tool timeout/cancellation signal** contract (we have global timeouts; dsh threads `exec.signal` through every tool).
4. **Skills are not auto-discovered from project/user dirs** with watch/invalidate (ours load from fixed folders).
5. **No built-in PTC-style "code as one program" mode** — the model must make many tool round trips.
6. **Agent presets are hardcoded intents**, not composable profile/bundle stacks.
7. **No fork/replay of sessions** (we persist + resume, but not fork/replay/audit-replay).
8. **No approval-classifier tier** (dsh auto-approval: rule + LLM classifier for every call).

**Recommended implementation order for JEXI (highest value first):**
1. **Plugin/extension seam** — a `PluginRegistry` that services mount into (ctx-style), so tools/skills/agents register by key, and a profile/patch layer for task presets. (This is the dsh core idea; biggest win.)
2. **Canonical tool output contracts + per-tool timeout + cancellation signal** — upgrade ToolRuntime.
3. **Skill auto-discovery** (project `.jexi/skills` → user dir) with watch + invalidation.
4. **Session fork/replay** on the existing EventLog.
5. **Code-mode (PTC)** — let the model emit one TypeScript/Python program that runs in a sandbox and does the multi-step work in one shot.
6. **Auto-approval classifier** (rules + LLM) with a status chip.

---

## Sources
- DeepSeek Harness official repo & docs: github.com/deepseek-ai/deepseek-harness (architecture.md, tools.md, skills.md, subsystems, config-catalog)
- atoms.dev/blog/deepseek-harness — hands-on install/test (Aug 15, 2026)
- dshai.net — official site (Everything is a plugin)
- flowtivity.ai/blog/deepseek-harness — 95k-stars analysis, Claude/Codex comparison
- reddit.com/r/LocalLLaMA — launch thread (Cordis vendored plugin framework)
- skillsllm.com/skill/awesome-deepseek-harness — ecosystem list (profiles, patches, plugins, presets)
- langfuse.com — open-source agent framework comparison
- uvik.net / digitalapplied.com / firecrawl.dev / pickaxe.co — 2026 framework comparisons (LangGraph, OpenAI Agents SDK, Claude Agent SDK, CrewAI, smolagents, AutoGen, ADK, Mastra…)
