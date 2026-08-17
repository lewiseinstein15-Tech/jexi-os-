# FIXLOG-B105 — Connection-Drop Fix + Plugin Tools Now Actually Reachable (weather works)

**Phase:** B105 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## The bugs (user report)
1. "⚠ The connection dropped … did not return within 10 minutes" — chat streams were
   dropping and recovery gave up too early.
2. "When I asked for weather it didn't use the plugin you said you added" — the
   `weather-now` plugin tool existed but the model could never see or call it.

## Root causes found

### Weather/plugin invisibility (three stacked bugs)
1. **`buildNativeSchemas` silently dropped schema-less tools.** Plugin tools carry
   `args:` (not `schema:`), so they produced `null` and were never offered to the model
   — the planner also can't select them (not in the registry), so plugin tools were
   unreachable everywhere.
2. **`generateWithToolsLoop` sent def-shaped tools raw to providers.** The SIMPLE-path
   coworker list (`SIMPLE_TOOL_DEFS` = `{slug,name,desc,schema}`) was passed straight
   into OpenAI-compatible APIs that require `{type:'function', function:{…}}` — tool
   calling silently died there and fell back to text-only.
3. **The intent allowlist blocked non-listed tools** for lightweight intents
   (direct_answer/conversation) — even a visible plugin tool would have been refused.

### Connection drops
- Server task budget was **15 min** while the client recovery window was **10 min** and
  the result-store TTL **10 min** — a task finishing at minute 12 was already evicted,
  so recovery could never find it → the scary "did not return within 10 minutes" message.

## What was fixed

### Plugin tools are first-class (the weather fix)
- `buildNativeSchemas`: accepts `schema` OR plugin-style `args`, and any tool without
  either gets a **generic empty-object schema** — nothing is ever silently dropped.
- **`normalizeTools()` in LLMClient**: `generateWithToolsLoop` now converts def-shaped
  tool lists into provider-ready OpenAI schemas (fixes the SIMPLE-path tool calling for
  real; plugin tools ride the same path).
- **AgentLoop** merges every mounted plugin tool into the offered set (+code-mode SDK).
- **SimpleTask** appends plugin tools to the coworker's tool list.
- **`enforceToolAllowlist`** lets user-installed plugin tools through (they still pass
  the permission/risk/approval gates; registry tools outside the allowlist stay blocked).

### Connection-drop robustness
- Server task budget **15 → 25 min** (`CHAT_DEADLINE_MS`, env-overridable).
- Result-store TTL **10 → 40 min**; resume/continue TTL **15 → 45 min**.
- Client recovery window **10 → 30 min**, with a one-time patience note after 2 minutes
  ("Still waiting — long tasks can take several minutes…") and an honest message only
  after the full 30-minute window.

### Tests — `test-plugins-all.js` (20 checks; the user's "test all of them" ask)
- All plugins load with zero failures; no slug collisions registry↔plugins or
  plugin↔plugin; registry count unchanged (187).
- Plugin tools are model-visible (schemas + normalizeTools), their args become
  provider-ready parameters, and **every mounted plugin tool executes through the gate**.
- **Core tools still work after plugin load**: todo, skill-search, session-list,
  spill-read, run_code.
- Intent allowlist lets plugin tools through while registry tools stay blocked.
- Unloading a plugin reverses its effects.
- `test-tools` updated to the new contract (schema-less defs kept with generic schemas).

## Verification
- `npm test` full sweep (46 suites): **exit 0** · `eslint`: **0 errors**
- test-plugin-seam 15/15, test-worker-router 37/37, test-tools 34/34 all green
- APK rebuilt (frontend changed) → release tag bumped.

## How the user sees it
- **Weather works**: ask "weather in Nairobi" in agent mode — the model now sees
  `weather-now` (with the city parameter) in its offered tools and calls it.
- **No more premature "did not return"**: dropped streams recover for up to 30 minutes
  with a reassuring note at the 2-minute mark; long tasks that finish late still land.
- Future plugins are automatically visible to the model and covered by the regression
  suite — adding one can no longer silently break tool calling.
