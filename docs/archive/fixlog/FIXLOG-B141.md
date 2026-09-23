# FIXLOG B141 — "Pull all continue": SDK protocol/server, pwsh tool, storage domain, api proxy, llm-mock-server, client modules, typert workspace

**Date:** 2026-08-19 · **Repo:** lewiseinstein15-Tech/jexi-os- · **Branch:** main

**Parity tracker now reads 95% ported (115/121).**

---

## What landed

### 1. `sdk/protocol` → `server/sdk/protocol.js`
- JSON-RPC 2.0 over streams: `JsonRpcLineTransport` (line-delimited,
  pending-request tracking, responses routed on both ends), `JsonRpcResponseError`,
  parse error (-32700), missing method (-32601), handler failure (-32603),
  notifications dropped without a handler.

### 2. `sdk/server` → `server/sdk/server.js`
- `RpcServer`: method table with `handle()/listMethods()/invoke()/mountTransport()`
  plus the built-in SDK methods (`health`, `tools.list`, `conversations.list`,
  `chat`) mirroring the JexiClient surface.

### 3. `shell/tool-pwsh` → registry tool **`pwsh`**
- PowerShell-dialect execution (`pwsh -NoProfile -Command`), native paths +
  `$env:` vars, scrubbed env, bounded output, **fail-open when pwsh isn't
  installed**. **Registry 210 → 211 tools.**

### 4. `storage/storage-domain` → `StorageDomain.js`
- Typed KV tables over the storage hub: memory cache + durable writes,
  snapshot iterators (entries/keys), spec validation (fail-closed
  `DomainError`), atomic read-modify-write `update()` on a **self-healing
  write chain** (a failed op never poisons later writes — fixed during
  testing), change events.
- `GET /api/storage/domain/:name`, `POST /api/storage/domain/:name/:table`.

### 5. `host/apiproxy` → `ApiProxy.js`
- Typed API-route validation: `assertJsonArgs` (JSON-safe deep copy),
  `validateApiArgs` (required/unknown/type codes), `createApiProxy` with
  per-route schemas.
- `GET /api/apiproxy`, `POST /api/apiproxy/validate`.

### 6. `test-support/llm-mock-server` → `server/test-support/llm-mock-server.js`
- HTTP mock LLM server: `/v1/chat/completions` + `/v1/generate` answered
  from a script (match mode), call recording, CLI arg parsing, 404 for
  unknown paths.

### 7. `client/schema-form` + `ui-theme` → `src/utils/schemaForm.js` + `theme.js`
- Pure form validation/coercion against JSON-schema-ish specs; theme
  get/set/apply with persistence.

### 8. `typert/generator` workspace mode → `generateWorkspaceTypes(root, {emitTo})`
- Scan a workspace tree for typert.json artifacts, register them, emit one
  aggregated `wire.ts`.
- `POST /api/typert/workspace`.

## Verification
- `npm test` — **exit 0, 67 suites green**, incl. new `test-dsh-batch10.js`
  (~60 checks: JSON-RPC roundtrip + error codes over real streams, RPC
  method table, pwsh fail-open, storage domain incl. the self-healing chain
  regression, api-proxy validation codes, llm-mock-server over HTTP, schema
  form, typert workspace).
- Registry count assertions **210 → 211** across 16 suites.
- `AGENT-CATALOG.md`: **252 agents · 508 skills · 211 tools · 100% reachable**.
- `DSH-PARITY.md` regenerated: **115 ported · 5 partial · 1 not-yet (95%)**.
- `eslint` — 0 errors, 0 warnings in new files; frontend esbuild parse OK.
- Boot smoke test: bundles counts (95%), storage domain, apiproxy validate
  (schema-required on empty args), pwsh in inventory.
