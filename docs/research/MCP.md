# Research: Model Context Protocol (MCP)

> Studied 2026-09-05 from the **current 2026-07-28 specification**
> (modelcontextprotocol.io/specification/2026-07-28 — architecture and
> overview pages) and the specification repository
> (github.com/modelcontextprotocol/modelcontextprotocol, schema at
> `schema/2026-07-28/schema.ts`).

## What MCP is

An open protocol for connecting LLM applications (hosts) with external data
sources and tools (servers). Standardized, composable, JSON-RPC 2.0 based.
Inspired by the Language Server Protocol's ecosystem approach.

## Architecture (2026-07-28)

- **Hosts** — LLM applications that initiate connections; contain and
  coordinate multiple clients; enforce security/consent; handle authorization.
- **Clients** — one per server, created by the host; attach protocol version
  and capabilities to every request; route messages bidirectionally; maintain
  security boundaries between servers.
- **Servers** — expose resources/prompts/tools; can be local processes or
  remote services; request client input (sampling, elicitation, roots) via
  `InputRequiredResult`.

Key change from older revisions: the protocol is **stateless** — every
request is self-contained and carries its own protocol version and
capabilities (per-request capability negotiation). Clients include
capabilities in `_meta.io.modelcontextprotocol/clientCapabilities`; servers
advertise via `server/discover`, which clients may call before anything else.

## Server features

- **Resources** — context/data for user or model (with subscriptions:
  `subscriptions/listen` streams for `toolsListChanged`, resource updates).
- **Prompts** — templated messages/workflows.
- **Tools** — functions the model executes (requires declared tool capability).
- **Client features** — elicitation (server-initiated requests for user input).

## Extensions (opt-in, negotiated at initialization)

- **Tasks** — async long-running operations with polling, mid-flight input,
  durable handles (relevant to JEXI missions!).
- **Skills over MCP** — rich structured instructions discovered via MCP.
- **MCP Apps** — inline interactive UI elements.

## Utilities

Configuration, progress tracking, cancellation, error reporting.

## Security principles (spec-mandated)

1. User consent and control — explicit consent for data access/operations.
2. Data privacy — no transmitting resource data elsewhere without consent.
3. Tool safety — tools are arbitrary code execution; **tool descriptions/
   annotations are UNTRUSTED input** unless from a trusted server; explicit
   user consent before invoking tools.
4. Servers must NOT read the whole conversation or see into other servers —
   the host sends only necessary context. Design principle: isolation.

## How JEXI can use MCP (decisions)

1. **JEXI already speaks it both ways**: `server/mcp-server.js` RUNS an MCP
   server (official SDK, read-mostly, `ask_jexi` the only action tool, no
   destructive tools); `src/services/McpClient.js` CONNECTS to external
   servers (stdio + streamable-http, reconnect policy). Phase 2 builds on
   these — no proprietary protocol invented.
2. **Gateway responsibilities** (Phase 2): registration, connection lifecycle,
   capability discovery via `server/discover`, tool/resource/prompt discovery,
   invocation with timeouts, error handling, permission checks, health.
3. **Trust model**: registry with explicit trustLevel + permission boundary
   per server (READ_ONLY…DESTRUCTIVE). Tool annotations from servers are
   treated as UNTRUSTED — JEXI's own ToolProfiles/risk classification
   governs what needs asking, per the spec's guidance.
4. **Isolation**: JEXI (host) sends each MCP server only the context the
   task needs — never the whole conversation.
5. **Useful features to adopt early**: capability negotiation (never assume
   a server has a feature), subscriptions for tool-list changes (live
   discovery), cancellation (long tool calls), progress (SSE real events),
   and later the Tasks extension for mission-shaped async work.
6. **Transports**: stdio (local processes) and streamable HTTP (remote) —
   both already supported by McpClient.

## What we deliberately avoid

- Auto-enabling arbitrary servers. Every server is opt-in, permissioned,
  and audited.
- Wrapping MCP tools in bespoke abstractions that hide their schemas —
   schemas flow through to ToolDiscovery so the planner sees real contracts.
