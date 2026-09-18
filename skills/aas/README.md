# AAS CORE — skill selection layer (Phase 12 Scope E)

Executable layer, not documents. The flow:

```
agent picks skill ids
   ↓
catalog.js        — read-only skills/**/SKILL.md metadata (list/get/search)
   ↓
compose-stack.js  — compose(ids): UNKNOWN_ID · DESCRIPTION_OVERLAP (cosine ≥ 0.85)
   │                · BUDGET_EXCEEDED (descriptions > 1200 chars, env JEXI_AAS_BUDGET)
   ↓ valid only
aas-stack.js      — persists the VALIDATED stack (aas-stack.json, gitignored)
   ↓
plan.js           — create(stack) → immutable {id, hash, createdAt, stack}
   │                verify(plan) — any mutation breaks the hash
   ↓
workbench.js      — self-contained HTML review surface (browser-openable, no server);
                    human review is the install gate
mcp-server.js     — stdio MCP: search_catalog · inspect_skill · compose_stack ·
                    compare_stacks (JSON-RPC 2.0, newline-delimited)
```

Contracts are exactly those specified in Phase 12 Scope E. Run the probes
with the Phase 12 report or directly:

```bash
node skills/aas/mcp-server.js            # speak MCP on stdio
node skills/aas/workbench.js             # regenerate aas-workbench.html
```

`aas-stack.json` and `aas-workbench.html` are runtime artifacts (gitignored).
