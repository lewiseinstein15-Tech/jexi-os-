# FIXLOG-B97.md — Plugin Seam (the "everything is a plugin" core)

Build 97 (Aug 17, 2026) — DeepSeek Harness's defining architecture, now in JEXI.

## What was added

### 1. Plugin Context (`server/src/services/PluginContext.js`) — the Cordis-style seam
- `createPluginContext({ services })` — a shared `ctx` with:
  - `ctx.services` — injectable shared services (planner, orchestrator,
    generateContent, executeTool, memory, conversations…).
  - `ctx.tools.register({ slug, name, desc, args, handler })` → returns an
    **unregister()** (reversible effect). Duplicate/invalid registrations
    are rejected.
  - `ctx.skills.register(...)` — same reversible pattern.
  - `ctx.events.on(type, fn)` / `ctx.events.emit(type, data)` — a typed event
    bus; every emit also lands in the durable EventLog as `plugin_event`.
- `loadPlugins({ dirs })` — scans `server/plugins/` (built-in) and
  `DATA_DIR/plugins/` (user-installable) for manifests
  (`{ name, version, inject, apply(ctx) }`); `apply()` may return a cleanup
  function (reversible effects); failures are collected, never fatal.

### 2. Runtime integration — plugin tools are FIRST-CLASS
- `ToolRuntime.executeToolInner` accepts plugin tools: if the static registry
  misses, it synthesizes the tool record from the plugin context — so the
  SAME gates apply (intent allowlist, permission profiles, RiskGuard,
  EXTERNAL approval, event logging, output validation).
- `runEngine` consults `getPluginTool(slug)` in its default branch.
- Per-tool zod OUTPUT CONTRACTS added for all B96 tools + weather-now.

### 3. First real plugin: `server/plugins/weather/plugin.js`
- Mounts **`weather-now`** (free wttr.in API, no key) into the gated runtime
  WITHOUT touching core code. Verified live: `weather-now` city=Nairobi →
  17°C, Sunny, humidity 70. Unloading removes the tool.

### 4. Resume a conversation in chat (frontend)
- Conversations screen: **RESUME IN CHAT** button sets the session id to the
  conversation and opens Home — chat continues the past conversation's
  append-only log. (FORK stays.)

### 5. API + observability
- `GET /api/plugins/runtime` — live mounted plugins, their tools/skills,
  counts (read-only). Boot log: `[Plugins] ✓ Loaded N plugin(s): …`.

## Verification
- New suite `test-plugin-seam.js` **15/15**: register/unregister reversibility,
  duplicate/invalid rejection, skills, event bus on/off, disk plugin loading,
  plugin tool executes through the gated ToolRuntime, weather plugin mounts.
- **31-suite full sweep green** · lint 0 · live e2e: weather-now returns real
  weather through /api/tools/execute; /api/plugins/runtime lists it.
