# Research: Awesome MCP Servers — what JEXI should actually use

> Studied 2026-09-05 from github.com/punkpeye/awesome-mcp-servers (curated
> list, ~10k commits, synced with the glama.ai directory). The list organizes
> servers into ~40 categories. Per the mission spec: DO NOT install hundreds
> of servers — build a registry where Lewis selectively enables trusted ones.

## Categories relevant to JEXI (from the list)

- **Filesystems / Git / GitHub** — local + repo operations.
- **Browser automation** — Playwright/Puppeteer-class control.
- **Databases** — SQLite/Postgres/MySQL access.
- **Search / Web access / Fetching** — structured retrieval.
- **Cloud platforms / Deployment** — infra operations.
- **Developer tools / Code execution / Command line** — build/test/run.
- **Databases & data platforms / Data visualization** — analysis output.
- **Documentation / Productivity** — notes, docs, office formats.
- **Communication** — messaging bridges (email/chat).
- **Monitoring / observability** — uptime and health checks.

## The JEXI selection principle

JEXI already HAS native tools for most of these categories (files, git/GitHub
via tokens, browser via Playwright, web search, command execution, publish).
An MCP server is only worth enabling when it adds a capability JEXI lacks
natively OR does the job with better safety/simplicity than the native path.

## Recommended starting registry (small, trusted, high-value)

| Slot | Why |
|---|---|
| `filesystem` (official reference server) | Bounded file access with allowlisted roots — complements JEXI's workspace tools with a standard, permission-scoped path |
| `git` (official reference server) | Repo operations through a standard, audited interface when the native GitHub-token path is not the right fit |
| `fetch` (official reference server) | Clean URL→markdown fetching with size/time limits for research tasks |
| `sqlite` (official reference server) | Read-mostly structured data queries (JEXI data lives in JSON; SQL analysis is a real gap) |
| `memory` (official reference server) | Knowledge-graph memory — studied as a cross-check on JEXI's own memory design, not a replacement |
| One browser-automation server (Playwright-based) | Only if it adds beyond JEXI's native browser; evaluated, not defaulted on |

Explicitly NOT enabled by default: cloud-platform consoles, deployment
pipelines, communication bridges, anything with DESTRUCTIVE potential — those
sit behind explicit authorization per the permission model in
`research/MCP.md` and the roadmap's Phase 2.

## Registry shape (Phase 2 implementation)

`mcp/registry.json` — per server: name, description, transport, endpoint,
enabled (default false), trustLevel, permissions boundary, availableTools
(discovered live, never hard-coded), health. Discovery results merge into
ToolDiscovery so the planner matches capabilities, not brand names.
