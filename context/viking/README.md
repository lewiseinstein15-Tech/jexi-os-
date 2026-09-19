# JEXI OS — Phase 17 Scope E — CONTEXT FILESYSTEM (`viking://`)

Organize context as a virtual filesystem so agents can **browse, not dump**.
Relevance is judged BEFORE full content is read, through three loading tiers.

## URI scheme

```
viking://{scope}/{path}      scopes: resources | user | agent | session
```

`context/viking/uri.js` — parse/build/validate. Traversal (`..`, absolute,
drive letters) rejected with `E_PATH_TRAVERSAL`; unknown scopes with
`E_INVALID_SCOPE`.

## Tiers

| Tier | Meaning | Where it lives |
|---|---|---|
| **L0** | abstract — one sentence | directory sidecar `<dir>/.viking/meta.json` |
| **L1** | overview — core info | same sidecar |
| **L2** | details — full content | the file itself (dirs: rendered tree) |

Every directory carries its own L0/L1 sidecar **and** the L0/L1 of its child
entries, so an entire directory can be judged without opening any L2 file.

## Contract (`filesystem.js`)

```js
const vfs = new VikingFs({ root: 'data/viking' });
vfs.ls(uri)                    // entries, each with its L0 sidecar
vfs.tree(uri, { depth })       // recursive view, L0 per node
vfs.read(uri, { tier })        // → { content, tier, tokens }
vfs.write(uri, content, { l0, l1 }) // → { written, tier, tokens, sidecars }
vfs.stat(uri)                  // → { type, size, tiers, tierTokens, lastModified }
```

Sidecars record provenance per tier: `explicit (caller-provided)` or
`auto (deterministic first-sentence/first-paragraph) — LLM summarization
NOT VERIFIED`. Tokens use the documented `ceil(chars/4)` estimator (same
convention as `server/src/memory/interface/MemoryProvider.js`).

## Layer loading (`layers.js`)

```js
const loader = createLoader(vfs);
const r = await loader.load('viking://resources/guide', 'what port does X use?');
// r.tier — the tier that answered; r.tokensUsed — cumulative tokens read
// ladder  — the full attempt trace (per-tier tokens + coverage)
```

Judge: deterministic keyword coverage, labeled
`keyword-coverage (deterministic) — LLM relevance judgment NOT VERIFIED`.
Inject `options.judge` to swap in a model without changing the ladder.

## Session pipeline (`session.js`)

```js
capture(vfs, { sessionId, turns, decisions, label: 'synthetic session' });
// → viking://session/<id>/{summary,decisions,turns}.md with L0+L1 sidecars
toSessionMemory(vfs); // session → memory digests (MemoryEntry-shaped,
                      // consumed by the Phase 17(D) confidence/lifecycle layer)
```

## Compile (`compile.js`)

```js
run({ source: 'viking://resources/notes', target: 'all', fs, dest: 'viking://resources/compiled' })
// → wiki (structured markdown), knowledge-graph (entities+relations,
//   reusing the Scope D labeled rule-based extractor), report (narrative)
```

## Storage layout

```
<root>/resources/<path>...          L2 files
<root>/resources/<dir>/.viking/meta.json
  { "self":    { "l0": …, "l1": … },     the directory's own sidecar
    "entries": { "<file>": { "l0": …, "l1": …, "tokens": {…},
                "l0By": "explicit|auto", "updatedAt": ISO } } }
```

`.viking/` is never listed. Everything is plain files — P10 in the probe
proves persistence across processes by re-reading from a fresh process.

## Integration (recorded, NOT wired — zone-owner task)

`server/src/context/**` never reads files directly: content arrives through
registered producer functions (`server/src/context/sources/index.js:17-26`,
pulled by `collectSources`), and `server/src/routes/context.js:52` calls
`build(...)`. Raw file reads happen upstream (e.g.
`server/src/services/AgentInstructions.js:50`). The viking integration is a
source whose `produce()` serves tiered content from `viking://` instead of
raw reads — wiring requires touching `server/src/**` and is left to the
zone owner.
