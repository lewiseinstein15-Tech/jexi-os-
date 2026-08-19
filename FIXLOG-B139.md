# FIXLOG B139 — "Pulla all": typert generator/registry, client connection/HMR/locale, commands dialect, preset authoring, directory picker, runnable examples

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

---

## What landed

### 1. `typert/generator` + `typert/registry` + `typert/loader` → `TypingGenerator.js`
- The wire-type generation pipeline: analyzer (validates slug names
  `^[a-z][a-z0-9_-]*$`, groups namespaces) → model → TS renderer →
  atomic emitter.
- Registry with per-entry unregister + duplicate rejection; loader scans
  plugin folders for `typert.json` artifacts at boot (fail-open).
- `GET /api/typert/registry`, `POST /api/typert/generate`, `POST /api/typert/register`.

### 2. `client/connection` → `ClientConnection.js`
- The /api trust fence (loopback + declared trusted hosts), request-body
  caps with the image-payload headroom check (dsh image-body capacity),
  and an SSE event-downlink builder with reconnect (dsh websocket-downlink
  analog, SSE for the free tier).
- `GET /api/connection`.

### 3. `client/hmr` → `ClientHmr.js`
- Hot-reload event ring: settings-file changes publish `hmr/update` events
  (broadcaster seam + recent-events ring for late subscribers).
- `GET /api/hmr`.

### 4. `client/locale` → `Locale.js`
- UI strings dictionary (English base + `DATA_DIR/locale/<tag>.json`
  overrides, `{var}` substitution, `x-jexi-locale` header).
- `GET /api/locale`.

### 5. `interaction/commands` (full dialect) → `CommandRegistry.js`
- DSH dialect: `parseCommand` (strict `^[a-z][a-z0-9_-]*$` + raw input
  preserved), `COMMAND_NAME_RE`, `withCommandAbort` (abort-aware handlers),
  `renderThrown`, `validateCommandDefinition`, and
  `tryExecuteCommandDialect` honoring `recordInput`.
- `GET /api/commands/dialect?sample=…`.

### 6. `preset/agent-presets` (discovery + authoring) → `PresetDiscovery.js`
- Filesystem presets: `DATA_DIR/presets/<key>/preset.json` (label,
  description, codeMode, flavor) merged over the built-in table; authoring
  = create/delete/read/write `composition.json` (the cordis.patch.yml
  analog).
- `GET|PUT /api/presets`, `DELETE /api/presets/:key`,
  `GET|PUT /api/presets/:key/composition`.

### 7. `host/directory-picker*` → `DirectoryPicker.js`
- Host directory browsing: depth-1 listing, hidden-filtered, workspace-
  relative display, root enforcement (fail-closed), parent traversal.
- `GET /api/directories`, `GET /api/directories/browse`.

### 8. `examples/` → runnable demos
- `examples/agent-spine-demo.mjs` (one real agent turn),
  `examples/acp-demo.mjs` (JSON-RPC over /api/acp),
  `examples/jsonrpc-demo.mjs` (MCP streamable handshake) — all executable.

## Verification
- `npm test` — **exit 0, 67 suites green**, incl. new `test-dsh-batch8.js`
  (~70 checks: generator/registry/loader, trust fence + caps, HMR ring,
  locale overrides, commands dialect incl. abort-awareness, preset
  authoring, directory picker fail-closed, examples).
- Registry stays **207 tools** (services + seams batch, like DSH).
- `AGENT-CATALOG.md` regenerated: **252 agents · 508 skills · 207 tools ·
  100% reachable**.
- `eslint` — 0 errors, 0 warnings in new files.
- Boot smoke test: all 12 new endpoints live (typert registry/generate,
  connection trust facts, hmr, locale, presets, directories, commands
  dialect).
