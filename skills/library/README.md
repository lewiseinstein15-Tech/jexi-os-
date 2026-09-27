# SKILLS LIBRARY (Phase 12 Scope F)

Curated import of external skill catalogs. **Decision: Path 2 — curated import.**

## Why curated, not full-import (honest accounting)

The "2,122 skills / ~6MB" figure no longer describes upstream: at import time
`sickn33/antigravity-awesome-skills` carried **2,130 index entries, 2,037+
top-level skill dirs, 6,697 SKILL.md files, a 321MB working tree**. A full
import would have added hundreds of MB of third-party content (including
1,102 `risk: critical` and 61 `risk: offensive` entries) to this repo.
Scope E already built the right pattern for the long tail: the AAS catalog
stays external, served by the `skills/aas/` MCP layer. This library holds
the high-relevance subset locally.

## What is here

- `engineering/` — **mattpocock/skills (MIT)** stable catalog (engineering +
  productivity + misc), full dirs with companion files, provenance in each
  file's `origin` front-matter. Skills whose ids/descriptions duplicate
  existing JEXI skills were skipped by the curator (see IMPORT-MANIFEST.json).
- `aas/<category>/<slug>/` — **AAS curated subset** (SKILL.md + references
  only; community `scripts/` are deliberately NOT imported — supply-chain
  caution; the full skill remains available upstream via the AAS index).

## Selection criteria (AAS subset)

1. `risk` in `{safe, none}` — critical/offensive excluded
2. English descriptions (ASCII-alpha ratio >= 0.75)
3. relevance >= 2 distinct hits against JEXI's division vocabulary
   (18 divisions from workforce/divisions.json: engineering, testing,
   security, ops, data, research, design, content, product, business,
   visualization, learning, integration, automation, legal, localization,
   voice)
4. size cap 100KB per skill dir
5. top 120 by relevance (actual taken: 118 after curator skips)

## Dedupe gate

`curator.mjs` — every staged skill must stay under cosine 0.85 description
similarity vs every existing JEXI skill AND every already-accepted library
skill (same `cosineSimilarity` as the AAS compose layer). Duplicates are
skipped and recorded with the skill they collided with.

- Full audit trail: `IMPORT-MANIFEST.json` (imported list, skip list with
  reasons + similarity scores, criteria, byte counts).
- Re-run: `node skills/library/curator.mjs --stage <staged-tree> --repo <root>`

## Loading

- `skills/library/engineering/` skills load through the JEXI skill engine
  (`readSkill`, flat `<store>/<slug>/SKILL.md`) with
  `JEXI_SKILLS_STORE=skills/library/engineering`.
- `skills/library/aas/` skills are indexed recursively by the AAS catalog
  (`skills/aas/catalog.js` + `search_catalog` MCP tool).

**Known indexing caveat (zone-owner follow-up):** the AAS catalog skips any
directory *named* `aas` (a guard meant for the `skills/aas` core layer), so
`skills/library/aas` is excluded from the combined index until that guard
becomes path-based. Workaround shipped today: point the AAS server at the
library subset — `JEXI_AAS_SKILLS_ROOT=skills/library/aas` (118 skills
searchable, probe-verified). The mattpocock 26 are in the combined index now.

## Machine-executable `## Steps` (P10 GAP 2)

A library skill is EXECUTABLE when its SKILL.md declares a machine `## Steps`
section. The declared schema (consumed by `server/src/skills/catalog.js
parseSteps` + `server/src/skills/library-registry.js runLibrarySteps`):

    ## Steps

    - step: 1. Search the live web for the topic
      tool: web_search
      args: {"query": "$args.query", "limit": 5}
    - step: 2. Store the findings for later recall
      tool: mem_store
      args: {"key": "research:$args.query", "value": "$prev.output"}

Rules:

- `tool` is a REAL registered domain tool (web_search, web_fetch, fs_read,
  fs_ls, data_json, mem_store, mem_recall, git_status, git_log, term_execute, …).
- `args` is a single-line JSON object. Argument resolution:
  - `"$args.<field>"` → the invoking task's args field; `"$args.<field>|<dflt>"`
    falls back to `<dflt>` when absent (chat-triggered invocations pass only
    the implicit `query`).
  - `"$root"` → the execution root. `"$prev"` / `"$prev.output[.path]"` → the
    previous step's entry / tool output / a deep path into it.
  - Unresolvable tokens pass through verbatim — never silently nulled.
- Execution root: the skill's own package dir by default; frontmatter
  `executionRoot: workspace` binds file steps to the JEXI workspace.
- `tool`-less steps (prose under `## Steps`) are ignored by the machine
  runner — keep prose guidance under a different heading (`## Workflow`).
- Every step runs in order through the gated domain executor; a failed step
  stops the chain and reports honestly (`mode: error`). Discovery at boot
  indexes each skill as `executable` (machine steps) or `reference-only`.

The 10 P10-converted executable skills live under `engineering/` and
`obsidian/` (research, diagnosing-bugs, code-review, handoff, implement,
triage, tdd, json-canvas, defuddle, obsidian-markdown).
