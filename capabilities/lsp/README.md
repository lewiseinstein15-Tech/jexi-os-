# LSP

L4 language-server integration — a real LSP runtime, not a stub.

## Where it lives

`server/src/lsp/`

| File | Role |
| --- | --- |
| `client.js` | JSON-RPC 2.0 over stdio with LSP `Content-Length` framing; correlates responses, answers server→client requests, surfaces notifications. |
| `router.js` | Maps a file extension to its language server (tsserver / pyright / gopls) and reports whether that server is installed. |
| `index/workspace.js` | Walks the workspace and opens every source file (`textDocument/didOpen`) so diagnostics populate at mission start. |
| `manager.js` | Spawns, initializes, tracks, and shuts down one process per language; owns open documents and published diagnostics. |

## Tools

Registered by `server/src/tools/domains/lsp/index.js`:

- `lsp_diagnostics` — real diagnostics. Language-server first; falls back to the
  real ESLint engine for JS/TS when no server is installed.
- `lsp_definition` — resolve a symbol to its definition.
- `lsp_references` — references to a symbol, declaration included.
- `lsp_hover` — type signature and docs for a symbol.
- `lsp_symbols` — document symbols, or workspace symbols when no file is given.
- `lsp_servers` — which servers are installed and running.

A language whose server is not installed resolves to `{ available: false, note }`
— an honest skip, never a fabricated result.

## Wiring

`MissionRunner.create()` indexes `WORKSPACE_DIR` on mission creation
(best-effort, non-blocking) so the first agent turn already has diagnostics.

## Tests

`server/tests/agi/test-lsp-manager.js` — real spawn, framing, routing, index, and
shutdown. `server/test-lsp.js` (B131) and `server/test-code-intel.js` cover the
plugin-level `lsp` tool contract.

See ../ARCHITECTURE.md for the full layer map.
