# Capability/Code — Code Knowledge Graph

Phase 11 Scope A. A CBM (codebase-memory-mcp)-model knowledge graph over this
repository: persistent SQLite store (node:sqlite on Node ≥ 22.5, durable
file-backed fallback below that), tree-sitter-contract AST extraction, and
hybrid type resolution.

## Layout

```
store.js               backend facade: node:sqlite → file-backed, explicit degradation warning
sqlite-store.js        persistent SQLite graph (Node >= 22.5) — VERIFIED under Node 22.14
file-store.js          durable JSON store (atomic tmp+rename) — SIGKILL-safe — VERIFIED under Node 20.20
nodes/                 Function, Class, File, Route, Resource, Module
edges/                 CALLS, IMPORTS, INHERITS, HTTP_CALLS, CROSS_SERVICE
pipeline/tree-sitter.js   AST extraction (tree-sitter contract; self-contained scanner internals)
pipeline/hybrid-lsp.js    type resolution: var→class bindings, member-call qualification
index.js               two-phase indexer (extract → resolve)
db/                    store artifacts (gitignored)
```

## Usage

```bash
node scripts/phase11-index.mjs                       # index this repo (fresh)
node scripts/phase11-probe-a.mjs counts              # P1: node/edge counts + breakdown
node scripts/phase11-probe-a.mjs search --name NAME  # P2: search_graph
node scripts/phase11-probe-a.mjs trace --name NAME --direction out --depth 3   # P3
node scripts/phase11-probe-a.mjs postrestart         # P4: fresh-process persistence check
node scripts/phase11-probe-a.mjs backend             # P5: runtime + active backend honesty
```

## Resolution semantics (honest limits)

Call resolution is tiered, most-specific-first: qualified `Class::method`
(this-method + hybrid-lsp type bindings) → `new Class` → same-file definition →
project-wide unique name. Bare-name member calls (`x.split(`) only resolve
same-file (COMMON_MEMBER list) — everything else is left unresolved rather
than guessed (≈71k of 97k raw call sites stay unlinked by design; CBM closes
this gap with real language servers, which this repo cannot ship).

## Verified

- Node 22.14.0 (node:sqlite): index → 8,079 nodes / 15,313 edges; SIGKILL
  holder process → fresh process → graph intact.
- Node 20.20.2 (file fallback): same counts, same probes; degradation warning
  printed explicitly; SQLite path correctly refused instead of faked.
- Both backends produce byte-identical counts on the same tree.
