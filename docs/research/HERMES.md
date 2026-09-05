# Research: Hermes Agent (NousResearch/hermes-agent)

> Studied 2026-09-05: repository structure, README, recent commit history
> (~32k commits, 242k stars; MIT license). Python + uv-managed runtime.
> JEXI remains its own system — ideas are adapted, never copied wholesale.

## What Hermes is

A self-improving personal agent ("the agent that grows with you"): TUI +
messaging gateway (Telegram/Discord/Slack/WhatsApp/Signal), provider-agnostic
models (Nous Portal, OpenRouter, OpenAI, custom endpoints — switch with
`hermes model`), scheduled automations (cron), subagent delegation, and a
closed learning loop (skills created from experience, improved during use;
FTS5 session search; user modeling).

## What Hermes does well (verified in repo/commits)

1. **Terminal sandboxing** — Docker backends with cap-drop ALL, tmpfs
   hardening, PID limits, privilege drop, snap-AppArmor compatibility
   escapes. Terminal execution happens in contained environments with
   per-host quirks handled explicitly.
2. **Provider routing discipline** — "fast mode" service-tier parameters are
   gated PER PROVIDER ROUTE (never sent to providers that don't support
   them); per-request overrides only; prompt cache preserved. JEXI's B220
   health-walking is philosophically aligned.
3. **State store engineering** — SQLite with schema versioning (v23),
   external-content FTS5 (trigram + CJK-bigram), resumable throttled
   backfills, corruption self-heal, capability classification of runtime
   errors. Local-first, no external DB required.
4. **Seven terminal backends** — local, Docker, SSH, Singularity, Modal,
   Daytona, Vercel Sandbox; serverless persistence (hibernate when idle).
5. **Skills as first-class artifacts** — created autonomously after complex
   tasks, self-improving, compatible with the agentskills.io open standard;
   Skills Hub community sharing.
6. **MCP integration with measurement** — `mcp-research-data` contains
   discovery-bound benchmarks (listing tools up-front vs bridge discovery:
   listing asserted absence in 0 searches vs up to 8 for the bridge). Their
   result favors static listing for tool visibility — a direct argument for
   JEXI's registry + up-front discovery approach.
7. **Computer use via accessibility** — computer-use-linux MCP server with
   AT-SPI accessibility trees (not just screenshots), Wayland/X11 input,
   compositor window targeting.
8. **Operational humility** — `hermes doctor`, degraded-runtime error
   classes, tokenizer-loss self-heal, plugin compatibility warnings with
   migration targets.

## What JEXI should learn from Hermes

- **Docker/SSH execution backends for risky terminal work** (JEXI has E2B —
  formalize backend selection + hardening defaults).
- **Per-route provider parameter gating** (extend JEXI's provider metadata
  so request-shaping features are declared per provider, never assumed).
- **Skills artifacts + validation + versioning** (Phase 8 directly inspired:
  procedure → tested → versioned skill).
- **Searchable session history with FTS** (JEXI has vector search; add
  lexical FTS for exact-recall cases).
- **Discovery-by-listing over discovery-by-searching** for tools (JEXI's
  registry-first ToolDiscovery already matches this; keep it).
- **Accessibility-tree observation** as a complement to screenshots for
  computer use (richer, cheaper state than pixels).

## What JEXI should NOT copy

- **The messaging-gateway-first shape** — JEXI is a product with its own UI,
  missions, roster, and verified autonomy stack; Hermes optimizes for
  "lives in your chat apps".
- **Its memory model** — JEXI's provenance-tagged, epistemically-stamped
  memory with hard promotion rules is further along on honesty; Hermes'
  Honcho dialectic user modeling is interesting but an external dependency.
- **Local-first SQLite state as the center of everything** — JEXI's
  file+Redis mirror already survives container replacement (proven live).
- **Plugin ecosystem scale** — JEXI has a plugin seam; a 1.7k-branch plugin
  compat layer is the cost Hermes pays for it. Not our problem to adopt.

## Proposed JEXI implementations (mapped to roadmap)

| Hermes idea | JEXI phase |
|---|---|
| Sandbox hardening defaults + backend selection | Phase 1/6 (execution safety) |
| Per-provider request-shaping gates | Phase 1 (provider metadata) |
| Skills artifacts + versioning + validation | Phase 8 |
| FTS lexical recall alongside vectors | Phase 4 (memory layers) |
| Tool discovery by listing | Already JEXI's design (keep) |
| AT-SPI/accessibility observation | Phase 6 (computer use, Linux target) |
