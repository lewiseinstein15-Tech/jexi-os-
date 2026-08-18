# FIXLOG-B121 — AUTO routing was dead (preset forced agent) + every plugin now mounted

**Phase:** B121 · **Branch:** main

## The bug (user report)
"Simple things are using search — why is there an AI model running things there?
Conversations are running agents using other models, not just answering. Make sure
every plugin is added and JEXI has access to them."

## Root cause — AUTO mode never ran in the real app
The frontend sends `x-jexi-preset: ptc` on every request. The chat route resolved the
mode as `preset.mode || 'auto'` — and the ptc/creator presets define `mode: 'agent'`.
So EVERY message was forced into the agent pipeline: simple questions got searched,
conversations spawned agents and other models, exactly what you saw. The auto-routing
block was dead code in production.

## What was fixed
1. **Preset can no longer force agent mode.** Mode now resolves as:
   `req.body.mode || x-jexi-mode || (preset.mode === 'normal' ? 'normal' : 'auto')` —
   only the minimal preset forces direct answers; standard/ptc/creator now route AUTO
   (JEXI decides per query).
2. **Confidence gate relaxed**: deterministic intent classifications (no confidence
   field) are trusted; LLM classifications need ≥ 0.5. Simple facts/questions now
   answer directly instead of falling through to search.
3. **Every plugin mounted + verified**:
   - `weather` (weather-now) — existing
   - `timezone` (time-now) — NEW: current local date/time for any IANA timezone,
     offline via Intl, no key
   - `currency` (currency-convert) — NEW: live rates (open.er-api.com, free, no key)
   - `coding-pipeline` (bundled skills) — existing
   - Plugin tools get canonical zod output contracts (time-now, currency-convert).
   - AgentLoop + the SIMPLE path already merge `listPluginTools()` into the offered
     set, so the model can call every plugin tool (access verified in tests).
4. **Settings → LOADED PLUGINS panel**: shows every mounted plugin tool (from
   /api/plugins/runtime) so you can see JEXI's plugin access at a glance.

## Verification
- Local live test: with `x-jexi-preset: ptc`, "what is 2 plus 2" routes to
  "⚡ Auto mode — answering directly" (no search, no agents).
- Boot log: `[Plugins] ✓ Loaded 3 plugin(s): currency, timezone, weather`.
- test-auto-mode 37/37 (preset-no-forcing-agent, deterministic-confidence rule);
  test-plugins-all 25/25 (3 plugins mounted, each tool executes through the gate).
- Full 54-suite sweep exit 0; lint 0; api-surface 86 endpoints 0 missing.
- Deployed to Render via the deploy hook; verified `/api/health` shows the new build.
