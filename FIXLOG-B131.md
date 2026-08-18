# FIXLOG-B131 — LSP plugin: real code intelligence (DeepSeek Harness `tool-lsp` mirror)

**Phase:** B131 · **Branch:** main

## What DSH does (packages/lsp/tool-lsp)
One `lsp` tool with operations goToDefinition / findReferences / goToImplementation /
hover at a ONE-BASED (line, character) cursor, returning `locations[{uri, range}]` or
`hover{contents}` — the model navigates code precisely instead of grepping. DSH spawns
real language servers; JEXI's plugin uses a built-in **workspace symbol indexer**
(offline, no node_modules, no external process) that delivers the same contract:
declarations indexed per file, references as word-boundary occurrences (declaration
always included — DSH semantics), implementations via implements/extends resolution,
hover = definition + context.

## What was built
1. **`server/plugins/lsp/plugin.js`** — the `lsp` tool with the exact DSH contract:
   - `lsp({operation, file_path, line, character})` → `{kind:'locations', locations:
     [{uri:'file://…', range:{start:{line,character}, end:{line,character}}}],
     resolvedWorkspaceUri}` or `{kind:'hover', hover:{contents, range}|null}`
   - Honest errors: bad operation, missing file, non-one-based positions,
     off-symbol cursors.
2. **Wired into the coding plugin**: the autonomous coding loop now offers `lsp`
   alongside bash/write/edit, and the coder skill teaches "use lsp for precise
   navigation before editing unfamiliar code".
3. zod output contract for `lsp`.

## Verified
- Fixture (lib.js + app.js): goToDefinition resolves a usage in app.js → lib.js;
  findReferences includes the declaration AND usages; hover shows `function add`;
  goToImplementation finds the `extends Calculator` site; all error paths honest.
- test-lsp 16/16; plugins-all 45/45 (13 plugin tools incl. lsp); autonomous-coding
  29/29; full 55-suite sweep exit 0; lint 0.
- Deployed to Render via hook.
