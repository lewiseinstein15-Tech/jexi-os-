# JEXI OS — STAGE 3A/3 — REFERENCE DISCOVERY

**Branch:** `restructure/file-structure` · **Base SHA:** `fcef3e7` (Stage 2) · **Status:** READ-ONLY — discovery only, zero code edits · **Zone:** this file only

| field | value |
| --- | --- |
| stage | 3A/3 — reference discovery (find refs to the 41 moved dirs) |
| base SHA (expected `fcef3e7`) | `fcef3e7084838fbec7c298b9e82e91bf527fd020` ✅ match |
| branch | `restructure/file-structure` (tracking `origin/restructure/file-structure`) |
| files changed by this commit | `docs/STAGE-3A-REFERENCE-DISCOVERY.md` — 1 file, 0 deletions |
| code edits | **0** (read-only) |
| method | slash-anchored `git grep -F` over the spec pathspec, then per-occurrence **existence resolution** against the working tree |
| scan date | 2026-09-24 |

---

## 0. HEADLINE NUMBERS

| metric | count |
| --- | --- |
| raw grep matching **lines** (spec pathspec, `docs/` excluded) | **4,098** |
| files touched by at least one raw line | **1,097** (after strict segment matching: 1,072) |
| **occurrence-level references** (one per old-dir token per line, de-duplicated) | **4,700** |
| — of those, **target MISSING** (path no longer exists → must be fixed) | **2,509** in 759 files |
| — of those, **target still resolves** (pre-move path still valid by coincidence) | 1,459 |
| — of those, **server-internal** `server/src/<old>/` (⚠️ NOT the moved dir — do not touch) | 494 |
| — of those, **not a repo path** (API routes / npm / URLs / dynamic) | 214 |
| — of those, **already new-layout** (`<new parent>/<old>/`) | 20 |
| root-absolute refs (`/src/…`, `/app/…`) | 97 of which MISSING 96 |
| MISSING refs written as **code** (non-comment lines) | **1,742** |
| MISSING refs inside comments/prose | 767 |
| **actionable** MISSING refs outside `scripts/` | **1,473** in 576 files (775 are code lines) |
| `scripts/` archaeology (historical phase probes) MISSING refs | 1,036 in 183 files |

> **Bottom line for the lead:** 41/41 moved dirs still have live references. 2,509 references point at paths that **no longer exist**. 1,473 of them are outside `scripts/` (real code, config, CI, Docker), and 494 refs are **false friends** — `server/src/<name>/` dirs that share a name with a moved dir and would be corrupted by a naive find-and-replace.

---

## P1 — Step 0 refs + HEAD SHA

```console
$ git fetch origin
$ git checkout restructure/file-structure
Switched to a new branch 'restructure/file-structure'
branch 'restructure/file-structure' set up to track 'origin/restructure/file-structure'.
$ git pull origin restructure/file-structure
From https://github.com/lewiseinstein15-Tech/jexi-os-
 * branch            restructure/file-structure -> FETCH_HEAD
Already up to date.
$ git rev-parse HEAD
fcef3e7084838fbec7c298b9e82e91bf527fd020
$ git log --oneline -3
fcef3e7 restructure(2/3): move root docs into docs/ — architecture/operations/guides/archive
900d0dd restructure(1/3): group top-level dirs into runtime/mind/agents/capabilities/services/interfaces/integrations/infra
e6bde65 merge: PR 17 — investigation: excluded scopes close-out (5 CLOSED, 17B confirmed)
```

✅ `fcef3e7` matches the expected Stage-2 tip. Working tree clean at start.

**Ground truth taken from the actual move commits** (not from prose):

| stage | commit | files changed | insertions/deletions |
| --- | --- | --- | --- |
| 1/3 — top-level dir grouping | `900d0dd` | 1006 | 0 / 0 (pure renames) |
| 2/3 — root docs → `docs/` | `fcef3e7` | 14 | 0 / 0 (pure renames) |

**Critical consequence:** both stages were **pure renames with zero content edits**, so *every* reference in the tree is still written against the pre-move layout. Nothing was rewritten. This document is therefore the complete worklist for Stage 3B.

---

## P2 — Raw grep counts (method + command)

Exact command (fixed-string, one `-e` per old dir name, slash-anchored, `docs/` excluded):

```bash
git grep -n -I -F -e 'kernel/' -e 'rlm/' -e 'scheduler/' -e 'session/' -e 'workgraph/' -e 'runtimes/' -e 'router/' -e 'context/' -e 'events/' -e 'brain/' -e 'memory/' -e 'instincts/' -e 'learning/' -e 'knowledge/' -e 'intelligence/' -e 'agents/' -e 'workforce/' -e 'swarm/' -e 'jexi-agents/' -e 'tools/' -e 'commands/' -e 'plugins/' -e 'prompt/' -e 'lsp/' -e 'capability/' -e 'semantica/' -e 'evomap/' -e 'omnia/' -e 'surfsense/' -e 'research/' -e 'computer/' -e 'src/' -e 'ui/' -e 'web/' -e 'public/' -e 'android/' -e 'cli/' -e 'providers/' -e 'deploy/' -e 'hooks/' -e 'verification/' \
  -- '*.js' '*.jsx' '*.mjs' '*.json' '*.yml' '*.yaml' '*.html' 'Dockerfile*' \
  ':(exclude)docs/**'
```

```console
raw match lines : 4098
distinct files  : 1097
```

Notes on the sweep:

* `node_modules/` is **untracked and absent** in this clone → contributes 0 matches (nothing to exclude).
* `docs/` excluded per spec. Root markdown (`README.md`, `AGENTS.md`, …) is **not** `docs/`, but `.md` is also not in the spec pathspec — see **F12 coverage gap**.
* The spec pathspec covers the 8 listed file types; a wider sweep over *all* tracked files finds **4,779** matches, i.e. **+681** lines in **0** files that the spec pathspec never looked at.

**Per old dir — raw matching lines (pre-dedupe, so a line can count for several dirs):**

| old dir | raw lines | | old dir | raw lines | | old dir | raw lines |
| --- | ---: | --- | --- | ---: | --- | --- | ---: |
| `kernel` | 69 | `intelligence` | 54 | `surfsense` | 52 |
| `rlm` | 23 | `agents` | 179 | `research` | 118 |
| `scheduler` | 61 | `workforce` | 185 | `computer` | 141 |
| `session` | 82 | `swarm` | 40 | `src` | 2101 |
| `workgraph` | 35 | `jexi-agents` | 13 | `ui` | 264 |
| `runtimes` | 37 | `tools` | 255 | `web` | 221 |
| `router` | 13 | `commands` | 108 | `public` | 12 |
| `context` | 120 | `plugins` | 60 | `android` | 10 |
| `events` | 131 | `prompt` | 122 | `cli` | 14 |
| `brain` | 152 | `lsp` | 80 | `providers` | 279 |
| `memory` | 88 | `capability` | 92 | `deploy` | 9 |
| `instincts` | 49 | `semantica` | 169 | `hooks` | 162 |
| `learning` | 39 | `evomap` | 11 | `verification` | 49 |
| `knowledge` | 31 | `omnia` | 18 |  |  |

---

## P3 — TABLE 1 — per old dir

`matches` = occurrence-level hits (a line referencing two old dirs counts once for each). `files` = distinct files carrying at least one hit. `MISSING` = the referenced path does not exist in the tree at `fcef3e7` (i.e. genuinely broken). `resolves` = the written path still exists (usually because the file moved deeper and the old relative path now lands somewhere that happens to exist — see F8).

| old_dir | target | matches | files_affected | MISSING | MISSING files | resolves | server-internal | already-new | not-a-path | root-abs |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `kernel/` | `runtime/kernel/` | 49 | 29 | 18 | 14 | 15 | 13 | 0 | 3 | 2 |
| `rlm/` | `runtime/rlm/` | 21 | 7 | 18 | 7 | 0 | 0 | 0 | 3 | 0 |
| `scheduler/` | `runtime/scheduler/` | 61 | 18 | 8 | 6 | 9 | 3 | 0 | 41 | 0 |
| `session/` | `runtime/session/` | 80 | 36 | 80 | 36 | 0 | 0 | 0 | 0 | 7 |
| `workgraph/` | `runtime/workgraph/` | 33 | 20 | 25 | 14 | 5 | 3 | 0 | 0 | 0 |
| `runtimes/` | `runtime/runtimes/` | 30 | 13 | 30 | 13 | 0 | 0 | 0 | 0 | 0 |
| `router/` | `runtime/router/` | 10 | 4 | 2 | 2 | 4 | 0 | 0 | 4 | 0 |
| `context/` | `runtime/context/` | 103 | 31 | 47 | 21 | 8 | 18 | 0 | 30 | 0 |
| `events/` | `runtime/events/` | 102 | 47 | 92 | 44 | 0 | 1 | 0 | 9 | 10 |
| `brain/` | `mind/brain/` | 89 | 32 | 89 | 32 | 0 | 0 | 0 | 0 | 0 |
| `memory/` | `mind/memory/` | 92 | 44 | 59 | 28 | 3 | 19 | 0 | 11 | 3 |
| `instincts/` | `mind/instincts/` | 26 | 12 | 26 | 12 | 0 | 0 | 0 | 0 | 2 |
| `learning/` | `mind/learning/` | 35 | 13 | 35 | 13 | 0 | 0 | 0 | 0 | 0 |
| `knowledge/` | `mind/knowledge/` | 29 | 16 | 12 | 12 | 0 | 4 | 0 | 13 | 0 |
| `intelligence/` | `mind/intelligence/` | 49 | 26 | 49 | 26 | 0 | 0 | 0 | 0 | 0 |
| `agents/` | `agents/catalog/` | 106 | 58 | 45 | 34 | 32 | 5 | 0 | 24 | 5 |
| `workforce/` | `agents/workforce/` | 148 | 62 | 116 | 40 | 29 | 3 | 0 | 0 | 3 |
| `swarm/` | `agents/swarm/` | 40 | 18 | 40 | 18 | 0 | 0 | 0 | 0 | 0 |
| `jexi-agents/` | `agents/jexi/` | 13 | 8 | 13 | 8 | 0 | 0 | 0 | 0 | 1 |
| `tools/` | `capabilities/tools/` | 193 | 77 | 85 | 42 | 33 | 61 | 1 | 13 | 0 |
| `commands/` | `capabilities/commands/` | 46 | 24 | 43 | 22 | 0 | 1 | 1 | 1 | 4 |
| `plugins/` | `capabilities/plugins/` | 35 | 22 | 8 | 5 | 3 | 11 | 0 | 13 | 0 |
| `prompt/` | `capabilities/prompts/` | 131 | 58 | 130 | 57 | 0 | 0 | 0 | 1 | 8 |
| `lsp/` | `capabilities/lsp/` | 48 | 15 | 15 | 9 | 29 | 4 | 0 | 0 | 0 |
| `capability/` | `capabilities/graph/` | 93 | 38 | 88 | 36 | 1 | 3 | 0 | 0 | 0 |
| `semantica/` | `services/semantica/` | 172 | 137 | 147 | 117 | 24 | 0 | 0 | 0 | 0 |
| `evomap/` | `services/evomap/` | 2 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `omnia/` | `services/omnia/` | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 0 |
| `surfsense/` | `services/surfsense/` | 43 | 15 | 43 | 15 | 0 | 0 | 0 | 0 | 0 |
| `research/` | `services/research/` | 104 | 50 | 101 | 47 | 3 | 0 | 0 | 0 | 2 |
| `computer/` | `services/computer/` | 134 | 62 | 126 | 60 | 0 | 0 | 0 | 8 | 1 |
| `src/` | `interfaces/console/` | 1735 | 389 | 358 | 109 | 1072 | 305 | 0 | 0 | 36 |
| `ui/` | `interfaces/ui/` | 177 | 53 | 160 | 44 | 7 | 0 | 0 | 9 | 4 |
| `web/` | `interfaces/web/` | 198 | 73 | 177 | 60 | 8 | 1 | 0 | 11 | 6 |
| `public/` | `interfaces/public/` | 12 | 10 | 9 | 7 | 0 | 3 | 0 | 0 | 0 |
| `android/` | `interfaces/android/` | 10 | 8 | 9 | 7 | 0 | 0 | 0 | 1 | 0 |
| `cli/` | `interfaces/cli/` | 8 | 5 | 5 | 4 | 0 | 0 | 0 | 3 | 0 |
| `providers/` | `integrations/providers/` | 263 | 122 | 66 | 36 | 142 | 28 | 18 | 9 | 0 |
| `deploy/` | `infra/deploy/` | 8 | 4 | 8 | 4 | 0 | 0 | 0 | 0 | 1 |
| `hooks/` | `infra/hooks/` | 132 | 59 | 90 | 37 | 27 | 8 | 0 | 7 | 0 |
| `verification/` | `tests/verification/` | 37 | 29 | 32 | 25 | 5 | 0 | 0 | 0 | 2 |
| **TOTAL (41 dirs)** | — | **4,700** | **1,072** | **2,509** | **759** | **1,459** | **494** | **20** | **214** | **97** |

**Highest-risk dirs (MISSING refs, ranked):**

| rank | old_dir | MISSING | of which code (non-comment) | MISSING files |
| ---: | --- | ---: | ---: | ---: |
| 1 | `src/` → `interfaces/console/` | 358 | 306 | 109 |
| 2 | `web/` → `interfaces/web/` | 177 | 142 | 60 |
| 3 | `ui/` → `interfaces/ui/` | 160 | 146 | 44 |
| 4 | `semantica/` → `services/semantica/` | 147 | 133 | 117 |
| 5 | `prompt/` → `capabilities/prompts/` | 130 | 56 | 57 |
| 6 | `computer/` → `services/computer/` | 126 | 61 | 60 |
| 7 | `workforce/` → `agents/workforce/` | 116 | 72 | 40 |
| 8 | `research/` → `services/research/` | 101 | 52 | 47 |
| 9 | `events/` → `runtime/events/` | 92 | 51 | 44 |
| 10 | `hooks/` → `infra/hooks/` | 90 | 61 | 37 |
| 11 | `brain/` → `mind/brain/` | 89 | 72 | 32 |
| 12 | `capability/` → `capabilities/graph/` | 88 | 70 | 36 |

---

## P4 — TABLE 2 — per file type

`file_type` per the spec. `MISSING` counts broken refs; `code` excludes comment/prose lines.

| file_type | files | matches | MISSING | MISSING files | MISSING code lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| *.js | 806 | 3,051 | 1,271 | 534 | 602 |
| *.mjs | 210 | 1,376 | 1,034 | 185 | 967 |
| *.json | 12 | 111 | 109 | 10 | 109 |
| *.jsx | 20 | 57 | 15 | 9 | 9 |
| *.html | 4 | 39 | 36 | 4 | 31 |
| .github/workflows/*.yml | 8 | 34 | 27 | 7 | 19 |
| `lockfile` | 2 | 12 | 1 | 1 | 1 |
| `Dockerfile*` | 2 | 10 | 6 | 1 | 0 |
| *.yaml | 4 | 4 | 4 | 4 | 1 |
| vite/postcss/tailwind config | 2 | 4 | 4 | 2 | 1 |
| `index.html (Vite entry)` | 1 | 1 | 1 | 1 | 1 |
| `package.json (nested)` | 1 | 1 | 1 | 1 | 1 |

Spec-mandated files, individually:

| spec item | found | matches | MISSING | verdict |
| --- | --- | ---: | ---: | --- |
| all `*.js` `*.jsx` `*.mjs` source | yes | 4,484 | 2,320 | main blast radius |
| root `package.json` | yes | 0 (slash-anchored) | 0 | ⚠️ **2 bare-dir refs** — see P8 / F13 |
| nested `package.json` | 6 files | 1 | 1 | `server/package.json` → `../cli/test-cli.js` |
| `Dockerfile` + `Dockerfile.slim` | 2 files | 10 | 6 | **4 COPY sources gone → image build fails** |
| `.github/workflows/*.yml` | 8 files | 34 | 27 | 3 workflows broken |
| `vite.config.js` | yes | 3 | 3 | comment only — **no functional path** |
| `postcss.config.js` | yes | 0 | 0 | clean |
| `tailwind.config.js` | yes | 1 | 1 | **purge glob `./src/**` broken** |
| `index.html` | yes | 1 | 1 | **Vite entry `/src/main.jsx` broken** |
| `render.yaml` | yes | 0 | 0 | clean (`rootDir: server` untouched) |
| `capacitor.config.json` | yes | 0 | 0 | clean (`webDir: dist`) — but `cap sync android` breaks |

---

## P5 — TABLE 3 — top 30 files

| rank | file_path | match_count | MISSING | which old dirs |
| ---: | --- | ---: | ---: | --- |
| 1 | `server/index.js` | 185 | 3 | `kernel/`, `scheduler/`, `context/`, `events/`, `memory/`, `knowledge/`, `agents/`, `workforce/`, `tools/`, `commands/`, `plugins/`, `computer/`, `src/`, `providers/`, `hooks/` |
| 2 | `server/bundles/manifest.json` | 79 | 79 | `session/`, `context/`, `plugins/`, `lsp/`, `src/`, `web/`, `hooks/` |
| 3 | `scripts/phase31-0-wiring-plan.mjs` | 60 | 33 | `kernel/`, `rlm/`, `session/`, `context/`, `brain/`, `memory/`, `instincts/`, `intelligence/`, `swarm/`, `tools/`, `prompt/`, `capability/`, `semantica/`, `computer/`, `src/`, `ui/`, `web/`, `providers/`, `verification/` |
| 4 | `server/test-everything.js` | 52 | 0 | `plugins/`, `src/`, `web/`, `hooks/` |
| 5 | `scripts/phase25-scope-d.mjs` | 47 | 10 | `memory/`, `tools/`, `prompt/`, `lsp/`, `src/`, `web/` |
| 6 | `scripts/phase16-l-probe.mjs` | 45 | 45 | `events/`, `src/`, `ui/`, `web/` |
| 7 | `server/src/wiring/phase31-bootstrap.js` | 45 | 35 | `kernel/`, `rlm/`, `scheduler/`, `session/`, `workgraph/`, `context/`, `brain/`, `instincts/`, `swarm/`, `tools/`, `commands/`, `capability/`, `semantica/`, `src/`, `providers/`, `verification/` |
| 8 | `capabilities/graph/code/mcp-server.js` | 38 | 8 | `tools/`, `lsp/`, `capability/` |
| 9 | `scripts/phase31-scope-3-probe.mjs` | 36 | 20 | `scheduler/`, `session/`, `workgraph/`, `context/`, `brain/`, `workforce/`, `swarm/`, `src/`, `providers/` |
| 10 | `scripts/phase31-scope-5-probe.mjs` | 36 | 7 | `context/`, `tools/`, `capability/`, `semantica/`, `src/` |
| 11 | `server/test-audit-b48.js` | 35 | 9 | `memory/`, `workforce/`, `prompt/`, `src/`, `hooks/` |
| 12 | `scripts/phase17-e-probe.mjs` | 34 | 11 | `kernel/`, `session/`, `context/`, `src/` |
| 13 | `scripts/phase16-l-shots.mjs` | 32 | 32 | `ui/`, `web/` |
| 14 | `scripts/regenerate-capabilities.mjs` | 32 | 18 | `brain/`, `agents/`, `workforce/`, `tools/`, `surfsense/`, `src/`, `ui/`, `web/`, `hooks/` |
| 15 | `services/research/constraints/read-only.js` | 28 | 28 | `workgraph/`, `runtimes/`, `context/`, `events/`, `workforce/`, `swarm/`, `commands/`, `capability/`, `research/`, `web/` |
| 16 | `runtime/events/hud/producer.js` | 26 | 0 | `kernel/`, `scheduler/`, `src/`, `providers/`, `hooks/` |
| 17 | `scripts/phase17-d-probe.mjs` | 26 | 12 | `memory/`, `src/` |
| 18 | `scripts/phase31-scope-2-probe.mjs` | 26 | 22 | `events/`, `agents/`, `computer/`, `src/`, `ui/`, `web/` |
| 19 | `capabilities/commands/_context.js` | 25 | 17 | `workgraph/`, `events/`, `learning/`, `commands/`, `src/` |
| 20 | `server/test-dsh-batch14.js` | 25 | 13 | `context/`, `plugins/`, `src/` |
| 21 | `server/test-model-coworkers.js` | 24 | 8 | `src/`, `providers/`, `hooks/` |
| 22 | `scripts/phase29-scope-k-probe.mjs` | 23 | 23 | `events/`, `workforce/`, `computer/`, `ui/`, `web/` |
| 23 | `server/test-learning.js` | 23 | 7 | `kernel/`, `context/`, `learning/`, `src/`, `hooks/` |
| 24 | `scripts/phase22-d-import.mjs` | 22 | 21 | `hooks/` |
| 25 | `server/test-b52.js` | 22 | 12 | `research/`, `computer/`, `src/`, `web/` |
| 26 | `server/test-dsh-batch12.js` | 21 | 11 | `events/`, `src/`, `web/`, `hooks/` |
| 27 | `scripts/phase16-o-probe.mjs` | 20 | 20 | `ui/`, `web/` |
| 28 | `scripts/phase31-scope-6-probe.mjs` | 20 | 8 | `tools/`, `commands/`, `src/`, `ui/`, `web/` |
| 29 | `scripts/phase16-k-probe.mjs` | 19 | 19 | `events/`, `src/`, `ui/`, `web/` |
| 30 | `scripts/phase16-m-probe.mjs` | 19 | 19 | `events/`, `ui/`, `web/` |

Total distinct files carrying ≥1 reference: **1,072** · files carrying ≥1 MISSING reference: **759**

### Blast-radius by top-level area (MISSING refs, non-`scripts/`)

| area | MISSING refs | files |
| --- | ---: | ---: |
| `server/` | 605 | 171 |
| `capabilities/` | 199 | 67 |
| `services/` | 159 | 77 |
| `mind/` | 141 | 99 |
| `interfaces/` | 87 | 35 |
| `harness/` | 56 | 28 |
| `runtime/` | 47 | 18 |
| `agents/` | 44 | 20 |
| `.github/` | 27 | 7 |
| `security/` | 20 | 10 |
| `infra/` | 19 | 7 |
| `tests/` | 17 | 12 |
| `benchmarks/` | 15 | 9 |
| `skills/` | 13 | 5 |
| `integrations/` | 11 | 5 |
| `Dockerfile.slim/` | 6 | 1 |
| `vite.config.js/` | 3 | 1 |
| `.jexi/` | 2 | 2 |
| `index.html/` | 1 | 1 |
| `tailwind.config.js/` | 1 | 1 |

---

## P6 — TABLE 4 — special cases (FLAGGED — do NOT fix in 3A)

### 4.1 `agents/` — needs a prefix insert (double-meaning dir)

* old `agents/` → new `agents/catalog/` (89 moved subdirs).
* **106** refs contain `agents/`; **17** are already relative (`../agents/…`) and **89** are bare/root-anchored.
* **45** of them are MISSING today.
* ⚠️ **`agents/` is also the NEW parent directory** (`agents/catalog`, `agents/workforce`, `agents/swarm`, `agents/jexi`). A blind `agents/ → agents/catalog/` rewrite is **the single most dangerous transform in this stage**: it would double-prefix every already-correct new-style path. Any fix must be per-target-validated, not per-token.

First segment seen after a bare `agents/`:

| first segment | count |
| --- | ---: |
| (end of token — bare `agents/`) | 35 |
| `profiles` | 7 |
| `definitions` | 7 |
| `vendor` | 6 |
| `coverage` | 5 |
| `skills` | 5 |
| `.test` | 4 |
| `tools` | 3 |
| `meta` | 2 |
| `${a}` | 2 |
| `delegate` | 2 |
| `${name}` | 1 |
| `commands` | 1 |
| `rules` | 1 |
| `sessions` | 1 |
| `roles` | 1 |
| `vendor.` | 1 |
| `divisions` | 1 |
| `orchestrator` | 1 |
| `i.test` | 1 |

MISSING `agents/` refs (all 45):

* `agents/workforce/agents/index.js:4` — `./workforce/agents/index.js`
* `agents/workforce/agents/index.js:10` — `./workforce/agents/index.js`
* `agents/workforce/agents/loader.js:10` — `workforce/agents/vendor/agency-agents.specs.json`
* `agents/workforce/agents/loader.js:231` — `workforce/agents/vendor/agency-agents.specs.json`
* `agents/workforce/registry/catalog.js:14` — `agents/meta/_template.md`
* `harness/adapters/_base.adapter.js:145` — `agents/commands/rules`
* `harness/adapters/index.js:64` — `agents/rules/skills/hooks/commands/mcp`
* `harness/parity/subagent/contract.js:2` — `../../../workforce/agents/agent-spec.js`
* `interfaces/console/components/console/views/PluginsView.jsx:6` — `agents/tools/skills`
* `interfaces/ui/preview/console.html:343` — `agents/sessions/memory/skills/etc.`
* `mind/brain/self/reflex.js:108` — `agents/roles`
* `scripts/generate-catalog.mjs:96` — `agents/.test`
* `scripts/generate-divisions.js:11` — `agents/meta/_template.md`
* `scripts/phase13-scope-a.mjs:20` — `../workforce/agents/index.js`
* `scripts/phase13-scope-b.mjs:24` — `../workforce/agents/index.js`
* `scripts/phase13-scope-c-fix-2.mjs:23` — `../workforce/agents/index.js`
* `scripts/phase13-scope-c-fix-2.mjs:44` — `/workforce/agents/vendor.`
* `scripts/phase13-scope-c-fix.mjs:73` — `/workforce/agents/vendor`
* `scripts/phase13-scope-c.mjs:22` — `../workforce/agents/index.js`
* `scripts/phase13-scope-d.mjs:30` — `../workforce/agents/index.js`
* `scripts/phase13-scope-d.mjs:318` — `agents/divisions/nexus/divisions.json`
* `scripts/phase13-scope-e.mjs:28` — `../workforce/agents/index.js`
* `scripts/phase13-vendor-agency.mjs:9` — `workforce/agents/vendor/agency-agents.specs.json`
* `scripts/phase13-vendor-agency.mjs:28` — `../workforce/agents/capabilities.js`
* `scripts/phase13-vendor-agency.mjs:29` — `../workforce/agents/infer.js`
* `scripts/phase13-vendor-agency.mjs:33` — `workforce/agents/vendor/agency-agents.specs.json`
* `scripts/phase30-subagent-probe.mjs:146` — `workforce/agents/vendor/agency-agents.specs.json`
* `scripts/phase31-scope-19-probe.mjs:45` — `/agents/.test`
* `scripts/regenerate-capabilities.mjs:106` — `../workforce/agents/index.js`
* `scripts/regenerate-capabilities.mjs:109` — `../workforce/agents/index.js`
* `scripts/regenerate-capabilities.mjs:114` — `../workforce/agents/index.js`
* `server/agents/profiles/orchestrator/config.yaml:19` — `agents/orchestrator/memory.jsonl`
* `server/index.js:1124` — `agents/skills/tools`
* `server/src/services/AcpServer.js:5` — `agents/tools`
* `server/src/services/JexiPrompt.js:65` — `agents/skills/tools`
* `server/src/services/Planner.js:10` — `agents/tools`
* `server/src/services/Planner.js:567` — `agents/i.test`
* `server/src/services/ProfileCompleteness.js:15` — `agents/profiles/.`
* `server/src/services/director/MissionRunner.js:23` — `missions/agents/verification`
* `server/src/workforce/registry/index.js:318` — `agents/skills`
* `server/test-b206b.js:15` — `narrations/agents/by`
* `server/test-b206b.js:199` — `/agents/.test`
* `server/test-b49.js:3` — `agents/skills/tools`
* `server/test-identity.js:38` — `agents/.test`
* `server/test-roster-registry.js:83` — `agents/skills`

### 4.2 Relative paths `../../brain/x` — depth changed when files moved

* **778** MISSING refs are written relative (`./` or `../`) across **323** files.
* Every file that moved 1–2 levels deeper (e.g. `brain/index/x.js` → `mind/brain/index/x.js`) needs its `../` count re-derived; the *string* is unchanged but the *depth* is wrong.

| leading prefix | MISSING refs |
| --- | ---: |
| `../` | 566 |
| `../../` | 86 |
| `../../../` | 85 |
| `./` | 29 |
| `../../../../` | 12 |

⚠️ **Accidental-resolve trap** — some relative refs still resolve *by coincidence* because the file and its target both moved by the same depth. These do **not** appear in the MISSING column and will pass a naive `node --check`/import smoke test while pointing at the wrong module:

| ref | written | resolves today to | was meant to be |
| --- | --- | --- | --- |
| `interfaces/console/main.jsx:4` | `../ui/web/console/shell/Shell.jsx` | `interfaces/ui/web/console/shell/Shell.jsx` ✅ exists | `ui/web/console/shell/Shell.jsx` |
| `capabilities/graph/code/graph-first.js:56` | `../../tools/domains/lsp/_graph.js` | `capabilities/tools/domains/lsp/_graph.js` ✅ exists | `tools/domains/lsp/_graph.js` |
| `capabilities/graph/code/mcp-server.js:13` | `../../tools/domains/lsp/index-repository.tool.js` | `capabilities/tools/domains/lsp/…` ✅ exists | `tools/domains/lsp/…` |

### 4.3 Dynamic paths — `path.join(...)`, `import()`, `new URL(...)`, `require()`

* **834** occurrence-level hits; **677** distinct production lines outside `scripts/` (the remainder are phase probes).
* **1** of them build the path from a variable (`path.join(ROOT, 'kernel/…')`) — these are the ones a textual grep-and-replace is most likely to miss.
* No `path.join(dirName, "brain")`-style *variable* assembly (where the moved dir name itself is a variable) was found; all dynamic joins use a **string literal segment**, so they are greppable.

Production dynamic-path lines (all, non-`scripts/`):

| file:line | code |
| --- | --- |
| `agents/workforce/agents/loader.js:231` | `const catalog = path.join(root, 'workforce/agents/vendor/agency-agents.specs.json');` |
| `agents/workforce/registry/index.js:4` | `*   node -e "console.log(require('./workforce/registry').loadAgentFile('planner'))"` |
| `agents/workforce/registry/index.js:5` | `*   node -e "console.log(require('./workforce/registry').listDivisions().length)"` |
| `capabilities/commands/autonomous.command.js:5` | `const module = await import(new URL('../scheduler/autonomous/index.js', import.meta.url));` |
| `capabilities/commands/goal.command.js:8` | `try { module = await import(new URL('../scheduler/autonomous/index.js', import.meta.url)); } catch { return null; }` |
| `capabilities/commands/heartbeat.command.js:5` | `const module = await import(new URL('../scheduler/autonomous/index.js', import.meta.url));` |
| `capabilities/graph/doctor/index.js:37` | `const { DaemonClient } = await import(path.join(ROOT, 'kernel/daemon/client.js'));` |
| `capabilities/graph/doctor/index.js:72` | `const { getStore, closeStore } = await import(path.join(ROOT, 'tools/domains/lsp/_graph.js'));` |
| `capabilities/graph/doctor/index.js:73` | `const { handler: coverageHandler } = await import(path.join(ROOT, 'tools/domains/lsp/check-index-coverage.tool.js'));` |
| `capabilities/graph/doctor/index.js:102` | `const { checkAll } = await import(path.join(ROOT, 'capability/internet/reach/doctor.js').replace(/^file:\/\//, ''));` |
| `capabilities/graph/doctor/index.js:103` | `const { ALL_CHANNELS } = await import(path.join(ROOT, 'capability/internet/reach/channels/index.js'));` |
| `capabilities/graph/doctor/index.js:104` | `const { ReachConfig } = await import(path.join(ROOT, 'capability/internet/reach/config.js'));` |
| `capabilities/tools/domains/lsp/_graph.js:32` | `_store = await openGraphStore(path.join(REPO_ROOT, 'capability/code/graph/db'), { project: 'jexi-os' });` |
| `harness/adapters/_convert.js:66` | `for (const f of listDir(path.join(REPO_ROOT, 'jexi-agents/coworkers'))) {` |
| `harness/adapters/_convert.js:68` | `const full = path.join(REPO_ROOT, 'jexi-agents/coworkers', f);` |
| `harness/adapters/_convert.js:124` | `for (const cw of listDir(path.join(REPO_ROOT, 'workforce/coworkers'))) {` |
| `harness/adapters/_convert.js:125` | `const agDir = path.join(REPO_ROOT, 'workforce/coworkers', cw, 'agents');` |
| `harness/adapters/_convert.js:223` | `const full = path.join(REPO_ROOT, 'hooks/hooks.json');` |
| `harness/adapters/_convert.js:242` | `const facade = await import(path.join(REPO_ROOT, 'commands/index.js'));` |
| `interfaces/ui/preview/agents-view.html:617` | `<b>To start daemon:</b> node -e "import('rlm/daemon/index.js').then(m=>m.createDaemon().start().then(console.log))"<br>` |
| `runtime/kernel/daemon/client.js:15` | `export const GRAPH_DB = path.join(REPO_ROOT, 'capability/code/graph/db');` |
| `runtime/kernel/daemon/client.js:71` | `spawn(process.execPath, [path.join(REPO_ROOT, 'kernel/daemon/codegraph-daemon.js'), '--cache-dir', cacheRoot], {` |
| `runtime/kernel/daemon/codegraph-daemon.js:24` | `const GRAPH_DB = path.join(REPO_ROOT, 'capability/code/graph/db');` |
| `runtime/router/resolve.js:12` | `*   node -e "require('./router/resolve').resolveTwoStage('review my TypeScript')` |
| `server/cli.js:56` | `const { workerBootstrapSelfCheck } = await import('./src/services/CodeRuntimeBootstrap.js');` |
| `server/cli.js:68` | `const { Planner } = await import('./src/services/Planner.js');` |
| `server/cli.js:69` | `const { runAgentLoop } = await import('./src/services/AgentLoop.js');` |
| `server/cli.js:121` | `const { listCommands } = await import('./src/services/CommandRegistry.js');` |
| `server/cli.js:147` | `const seam = await import('./src/commands-seam.js');` |
| `server/evaluation/tasks.js:14` | `const { structureObjective } = await import('../src/services/director/ObjectiveInterpreter.js');` |
| `server/evaluation/tasks.js:15` | `const { discoverTools } = await import('../src/services/ToolDiscovery.js');` |
| `server/evaluation/tasks.js:16` | `const { TOOL_REGISTRY } = await import('../src/services/ToolRegistry.js');` |
| `server/evaluation/tasks.js:17` | `const { WorkGraph } = await import('../src/services/director/WorkGraph.js');` |
| `server/evaluation/tasks.js:18` | `const { acceptanceGates, claimsBrowserMethod, executionEvidence } = await import('../src/services/director/Verifier.js'…` |
| `server/evaluation/tasks.js:19` | `const { recordLesson, retrieveLessons, formatLessonsBlock } = await import('../src/services/director/Lessons.js');` |
| `server/evaluation/tasks.js:20` | `const { classifyProviderError, recordProviderCallFailure, skipForNow, providerState, __resetProviderHealth } = await im…` |
| `server/evaluation/tasks.js:21` | `const { TaskBudget } = await import('../src/services/RequestBudget.js');` |
| `server/evaluation/tasks.js:22` | `const { cacheKey, cacheGet, cacheSet, __resetCache } = await import('../src/services/ResponseCache.js');` |
| `server/evaluation/tasks.js:23` | `const { requestIdentity } = await import('../src/services/RequestDedup.js');` |
| `server/evaluation/tasks.js:24` | `const { recordAction, recordReasoning, detectLoops, findCircularPlan, similarity, __resetLoops } = await import('../src…` |
| `server/evaluation/tasks.js:25` | `const { scorePlan, simulateAlternatives } = await import('../src/services/director/PlanSimulator.js');` |
| `server/evaluation/tasks.js:26` | `const { validateSkill, promoteSkill, learnSkillFromLesson, usableSkills } = await import('../src/services/Skills.js');` |
| `server/evaluation/tasks.js:27` | `const { entity, recordFact, entityView, __resetWorldModel } = await import('../src/services/director/WorldModel.js');` |
| `server/evaluation/tasks.js:28` | `const { makeClaim, mergeClaims } = await import('../src/services/director/Epistemics.js');` |
| `server/evaluation/tasks.js:29` | `const { parseModelJson } = await import('../src/services/director/JsonRepair.js');` |
| `server/evaluation/tasks.js:30` | `const { parseBrowserLine } = await import('../src/services/director/ComputerOps.js');` |
| `server/evaluation/tasks.js:123` | `{ id: 'T10', task: 'the unified catalog exposes native + computer tools in one shape', expected: 'both sources present'…` |
| `server/index.js:68` | `setRedisClientGetter(() => import('./src/services/MemoryManager.js').then((m) => m.getRedis()).catch(() => null));` |
| `server/index.js:246` | `await import('./src/providers/runtime/LLMClient.js').then(async (m) => {` |
| `server/index.js:249` | `const { planner } = await import('./src/services/Planner.js');` |
| `server/scripts/mcp-gen-tool-directory.mjs:40` | `const { gatewayServerTools } = await import('../src/services/MCPGateway.js');` |
| `server/scripts/mcp-live-test.js:48` | `const g = await import('../src/services/MCPGateway.js');` |
| `server/scripts/mcp-live-test.js:50` | `try { unified = await import('../src/services/UnifiedTools.js'); } catch { /* older layout */ }` |
| `server/scripts/scope-b-probe.mjs:28` | `} = await import('../src/verification/index.js');` |
| `server/scripts/scope-b-probe.mjs:29` | `const { createWorkGraph, createTaskNode, createVerificationNode } = await import('../src/workgraph/index.js');` |
| `server/src/memory/index.js:9` | `*   const { createMemorySystem, openMemorySystem } = await import('./memory/index.js');` |
| `server/src/routes/arena.js:33` | `const { localProviderPreferred } = await import('../providers/index.js');` |
| `server/src/services/AgentGateway.js:109` | `const { generateContent } = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/DataAgent.js:220` | `const { canChat } = await import('../providers/index.js');` |
| `server/src/services/DeliverableContinuation.js:108` | `const { generateContent } = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/GuardrailAgent.js:80` | `const { generateContent } = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/JexiKernel.js:159` | `const { generateContent } = await import('../providers/runtime/LLMClient.js'); // late import: no cycle at load` |
| `server/src/services/Orchestrator.js:1207` | `const { generateContent } = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/ReasoningEngine.js:39` | `const { hasLocalCapability, resolveLocalProvider, localProviderPreferred } = await import('../providers/index.js');` |
| `server/src/services/ReasoningEngine.js:68` | `const llm = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/SessionTitles.js:123` | `const { generateContent } = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/SubagentRuntime.js:72` | `const { generateContent } = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/SubagentRuntime.js:213` | `const { generateContent } = await import('../providers/runtime/LLMClient.js');` |
| `server/src/services/ToolRuntime.js:1315` | `const { domainDispatch, domainToolCount, hasDomainTool } = await import('../tools/domains/executor.js');` |
| `server/src/services/ToolRuntime.js:1569` | `const { domainDispatch, domainToolCount, hasDomainTool } = await import('../tools/domains/executor.js');` |
| `server/src/skills/executor.js:80` | `const { domainDispatch } = await import('../tools/domains/executor.js');` |
| `server/src/wiring/phase31-bootstrap.js:713` | `const { chat } = await import('../providers/index.js');` |
| `server/test-agent-contracts.js:24` | `const A = await import('./src/services/AgentDefinitions.js');` |
| `server/test-agent-contracts.js:25` | `const { TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');` |
| `server/test-agent-contracts.js:26` | `const { resolveJobAgent, runSubagents } = await import('./src/services/SubagentRuntime.js');` |
| `server/test-arena-astra.js:12` | `const { emit, recent, stats, subscribe, _clear } = await import('./src/services/Observer.js');` |
| `server/test-arena-astra.js:40` | `const { classify, capabilitiesFor } = await import('./src/services/IntentEngine.js');` |
| `server/test-arena-astra.js:65` | `const { ollamaConfig, OllamaProvider } = await import('./src/providers/runtime/OllamaProvider.js');` |
| `server/test-arena-astra.js:81` | `const { ReasoningEngine } = await import('./src/services/ReasoningEngine.js');` |
| `server/test-arena-astra.js:99` | `const { assemble, checkpoint } = await import('./src/services/ContextEngine.js');` |
| `server/test-arena-astra.js:125` | `const { tick, pause, resume, cancel, schedulerStatus, _reset } = await import('./src/services/Scheduler.js');` |
| `server/test-arena-astra.js:155` | `const { attempt, diagnose, recoverWorkItem } = await import('./src/services/Recovery.js');` |
| `server/test-arena-astra.js:178` | `const { propose, advance, approve, reject, promote, scanAnomalies, listProposals, _reset } = await import('./src/servic…` |
| `server/test-arena-astra.js:208` | `const { marketStatus, callMarket } = await import('./src/services/JexiMarketProvider.js');` |
| `server/test-arena-astra.js:220` | `const { loadProfile, publicPersona, behaviorBrief } = await import('./src/services/UserProfile.js');` |
| `server/test-arena-astra.js:233` | `const { remember, recall, vaultStatus } = await import('./src/services/MemoryVault.js');` |
| `server/test-audit-b47.js:121` | `const { ClassificationSchema } = await import('./src/services/Planner.js');` |
| `server/test-audit-b47.js:277` | `const { setGithubKey, forgetGithubKey } = await import('./src/services/SessionKeys.js');` |
| `server/test-audit-b47.js:330` | `const { parseVerificationVerdict, buildVerificationPrompt, buildRevisionPrompt } = await import('./src/services/Verific…` |
| `server/test-audit-b47.js:340` | `const loopSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/VerificationLoop.js', 'utf8')…` |
| `server/test-audit-b47.js:341` | `const domainSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/DomainVerifier.js', 'utf8')…` |
| `server/test-audit-b47.js:344` | `const memSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/MemoryManager.js', 'utf8'));` |
| `server/test-audit-b47.js:345` | `const prefSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/PreferenceLearner.js', 'utf8'…` |
| `server/test-audit-b47.js:346` | `const jexiSrc = await import('node:fs').then((fs) => fs.promises.readFile('./src/services/JexiPrompt.js', 'utf8'));` |
| `server/test-audit-b48.js:55` | `const orchSrc = fs.readFileSync('./src/services/Orchestrator.js', 'utf8');` |
| `server/test-audit-b48.js:71` | `const mem = await import('./src/services/MemoryManager.js');` |
| `server/test-audit-b48.js:95` | `const mem = await import('./src/services/MemoryManager.js');` |
| `server/test-audit-b48.js:118` | `const sa = fs.readFileSync('./src/services/SearchAgent.js', 'utf8');` |
| `server/test-audit-b48.js:120` | `const rsn = fs.readFileSync('./src/services/Reasoner.js', 'utf8');` |
| `server/test-audit-b48.js:128` | `const cw = fs.readFileSync('../src/components/ChatWindow.jsx', 'utf8');` |
| `server/test-audit-b48.js:129` | `const css = fs.readFileSync('../src/index.css', 'utf8');` |
| `server/test-audit-b48.js:140` | `const mr = fs.readFileSync('../src/components/MarkdownRenderer.jsx', 'utf8');` |
| `server/test-audit-b48.js:162` | `const s = fs.readFileSync('./src/services/SessionStore.js', 'utf8');` |
| `server/test-audit-b48.js:167` | `const helpers = fs.readFileSync('../src/utils/helpers.js', 'utf8');` |
| `server/test-audit-b48.js:169` | `const engine = fs.readFileSync('../src/hooks/useJexiEngine.js', 'utf8');` |
| `server/test-audit-b48.js:207` | `const mem = await import('./src/services/MemoryManager.js');` |
| `server/test-audit-b48.js:267` | `const mem = await import('./src/services/MemoryManager.js');` |
| `server/test-audit-b48.js:328` | `const ta = fs.readFileSync('./src/services/TranslatorAgent.js', 'utf8');` |
| `server/test-audit-b48.js:330` | `const da = fs.readFileSync('./src/services/DataAgent.js', 'utf8');` |
| `server/test-audit-b48.js:332` | `const wa = fs.readFileSync('./src/services/WriterAgent.js', 'utf8');` |
| `server/test-audit-b48.js:334` | `const pa = fs.readFileSync('./src/services/PerfAgent.js', 'utf8');` |
| `server/test-audit-b48.js:336` | `const cu = fs.readFileSync('./src/services/ComputerUseAgent.js', 'utf8');` |
| `server/test-audit-b48.js:338` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf8');` |
| `server/test-audit-b48.js:348` | `ok(fs.existsSync('./src/services/RESPONSE_VOICE.md'), 'P7.3: the shared style guide file exists');` |
| `server/test-audit-b48.js:349` | `const guide = fs.readFileSync('./src/services/RESPONSE_VOICE.md', 'utf8');` |
| `server/test-auto-mode.js:32` | `const { isDirectIntent, DIRECT_INTENTS } = await import('./src/services/Planner.js');` |
| `server/test-auto-mode.js:51` | `const plannerSrc = fs.readFileSync('./src/services/Planner.js', 'utf-8');` |
| `server/test-auto-mode.js:60` | `const hook = fs.readFileSync('../src/hooks/useJexiEngine.js', 'utf-8');` |
| `server/test-auto-mode.js:64` | `const chat = fs.readFileSync('../src/components/ChatWindow.jsx', 'utf-8');` |
| `server/test-auto-mode.js:73` | `const home = fs.readFileSync('../src/components/HomeView.jsx', 'utf-8');` |
| `server/test-auto-mode.js:76` | `const settings = fs.readFileSync('../src/components/SettingsPanel.jsx', 'utf-8');` |
| `server/test-auto-mode.js:94` | `const { detectPluginIntent } = await import('./src/services/Planner.js');` |
| `server/test-auto-mode.js:114` | `const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');` |
| `server/test-auto-mode.js:115` | `const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');` |
| `server/test-autonomous-coding.js:24` | `const { loadPlugins, setActivePluginContext, listPluginTools, listPluginSkills } = await import('./src/services/PluginC…` |
| `server/test-autonomous-coding.js:25` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-autonomous-coding.js:26` | `const { discoverSkills, loadSkillForModel } = await import('./src/services/SkillDiscovery.js');` |
| `server/test-autonomous-coding.js:27` | `const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');` |
| `server/test-autonomous-coding.js:28` | `const { planner } = await import('./src/services/Planner.js');` |
| `server/test-autonomous-coding.js:102` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-b186.js:6` | `const dsh = fs.readFileSync('./src/services/DshCoding.js', 'utf-8');` |
| `server/test-b186.js:9` | `const tr = fs.readFileSync('./src/services/TeamRouter.js', 'utf-8');` |
| `server/test-b186.js:16` | `const { WORKSPACE_DIR } = await import('./src/config.js');` |
| `server/test-b186.js:19` | `const { runDshCoding } = await import('./src/services/DshCoding.js');` |
| `server/test-b187.js:6` | `const { sanitizeOutgoingLinks } = await import('./src/services/Formatting.js');` |
| `server/test-b187.js:27` | `const rules = fs.readFileSync('./src/services/Formatting.js', 'utf-8');` |
| `server/test-b187.js:31` | `const dsh = fs.readFileSync('./src/services/DshCoding.js', 'utf-8');` |
| `server/test-b187.js:38` | `const F = await import('./src/services/Formatting.js');` |
| `server/test-b188.js:7` | `const WP = await import('./src/services/WorkspacePublisher.js');` |
| `server/test-b188.js:55` | `const tr = fs.readFileSync('./src/services/TeamRouter.js', 'utf-8');` |
| `server/test-b189.js:9` | `const MM = await import('./src/services/MemoryManager.js');` |
| `server/test-b189.js:29` | `const { routeToTeam } = await import('./src/services/TeamRouter.js');` |
| `server/test-b189.js:39` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-b191.js:12` | `const PC = await import('./src/services/ProfileCompleteness.js');` |
| `server/test-b191.js:28` | `const PM = await import('./src/services/ProjectMemory.js');` |
| `server/test-b199.js:26` | `const { DATA_DIR, KNOWLEDGE_DIR } = await import('./src/config.js');` |
| `server/test-b199.js:42` | `const { searchKnowledge } = await import('./src/services/MemoryManager.js');` |
| `server/test-b199.js:43` | `const { looksLikeSourceRefusal } = await import('./src/services/Orchestrator.js');` |
| `server/test-b199.js:74` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-b199.js:78` | `const mm = fs.readFileSync('./src/services/MemoryManager.js', 'utf-8');` |
| `server/test-b199.js:82` | `const { isNonAnswerText, saveInternetKnowledge, purgeNonAnswerKnowledge } = await import('./src/services/MemoryManager.…` |
| `server/test-b199.js:97` | `const MemoryMod = await import('./src/services/MemoryManager.js');` |
| `server/test-b199.js:100` | `const pg = fs.readFileSync('./src/services/PipelineGraphs.js', 'utf-8');` |
| `server/test-b199.js:103` | `const orchSrc = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-b199.js:107` | `fs.readFileSync('./src/providers/runtime/LLMClient.js', 'utf-8').includes('[groqModelCache \|\| GROQ_TEXT_MODEL]'));` |
| `server/test-b199.js:109` | `fs.readFileSync('./src/providers/runtime/LLMClient.js', 'utf-8').includes("DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'"));` |
| `server/test-b199.js:112` | `const { budgetSources } = await import('./src/services/SearchAgent.js');` |
| `server/test-b199.js:127` | `const { detectPluginIntent } = await import('./src/services/Planner.js');` |
| `server/test-b199.js:142` | `const { extractFileBlocks, persistFileBlocks } = await import('./src/services/FileBlockWriter.js');` |
| `server/test-b199.js:176` | `const { planner } = await import('./src/services/Planner.js');` |
| `server/test-b199.js:190` | `const { runCodingLoop } = await import('./src/services/CodingLoop.js');` |
| `server/test-b199.js:212` | `const dsh = fs.readFileSync('./src/services/DshCoding.js', 'utf-8');` |
| `server/test-b200.js:40` | `const { runResearchVerifyGraph } = await import('./src/services/PipelineGraphs.js');` |
| `server/test-b200.js:70` | `const sa = fs.readFileSync('./src/services/SearchAgent.js', 'utf-8');` |
| `server/test-b200.js:83` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-b200.js:90` | `const reasoner = fs.readFileSync('./src/services/Reasoner.js', 'utf-8');` |
| `server/test-b200.js:94` | `const engine = fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.js'), 'utf-8');` |
| `server/test-b200.js:96` | `const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');` |
| `server/test-b200.js:106` | `path.join(ROOT, 'src/components/NarrationFeed.jsx'),` |
| `server/test-b201.js:13` | `const { parseRequestedCount, continueDeliverable } = await import('./src/services/DeliverableContinuation.js');` |
| `server/test-b201.js:14` | `const { extractFileBlocks } = await import('./src/services/FileBlockWriter.js');` |
| `server/test-b204.js:90` | `const src = fs.readFileSync('./src/services/SearchAgent.js', 'utf-8');` |
| `server/test-b208.js:484` | `const { isPureGithubTurn } = await import('./src/services/director/Director.js');` |
| `server/test-b210.js:251` | `const { verifyDeliverable } = await import('./src/services/director/Verifier.js');` |
| `server/test-b210.js:285` | `const { realLlmAdapter } = await import('./src/services/director/RealAdapters.js');` |
| `server/test-b210.js:287` | `const sys = fsx.readFileSync('src/services/director/RealAdapters.js', 'utf-8');` |
| `server/test-b210.js:290` | `const es = fsx.readFileSync('src/services/director/EmployeeSession.js', 'utf-8');` |
| `server/test-b211.js:26` | `const { MissionRunner, extractDiscovered } = await import('./src/services/director/MissionRunner.js');` |
| `server/test-b211.js:27` | `const { Mission, loadMission, listMissions, activeMissionFor, loadMissionEvents } = await import('./src/services/direct…` |
| `server/test-b211.js:28` | `const { WorkGraph, loadWorkGraph, sha256 } = await import('./src/services/director/WorkGraph.js');` |
| `server/test-b211b2.js:27` | `const { MissionRunner } = await import('./src/services/director/MissionRunner.js');` |
| `server/test-b211b2.js:28` | `const { loadMission, loadMissionEvents } = await import('./src/services/director/Mission.js');` |
| `server/test-b211b2.js:29` | `const { analyzeObjective, depthFor, heuristicAnalysis } = await import('./src/services/director/ComplexityAnalyzer.js');` |
| `server/test-b211b2.js:30` | `const { imagine, comparePredictedVsActual, IMAGINATION_BUDGETS } = await import('./src/services/director/ImaginationEng…` |
| `server/test-b211b2.js:31` | `const { recordLesson, retrieveLessons, formatLessonsBlock, lessonCount } = await import('./src/services/director/Lesson…` |
| `server/test-b211b2.js:238` | `const childCount = Number(execFileSync('node', ['-e', "process.env.DATA_DIR='./data/test-b211b2'; import('./src/service…` |
| `server/test-b211b3.js:26` | `const { MissionRunner } = await import('./src/services/director/MissionRunner.js');` |
| `server/test-b211b3.js:27` | `const { loadMission, loadMissionEvents } = await import('./src/services/director/Mission.js');` |
| `server/test-b211b3.js:28` | `const { parseBrowserLine, runBrowserRound, computerCapabilities } = await import('./src/services/director/ComputerOps.j…` |
| `server/test-b211b3.js:29` | `const { getEmployee, selectEmployee, normalizeCap } = await import('./src/services/director/Employees.js');` |
| `server/test-b211b3.js:30` | `const { checkToolPermission, toolPermissionsFor } = await import('./src/services/director/Permissions.js');` |
| `server/test-b211b3.js:31` | `const { runEmployeeSession, assembleBrief, employeeSystemPrompt, extractBrowserRequests, extractCommandRequests } = awa…` |
| `server/test-b211b3.js:32` | `const { DirectorTask } = await import('./src/services/director/TaskState.js');` |
| `server/test-b211b3.js:33` | `const { TaskMailbox } = await import('./src/services/director/AgentMail.js');` |
| `server/test-b211b3.js:258` | `const graph = (await import('./src/services/director/WorkGraph.js')).loadWorkGraph(mission.id);` |
| `server/test-b212.js:20` | `const { MissionRunner } = await import('./src/services/director/MissionRunner.js');` |
| `server/test-b212.js:21` | `const { loadMission, loadMissionEvents } = await import('./src/services/director/Mission.js');` |
| `server/test-b212.js:22` | `const { runEmployeeSession, assembleBrief } = await import('./src/services/director/EmployeeSession.js');` |
| `server/test-b212.js:23` | `const { DirectorTask } = await import('./src/services/director/TaskState.js');` |
| `server/test-b212.js:24` | `const { TaskMailbox } = await import('./src/services/director/AgentMail.js');` |
| `server/test-b212.js:25` | `const { getEmployee } = await import('./src/services/director/Employees.js');` |
| `server/test-b212.js:26` | `const { COMMAND_WORKSPACE_ROOT } = await import('./src/services/director/CommandRunner.js');` |
| `server/test-b212.js:125` | `const { runBrowserRound } = await import('./src/services/director/ComputerOps.js');` |
| `server/test-b213.js:22` | `const { verifyDeliverable, claimsBrowserMethod, executionEvidence } = await import('./src/services/director/Verifier.js…` |
| `server/test-b213.js:23` | `const { DirectorTask } = await import('./src/services/director/TaskState.js');` |
| `server/test-b213.js:24` | `const { TaskMailbox } = await import('./src/services/director/AgentMail.js');` |
| `server/test-b213.js:25` | `const { getEmployee } = await import('./src/services/director/Employees.js');` |
| `server/test-b213.js:26` | `const { assembleBrief } = await import('./src/services/director/EmployeeSession.js');` |
| `server/test-b214.js:22` | `const { waitForLive, publishProject, clearProject } = await import('./src/services/WorkspacePublisher.js');` |
| `server/test-b217.js:20` | `} = await import('./src/services/RedisMirror.js');` |
| `server/test-b218.js:115` | `await import('./src/services/MemoryManager.js');` |
| `server/test-b218b.js:23` | `const { hydrateFromRedis, redisConnectionInfo } = await import('./src/services/MemoryManager.js');` |
| `server/test-b218b.js:27` | `} = await import('./src/services/RedisMirror.js');` |
| `server/test-b220.js:13` | `const { __parseRetryAfterMs } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-b220.js:17` | `} = await import('./src/providers/runtime/ProviderRouter.js');` |
| `server/test-b223.js:27` | `} = await import('./src/services/ToolDiscovery.js');` |
| `server/test-b223.js:28` | `const { TOOL_REGISTRY, toolsForTeam } = await import('./src/services/ToolRegistry.js');` |
| `server/test-b223.js:29` | `const { toolPermissionsFor } = await import('./src/services/director/Permissions.js');` |
| `server/test-b223.js:150` | `const src = fs.readFileSync(path.join(SERVER_DIR, 'src/services/director/Director.js'), 'utf-8');` |
| `server/test-b223.js:167` | `const src = fs.readFileSync(path.join(SERVER_DIR, 'src/services/ToolDiscovery.js'), 'utf-8');` |
| `server/test-b224.js:26` | `const { Mission } = await import('./src/services/director/Mission.js');` |
| `server/test-b224.js:27` | `const { missionEventStream } = await import('./src/routes/missionStream.js');` |
| `server/test-b224.js:174` | `const src = fs.readFileSync(path.join(SERVER_DIR, 'src/routes/missionStream.js'), 'utf-8');` |
| `server/test-b224.js:189` | `const src = fs.readFileSync(path.join(SERVER_DIR, '../src/components/MissionsScreen.jsx'), 'utf-8');` |
| `server/test-b224.js:198` | `const src = fs.readFileSync(path.join(SERVER_DIR, '../src/components/MissionsScreen.jsx'), 'utf-8');` |
| `server/test-b224.js:205` | `const src = fs.readFileSync(path.join(SERVER_DIR, '../src/components/MissionsScreen.jsx'), 'utf-8');` |
| `server/test-b225.js:349` | `const { runBrowserRound } = await import('./src/services/director/ComputerOps.js');` |
| `server/test-b225.js:374` | `const { runBrowserRound } = await import('./src/services/director/ComputerOps.js');` |
| `server/test-b225.js:416` | `const src = fs.readFileSync('./src/services/director/Director.js', 'utf8');` |
| `server/test-b225.js:425` | `const src = fs.readFileSync('../src/components/Composer.jsx', 'utf8');` |
| `server/test-b227.js:34` | `const { detectPictureIntent } = await import('./src/services/ImageSearch.js');` |
| `server/test-b227.js:43` | `const { detectPictureIntent } = await import('./src/services/ImageSearch.js');` |
| `server/test-b227.js:100` | `const { Planner } = await import('./src/services/Planner.js');` |
| `server/test-b227.js:101` | `const { orchestrator } = await import('./src/services/Orchestrator.js');` |
| `server/test-b52.js:139` | `const { toolsForIntent } = await import('./src/services/ToolRegistry.js');` |
| `server/test-b52.js:140` | `const { enforceToolAllowlist } = await import('./src/services/ToolRegistry.js');` |
| `server/test-b52.js:141` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-b52.js:166` | `const { finalizeAnswer } = await import('./src/services/Finalizer.js');` |
| `server/test-b52.js:252` | `const { planningSkillSummaries } = await import('./src/services/SkillChain.js');` |
| `server/test-b55.js:27` | `} = await import('./src/services/ToolRuntime.js');` |
| `server/test-b55.js:30` | `} = await import('./src/services/MemoryManager.js');` |
| `server/test-b78.js:56` | `const { appendEvent, getEvents, eventLogStats, hydrateEventLogFromRedis } = await import('./src/services/EventLog.js');` |
| `server/test-b78.js:148` | `const { runWorker } = await import('./src/providers/catalog/WorkerRouter.js');` |
| `server/test-b78.js:165` | `const { runSimpleTask } = await import('./src/services/SimpleTask.js');` |
| `server/test-b78.js:174` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-books.js:7` | `const { importBookBuffer, importBookUrl, listBooks, deleteBook } = await import('./src/services/BookLibrary.js');` |
| `server/test-books.js:8` | `const { searchKnowledge } = await import('./src/services/MemoryManager.js');` |
| `server/test-build47.js:13` | `const { createTask, getTask, listTasks, updateTask, resolveTaskRef, taskContextBlock, clearTasks, taskStats } = await i…` |
| `server/test-build47.js:14` | `const { analyzeMessage, decomposeTasks } = await import('./src/services/ConversationManager.js');` |
| `server/test-build47.js:15` | `const { decide, applyDecision } = await import('./src/services/DecisionEngine.js');` |
| `server/test-build47.js:16` | `const { recordDecision, retrieveDecisions, findConflict, clearDecisionMemory, memoryStats } = await import('./src/servi…` |
| `server/test-chat-books.js:6` | `const { planner } = await import('./src/services/Planner.js');` |
| `server/test-chat-books.js:7` | `const { orchestrator } = await import('./src/services/Orchestrator.js');` |
| `server/test-chat-books.js:8` | `const { importBookBuffer } = await import('./src/services/BookLibrary.js');` |
| `server/test-chat-books.js:9` | `const { searchKnowledge } = await import('./src/services/MemoryManager.js');` |
| `server/test-chat-jobs.js:105` | `const g = (await import('./src/services/GoalJobQueue.js')).enqueueGoal;` |
| `server/test-code-intel.js:26` | `const { diagnoseJsFile } = await import('./src/services/CodeJudge.js');` |
| `server/test-code-intel.js:27` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-code-intel.js:28` | `const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-code-mode.js:23` | `const { renderToolsSdk, runCodeProgram, buildRunCodeSchema, RUN_CODE_NAME } = await import('./src/services/CodeModeRunt…` |
| `server/test-code-mode.js:24` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-compaction.js:23` | `const { saveText, readSpill, listSpills, spillStats, SPILL_THRESHOLD } = await import('./src/services/SpillStore.js');` |
| `server/test-compaction.js:27` | `} = await import('./src/services/CompactionEngine.js');` |
| `server/test-compaction.js:28` | `const { appendConversationEvent, loadConversationEvents } = await import('./src/services/SessionConversations.js');` |
| `server/test-compaction.js:29` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-compaction.js:59` | `const { createPluginContext, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-context-engine.js:27` | `const CE = await import('./src/services/ContextEngine.js');` |
| `server/test-context-engine.js:28` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-context-engine.js:109` | `const { activateTaskWorkspace, writeWorkspace } = await import('./src/services/WorkspaceRuntime.js');` |
| `server/test-context-engine.js:110` | `const { WORKSPACE_DIR } = await import('./src/config.js');` |
| `server/test-context-engine.js:111` | `const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');` |
| `server/test-context-resolution.js:29` | `} = await import('./src/services/MemoryManager.js');` |
| `server/test-dsh-batch.js:24` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch.js:25` | `const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch.js:28` | `const { TOOL_COUNT, TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch.js:54` | `const { writeFileAtomic } = await import('./src/services/AtomicWrite.js');` |
| `server/test-dsh-batch.js:63` | `const { maybeCheckpoint, latestCheckpoint, listSessionCheckpoints } = await import('./src/services/SessionCheckpoints.j…` |
| `server/test-dsh-batch.js:64` | `const { appendConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-dsh-batch.js:77` | `const { recordTelemetry, readTelemetry, telemetryStats } = await import('./src/services/Telemetry.js');` |
| `server/test-dsh-batch.js:89` | `const { estimateTokens, underTokenBudget } = await import('./src/services/TokenMeter.js');` |
| `server/test-dsh-batch.js:97` | `const { addCommandFeedback, listFeedback } = await import('./src/services/FeedbackStore.js');` |
| `server/test-dsh-batch10.js:98` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch10.js:101` | `const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch10.js:131` | `const { StorageDomain, KvTable, DomainError } = await import('./src/services/StorageDomain.js');` |
| `server/test-dsh-batch10.js:132` | `const { createStorageHub } = await import('./src/services/StorageHub.js');` |
| `server/test-dsh-batch10.js:163` | `const { validateApiArgs, assertJsonArgs, createApiProxy, apiProxyStatus } = await import('./src/services/ApiProxy.js');` |
| `server/test-dsh-batch10.js:230` | `const { generateWorkspaceTypes, listTypertManifests, unloadTypertArtifacts } = await import('./src/services/TypingGener…` |
| `server/test-dsh-batch10.js:246` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch10.js:248` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch11.js:26` | `const { sandboxPolicyFor, e2bStatus } = await import('./src/services/SandboxLocal.js');` |
| `server/test-dsh-batch11.js:43` | `const { cordisInspectList, cordisInspectQuery, cordisInspectStatus, cordisInspectProviders } = await import('./src/serv…` |
| `server/test-dsh-batch11.js:63` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch11.js:66` | `const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch11.js:80` | `const { runAgentLoop } = await import('./src/services/AgentLoop.js');` |
| `server/test-dsh-batch11.js:121` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch11.js:123` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch11.js:125` | `const { bundleStatus } = await import('./src/services/BundleBase.js');` |
| `server/test-dsh-batch12.js:29` | `const { CordisRunner } = await import('./src/services/CordisRunner.js');` |
| `server/test-dsh-batch12.js:30` | `const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch12.js:49` | `const { getPluginTool } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch12.js:77` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch12.js:82` | `const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch12.js:89` | `const { cordisRunner } = await import('./src/services/CordisRunner.js');` |
| `server/test-dsh-batch12.js:189` | `const { bundleStatus } = await import('./src/services/BundleBase.js');` |
| `server/test-dsh-batch12.js:194` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch12.js:196` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch12.js:198` | `const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch13.js:31` | `const { bundleStatus } = await import('./src/services/BundleBase.js');` |
| `server/test-dsh-batch13.js:54` | `const { querySessionLog, exportSessionLog, querySessionSqlite, searchSessions } = await import('./src/services/SessionQ…` |
| `server/test-dsh-batch13.js:55` | `const { appendConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-dsh-batch13.js:84` | `const { BRAND, brandIdentity, brandName, brandTagline } = await import('./src/services/Brand.js');` |
| `server/test-dsh-batch13.js:88` | `const { retainHeadTail, retainTail, retentionStatus, RETENTION_BUDGETS } = await import('./src/services/OutputRetention…` |
| `server/test-dsh-batch13.js:98` | `const { runNativeCommand } = await import('./src/services/NativeCommand.js');` |
| `server/test-dsh-batch13.js:112` | `const { webSearchProviderStatus } = await import('./src/services/WebSearchProviders.js');` |
| `server/test-dsh-batch13.js:121` | `const { pruneToolResult } = await import('./src/services/ToolResultPruner.js');` |
| `server/test-dsh-batch13.js:131` | `const { loadPlugins, setActivePluginContext, getPluginTool } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch13.js:188` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch13.js:190` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch13.js:192` | `const { listPluginTools } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch14.js:44` | `const pwsh = await import('./src/services/PwshPersistent.js');` |
| `server/test-dsh-batch14.js:59` | `const fr = await import('./src/services/FileReference.js');` |
| `server/test-dsh-batch14.js:60` | `const { WORKSPACE_DIR } = await import('./src/config.js');` |
| `server/test-dsh-batch14.js:83` | `const auth = await import('./src/services/Authorization.js');` |
| `server/test-dsh-batch14.js:84` | `const store = await import('./src/services/CredentialStore.js');` |
| `server/test-dsh-batch14.js:106` | `const T = await import('./src/services/AgentTeams.js');` |
| `server/test-dsh-batch14.js:156` | `const mod = await import('./plugins/agent-team/plugin.js');` |
| `server/test-dsh-batch14.js:163` | `const py = await import('./src/services/CodeRuntimePython.js');` |
| `server/test-dsh-batch14.js:181` | `const ref = fs.readFileSync(path.join(ROOT, 'src/utils/referenceSource.js'), 'utf-8');` |
| `server/test-dsh-batch14.js:183` | `const rend = fs.readFileSync(path.join(ROOT, 'src/utils/uiRenderer.jsx'), 'utf-8');` |
| `server/test-dsh-batch14.js:185` | `const brand = fs.readFileSync(path.join(ROOT, 'src/brand/official.jsx'), 'utf-8');` |
| `server/test-dsh-batch14.js:187` | `const main = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf-8');` |
| `server/test-dsh-batch14.js:189` | `const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf-8');` |
| `server/test-dsh-batch14.js:200` | `const { WORKSPACE_DIR } = await import('./src/config.js');` |
| `server/test-dsh-batch14.js:203` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch2.js:24` | `const { registerCommand, listCommands, tryExecuteCommand, helpText } = await import('./src/services/CommandRegistry.js'…` |
| `server/test-dsh-batch2.js:25` | `const { withRetry, retryDelayMs, isRetryableError } = await import('./src/services/RetryPolicy.js');` |
| `server/test-dsh-batch2.js:26` | `const { anonymousUserId, resetAnonymousUserId } = await import('./src/services/AnonymousId.js');` |
| `server/test-dsh-batch2.js:27` | `const { validateAttachment, validateAttachmentName, MAX_ATTACHMENT_BYTES } = await import('./src/services/AttachmentPol…` |
| `server/test-dsh-batch2.js:28` | `const { checkConversationInvariants, invariantStatus } = await import('./src/services/SessionInvariants.js');` |
| `server/test-dsh-batch2.js:29` | `const { appendConversationEvent, loadConversationEvents } = await import('./src/services/SessionConversations.js');` |
| `server/test-dsh-batch3.js:23` | `const { handleAcpRequest, acpSessionCount } = await import('./src/services/AcpServer.js');` |
| `server/test-dsh-batch3.js:24` | `const { terminalOpen, terminalSend, terminalRead, terminalSignal, terminalClose, terminalList } = await import('./src/s…` |
| `server/test-dsh-batch3.js:25` | `const { setCredential, resolveCredential, deleteCredential, listCredentialKeys, validateCredential } = await import('./…` |
| `server/test-dsh-batch3.js:26` | `const { effectiveSandboxMode, setSandboxMode, sandboxDenial, SANDBOX_MODES, DEFAULT_SANDBOX_MODE } = await import('./sr…` |
| `server/test-dsh-batch3.js:27` | `const { createGoal, getCurrentGoal, updateGoal } = await import('./src/services/GoalTools.js');` |
| `server/test-dsh-batch3.js:28` | `const { appendConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-dsh-batch4.js:42` | `const { resolveJexiHome, expandHomePath, jexiHomePath, jexiHomeDisplay, JEXI_HOME_ENV } = await import('./src/services/…` |
| `server/test-dsh-batch4.js:58` | `const { createLaunchEnvironmentSnapshot, parseDotEnv, buildLaunchEnvironment, setLaunchEnvironment, launchEnvironmentOf…` |
| `server/test-dsh-batch4.js:80` | `const { SettingsFileStore, parseYamlSubset, stringifyYamlSubset, resolveSettingsSpec } = await import('./src/services/S…` |
| `server/test-dsh-batch4.js:105` | `const { createStorageHub, StorageError, UNIT_NAME_RE } = await import('./src/services/StorageHub.js');` |
| `server/test-dsh-batch4.js:138` | `const { openSessionPersistence, sessionRevision, sessionPersistenceStatus, persistSessionEvent, closeSessionPersistence…` |
| `server/test-dsh-batch4.js:139` | `const { appendConversationEvent, onConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-dsh-batch4.js:159` | `const { runPersistentBash, resetShell, listPersistentShells, closeAllShells } = await import('./src/services/BashPersis…` |
| `server/test-dsh-batch4.js:184` | `const { parseCodexConfig, parseClaudeCodeConfig, substituteCommand, HookBridge, CODEX_EVENTS, CLAUDE_EVENTS } = await i…` |
| `server/test-dsh-batch4.js:223` | `const { validateRalphReport, decodeRalphReport, runRalph, RALPH_STATUSES } = await import('./src/services/RalphRunner.j…` |
| `server/test-dsh-batch4.js:269` | `const { connectMcpServer, disconnectMcpServer, mcpServerStatus, validateServerSpec } = await import('./src/services/Mcp…` |
| `server/test-dsh-batch4.js:270` | `const { createPluginContext, setActivePluginContext, getPluginTool, listPluginTools } = await import('./src/services/Pl…` |
| `server/test-dsh-batch4.js:305` | `const { probeConfinement, sandboxTempDir, revokeSandboxTempDir, sandboxFacts, confine, bwrapProfileArgs } = await impor…` |
| `server/test-dsh-batch4.js:328` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch4.js:331` | `const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch4.js:340` | `const { loadPlugins, setActivePluginContext: setCtx, listPluginTools } = await import('./src/services/PluginContext.js'…` |
| `server/test-dsh-batch5.js:34` | `const { projectSession, projectedConversationBlock, projectionCacheStats } = await import('./src/services/SessionProjec…` |
| `server/test-dsh-batch5.js:35` | `const { appendConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-dsh-batch5.js:62` | `const { discoverAgentInstructionFiles, loadBaselineInstructionSet, renderInstructionsBlock, newInstructionVersions, mar…` |
| `server/test-dsh-batch5.js:93` | `const { checkFsOperation, isPathUnder, effectiveFsRoots } = await import('./src/services/FsSandbox.js');` |
| `server/test-dsh-batch5.js:130` | `const { shellEnv, looksLikeSecret, scrubbedNames } = await import('./src/services/ShellEnv.js');` |
| `server/test-dsh-batch5.js:150` | `const { spawnManaged, killManaged, listManagedProcesses, closeAllManagedProcesses } = await import('./src/services/Subp…` |
| `server/test-dsh-batch5.js:169` | `const { initWorkspaceEntity, readWorkspaceEntity, updateWorkspaceEntity, attachSession, pathInWorkspace, workspaceEntit…` |
| `server/test-dsh-batch5.js:189` | `const { writeBootProfile, readBootProfile, configDump, envSummary, featureFlags } = await import('./src/services/BootPr…` |
| `server/test-dsh-batch5.js:234` | `const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch5.js:235` | `const { pluginInventory } = await import('./src/services/PluginInventory.js');` |
| `server/test-dsh-batch5.js:250` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch5.js:253` | `const { listPluginTools: listPluginTools2 } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch5.js:256` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch5.js:258` | `const { listPluginTools } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch6.js:28` | `const { APPROVAL_POLICIES, DEFAULT_APPROVAL_POLICY, effectiveApprovalPolicy, setApprovalPolicy, needsApproval } = await…` |
| `server/test-dsh-batch6.js:45` | `const { PERMISSION_PRESETS, PERMISSION_PRESET_NAMES, effectivePermissionPreset, setPermissionPreset, permissionsStatus,…` |
| `server/test-dsh-batch6.js:51` | `const { effectiveSandboxMode } = await import('./src/services/SandboxMode.js');` |
| `server/test-dsh-batch6.js:53` | `const { effectiveApprovalPolicy } = await import('./src/services/UserApproval.js');` |
| `server/test-dsh-batch6.js:68` | `const { openReportChannel, deliverReport, reportsFor, closeReportChannel, closeAllReportChannels, reportChannelStatus, …` |
| `server/test-dsh-batch6.js:84` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch6.js:87` | `const { hasOutputContract, validateToolArgs, executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch6.js:102` | `const { BUILTIN_PERSONAS, loadPersonas, resolvePersona, personaFlavor, personaStatus, saveUserPersonas } = await import…` |
| `server/test-dsh-batch6.js:124` | `const { scheduleRuntimeStatus } = await import('./src/services/ScheduleRuntime.js');` |
| `server/test-dsh-batch6.js:141` | `const { hostStatus, gatewayStatus, resetHostClock } = await import('./src/services/HostStatus.js');` |
| `server/test-dsh-batch6.js:187` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch6.js:189` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch6.js:192` | `const { loadPlugins, setActivePluginContext, listPluginTools } = await import('./src/services/PluginContext.js');` |
| `server/test-dsh-batch7.js:31` | `const { SUBAGENT_PROVIDERS, subagentProviderStatus, isExternalProvider, resolveSubagentProvider, runExternalSubagent, b…` |
| `server/test-dsh-batch7.js:72` | `const { jsonSnapshot, byteBudget, validateWorkerMessage, normalizeWorkerResult, workerBootstrapSelfCheck, WORKER_MESSAG…` |
| `server/test-dsh-batch7.js:101` | `const { foldConfigSnapshot, initConfigSnapshot, reloadConfig, configStatus, onConfigChange } = await import('./src/serv…` |
| `server/test-dsh-batch7.js:122` | `const { registerRemoteAgent, lookupRemoteAgent, listRemoteAgents, unregisterRemoteAgent, remoteAgentsStatus, agentLooku…` |
| `server/test-dsh-batch7.js:149` | `const { inTmux, tmuxContextBlock, tmuxStatus } = await import('./src/services/TmuxContext.js');` |
| `server/test-dsh-batch7.js:163` | `const { validateTypingMessage, applyTypingOp, applyTypingScript, TYPING_MESSAGE_TYPES, clampPos } = await import('./src…` |
| `server/test-dsh-batch7.js:197` | `const { executeTool, validateToolArgs } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch7.js:210` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch7.js:212` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch8.js:27` | `const { analyzeManifest, renderTypes, generateTypes, emitTypes, registerTypertManifest, listTypertManifests, typertRegi…` |
| `server/test-dsh-batch8.js:73` | `const { isLoopbackHost, isTrustedAuthority, checkTrustedHost, resolveBodyCap } = await import('./src/services/ClientCon…` |
| `server/test-dsh-batch8.js:89` | `const { publishHmrEvent, setHmrBroadcaster, recentHmrEvents, hmrStatus } = await import('./src/services/ClientHmr.js');` |
| `server/test-dsh-batch8.js:103` | `const { t, localeStatus, BASE_STRINGS } = await import('./src/services/Locale.js');` |
| `server/test-dsh-batch8.js:125` | `const { parseCommand, COMMAND_NAME_RE, withCommandAbort, tryExecuteCommandDialect, validateCommandDefinition, registerC…` |
| `server/test-dsh-batch8.js:151` | `const { discoverPresets, createPreset, deletePreset, readComposition, writeComposition, presetsStatus, userPresetDir } …` |
| `server/test-dsh-batch8.js:180` | `const { browseDirectories, validFolderName, directoryPickerStatus } = await import('./src/services/DirectoryPicker.js');` |
| `server/test-dsh-batch8.js:206` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch8.js:208` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch9.js:28` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-batch9.js:31` | `const { executeTool, hasOutputContract, validateToolArgs } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-batch9.js:39` | `const { taskScheduler } = await import('./src/services/TaskScheduler.js');` |
| `server/test-dsh-batch9.js:67` | `const { bundleStatus, readBundleManifest, MANIFEST_FILE, PARITY_FILE } = await import('./src/services/BundleBase.js');` |
| `server/test-dsh-batch9.js:186` | `const { scrubbedParentEnv } = await import('./src/services/ShellEnv.js');` |
| `server/test-dsh-batch9.js:193` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-dsh-batch9.js:196` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-dsh-coding.js:117` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-dsh-coding.js:120` | `const dsh = fs.readFileSync('./src/services/DshCoding.js', 'utf-8');` |
| `server/test-dsh-fidelity.js:27` | `const { cleanTitleText, truncateTitleUtf8, normalizeSessionTitle, fallbackSessionTitle } = await import('./src/services…` |
| `server/test-dsh-fidelity.js:28` | `const { setStoredTitle, getStoredTitle, getStoredTitleRecord, maybeAutoTitle, setTitleGenerator, cleanTitle, fallbackTi…` |
| `server/test-dsh-fidelity.js:29` | `const { sessionStats } = await import('./src/services/SessionStats.js');` |
| `server/test-dsh-fidelity.js:33` | `} = await import('./src/services/SessionReference.js');` |
| `server/test-dsh-fidelity.js:34` | `const { appendConversationEvent, conversationSummary, loadConversationEvents } = await import('./src/services/SessionCo…` |
| `server/test-dsh-fidelity.js:35` | `const { appendEvent, getEvents } = await import('./src/services/EventLog.js');` |
| `server/test-dsh-research.js:31` | `const { loadPlugins, setActivePluginContext, listPluginTools, listPluginSkills } = await import('./src/services/PluginC…` |
| `server/test-dsh-research.js:32` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-dsh-research.js:33` | `const { discoverSkills, loadSkillForModel } = await import('./src/services/SkillDiscovery.js');` |
| `server/test-dsh-research.js:34` | `const { runDshResearch } = await import('./src/services/DshResearch.js');` |
| `server/test-dsh-research.js:35` | `const { planner, isDirectIntent } = await import('./src/services/Planner.js');` |
| `server/test-dsh-research.js:97` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-everything.js:98` | `const { rememberUserFact, semanticRecall, saveMemory, loadMemory, saveKnowledgeFile, searchKnowledge, saveKnowledge, lo…` |
| `server/test-everything.js:99` | `const { preferencesBlock } = await import('./src/services/PreferenceLearner.js');` |
| `server/test-everything.js:100` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-everything.js:102` | `const { setActiveSession } = await import('./src/services/MemoryManager.js');` |
| `server/test-everything.js:152` | `const { planner } = await import('./src/services/Planner.js');` |
| `server/test-everything.js:153` | `const { detectDomain, deterministicChecks, DOMAINS } = await import('./src/services/DomainVerifier.js');` |
| `server/test-everything.js:154` | `const { decide } = await import('./src/services/DecisionEngine.js');` |
| `server/test-everything.js:155` | `const { todoAdd, todoList, todoComplete } = await import('./src/services/TodoStore.js');` |
| `server/test-everything.js:156` | `const { planSet, planGet, planUpdate } = await import('./src/services/PlanStore.js');` |
| `server/test-everything.js:157` | `const { createGoal, updateGoal, getCurrentGoal } = await import('./src/services/GoalTools.js');` |
| `server/test-everything.js:158` | `const { startWorkflow, workflowRecord } = await import('./src/services/WorkflowEngine.js');` |
| `server/test-everything.js:159` | `const { decomposeQuery, runSubagents } = await import('./src/services/SubagentRuntime.js');` |
| `server/test-everything.js:160` | `const { runRalph, validateRalphReport } = await import('./src/services/RalphRunner.js');` |
| `server/test-everything.js:161` | `const { setPlanMode, presentPlan, approvePlan, currentPlan, isPlanMode } = await import('./src/services/PlanMode.js');` |
| `server/test-everything.js:162` | `const { askQuestions, answerPending, getPending } = await import('./src/services/PendingQuestions.js');` |
| `server/test-everything.js:163` | `const { registerCommand, tryExecuteCommandDialect } = await import('./src/services/CommandRegistry.js');` |
| `server/test-everything.js:164` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-everything.js:273` | `const { appendConversationEvent, loadConversationEvents, conversationSummary, searchConversations, forkConversation, ex…` |
| `server/test-everything.js:274` | `const { projectSession } = await import('./src/services/SessionProjection.js');` |
| `server/test-everything.js:275` | `const { compactionAwareHistory } = await import('./src/services/CompactionEngine.js');` |
| `server/test-everything.js:276` | `const { maybeCheckpoint, latestCheckpoint } = await import('./src/services/SessionCheckpoints.js');` |
| `server/test-everything.js:277` | `const { saveText, readSpill, listSpills } = await import('./src/services/SpillStore.js');` |
| `server/test-everything.js:278` | `const { persistSessionEvent, sessionRevision, sessionPersistenceStatus, openSessionPersistence } = await import('./src/…` |
| `server/test-everything.js:280` | `const { onConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-everything.js:281` | `const { setStoredTitle, getStoredTitle } = await import('./src/services/SessionTitles.js');` |
| `server/test-everything.js:282` | `const { buildTrace } = await import('./src/services/SessionTrace.js');` |
| `server/test-everything.js:283` | `const { checkConversationInvariants } = await import('./src/services/SessionInvariants.js');` |
| `server/test-everything.js:284` | `const { encodeSessionReferenceUri, formatSessionReferenceMention, decodeSessionReferenceUri } = await import('./src/ser…` |
| `server/test-everything.js:377` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-everything.js:378` | `const { hasOutputContract, validateToolArgs, executeTool, TOOL_SCHEMAS } = await import('./src/services/ToolRuntime.js'…` |
| `server/test-everything.js:379` | `const { loadPlugins, setActivePluginContext, listPluginTools } = await import('./src/services/PluginContext.js');` |
| `server/test-everything.js:469` | `const { runDshResearch } = await import('./src/services/DshResearch.js');` |
| `server/test-everything.js:495` | `const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');` |
| `server/test-everything.js:561` | `const { runAgentLoop } = await import('./src/services/AgentLoop.js');` |
| `server/test-everything.js:562` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-everything.js:563` | `const { runIsolatedSubagent } = await import('./src/services/SubagentRuntime.js');` |
| `server/test-everything.js:581` | `const { estimateTokens, underTokenBudget } = await import('./src/services/TokenMeter.js');` |
| `server/test-everything.js:582` | `const { writeFileAtomic, appendAndCap, withFileLock } = await import('./src/services/AtomicWrite.js');` |
| `server/test-everything.js:583` | `const { validateAttachment, MAX_ATTACHMENT_BYTES } = await import('./src/services/AttachmentPolicy.js');` |
| `server/test-everything.js:584` | `const { estimateTokens: _t } = await import('./src/services/TokenMeter.js');` |
| `server/test-everything.js:585` | `const { setCredential, resolveCredential, listCredentialKeys, deleteCredential, hasManagedCredential } = await import('…` |
| `server/test-everything.js:586` | `const { createStorageHub } = await import('./src/services/StorageHub.js');` |
| `server/test-everything.js:587` | `const { SettingsFileStore } = await import('./src/services/SettingsFile.js');` |
| `server/test-everything.js:588` | `const { resolveJexiHome } = await import('./src/services/HomePaths.js');` |
| `server/test-everything.js:589` | `const { launchEnvironmentOf } = await import('./src/services/LaunchEnvironment.js');` |
| `server/test-everything.js:590` | `const { initConfigSnapshot, reloadConfig } = await import('./src/services/ConfigReload.js');` |
| `server/test-everything.js:591` | `const { runHooks } = await import('./src/services/HookEngine.js');` |
| `server/test-everything.js:592` | `const { persistSessionEvent: _p, sessionPersistenceStatus } = await import('./src/services/SessionPersistenceSqlite.js'…` |
| `server/test-f5-hardening.js:93` | `const { __streamOpenAICompletion } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-f5-hardening.js:126` | `const { generateContent } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-f5-hardening.js:149` | `const { generateContent } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-f5-hardening.js:174` | `const { __streamOpenAICompletion, generateContent } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-f5-hardening.js:214` | `const { asStringArray } = await import('./src/services/director/MissionRunner.js');` |
| `server/test-f5-hardening.js:224` | `const { generateContent } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-f5-hardening.js:225` | `const { providerHealthSnapshot } = await import('./src/services/ProviderHealth.js');` |
| `server/test-f5-hardening.js:258` | `const { runEmployeeSession, assembleBrief } = await import('./src/services/director/EmployeeSession.js');` |
| `server/test-f5-hardening.js:259` | `const { getEmployee } = await import('./src/services/director/Employees.js');` |
| `server/test-f5-hardening.js:260` | `const { TaskMailbox } = await import('./src/services/director/AgentMail.js');` |
| `server/test-fcm.js:82` | `const h = await (await import('./src/services/FcmManager.js')).hydrateFcmTokensFromRedis();` |
| `server/test-gaps-b106.js:23` | `const { startJob, collectJob, listJobs, killJob, jobStats, setJobExecutor } = await import('./src/services/BackgroundJo…` |
| `server/test-gaps-b106.js:24` | `const { repeatReminderFor } = await import('./src/services/AgentLoop.js');` |
| `server/test-gaps-b106.js:25` | `const { addFeedback, listFeedback, feedbackStats } = await import('./src/services/FeedbackStore.js');` |
| `server/test-gaps-b106.js:26` | `const { recentSessionsBlock, exportConversation, appendConversationEvent, loadConversationEvents } = await import('./sr…` |
| `server/test-gaps-b106.js:27` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-gaps-b106.js:28` | `const { TOOL_COUNT, TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');` |
| `server/test-hermes-full.js:22` | `const GW = await import('./src/services/AgentGateway.js');` |
| `server/test-hermes-full.js:23` | `const SL = await import('./src/services/SkillLoop.js');` |
| `server/test-hermes-full.js:24` | `const AP = await import('./src/services/AgentProfiles.js');` |
| `server/test-hermes-full.js:42` | `const plugin = fs.readFileSync('./plugins/hermes-profiles/plugin.js', 'utf-8');` |
| `server/test-hermes-full.js:48` | `const src = fs.readFileSync('./src/services/AgentGateway.js', 'utf-8');` |
| `server/test-hermes-full.js:56` | `const orch = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-hermes-parity.js:22` | `const PROFILES = await import('./src/services/AgentProfiles.js');` |
| `server/test-hermes-parity.js:23` | `const GW = await import('./src/services/AgentGateway.js');` |
| `server/test-hermes-parity.js:24` | `const SL = await import('./src/services/SkillLoop.js');` |
| `server/test-hermes-wiring.js:20` | `const { loadPlugins, listPluginTools, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-hermes-wiring.js:43` | `const { listCommands } = await import('./src/services/CommandRegistry.js');` |
| `server/test-hermes-wiring.js:57` | `const { loadPlugins, listPluginTools, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-hooks.js:12` | `await import('./src/services/HookEngine.js');` |
| `server/test-hooks.js:54` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-identity.js:53` | `const { JEXI_NORMAL_PROMPT, JEXI_SYSTEM_PROMPT, IDENTITY_QUESTION_RE } = await import('./src/services/JexiPrompt.js');` |
| `server/test-incident-b177.js:30` | `const { orchestrator } = await import('./src/services/Orchestrator.js');` |
| `server/test-incident-b177.js:59` | `const src = fs.readFileSync('./src/services/Orchestrator.js', 'utf-8');` |
| `server/test-incident-b177.js:67` | `const llmSrc = fs.readFileSync('./src/providers/runtime/LLMClient.js', 'utf-8');` |
| `server/test-incident-b177.js:75` | `const { __pickGroqModel } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-judge-gates.js:28` | `const { deterministicCodeChecks, judgeVerdict } = await import('./src/services/CodeJudge.js');` |
| `server/test-judge-gates.js:66` | `const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');` |
| `server/test-learning.js:16` | `} = await import('../learning/instinct.js');` |
| `server/test-learning.js:19` | `} = await import('../learning/store.js');` |
| `server/test-learning.js:21` | `await import('../learning/observer.js');` |
| `server/test-learning.js:23` | `await import('../learning/analyzer.js');` |
| `server/test-learning.js:24` | `const { promoteQualified } = await import('../learning/promoter.js');` |
| `server/test-learning.js:25` | `const { recallForTask, instinctsSection } = await import('../learning/index.js');` |
| `server/test-learning.js:189` | `const { listSources } = await import('./src/context/sources/index.js');` |
| `server/test-learning.js:193` | `const { learningSeamStatus, runStopAnalysis } = await import('./src/kernel/hooks/learning-seam.js');` |
| `server/test-lifecycle.js:28` | `} = await import('./src/services/SessionLifecycle.js');` |
| `server/test-lifecycle.js:29` | `const { assemblePrompt, todoStateBlock, planStateBlock, goalStateBlock, setGoalEngine } = await import('./src/services/…` |
| `server/test-lifecycle.js:30` | `const { appendConversationEvent, loadConversationEvents, conversationSummary } = await import('./src/services/SessionCo…` |
| `server/test-lifecycle.js:31` | `const { todoAdd, todoClear } = await import('./src/services/TodoStore.js');` |
| `server/test-lifecycle.js:32` | `const { planSet } = await import('./src/services/PlanStore.js');` |
| `server/test-lifecycle.js:75` | `const { createUserSkill } = await import('./src/services/SkillDiscovery.js');` |
| `server/test-lifecycle.js:111` | `const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');` |
| `server/test-lifecycle.js:114` | `const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');` |
| `server/test-llm-models.js:20` | `const src = fs.readFileSync(new URL('./src/providers/runtime/LLMClient.js', import.meta.url), 'utf-8');` |
| `server/test-lsp.js:23` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-lsp.js:24` | `const { loadPlugins, setActivePluginContext, listPluginTools } = await import('./src/services/PluginContext.js');` |
| `server/test-lsp.js:93` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-marketplace.js:23` | `const { MARKETPLACE_SKILLS, listMarketplace, marketplaceStats, installSkill, uninstallSkill, validateMarketplace } = aw…` |
| `server/test-marketplace.js:24` | `const { discoverSkills, loadSkillForModel } = await import('./src/services/SkillDiscovery.js');` |
| `server/test-marketplace.js:25` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-marketplace.js:26` | `const { TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-math-stream.js:22` | `const { createMathStreamBuffer } = await import('./src/services/Formatting.js');` |
| `server/test-math-stream.js:65` | `const { normalizeMathDelimiters } = await import('./src/services/Formatting.js');` |
| `server/test-math-stream.js:80` | `const { preprocessMath } = await import(path.join(ROOT, 'src/utils/mathPreprocess.js'));` |
| `server/test-math-stream.js:104` | `const mr = fs.readFileSync(path.join(ROOT, 'src/components/MarkdownRenderer.jsx'), 'utf-8');` |
| `server/test-math-stream.js:106` | `const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf-8');` |
| `server/test-math-stream.js:117` | `const tw = fs.readFileSync(path.join(ROOT, 'src/hooks/useTypewriter.js'), 'utf-8');` |
| `server/test-math-stream.js:119` | `const mr = fs.readFileSync(path.join(ROOT, 'src/components/MarkdownRenderer.jsx'), 'utf-8');` |
| `server/test-memory-direct-path.js:24` | `await import('./src/services/MemoryManager.js');` |
| `server/test-memory-direct-path.js:25` | `const { recallPreferences, learnFromExchange } = await import('./src/services/PreferenceLearner.js');` |
| `server/test-memory-direct-path.js:33` | `const { compactionAwareHistory } = await import('./src/services/CompactionEngine.js');` |
| `server/test-memory-direct-path.js:88` | `const { assemblePrompt } = await import('./src/services/PromptAssembly.js');` |
| `server/test-memory-direct-path.js:89` | `const { appendConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-memory-persistence.js:38` | `const { memoryPersistenceProbe, isRedisActive, redisConnectionInfo } = await import('./src/services/MemoryManager.js');` |
| `server/test-memory-preferences.js:25` | `await import('./src/services/PreferenceLearner.js');` |
| `server/test-memory-preferences.js:27` | `await import('./src/services/MemoryManager.js');` |
| `server/test-memory-vector.js:30` | `} = await import('./src/services/MemoryManager.js');` |
| `server/test-memory-vector.js:32` | `await import('./src/providers/runtime/ProviderRouter.js');` |
| `server/test-memory-vector.js:88` | `const { providerHealthSnapshot } = await import('./src/providers/runtime/ProviderRouter.js');` |
| `server/test-model-coworkers.js:35` | `const { coworkerName, teamRoster } = await import('./src/providers/catalog/ModelCoworkers.js');` |
| `server/test-model-coworkers.js:36` | `const { coworkerChain } = await import('./src/providers/catalog/WorkerRouter.js');` |
| `server/test-model-coworkers.js:70` | `const { sanitizeStreamText } = await import('./src/providers/catalog/ModelCoworkers.js');` |
| `server/test-model-coworkers.js:95` | `const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');` |
| `server/test-model-coworkers.js:100` | `const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');` |
| `server/test-model-coworkers.js:103` | `const llm = fs.readFileSync('./src/providers/runtime/LLMClient.js', 'utf-8');` |
| `server/test-model-coworkers.js:112` | `/data\.type === 'log' \\|\\| data\.type === 'agent\.log'/.test(fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.j…` |
| `server/test-model-coworkers.js:113` | `const llm2 = fs.readFileSync('./src/providers/runtime/LLMClient.js', 'utf-8');` |
| `server/test-model-coworkers.js:116` | `const hook = fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.js'), 'utf-8');` |
| `server/test-model-coworkers.js:118` | `const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');` |
| `server/test-model-coworkers.js:119` | `const think = fs.readFileSync(path.join(ROOT, 'src/components/AgentThinking.jsx'), 'utf-8');` |
| `server/test-model-coworkers.js:125` | `const settings = fs.readFileSync(path.join(ROOT, 'src/components/SettingsView.jsx'), 'utf-8');` |
| `server/test-model-coworkers.js:132` | `const { coworkerName } = await import('./src/providers/catalog/ModelCoworkers.js');` |
| `server/test-model-coworkers.js:141` | `const { sanitizeStreamText: sst } = await import('./src/providers/catalog/ModelCoworkers.js');` |
| `server/test-new-agents.js:18` | `const { parseGithubRequest, inferCommitMessage } = await import('./src/services/GitHubAgent.js');` |
| `server/test-new-agents.js:19` | `const { parseCsv, parseJson, computeStats, extractData } = await import('./src/services/DataAgent.js');` |
| `server/test-new-agents.js:20` | `const { detectStack, dockerfileFor, ciYamlFor, deploySteps } = await import('./src/services/DevOpsAgent.js');` |
| `server/test-new-agents.js:21` | `const { parseLanguages, extractText } = await import('./src/services/TranslatorAgent.js');` |
| `server/test-new-agents.js:22` | `const { scanPerf } = await import('./src/services/PerfAgent.js');` |
| `server/test-onekey-providers.js:6` | `const llm = fs.readFileSync(new URL('./src/providers/runtime/LLMClient.js', import.meta.url), 'utf8');` |
| `server/test-onekey-providers.js:7` | `const router = fs.readFileSync(new URL('./src/providers/runtime/ProviderRouter.js', import.meta.url), 'utf8');` |
| `server/test-onekey-providers.js:32` | `const { providerOrder } = await import('./src/providers/runtime/ProviderRouter.js');` |
| `server/test-perf.js:11` | `const { latestNews, searchTrustedBooks } = await import('./src/services/TrustedLibrary.js');` |
| `server/test-perf.js:15` | `} = await import('./src/services/MemoryManager.js');` |
| `server/test-plan-mode.js:25` | `const { isPlanMode, setPlanMode, planModePromptSection, presentPlan, approvePlan, currentPlan, PLAN_POLICY_SECTION } = …` |
| `server/test-plan-mode.js:26` | `const { askQuestions, getPending, answerPending, takeAnswers, clearPending, formatAnswers } = await import('./src/servi…` |
| `server/test-plan-mode.js:27` | `const { appendConversationEvent, loadConversationEvents } = await import('./src/services/SessionConversations.js');` |
| `server/test-plan-mode.js:28` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-plan-mode.js:29` | `const { TOOL_COUNT, TOOL_REGISTRY } = await import('./src/services/ToolRegistry.js');` |
| `server/test-plan-mode.js:30` | `const { planGet } = await import('./src/services/PlanStore.js');` |
| `server/test-plan-mode.js:105` | `const { planModeBlocked } = await import('./src/services/PlanMode.js');` |
| `server/test-plan-mode.js:146` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-plan-mode.js:153` | `const { APPROVE_PLAN_RE } = await import('./src/services/PlanMode.js');` |
| `server/test-plan-mode.js:154` | `const { buildNativeSchemas, TOOL_SCHEMAS } = await import('./src/services/ToolRuntime.js');` |
| `server/test-plan-mode.js:163` | `const { getTool } = await import('./src/services/ToolRegistry.js');` |
| `server/test-plugin-seam.js:18` | `} = await import('./src/services/PluginContext.js');` |
| `server/test-plugin-seam.js:19` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-plugins-all.js:27` | `const { loadPlugins, setActivePluginContext, getPluginTool, listPluginTools, listPluginSkills } = await import('./src/s…` |
| `server/test-plugins-all.js:28` | `const { executeTool, buildNativeSchemas } = await import('./src/services/ToolRuntime.js');` |
| `server/test-plugins-all.js:29` | `const { normalizeTools } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-plugins-all.js:30` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-plugins-all.js:31` | `const { enforceToolAllowlist } = await import('./src/services/ToolRegistry.js');` |
| `server/test-plugins.js:12` | `await import('./src/services/PluginRegistry.js');` |
| `server/test-presenter.js:27` | `const { chartSvg } = await import('../src/utils/chartSvg.js');` |
| `server/test-presenter.js:53` | `const { imageSearch } = await import('./src/services/ImageSearch.js');` |
| `server/test-presenter.js:69` | `const VW = await import('./src/services/VideoWatch.js');` |
| `server/test-presenter.js:89` | `const IS = await import('./src/services/ImageSearch.js');` |
| `server/test-presenter.js:121` | `const { FORMAT_RULES } = await import('./src/services/Formatting.js');` |
| `server/test-presenter.js:127` | `const mr = fs.readFileSync(path.join(ROOT, 'src/components/MarkdownRenderer.jsx'), 'utf-8');` |
| `server/test-presets.js:22` | `const { resolvePreset, presetFromHeader, presetFlavor, PRESETS, DEFAULT_PRESET } = await import('./src/services/PresetM…` |
| `server/test-presets.js:23` | `const { buildTrace, traceEventLabel, isTraceCompaction } = await import('./src/services/SessionTrace.js');` |
| `server/test-presets.js:24` | `const { appendEvent } = await import('./src/services/EventLog.js');` |
| `server/test-presets.js:25` | `const { appendConversationEvent } = await import('./src/services/SessionConversations.js');` |
| `server/test-presets.js:26` | `const { compactNow } = await import('./src/services/CompactionEngine.js');` |
| `server/test-preview.js:20` | `const { executeTool, sanitizeModelOutput } = await import('./src/services/ToolRuntime.js');` |
| `server/test-preview.js:21` | `const { loadPlugins, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-process.js:12` | `await import('./src/services/ProcessManager.js');` |
| `server/test-process.js:70` | `const { listProcesses: listFresh } = await import(`./src/services/ProcessManager.js?bust=${Date.now()}`);` |
| `server/test-project-memory.js:24` | `} = await import('./src/services/ProjectCapsules.js');` |
| `server/test-rate-limiter.js:67` | `const daily = await import('./src/services/ProviderRateLimiter.js');` |
| `server/test-recovery-lessons.js:25` | `const { runAutonomousCoding } = await import('./src/services/AutonomousCoding.js');` |
| `server/test-recovery-lessons.js:26` | `const { retrieveLessons, lessonCount } = await import('./src/services/director/Lessons.js');` |
| `server/test-roster-registry.js:104` | `try { await import('./src/services/AgentRoster.js'); } catch { importFailed = true; }` |
| `server/test-session-keys.js:130` | `const { getGhToken } = await import('./src/services/GitHubAgent.js');` |
| `server/test-session-titles.js:27` | `} = await import('./src/services/SessionTitles.js');` |
| `server/test-session-titles.js:28` | `const { appendConversationEvent, conversationSummary, listConversations, recentSessionsBlock, searchConversations, dele…` |
| `server/test-session-titles.js:29` | `const { appendEvent } = await import('./src/services/EventLog.js');` |
| `server/test-session-titles.js:30` | `const { compactNow } = await import('./src/services/CompactionEngine.js');` |
| `server/test-sessions-b96.js:19` | `} = await import('./src/services/SessionConversations.js');` |
| `server/test-sessions-b96.js:20` | `const { todoAdd, todoList, todoComplete, todoRemove } = await import('./src/services/TodoStore.js');` |
| `server/test-sessions-b96.js:21` | `const { planSet, planGet, planUpdate } = await import('./src/services/PlanStore.js');` |
| `server/test-skill-discovery.js:33` | `} = await import('./src/services/SkillDiscovery.js');` |
| `server/test-skill-discovery.js:34` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-skill-discovery.js:73` | `const summary = (await import('./src/services/SkillDiscovery.js')).discoverySummary;` |
| `server/test-speed.js:27` | `const PR = await import('./src/providers/runtime/ProviderRouter.js');` |
| `server/test-speed.js:56` | `const { timeContextBlock } = await import('./src/services/TimeContext.js');` |
| `server/test-speed.js:67` | `const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');` |
| `server/test-speed.js:88` | `const llm = fs.readFileSync('./src/providers/runtime/LLMClient.js', 'utf-8');` |
| `server/test-team-router.js:17` | `const { routeToTeam } = await import('./src/services/TeamRouter.js');` |
| `server/test-team-router.js:45` | `const { runTeam } = await import('./src/services/TeamRouter.js');` |
| `server/test-team-router.js:54` | `const rules = fs.readFileSync('./src/services/Formatting.js', 'utf-8');` |
| `server/test-team-router.js:62` | `const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf-8');` |
| `server/test-team-router.js:67` | `const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');` |
| `server/test-thinking.js:41` | `const { generateContent } = await import('./src/providers/runtime/LLMClient.js');` |
| `server/test-thinking.js:92` | `const { sanitizeStreamText } = await import('./src/providers/catalog/ModelCoworkers.js');` |
| `server/test-thinking.js:101` | `const hook = fs.readFileSync(path.join(ROOT, 'src/hooks/useJexiEngine.js'), 'utf-8');` |
| `server/test-thinking.js:107` | `const tr = fs.readFileSync(path.join(ROOT, 'src/components/ThinkRow.jsx'), 'utf-8');` |
| `server/test-thinking.js:112` | `const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');` |
| `server/test-thinking.js:118` | `const pipe = fs.readFileSync(path.join(ROOT, 'src/components/AgentPipeline.jsx'), 'utf-8');` |
| `server/test-thinking.js:124` | `const al = fs.readFileSync('./src/services/AgentLoop.js', 'utf-8');` |
| `server/test-thinking.js:125` | `const st = fs.readFileSync('./src/services/SimpleTask.js', 'utf-8');` |
| `server/test-thinking.js:127` | `const wr = fs.readFileSync('./src/providers/catalog/WorkerRouter.js', 'utf-8');` |
| `server/test-time-context.js:23` | `const { timeContextBlock, appendTimeContext, setRequestTimeZone, requestTimeZone } = await import('./src/services/TimeC…` |
| `server/test-time-context.js:24` | `const { saveText, listSpills, runRetention } = await import('./src/services/SpillStore.js');` |
| `server/test-time-context.js:53` | `const src = fs.readFileSync('./src/providers/runtime/LLMClient.js', 'utf-8');` |
| `server/test-tool-contracts.js:23` | `const { executeTool, validateToolOutput, hasOutputContract, TOOL_OUTPUT_SCHEMAS, GENERIC_TOOL_OUTPUT } = await import('…` |
| `server/test-tool-contracts.js:24` | `const { TOOL_REGISTRY, TOOL_COUNT } = await import('./src/services/ToolRegistry.js');` |
| `server/test-tool-contracts.js:25` | `const { createPluginContext, setActivePluginContext } = await import('./src/services/PluginContext.js');` |
| `server/test-trace-events.js:23` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-turso-adapter.js:20` | `} = await import('./src/services/MemoryManager.js');` |
| `server/test-video-analyzer.js:27` | `} = await import('./src/services/VideoAnalyzer.js');` |
| `server/test-video-analyzer.js:28` | `const { toolsForIntent } = await import('./src/services/ToolRegistry.js');` |
| `server/test-video-watch.js:29` | `const VW = await import('./src/services/VideoWatch.js');` |
| `server/test-video-watch.js:135` | `const reg = fs.readFileSync('./src/services/CommandRegistry.js', 'utf-8');` |
| `server/test-video-watch.js:137` | `const cr = await import('./src/services/CommandRegistry.js');` |
| `server/test-video-watch.js:138` | `const pluginMod = await import('./plugins/video-watch/plugin.js');` |
| `server/test-web-search.js:38` | `const WS = await import('./src/services/WebSearch.js');` |
| `server/test-web-search.js:165` | `const SE = await import('./src/services/SearchEngine.js');` |
| `server/test-web-search.js:200` | `const sa = fs.readFileSync('./src/services/SearchAgent.js', 'utf-8');` |
| `server/test-web-search.js:202` | `const se = fs.readFileSync('./src/services/SearchEngine.js', 'utf-8');` |
| `server/test-web-search.js:205` | `const wsp = fs.readFileSync('./src/services/WebSearchProviders.js', 'utf-8');` |
| `server/test-web-search.js:209` | `const row = fs.readFileSync(path.join(ROOT, 'src/components/StepRow.jsx'), 'utf-8');` |
| `server/test-web-search.js:211` | `const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf-8');` |
| `server/test-web-search.js:213` | `const chat = fs.readFileSync(path.join(ROOT, 'src/components/ChatWindow.jsx'), 'utf-8');` |
| `server/test-workflow.js:25` | `const { startWorkflow, workflowRecord, listWorkflows, setWorkflowDispatcher, WorkflowError } = await import('./src/serv…` |
| `server/test-workflow.js:26` | `const { executeTool } = await import('./src/services/ToolRuntime.js');` |
| `server/test-workflow.js:27` | `const { TOOL_COUNT, TOOL_REGISTRY, getTool } = await import('./src/services/ToolRegistry.js');` |
| `server/test-workflow.js:28` | `const { buildNativeSchemas, TOOL_SCHEMAS } = await import('./src/services/ToolRuntime.js');` |
| `server/test-workflow.js:29` | `const { startJob, setJobExecutor } = await import('./src/services/BackgroundJobs.js');` |
| `server/test-workspace.js:21` | `await import('./src/services/WorkspaceRuntime.js');` |
| `server/tests/agi/test-observer-chat-events.js:62` | `const src = fs.readFileSync(path.resolve('src/services/director/MissionRunner.js'), 'utf8');` |
| `tests/verification/eval/index.js:7` | `*   const ev = require('../verification/eval');` |

### 4.4 Glob patterns

* **114** glob hits — **64** in code/config, **50** in comments.
* Functional globs that break silently (config looks valid, matches nothing):

| file:line | glob | effect |
| --- | --- | --- |
| `tailwind.config.js:2` | `content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"]` | **purge glob matches 0 files → Tailwind strips all classes the new tree uses** |
| `.github/workflows/docker-publish.yml:17-23` | `'src/**' 'public/**' 'commands/**' 'ui/**' 'events/**' 'providers/**' 'workforce/**'` | image never rebuilds on changes to the moved dirs |
| `.github/workflows/validate-divisions.yml:12,18` | `- 'agents/**'` | still matches the NEW `agents/` parent — but the file it guards moved |
| `.github/workflows/validate-divisions.yml:13,19` | `- 'workforce/divisions.json'` | never fires |

All remaining glob hits (comments + docs-in-code):

* `.github/workflows/apk.yml:18` — `# the Phase 24 Scope 0 cleanup over-deleted android/** raster build resources`
* `.github/workflows/docker-publish.yml:17` — `- 'src/**'`
* `.github/workflows/docker-publish.yml:18` — `- 'public/**'`
* `.github/workflows/docker-publish.yml:19` — `- 'commands/**'`
* `.github/workflows/docker-publish.yml:20` — `- 'ui/**'`
* `.github/workflows/docker-publish.yml:21` — `- 'events/**'`
* `.github/workflows/docker-publish.yml:22` — `- 'providers/**'`
* `.github/workflows/docker-publish.yml:23` — `- 'workforce/**'`
* `.github/workflows/hf-deploy.yml:46` — `--exclude "server/public/*" --exclude ".env" --exclude "*.log"`
* `.github/workflows/validate-divisions.yml:12` — `- 'agents/**'`
* `.github/workflows/validate-divisions.yml:18` — `- 'agents/**'`
* `agents/workforce/agents/infer.js:4` — `* Only JEXI's canonical `agents/**\/*.agent.md` files declare a `division:` in`
* `agents/workforce/agents/loader.js:7` — `*   1. Live tree  — agents/**\/*.agent.md, server/agents, jexi-agents,`
* `agents/workforce/registry/index.js:7` — `* The canonical agent files (agents/**\/*.agent.md) are the source of truth`
* `benchmarks/osworld/index.js:24` — `* READ-ONLY through injection; nothing here imports or edits computer/**.`
* `benchmarks/webarena/index.js:25` — `* (computer/**) files.`
* `capabilities/commands/_context.js:22` — `*   dev        <root>/commands/*.js → ../server/src/…   ../events/hud/…`
* `capabilities/commands/_context.js:22` — `*   dev        <root>/commands/*.js → ../server/src/…   ../events/hud/…`
* `capabilities/commands/_context.js:22` — `*   dev        <root>/commands/*.js → ../server/src/…   ../events/hud/…`
* `capabilities/commands/_context.js:23` — `*   container  /app/commands/*.js   → ../src/…          ../events/hud/…`
* `capabilities/commands/_context.js:23` — `*   container  /app/commands/*.js   → ../src/…          ../events/hud/…`
* `capabilities/commands/_context.js:23` — `*   container  /app/commands/*.js   → ../src/…          ../events/hud/…`
* `capabilities/graph/code/graph-first.js:30` — `// SCOPED to capability/. It does NOT import anything from server/src/context/**`
* `capabilities/graph/code/graph-first.js:30` — `// SCOPED to capability/. It does NOT import anything from server/src/context/**`
* `capabilities/graph/code/graph-first.js:30` — `// SCOPED to capability/. It does NOT import anything from server/src/context/**`
* `capabilities/graph/context-hook.js:7` — `// ZONE DISCIPLINE: this module imports NOTHING from server/src/context/**.`
* `capabilities/graph/context-hook.js:7` — `// ZONE DISCIPLINE: this module imports NOTHING from server/src/context/**.`
* `capabilities/graph/rag/graph-rag.js:26` — `* This is a STANDALONE subsystem: it does not import or touch memory/** or`
* `capabilities/graph/rag/index.js:5` — `* no memory/** or server/** wiring.`
* `capabilities/prompts/anti-patterns/index.js:35` — `// "a prompt" across scopes). server/** and events/** untouched.`
* `capabilities/prompts/assembly/errors.js:7` — `// prompt/** zone; later scopes (B: E_STATIC_AFTER_DYNAMIC, ...) add`
* `capabilities/prompts/memory-fs/tree.js:6` — `// the structure; write enforcement wiring inside server/src/memory/** is a`
* `capabilities/prompts/memory-fs/tree.js:6` — `// the structure; write enforcement wiring inside server/src/memory/** is a`
* `capabilities/prompts/memory-fs/write-rules.js:23` — `// NOTE: enforcement wiring inside server/src/memory/** is a zone-owner`
* `capabilities/prompts/memory-fs/write-rules.js:23` — `// NOTE: enforcement wiring inside server/src/memory/** is a zone-owner`
* `capabilities/prompts/tools/descriptions.js:12` — `// Phase 5 — 12 domains; tools/domains/lsp/**, Phase 11 — 15 CBM tools)`
* `capabilities/prompts/tools/descriptions.js:12` — `// Phase 5 — 12 domains; tools/domains/lsp/**, Phase 11 — 15 CBM tools)`
* `capabilities/prompts/tools/descriptions.js:18` — `// keeping prompt/** zero-dependency and the zone boundary clean.`
* `harness/adapters/_convert.js:123` — `// 2) workforce/coworkers/*/agents/*.agent.js — canonical phase layout (if populated)`
* `harness/adapters/_convert.js:123` — `// 2) workforce/coworkers/*/agents/*.agent.js — canonical phase layout (if populated)`

### 4.5 String concatenation / template-literal path building

* **4** hits where a moved-dir segment is glued with `+` / string-adjacent.
* **19** template-literal (`${...}`) refs where the moved dir is a literal segment of the template.
* Representative cases:

* `agents/workforce/agents/loader.js:145` — `sourcePath: `server/agents/${name}`,`
* `agents/workforce/agents/loader.js:183` — `sourcePath: `server/plugins/${dir}/plugin.json`,`
* `harness/refine/planner.js:30` — `evidence: { source: `${path.resolve(file)}#/events/${index}`, detail: event.detail },`
* `skills/creator.js:101` — `source: `${trajectoryId}#/events/${event.index}`,`

Template-literal refs (all, with verdict):

| file:line | token | verdict |
| --- | --- | --- |
| `agents/workforce/agents/loader.js:145` | `server/agents/${name}` | server-internal |
| `agents/workforce/agents/loader.js:183` | `server/plugins/${dir}/plugin.json` | server-internal |
| `agents/workforce/agents/loader.js:204` | `server/agents/profiles/${dir}/SOUL.md` | server-internal |
| `harness/refine/planner.js:30` | `/events/${index}` | ⚠️ verify by hand |
| `interfaces/console/components/MissionsScreen.jsx:181` | `}/api/missions/${selectedId}/events/stream` | not a repo path (API route) |
| `scripts/phase10-i-probe.mjs:221` | `${ROOT}/context/offload/file.js` | ⚠️ verify by hand |
| `scripts/phase10-i-probe.mjs:233` | `${ROOT}/context/offload/file.js` | ⚠️ verify by hand |
| `scripts/phase17-e-probe.mjs:271` | `${ROOT}/context/viking/filesystem.js` | ⚠️ verify by hand |
| `scripts/phase22-d-probe.mjs:109` | `${BUNDLE}/hooks/hooks.json` | ⚠️ verify by hand |
| `server/src/services/ImageSearch.js:94` | `//image.pollinations.ai/prompt/${encodeURIComponent` | ⚠️ verify by hand |
| `server/src/services/ProfileCompleteness.js:58` | `agents/profiles/${meta.slug}` | ⚠️ verify by hand |
| `server/test-b224.js:81` | `${BASE}/api/missions/does-not-exist/events/stream` | not a repo path (API route) |
| `server/test-b224.js:86` | `${BASE}/api/missions/${mission.id}/events/stream` | not a repo path (API route) |
| `server/test-b224.js:103` | `${BASE}/api/missions/${mission.id}/events/stream` | not a repo path (API route) |
| `server/test-b224.js:146` | `${BASE}/api/missions/${mission.id}/events/stream` | not a repo path (API route) |
| `server/test-b224.js:157` | `${BASE}/api/missions/${mission.id}/events/stream` | not a repo path (API route) |
| `server/test-b224.js:167` | `${BASE}/api/missions/${mission.id}/events/stream` | not a repo path (API route) |
| `skills/creator.js:101` | `/events/${event.index}` | ⚠️ verify by hand |
| `skills/library/claude-ecosystem/superpowers/hooks/hooks.json:9` | `${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd` | ⚠️ verify by hand |

---

## P7 — FRONTEND CHECK — full path references

### `vite.config.js`

```js
21  export default defineConfig({
22    plugins: [react(), jexiBuildStamp()],
23    // Relative base: works on Vercel (root) and GitHub Pages (subpath)
24    base: './',
25    // Pin the dependency scanner to the real app entry. Without this, Vite
26    // auto-discovers EVERY index.html in the project — including the COMPILED
27    // Android bundle at android/app/src/main/assets/public/index.html — and
28    // crashes the dev server trying to resolve imports inside that built file
29    // ("@emotion/is-prop-valid could not be resolved").
30    optimizeDeps: {
31      entries: 'index.html',
32    },
39    build: {
40      target: 'es2017',
41    },
42    server: {
43      host: true, port: 3000,
50      proxy: {
51        '/api': 'http://localhost:3002',
52        '/desktop-api': { target: 'http://localhost:3002', … }
```

| line | reference | type | verdict |
| --- | --- | --- | --- |
| 27 | `android/app/src/main/assets/public/index.html` | comment only | MISSING path in prose → new path is `interfaces/android/…`; **no functional break**, but the warning text is now wrong |
| 24, 31, 39–41, 42–58 | `'./'`, `'index.html'`, `es2017`, ports, proxy | — | **no moved-dir paths** |

**vite.config.js has no functional path reference to any moved dir** — the damage is done by `index.html` and `tailwind.config.js` instead. `base: './'` + `build.target` are unaffected. Not a blocker in itself; flagged because line 27 is the only stale mention.

### `index.html`

```html
113    <script type="module" src="/src/main.jsx"></script>
```

**This single line breaks `npm run build` / `vite dev`.** `/src/main.jsx` resolved from the project root no longer exists (root `src/` is gone; `git ls-files | grep -c '^src/'` = 0). The entry now lives at `interfaces/console/main.jsx`. Other `href`/`src` in the file are external (Google Fonts) or `data:` URIs — clean.

### `capacitor.config.json`

```json
3      "appName": "JEXI OS",
4      "webDir": "dist",          ← output dir, NOT a moved dir (clean)
6      "android": {                ← key name, NOT a path (clean)
14       "androidSplashResourceName": "splash"
```

**No path reference to a moved dir.** `webDir: dist` still correct. ⚠️ *Indirect* break: Capacitor needs the `android/` platform folder (now `interfaces/android/`); `npx cap sync android` (root `package.json:13`, `.github/workflows/apk.yml:73`) will not find it → see **F3/F5**.

### `render.yaml`

```yaml
12    rootDir: server          ← not a moved dir (server/ is untouched) — clean
19    buildCommand: … npm ci && npx playwright install … && mkdir -p bin && curl … bin/yt-dlp
20    startCommand: PATH="$PWD/bin:$PATH" npm start
21    healthCheckPath: /api/health
```

**No reference to any moved dir.** All paths are `server/`-relative or `./bin`-relative. Deploy target unaffected by the move (the brain is `server/`, which did not move).

### `Dockerfile` (root)

```dockerfile
39  # Frontend build -> served from server/public by Express
40  COPY package*.json index.html vite.config.js tailwind.config.js postcss.config.js ./
41  COPY public ./public
42  COPY src ./src
43  RUN npm ci --no-audit --no-fund && npm run build
44  # server/public is a git symlink to ../dist — vite writes the bundle
45  # straight through it, so the old `cp -r dist/* server/public/` copied
```

| line | reference | status |
| --- | --- | --- |
| 41 | `COPY public ./public` | **MISSING** — root `public/` is gone (`interfaces/public/`) → `docker build` fails |
| 42 | `COPY src ./src` | **MISSING** — root `src/` is gone (`interfaces/console/`) → `docker build` fails |
| 40 | `index.html vite.config.js tailwind.config.js postcss.config.js` | files still at root ✅ (but their contents point at the old tree) |
| 44–45 | `server/public` symlink → `../dist` | unchanged, still valid ✅ |

### `Dockerfile.slim` (root)

```dockerfile
43  # Frontend build → served by Express from server/public
44  COPY package*.json index.html vite.config.js tailwind.config.js postcss.config.js ./
45  COPY public ./public
46  COPY src ./src
47  # Phase 7(G) — the commands subsystem lives at the repo root (ECC layout);
48  # the container resolves /app/commands (dual-depth seam: /app/commands).
49  COPY commands ./commands
50  # Phase 24: src/components/ChatWindow.jsx imports ../../ui/web/console/chat/mount.js
51  #
52  # and its import closure reaches events/ (chat taxonomy), providers/ (keyRef
53  # profile schema) and workforce/ (narration modules imported by the runtime).
54  COPY ui ./ui
55  COPY events ./events
56  COPY providers ./providers
57  COPY workforce ./workforce
58  RUN npm ci --no-audit --no-fund && npm run build
```

| line | reference | status |
| --- | --- | --- |
| 45 | `COPY public ./public` | **MISSING** → `interfaces/public/` |
| 46 | `COPY src ./src` | **MISSING** → `interfaces/console/` |
| 49 | `COPY commands ./commands` | **MISSING** → `capabilities/commands/` |
| 54 | `COPY ui ./ui` | **MISSING** → `interfaces/ui/` |
| 55 | `COPY events ./events` | **MISSING** → `runtime/events/` |
| 56 | `COPY providers ./providers` | **MISSING** → `integrations/providers/` |
| 57 | `COPY workforce ./workforce` | **MISSING** → `agents/workforce/` |
| 50, 52–53 | prose references to `ui/…`, `events/`, `providers/`, `workforce/` | stale comments (explain *why* the COPYs exist) |
| 40, 59–60 | `../../mcp/registry.json`, `server/public` symlink | server-internal, unchanged ✅ |

> **7 of 7 COPY sources in `Dockerfile.slim` and 2 of 2 in `Dockerfile` are broken.** The image build is a hard failure, not a silent one.

---

## P8 — PACKAGE.JSON CHECK

### Root `package.json` — every script

| script | command | moved-dir ref? | verdict |
| --- | --- | --- | --- |
| `dev` | `vite --host` | no | runs, but the served entry `/src/main.jsx` is gone → blank/500 |
| `dev:full` | `concurrently … "PORT=3002 npm --prefix server start" "vite --host"` | no (`server/` untouched) | runs; same frontend problem |
| `build` | `vite build` | indirect (index.html entry) | **fails** — `Could not resolve /src/main.jsx` |
| `preview` | `vite preview --host` | no | fine once build succeeds |
| `test` | `cd server && npm test` | no | `server/` untouched — but the suite contains `node ../cli/test-cli.js` (see nested) |
| `apk:generate` | `node scripts/make-icon.js && npx @capacitor/assets generate --android` | ⚠️ **bare `--android`** | slash-grep misses it; Capacitor targets the `android/` platform dir → **now `interfaces/android/`** |
| `apk:sync` | `npm run build && npx cap sync android` | ⚠️ **bare `android`** | **fails** — `cap sync android` needs the platform folder at root |

**Slash-anchored matches in root `package.json`: 0.** Two scripts are broken anyway via bare directory arguments — this is the exact class of reference the spec's `OLD_DIR/` grep cannot see (**F13**).

### Nested `package.json` files (6 found)

| file | moved-dir path in scripts? |
| --- | --- |
| `server/package.json` | ⚠️ **yes** — `scripts.test` ends with `node ../cli/test-cli.js` → `.github` **?** no: `cli/` moved to `interfaces/cli/` → **MISSING** |
| `server/tests/agi/fixtures/verify-pkg/package.json` | no |
| `server/tests/agi/skill-probe/package.json` | no |
| `skills/aas/package.json` | no |
| `skills/gates/package.json` | no |
| `tests/verification/eval/package.json` | no |

`server/package.json` `lint` script (`eslint index.js src test-*.js tests`) is **fine** — that `src` is `server/src`, an unrelated directory. See **F7**.

---

## P9 — CI CHECK — `.github/workflows/*.yml`

**Cache paths:** none declared — no `cache:` / `cache-dependency-path:` key exists in any of the 12 workflows. Nothing to migrate; nothing silently stale.

**`working-directory:` keys (all 5 in the repo):**

| file:line | value | verdict |
| --- | --- | --- |
| `.github/workflows/apk.yml:76` | `android` | ⚠️ **BARE dir ref, no slash** → now `interfaces/android`; gradle runs in a non-existent dir → **APK workflow fails** |
| `.github/workflows/ci.yml:17` (job default) | `server` | fine (untouched) |
| `.github/workflows/ci.yml:24,27,32,35` | `.` | fine |

**Path filters / artifact paths / step paths:**

| file:line | reference | status |
| --- | --- | --- |
| `apk.yml:73` | `npx cap sync android` | ⚠️ bare `android` → MISSING |
| `apk.yml:106` | `path: android/app/build/outputs/apk/debug/app-debug.apk` | **MISSING** → `interfaces/android/…` |
| `apk.yml:138` | `android/app/build/outputs/apk/debug/app-debug.apk \` (gh release upload) | **MISSING** |
| `apk.yml:18` | comment `android/** raster build resources` | stale prose |
| `ci.yml:36` | `node tools/registry/audit.js` | **MISSING** → `capabilities/tools/registry/audit.js` → CI step fails |
| `ci.yml:39` | `for f in index.js src/services/*.js; do node --check "$f"; done` (runs in `.`) | `index.js` never existed at root (**pre-existing rot**); `src/services/*.js` **MISSING** → loop checks nothing / shell glob error |
| `ci.yml:28` | `bash scripts/lint-agent-baseline.sh agents/` | resolves today (`agents/` = new parent) — **but lints the wrong tree** (`agents/catalog/` was the old content) → **silent false pass** |
| `deploy-worker.yml:20` | `- 'deploy/lb-worker.js'` | **MISSING** → `infra/deploy/lb-worker.js` → workflow never triggers |
| `deploy-worker.yml:45` | `npx --yes wrangler@4 deploy deploy/lb-worker.js` | **MISSING** → step fails if triggered |
| `deploy-worker.yml:10` | comment `deploy/lb-worker.js` | stale prose |
| `docker-publish.yml:17-23` | `'src/**' 'public/**' 'commands/**' 'ui/**' 'events/**' 'providers/**' 'workforce/**'` | **all MISSING** → slim image silently not rebuilt on the dirs it ships |
| `docker-publish.yml:9` | comment `ui/web/console/chat/mount.js` | stale prose |
| `docker-image.yml:28` | `cp -r events/hud server/events/` | **MISSING** source → `runtime/events/hud` → brain image HUD missing |
| `docker-image.yml:35` | `cp -r commands/. server/commands/` | **MISSING** source → `capabilities/commands` → container loses slash commands |
| `docker-image.yml:23-25` | comment `/app/events/hud` | stale prose (container path) |
| `docker-image.yml:47` | `context: server` | fine (untouched) |
| `validate-divisions.yml:12,18` | `- 'agents/**'` | resolves today but semantically wrong (old `agents/` content is now `agents/catalog/`) |
| `validate-divisions.yml:13,19` | `- 'workforce/divisions.json'` | **MISSING** → `agents/workforce/divisions.json` → drift guard never fires |
| `validate-divisions.yml:3-4` | comments `workforce/divisions.json`, `agents/` | stale prose |
| `deploy.yml:24,30` | `dist/brain.json`, `VITE_JEXI_BACKEND_URL`, Pages | fine (build output) |
| `hf-deploy.yml:46` | `--exclude "server/public/*"` | fine (server-internal) |
| `render-deploy.yml:6`, `self-deploy.yml`, `keepalive.yml` | Render API URLs / health endpoint | not repo paths (URL category) |

**Verdict: 4 workflows are functionally broken** (`apk.yml`, `ci.yml`, `deploy-worker.yml`, `docker-publish.yml`, `docker-image.yml` — 5 including the image pipeline), 1 silently mis-scoped (`validate-divisions.yml`), 6 unaffected.

---

## P10 — `docs/STAGE-3A-REFERENCE-DISCOVERY.md` rendered

This file. Machine-generated sections are marked; every number above is reproducible with the commands in **Appendix D**.

| property | value |
| --- | --- |
| path | `docs/STAGE-3A-REFERENCE-DISCOVERY.md` |
| lines | 3478 |
| bytes | 271160 |
| appended by this commit | yes (new file) |

---

## P11 — diff stat

Expected by spec: `git diff --stat origin/main..HEAD` = **only the doc**.

**Result against the spec's exact command — the expectation does not hold, and here is why:**

```console
$ git diff --stat origin/main..HEAD | tail -1
1020 files changed, 0 insertions(+), 0 deletions(-)
$ git log --oneline -1 origin/main
e6bde65 merge: PR 17 — investigation: excluded scopes close-out (5 CLOSED, 17B confirmed)
$ git rev-list --count origin/main..HEAD
3
```

`origin/main` is still parked at `e6bde65`, the **base of Stage 1**. `origin/main..HEAD` therefore spans Stage 1 (1006 renames) + Stage 2 (14 renames) + this Stage-3A commit — i.e. the 1020 renames plus this doc. The stage boundary the lead is looking for is the **Stage-2 base `fcef3e7`**, not `origin/main`:

```console
$ git diff --stat fcef3e7..HEAD
docs/STAGE-3A-REFERENCE-DISCOVERY.md | 3478 ++++++++++++++++++++++++++++++++++
 1 file changed, 3478 insertions(+)
```

That is the correct form of the probe: **exactly one file — this document.** Nothing else moved in 3A.

---

## P12 — Zone check

```console
$ git show --stat --oneline HEAD
<this-commit-sha> restructure(3a): reference discovery
 docs/STAGE-3A-REFERENCE-DISCOVERY.md | 3478 ++++++++++++++++++++++++++++++++++
 1 file changed, 3478 insertions(+)
$ git status --short
(clean)
```

| zone guard | required | actual |
| --- | --- | --- |
| branch | `restructure/file-structure` only | `restructure/file-structure` ✅ |
| zone | `docs/STAGE-3A-REFERENCE-DISCOVERY.md` only | 1 file, this doc ✅ |
| code edits | none | 0 code files touched ✅ |
| commits | one | 1 commit ✅ |
| mode | read-only | no source/config/CI file modified ✅ |

> `<this-commit-sha>` is masked on purpose: a commit cannot contain its own hash — embedding it would change the hash, which would change the file, which would change the hash. The real value is printed by `git log -1 --format=%H` on this branch; everything else in the block above (`1 file changed, … insertions(+)`, clean `git status`) is verbatim from the probe.

---

## F — FINDINGS (ranked, no fixes applied)

### F1 — BLOCKER: both Docker images fail to build (9 broken COPY sources)

`Dockerfile:41-42` and `Dockerfile.slim:45-57`. Root `src/` and `public/` are **gone** (`git ls-files | grep -c '^src/'` = 0, `^public/` = 0). This is a hard build error, so it fails loudly.

### F2 — BLOCKER: the web build fails / ships unstyled

`index.html:113` → `/src/main.jsx` missing → `vite build` cannot resolve the entry. Even if fixed, `tailwind.config.js:2` `content: ["./src/**/*.{js,ts,jsx,tsx}"]` matches **zero** files, so every utility class used by the moved console is purged. Two independent failures on the same artifact.

### F3 — BLOCKER: the APK workflow cannot find the Android platform

`.github/workflows/apk.yml:76` `working-directory: android` + `:73` `npx cap sync android` + `:106/:138` artifact paths. Three separate breaks; the bare `android` specifier is invisible to the slash-anchored grep.

### F4 — CI never rebuilds the slim brain image

`docker-publish.yml:17-23` path filters list 7 moved dirs. The workflow still passes, but changes to the console/commands/events/providers/workforce never trigger a rebuild → **silent staleness in production**.

### F5 — CI ships a brain image without the HUD and commands

`docker-image.yml:28,35` copy `events/hud` and `commands/` into the server context. Both sources are MISSING, so the container resolves `/app/events/hud` and `/app/commands` to nothing. (`cp` fails → step error, or a silently empty dir depending on shell flags.)

### F6 — `server/package.json` test suite runs a deleted path

`scripts.test` includes `node ../cli/test-cli.js`; `cli/` is now `interfaces/cli/`. The suite fails at that entry.

### F7 — ⚠️ HIGHEST-RISK: 494 refs are *false friends* (`server/src/<name>/`)

`server/src/` contains directories that **share names with 11 moved dirs**. A naive `s/<old>/<new>/` sweep would corrupt them. Exact overlap:

| old dir name | `server/src/<name>` exists? | refs written as `server/src/<name>/…` |
| --- | --- | ---: |
| `memory/` | **YES** ⚠️ | 18 |
| `context/` | **YES** ⚠️ | 18 |
| `kernel/` | **YES** ⚠️ | 13 |
| `scheduler/` | **YES** ⚠️ | 3 |
| `workgraph/` | **YES** ⚠️ | 3 |
| `tools/` | **YES** ⚠️ | 61 |
| `lsp/` | **YES** ⚠️ | 2 |
| `capability/` | **YES** ⚠️ | 3 |
| `workforce/` | **YES** ⚠️ | 3 |
| `providers/` | **YES** ⚠️ | 27 |
| `verification/` | **YES** ⚠️ | 0 |
| `verification/` | **YES** ⚠️ | 0 |

Evidence from the sample sweep:

```
capabilities/commands/build-fix.command.js:117  const providers = await serverMod('src/providers/index.js');
                                                 ^^^^^^^^^^^^^^^^^^ server-internal, NOT the moved src/
runtime/events/hud/producer.js:86              '../../server/src/services/providers/modelConfig.js'  ← fine
server/cli.js:19-24                            './src/services/…'                                     ← fine
```

### F8 — 1,459 refs still *resolve*, so smoke tests will lie

Files moved 1–2 levels deeper while their relative imports stayed the same. Examples in **4.2**: `interfaces/console/main.jsx:4` `../ui/web/console/shell/Shell.jsx` and `capabilities/graph/code/graph-first.js:56` `../../tools/domains/lsp/_graph.js` both **resolve today to a real file** — the wrong one relative to intent, but real. A green import test is not evidence of correctness here.

### F9 — Production dynamic imports are broken (not just comments)

| file | what breaks |
| --- | --- |
| `capabilities/commands/{autonomous,goal,heartbeat}.command.js` | `new URL('../scheduler/autonomous/index.js', import.meta.url)` → resolves to `capabilities/scheduler/…` → **MISSING** |
| `capabilities/graph/doctor/index.js:37,72,73,102-104` | `path.join(ROOT, 'kernel/…' \| 'tools/…' \| 'capability/internet/…')` — ROOT-anchored to the old layout |
| `runtime/kernel/daemon/client.js:15,71`, `runtime/kernel/daemon/codegraph-daemon.js:24` | `path.join(REPO_ROOT, 'capability/code/graph/db')`, `…'kernel/daemon/codegraph-daemon.js'` |
| `capabilities/tools/domains/lsp/_graph.js:32` | `path.join(REPO_ROOT, 'capability/code/graph/db')` — the graph DB path |
| `harness/adapters/_convert.js:66,68,124,125,223,242` | `path.join(REPO_ROOT, 'jexi-agents/…' \| 'workforce/…' \| 'hooks/hooks.json' \| 'commands/index.js')` |
| `agents/workforce/agents/loader.js:231` | `path.join(root, 'workforce/agents/vendor/agency-agents.specs.json')` |

### F10 — `server/bundles/manifest.json` is the single densest stale file (79 refs)

A generated build artifact listing bundle→source paths. Decide policy in 3B: **regenerate** (preferred) vs hand-rewrite. It accounts for 79 of the 2,509 MISSING refs and all 8 of its dirs are affected.

### F11 — 1,036 MISSING refs are `scripts/` archaeology

Historical `scripts/phase*.mjs` probes (Phase 9–31) hard-code the old layout. They are executed artifacts, not live code, and rewriting them would falsify the historical record. Recommend an explicit **no-touch policy** for `scripts/` in 3B; only `scripts/generate-divisions.js` + `scripts/regenerate-capabilities.mjs` are wired into CI (`validate-divisions.yml`) and may need review.

### F12 — coverage gap: the spec pathspec misses 681 matches in 0 files

| extension | matches | note |
| --- | ---: | --- |
| `.md` | 0 | skills/library docs — bulk of the noise |
| `.sh` | 0 | not covered by the spec sweep |
| `(extensionless)` | 0 | not covered by the spec sweep |
| `.slim` | 0 | not covered by the spec sweep |
| `.gradle` | 0 | not covered by the spec sweep |
| `.lock` | 0 | not covered by the spec sweep |
| `.css` | 0 | not covered by the spec sweep |
| `.java` | 0 | not covered by the spec sweep |

Add `*.md` (excluding `docs/`), `*.sh`, extensionless `scripts/*`, `*.gradle`, `*.css` to the 3B sweep, or declare them out of scope explicitly.

### F13 — bare directory arguments evade the slash-anchored grep (5 found by manual sweep)

| location | reference |
| --- | --- |
| `.github/workflows/apk.yml:76` | `working-directory: android` |
| `.github/workflows/apk.yml:73` | `npx cap sync android` |
| `package.json:13` | `npx cap sync android` |
| `package.json:12` | `npx @capacitor/assets generate --android` |
| `capacitor.config.json:6` | `"android": {` (config key — benign, listed for completeness) |

3B needs a bare-token sweep too (e.g. `\bandroid\b` in workflows/scripts), not just `OLD_DIR/`.

### F14 — the `agents/` double meaning (see 4.1)

Old `agents/` → `agents/catalog/`, but `agents/` is also the new parent. 106 refs contain `agents/`; 89 are bare. Any per-token rewrite is unsafe here; this dir needs per-target resolution.

---

## Suggested 3B sequencing (recommendation only — nothing executed)

| step | scope | why first |
| ---: | --- | --- |
| 1 | `index.html`, `tailwind.config.js`, root `vite.config.js` | restores the web build; unblocks every frontend verification |
| 2 | `Dockerfile`, `Dockerfile.slim` | restores image builds |
| 3 | root `package.json` (bare `android`), `server/package.json` (`../cli/test-cli.js`) | restores APK + test entry points |
| 4 | `.github/workflows/*` (5 files) | restores CI signal + the silently-mis-scoped guards |
| 5 | runtime/brain code (`capabilities/`, `runtime/`, `mind/`, `services/`, `agents/`, `interfaces/`) — 1,473 refs minus comments | the actual product |
| 6 | `harness/`, `integrations/`, `infra/`, `tests/`, `security/` | tooling ring |
| 7 | `server/bundles/manifest.json` | regenerate, don't hand-edit |
| 8 | `scripts/**`, `benchmarks/**`, `docs/**` | declare no-touch / archaeology |

---

## APPENDIX A — Every MISSING reference outside `scripts/` (actionable worklist)

1,473 references across 576 files, grouped by old dir (`✅code` = non-comment line, `💬` = comment/prose).

### `kernel/` → `runtime/kernel/` — 12 MISSING refs (4 code) in 9 files

- `capabilities/graph/doctor/index.js:37` ✅code → `kernel/daemon/client.js`
- `capabilities/graph/doctor/index.js:61` ✅code → `kernel/daemon/codegraph-daemon.js`
- `infra/hooks/scripts/session-start/restore-memory.js:7` 💬 → `kernel/operator`
- `runtime/context/offload/index.js:52` 💬 → `../rlm/kernel/persistent-repl.js`
- `runtime/context/offload/index.js:69` 💬 → `rlm/kernel/persistent-repl.js`
- `runtime/context/offload/index.js:75` 💬 → `../rlm/kernel/context-variable.js`
- `runtime/kernel/daemon/client.js:71` ✅code → `kernel/daemon/codegraph-daemon.js`
- `runtime/kernel/daemon/codegraph-daemon.js:12` 💬 → `kernel/daemon/codegraph-daemon.js`
- `server/src/kernel/hooks/hud-seam.js:22` 💬 → `/app/src/kernel/hooks`
- `server/src/services/BrowserRouter.js:29` 💬 → `kernel/mission`
- `server/src/services/director/Employees.js:38` 💬 → `kernel/Director`
- `server/src/wiring/phase31-bootstrap.js:58` ✅code → `../../../rlm/kernel/index.js`

### `rlm/` → `runtime/rlm/` — 11 MISSING refs (6 code) in 3 files

- `interfaces/ui/preview/agents-view.html:293` ✅code → `rlm/daemon/index.js`
- `interfaces/ui/preview/agents-view.html:300` ✅code → `rlm/daemon/index.js`
- `interfaces/ui/preview/agents-view.html:396` 💬 → `rlm/daemon/index.js`
- `interfaces/ui/preview/agents-view.html:405` 💬 → `../../rlm/daemon/index.js`
- `interfaces/ui/preview/agents-view.html:596` ✅code → `rlm/daemon/index.js`
- `interfaces/ui/preview/agents-view.html:614` ✅code → `rlm/daemon/index.js`
- `interfaces/ui/preview/agents-view.html:617` ✅code → `rlm/daemon/index.js`
- `runtime/context/offload/index.js:52` 💬 → `../rlm/kernel/persistent-repl.js`
- `runtime/context/offload/index.js:69` 💬 → `rlm/kernel/persistent-repl.js`
- `runtime/context/offload/index.js:75` 💬 → `../rlm/kernel/context-variable.js`
- `server/src/wiring/phase31-bootstrap.js:58` ✅code → `../../../rlm/kernel/index.js`

### `scheduler/` → `runtime/scheduler/` — 5 MISSING refs (4 code) in 4 files

- `capabilities/commands/autonomous.command.js:5` ✅code → `../scheduler/autonomous/index.js`
- `capabilities/commands/goal.command.js:8` ✅code → `../scheduler/autonomous/index.js`
- `capabilities/commands/heartbeat.command.js:5` ✅code → `../scheduler/autonomous/index.js`
- `server/src/wiring/phase31-bootstrap.js:65` ✅code → `../../../scheduler/autonomous/index.js`
- `server/src/wiring/phase31-bootstrap.js:312` 💬 → `scheduler/autonomous`

### `session/` → `runtime/session/` — 64 MISSING refs (31 code) in 28 files

- `harness/parity/worktree/create.js:7` ✅code → `../../../session/fleet/index.js`
- `harness/parity/worktree/create.js:8` ✅code → `../../../workgraph/session/index.js`
- `integrations/providers/profiles/_internal.js:5` 💬 → `session/fleet/_internal.js`
- `integrations/providers/routing/_internal.js:4` 💬 → `session/fleet/_internal.js`
- `mind/brain/hot/index.js:105` 💬 → `source/session/op`
- `mind/brain/search/mmr.js:15` 💬 → `session/prefix`
- `mind/brain/search/mmr.js:57` ✅code → `session/prefix`
- `runtime/context/offload/history.js:8` 💬 → `workgraph/session/store.js`
- `runtime/context/viking/session.js:5` 💬 → `//session/`
- `runtime/context/viking/session.js:8` 💬 → `//session/`
- `runtime/context/viking/session.js:9` 💬 → `//session/`
- `runtime/context/viking/session.js:10` 💬 → `//session/`
- `runtime/context/viking/session.js:13` 💬 → `//session/`
- `runtime/kernel/daemon/codegraph-daemon.js:9` 💬 → `session/watcher`
- `server/bundles/manifest.json:1048` ✅code → `session/session-checkpoint-policy`
- `server/bundles/manifest.json:1055` ✅code → `session/session-persistence`
- `server/bundles/manifest.json:1062` ✅code → `session/session-persistence-jsonl`
- `server/bundles/manifest.json:1069` ✅code → `session/session-persistence-sqlite`
- `server/bundles/manifest.json:1076` ✅code → `session/session-projection`
- `server/bundles/manifest.json:1083` ✅code → `session/session-projection-cache`
- `server/bundles/manifest.json:1090` ✅code → `session/session-stats`
- `server/bundles/manifest.json:1097` ✅code → `session/session-telemetry`
- `server/bundles/manifest.json:1104` ✅code → `session/session-telemetry-otel`
- `server/bundles/manifest.json:1111` ✅code → `session/session-title`
- `server/bundles/manifest.json:1118` ✅code → `session/session-title-all-prompts-llm`
- `server/bundles/manifest.json:1125` ✅code → `session/session-title-first-prompt-llm`
- `server/bundles/manifest.json:1132` ✅code → `session/session-title-llm`
- `server/src/memory/index.js:5` 💬 → `working/session/episodic/semantic`
- `server/src/providers/adapters/base.js:4` 💬 → `session/fetch`
- `server/src/services/AcpServer.js:11` 💬 → `session/new`
- `server/src/services/AcpServer.js:12` 💬 → `session/prompt`
- `server/src/services/AcpServer.js:13` 💬 → `session/cancel`
- `server/src/services/AcpServer.js:14` 💬 → `session/delete`
- `server/src/services/AcpServer.js:49` ✅code → `session/new`
- `server/src/services/AcpServer.js:55` ✅code → `session/delete`
- `server/src/services/AcpServer.js:60` ✅code → `session/cancel`
- `server/src/services/AcpServer.js:63` ✅code → `session/prompt`
- `server/src/services/EventLog.js:42` ✅code → `session/title`
- `server/src/services/SessionCheckpoints.js:3` 💬 → `packages/session/session-checkpoint-policy`
- `server/src/services/SessionPersistenceSqlite.js:3` 💬 → `packages/session/session-persistence-sqlite`
- `server/src/services/SessionProjection.js:2` 💬 → `packages/session/session-projection`
- `server/src/services/SessionStats.js:2` 💬 → `packages/session/session-stats`
- `server/src/services/SessionTitles.js:2` 💬 → `packages/session/session-title`
- `server/src/services/SessionTitles.js:12` 💬 → `session/title`
- `server/src/services/Telemetry.js:2` 💬 → `packages/session/session-telemetry`
- `server/src/services/TmuxContext.js:6` 💬 → `session/pane`
- `server/src/services/ToolRegistry.js:269` ✅code → `session/workspace`
- `server/src/wiring/phase31-bootstrap.js:20` 💬 → `session/fleet`
- `server/src/wiring/phase31-bootstrap.js:57` ✅code → `../../../session/fleet/index.js`
- `server/src/wiring/phase31-bootstrap.js:245` 💬 → `session/fleet`
- `server/test-b78.js:5` 💬 → `ts/type/session/payload`
- `server/test-b78.js:6` 💬 → `session/type/limit`
- `server/test-b78.js:63` ✅code → `ts/type/session/payload`
- `server/test-dsh-batch3.js:38` ✅code → `session/new`
- `server/test-dsh-batch3.js:39` ✅code → `session/new`
- `server/test-dsh-batch3.js:40` ✅code → `session/new`
- `server/test-dsh-batch3.js:42` ✅code → `session/prompt`
- `server/test-dsh-batch3.js:44` ✅code → `session/delete`
- `server/test-dsh-batch3.js:45` ✅code → `session/delete`
- `server/test-dsh-batch5.js:4` 💬 → `session/session-projection`
- `server/test-dsh-fidelity.js:9` 💬 → `session/title`
- `server/test-dsh-fidelity.js:67` ✅code → `session/title`
- `server/test-lifecycle.js:3` 💬 → `agent-loop/session/system-prompt`
- `services/surfsense/connectors/_internal.js:4` 💬 → `session/fleet/_internal.js`

### `workgraph/` → `runtime/workgraph/` — 12 MISSING refs (8 code) in 7 files

- `capabilities/commands/checkpoint.command.js:23` ✅code → `src/workgraph/index.js`
- `capabilities/commands/checkpoint.command.js:24` ✅code → `src/workgraph/state/checkpoint.js`
- `capabilities/commands/checkpoint.command.js:26` ✅code → `workgraph/state/checkpoint.js`
- `capabilities/commands/checkpoint.command.js:29` ✅code → `workgraph/index.js`
- `capabilities/commands/doctor.command.js:74` ✅code → `src/workgraph/state/checkpoint.js`
- `harness/parity/worktree/create.js:8` ✅code → `../../../workgraph/session/index.js`
- `runtime/context/offload/history.js:4` 💬 → `workgraph/session`
- `runtime/context/offload/history.js:8` 💬 → `workgraph/session/store.js`
- `server/src/wiring/phase31-bootstrap.js:68` ✅code → `../../../workgraph/phases/gsd/index.js`
- `server/src/wiring/phase31-bootstrap.js:368` 💬 → `workgraph/phases/gsd`
- `services/research/constraints/read-only.js:22` ✅code → `research/workgraph/`
- `services/research/workgraph/experiment-node.js:1` 💬 → `research/workgraph/experiment-node.js`

### `runtimes/` → `runtime/runtimes/` — 15 MISSING refs (9 code) in 9 files

- `runtime/runtimes/browser/engine.js:358` 💬 → `runtimes/sandbox.`
- `runtime/runtimes/browser/fallback.js:34` ✅code → `runtimes/browser/README.md`
- `runtime/runtimes/browser/vision/index.js:8` 💬 → `../runtimes/browser/vision/index.js`
- `runtime/runtimes/sandbox/compose.yaml:9` 💬 → `runtimes/sandbox/dual-network.js`
- `security/exec-bridge/audit.js:5` 💬 → `runtimes/sandbox/audit.js`
- `security/exec-bridge/audit.js:11` ✅code → `../../runtimes/sandbox/audit.js`
- `security/exec-bridge/index.js:34` ✅code → `../../runtimes/sandbox`
- `security/exec-bridge/index.js:34` ✅code → `runtimes/sandbox/`
- `security/exec-bridge/index.js:93` ✅code → `../../runtimes/sandbox/index.js`
- `security/pipeline/orchestration/durable-workflow.js:103` ✅code → `runtimes/sandbox`
- `services/research/constraints/read-only.js:33` ✅code → `runtimes/browser/`
- `tests/verification/visual/puppeteer-runner.js:10` 💬 → `runtimes/browser/`
- `tests/verification/visual/puppeteer-runner.js:115` 💬 → `runtimes/browser/`
- `tests/verification/visual/puppeteer-runner.js:121` ✅code → `runtimes/browser/`
- `tests/verification/visual/puppeteer-runner.js:128` ✅code → `runtimes/browser/`

### `router/` → `runtime/router/` — 2 MISSING refs (0 code) in 2 files

- `agents/workforce/registry/resolve.js:4` 💬 → `router/README`
- `runtime/router/resolve.js:12` 💬 → `./router/resolve`

### `context/` → `runtime/context/` — 28 MISSING refs (14 code) in 16 files

- `runtime/context/offload/file.js:73` 💬 → `context/viking/filesystem.js`
- `runtime/context/offload/index.js:12` 💬 → `context/viking/filesystem.js`
- `runtime/context/offload/index.js:51` 💬 → `../context/offload/index.js`
- `runtime/context/offload/index.js:74` 💬 → `../context/offload/index.js`
- `runtime/runtimes/browser/actions/registry.js:264` ✅code → `context/i.test`
- `server/bundles/manifest.json:425` ✅code → `context/agent-instructions`
- `server/bundles/manifest.json:432` ✅code → `context/file-reference`
- `server/bundles/manifest.json:439` ✅code → `context/file-reference-local`
- `server/bundles/manifest.json:446` ✅code → `context/session-reference`
- `server/bundles/manifest.json:453` ✅code → `context/time-context`
- `server/bundles/manifest.json:460` ✅code → `context/tmux-context`
- `server/src/providers/catalog/WorkerRouter.js:102` ✅code → `context/.test`
- `server/src/services/AgentInstructions.js:2` 💬 → `packages/context/agent-instructions`
- `server/src/services/FileReference.js:2` 💬 → `packages/context/file-reference`
- `server/src/services/FileReference.js:3` 💬 → `packages/context/file-reference-local`
- `server/src/services/SessionReference.js:3` 💬 → `packages/context/session-reference`
- `server/src/services/TimeContext.js:3` 💬 → `packages/context/time-context`
- `server/src/services/TmuxContext.js:2` 💬 → `packages/context/tmux-context`
- `server/src/wiring/phase31-bootstrap.js:60` ✅code → `../../../context/viking/filesystem.js`
- `server/src/wiring/phase31-bootstrap.js:67` ✅code → `../../../context/offload/index.js`
- `server/src/wiring/phase31-bootstrap.js:347` 💬 → `context/offload`
- `server/src/wiring/phase31-bootstrap.js:366` ✅code → `context/offload`
- `server/test-commands.js:275` ✅code → `context/.test`
- `server/test-dsh-batch14.js:6` 💬 → `context/file-reference`
- `server/test-dsh-batch14.js:57` ✅code → `context/file-reference`
- `server/test-dsh-batch5.js:5` 💬 → `context/agent-instructions`
- `server/test-dsh-batch7.js:8` 💬 → `context/tmux-context`
- `services/research/constraints/read-only.js:34` ✅code → `context/viking/`

### `events/` → `runtime/events/` — 64 MISSING refs (24 code) in 27 files

- `.github/workflows/docker-image.yml:23` 💬 → `events/hud`
- `.github/workflows/docker-image.yml:24` 💬 → `/app/events/hud`
- `.github/workflows/docker-image.yml:25` ✅code → `events/hud`
- `.github/workflows/docker-image.yml:28` ✅code → `events/hud`
- `.github/workflows/docker-publish.yml:21` ✅code → `events/`
- `Dockerfile.slim:52` 💬 → `events/`
- `agents/workforce/narration/index.js:27` ✅code → `../../events/chat/taxonomy.js`
- `capabilities/commands/_context.js:5` 💬 → `events/hud/`
- `capabilities/commands/_context.js:10` 💬 → `events/hud/producer.js`
- `capabilities/commands/_context.js:18` 💬 → `events/hud/producer.js`
- `capabilities/commands/_context.js:22` 💬 → `../events/hud/`
- `capabilities/commands/_context.js:23` 💬 → `../events/hud/`
- `capabilities/commands/_context.js:24` 💬 → `events/hud`
- `capabilities/commands/_context.js:73` 💬 → `events/hud`
- `capabilities/commands/_context.js:97` ✅code → `events/hud/producer.js`
- `capabilities/commands/cost-report.command.js:5` 💬 → `events/hud/producer.js`
- `capabilities/commands/cost-report.command.js:25` ✅code → `events/hud`
- `capabilities/commands/cost-report.command.js:25` ✅code → `events/hud/producer.js`
- `capabilities/commands/cost-report.command.js:79` ✅code → `events/hud/producer.js`
- `capabilities/commands/status.command.js:4` 💬 → `events/hud/producer.js`
- `capabilities/commands/status.command.js:27` ✅code → `events/hud`
- `capabilities/prompts/anti-patterns/index.js:35` 💬 → `events/`
- `interfaces/ui/web/console/chat/approvals.js:24` ✅code → `../../../../events/chat/taxonomy.js`
- `interfaces/ui/web/console/chat/router.js:61` ✅code → `../../../../events/chat/taxonomy.js`
- `mind/intelligence/layers/_shared.js:30` ✅code → `../../events/provenance/label.js`
- `mind/intelligence/trust-pipeline/broker.js:40` ✅code → `../../events/provenance/label.js`
- `mind/intelligence/trust-pipeline/broker.js:190` 💬 → `events/provenance/label.js`
- `runtime/events/hud/index.js:4` 💬 → `events/hud/index.js`
- `runtime/events/hud/index.js:5` 💬 → `events/hud/schema.js`
- `runtime/events/hud/index.js:6` 💬 → `events/hud/validator.js`
- `runtime/events/hud/index.js:7` 💬 → `events/hud/producer.js`
- `runtime/events/hud/index.js:8` 💬 → `events/hud/consumer.js`
- `runtime/events/provenance/label.js:4` 💬 → `events/provenance/`
- `server/index.js:1597` ✅code → `id/events/stream`
- `server/src/kernel/hooks/hud-seam.js:12` 💬 → `events/hud/`
- `server/src/kernel/hooks/hud-seam.js:13` 💬 → `events/hud/`
- `server/src/kernel/hooks/hud-seam.js:22` 💬 → `/events/hud`
- `server/src/kernel/hooks/hud-seam.js:22` 💬 → `/app/events/hud`
- `server/src/providers/catalog/ModelRouter.js:82` 💬 → `events/UI`
- `server/src/routes/hud.js:4` 💬 → `events/hud/`
- `server/src/routes/hud.js:11` 💬 → `events/hud/`
- `server/src/routes/hud.js:13` 💬 → `events/hud`
- `server/src/routes/hud.js:15` 💬 → `events/hud`
- `server/src/routes/hud.js:22` 💬 → `/events/hud`
- `server/src/routes/hud.js:22` 💬 → `/app/events/hud`
- `server/src/routes/hud.js:31` ✅code → `events/hud`
- `server/src/routes/hud.js:39` 💬 → `events/hud`
- `server/src/routes/missionStream.js:12` 💬 → `id/events/stream.`
- `server/src/services/director/ObjectiveInterpreter.js:154` 💬 → `events/UI`
- `server/test-b224.js:39` ✅code → `id/events/stream`
- `server/test-b224.js:183` ✅code → `id/events/stream`
- `server/test-dsh-batch12.js:5` 💬 → `slots/sessions/workspaces/events/tz/baseline`
- `server/test-dsh-batch12.js:105` ✅code → `slots/sessions/workspaces/events/tz/baseline`
- `server/test-hud.js:14` ✅code → `../events/hud/schema.js`
- `server/test-hud.js:15` ✅code → `../events/hud/validator.js`
- `server/test-hud.js:19` ✅code → `../events/hud/index.js`
- `services/computer/events/emit.js:1` 💬 → `computer/events/emit.js`
- `services/computer/events/index.js:1` 💬 → `computer/events/index.js`
- `services/computer/events/index.js:9` 💬 → `events/chat/taxonomy.js`
- `services/computer/events/index.js:18` ✅code → `../../events/chat/taxonomy.js`
- `services/computer/events/map.js:1` 💬 → `computer/events/map.js`
- `services/computer/events/map.js:6` 💬 → `events/chat/taxonomy.js`
- `services/computer/events/map.js:54` ✅code → `../../events/chat/taxonomy.js`
- `services/research/constraints/read-only.js:40` ✅code → `events/hud/`

### `brain/` → `mind/brain/` — 37 MISSING refs (21 code) in 17 files

- `mind/brain/index/chunker.js:25` ✅code → `brain/repo`
- `mind/brain/index/index.js:4` 💬 → `../brain/index/index.js`
- `mind/brain/index/index.js:5` 💬 → `brain/repo`
- `mind/brain/index/index.js:31` ✅code → `brain/repo`
- `mind/brain/kg/extract-cli.js:3` 💬 → `brain/kg/extract-cli.js`
- `mind/brain/kg/extract-cli.js:14` ✅code → `brain/kg/extract-cli.js`
- `mind/brain/kg/extractor.js:62` ✅code → `brain/repo`
- `mind/brain/kg/index.js:5` 💬 → `../brain/kg/index.js`
- `mind/brain/kg/index.js:8` 💬 → `brain/kg`
- `mind/brain/repo/index.js:4` 💬 → `../brain/repo/index.js`
- `mind/brain/search/hybrid.js:49` ✅code → `brain/index`
- `mind/brain/search/hybrid.js:52` ✅code → `brain/repo`
- `mind/brain/search/index.js:4` 💬 → `../brain/search/index.js`
- `mind/brain/search/rerank/index.js:7` 💬 → `brain/`
- `mind/brain/self/composer.js:2` 💬 → `brain/self/composer.js`
- `mind/brain/self/guard.js:2` 💬 → `brain/self/guard.js`
- `mind/brain/self/guard.js:80` ✅code → `brain/self/core.md`
- `mind/brain/self/index.js:2` 💬 → `brain/self`
- `mind/brain/self/index.js:38` ✅code → `brain/self/core.md`
- `mind/brain/self/reflex.js:2` 💬 → `brain/self/reflex.js`
- `mind/brain/self/validate.js:2` 💬 → `brain/self/validate.js`
- `server/src/services/JexiIdentity.js:28` ✅code → `../../../brain/self/index.js`
- `server/src/services/JexiIdentity.js:28` ✅code → `brain/self/core.md`
- `server/src/services/JexiIdentity.js:31` 💬 → `brain/self/core.md`
- `server/src/wiring/phase31-bootstrap.js:50` ✅code → `../../../brain/repo/index.js`
- `server/src/wiring/phase31-bootstrap.js:51` ✅code → `../../../brain/index/index.js`
- `server/src/wiring/phase31-bootstrap.js:52` ✅code → `../../../brain/search/index.js`
- `server/src/wiring/phase31-bootstrap.js:53` ✅code → `../../../brain/hot/index.js`
- `server/src/wiring/phase31-bootstrap.js:54` ✅code → `../../../brain/protocol/index.js`
- `server/src/wiring/phase31-bootstrap.js:62` ✅code → `../../../brain/hot/mcp-meta.js`
- `server/src/wiring/phase31-bootstrap.js:66` ✅code → `../../../brain/cycle/index.js`
- `server/src/wiring/phase31-bootstrap.js:100` ✅code → `../../../brain/self/index.js`
- `server/src/wiring/phase31-bootstrap.js:623` 💬 → `brain/self/core.md`
- `server/src/wiring/phase31-bootstrap.js:627` ✅code → `brain/self/core.md`
- `server/src/wiring/phase31-bootstrap.js:632` ✅code → `brain/self/core.md`
- `server/test-identity.js:8` ✅code → `../brain/self/index.js`
- `server/test-identity.js:10` 💬 → `brain/self/core.md`

### `memory/` → `mind/memory/` — 35 MISSING refs (20 code) in 25 files

- `Dockerfile.slim:69` 💬 → `memory/history`
- `capabilities/graph/rag/graph-rag.js:26` 💬 → `memory/`
- `capabilities/graph/rag/index.js:5` 💬 → `memory/`
- `harness/hardening/ralph/ci-doctor.js:101` ✅code → `memory/i`
- `interfaces/ui/preview/console.html:343` 💬 → `agents/sessions/memory/skills/etc.`
- `mind/memory/hybrid-search.js:27` 💬 → `memory/lifecycle.js`
- `runtime/context/viking/compile.js:9` 💬 → `memory/knowledge-graph.js`
- `runtime/context/viking/compile.js:20` ✅code → `../../memory/knowledge-graph.js`
- `server/src/config.js:7` 💬 → `memory/knowledge`
- `server/src/memory/index.js:9` 💬 → `./memory/index.js`
- `server/src/memory/index.js:23` ✅code → `../../../memory/hybrid-search.js`
- `server/src/memory/index.js:24` ✅code → `../../../memory/lifecycle.js`
- `server/src/memory/index.js:25` ✅code → `../../../memory/confidence.js`
- `server/src/services/AnswerSanitizer.js:27` ✅code → `memory/gi`
- `server/src/services/ExternalProviders.js:157` ✅code → `memory/tools/MCPs/agents.`
- `server/src/services/JexiMarketProvider.js:10` 💬 → `memory/tools/MCPs.`
- `server/src/services/MCPGateway.js:144` ✅code → `/sys/fs/cgroup/memory/memory.limit_in_bytes`
- `server/src/services/MCPGateway.js:159` ✅code → `/sys/fs/cgroup/memory/memory.limit_in_bytes`
- `server/src/services/MCPGateway.js:161` ✅code → `/sys/fs/cgroup/memory/memory.usage_in_bytes`
- `server/src/services/Orchestrator.js:696` 💬 → `memory/knowledge`
- `server/src/services/Orchestrator.js:899` 💬 → `memory/process`
- `server/src/services/PlanMode.js:76` 💬 → `memory/knowledge/search`
- `server/src/services/Planner.js:363` ✅code → `memory/i.test`
- `server/src/services/SimpleTask.js:37` 💬 → `memory/answer-focused`
- `server/src/services/ToolRegistry.js:53` ✅code → `memory/knowledge`
- `server/src/services/ToolRegistry.js:252` ✅code → `CPU/memory/timeout`
- `server/src/services/ToolRuntime.js:1307` 💬 → `terminal/web/memory/git/github/testing/data/`
- `server/src/services/ToolRuntime.js:1547` ✅code → `memory/knowledge`
- `server/src/services/ToolRuntime.js:1579` 💬 → `memory/knowledge`
- `server/src/workforce/registry/catalog.js:262` ✅code → `CPU/memory/network`
- `server/test-audit-b48.js:65` ✅code → `memory/continuity`
- `server/test-b217.js:166` ✅code → `memory/identity.json`
- `server/test-b223.js:121` ✅code → `memory/knowledge`
- `server/test-b51.js:61` ✅code → `memory/i.test`
- `server/test-dsh-batch6.js:144` ✅code → `uptime/memory/node`

### `instincts/` → `mind/instincts/` — 3 MISSING refs (1 code) in 3 files

- `mind/instincts/core/index.js:12` 💬 → `/instincts/`
- `mind/instincts/store/store.js:5` 💬 → `instincts/`
- `server/src/wiring/phase31-bootstrap.js:56` ✅code → `../../../instincts/observe/index.js`

### `learning/` → `mind/learning/` — 35 MISSING refs (14 code) in 13 files

- `capabilities/commands/_context.js:4` 💬 → `learning/`
- `capabilities/commands/_context.js:12` 💬 → `learning/analyzer.js`
- `capabilities/commands/doctor.command.js:95` ✅code → `learning/store.js`
- `capabilities/commands/doctor.command.js:96` ✅code → `learning/`
- `capabilities/commands/learn.command.js:4` 💬 → `learning/analyzer.js`
- `capabilities/commands/learn.command.js:22` ✅code → `learning/analyzer.js`
- `capabilities/commands/learn.command.js:24` ✅code → `learning/`
- `capabilities/commands/learn.command.js:24` ✅code → `learning/analyzer.js`
- `capabilities/commands/learn.command.js:64` ✅code → `learning/analyzer.js`
- `mind/learning/analyzer.js:14` 💬 → `learning/instinct.js`
- `mind/learning/index.js:8` 💬 → `$JEXI_HOME/learning/global.jsonl`
- `mind/learning/index.js:19` 💬 → `learning/index.js`
- `mind/learning/index.js:20` 💬 → `learning/index.js`
- `mind/learning/index.js:21` 💬 → `learning/index.js`
- `mind/learning/index.js:22` 💬 → `learning/index.js`
- `mind/learning/index.js:23` 💬 → `learning/index.js`
- `mind/learning/index.js:24` 💬 → `learning/index.js`
- `mind/learning/store.js:6` 💬 → `$JEXI_HOME/learning/global.jsonl`
- `mind/learning/store.js:21` 💬 → `learning/`
- `runtime/events/hud/schema.js:9` 💬 → `learning/`
- `server/src/context/sources/index.js:99` 💬 → `learning/`
- `server/src/context/sources/index.js:100` 💬 → `learning/`
- `server/src/context/sources/index.js:107` ✅code → `../../../../learning/index.js`
- `server/src/kernel/hooks/learning-seam.js:11` 💬 → `learning/`
- `server/src/kernel/hooks/learning-seam.js:12` 💬 → `learning/`
- `server/src/providers/catalog/Telemetry.js:4` 💬 → `learning/training`
- `server/src/services/Planner.js:411` 💬 → `learning/research`
- `server/test-learning.js:16` ✅code → `../learning/instinct.js`
- `server/test-learning.js:19` ✅code → `../learning/store.js`
- `server/test-learning.js:21` ✅code → `../learning/observer.js`
- `server/test-learning.js:23` ✅code → `../learning/analyzer.js`
- `server/test-learning.js:24` ✅code → `../learning/promoter.js`
- `server/test-learning.js:25` ✅code → `../learning/index.js`
- `server/test-learning.js:194` ✅code → `learning/`
- `server/test-planner-routing.js:177` 💬 → `learning/news/research`

### `knowledge/` → `mind/knowledge/` — 11 MISSING refs (7 code) in 11 files

- `mind/knowledge/index.js:12` 💬 → `knowledge/index.js`
- `security/pipeline/phases/exploitation.phase.js:30` ✅code → `../../../knowledge/index.js`
- `security/pipeline/phases/recon.phase.js:16` ✅code → `../../../knowledge/index.js`
- `security/pipeline/phases/reporting.phase.js:27` ✅code → `../../../knowledge/index.js`
- `security/pipeline/phases/verification.phase.js:32` ✅code → `../../../knowledge/index.js`
- `server/scripts/gen-plugins.js:2` 💬 → `knowledge/capability`
- `server/src/services/Orchestrator.js:1035` ✅code → `knowledge/i`
- `server/src/services/PlanMode.js:76` 💬 → `memory/knowledge/search`
- `server/test-b51.js:10` 💬 → `knowledge/skills`
- `server/test-b53.js:240` ✅code → `knowledge/JEXI.md`
- `tests/verification/verifiers/exploit.verifier.js:38` ✅code → `../../knowledge/index.js`

### `intelligence/` → `mind/intelligence/` — 27 MISSING refs (6 code) in 18 files

- `interfaces/ui/preview/globe.html:14` ✅code → `intelligence/trust-pipeline/`
- `interfaces/ui/preview/globe.html:189` ✅code → `intelligence/layers/index.js`
- `interfaces/ui/preview/globe.html:274` ✅code → `intelligence/trust-pipeline/registered-urls.js.`
- `interfaces/ui/preview/globe.html:300` ✅code → `intelligence/trust-pipeline/registered-urls.js`
- `interfaces/ui/preview/globe.html:403` ✅code → `intelligence/layers/index.js`
- `mind/intelligence/layers/_shared.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/_shared.js:225` ✅code → `intelligence/trust-pipeline/registered-urls.js`
- `mind/intelligence/layers/astronomy.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/bikeshare.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/cameras.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/cameras.layer.js:13` 💬 → `intelligence/trust-pipeline/`
- `mind/intelligence/layers/earthquakes.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/fires.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/flights.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/index.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/index.js:7` 💬 → `intelligence/trust-pipeline/registered-urls.js`
- `mind/intelligence/layers/launches.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/marine.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/marine.layer.js:12` 💬 → `intelligence/trust-pipeline/`
- `mind/intelligence/layers/radio.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/satellites.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/ships.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/traffic.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/weather.layer.js:4` 💬 → `intelligence/layers/`
- `mind/intelligence/layers/weather.layer.js:11` 💬 → `intelligence/trust-pipeline/`
- `runtime/events/provenance/label.js:316` 💬 → `intelligence/trust-pipeline/broker.js.`
- `runtime/events/provenance/schema.js:10` 💬 → `intelligence/trust-pipeline/registered-urls.js`

### `agents/` → `agents/catalog/` — 25 MISSING refs (10 code) in 21 files

- `agents/workforce/agents/index.js:4` 💬 → `./workforce/agents/index.js`
- `agents/workforce/agents/index.js:10` 💬 → `./workforce/agents/index.js`
- `agents/workforce/agents/loader.js:10` 💬 → `workforce/agents/vendor/agency-agents.specs.json`
- `agents/workforce/agents/loader.js:231` ✅code → `workforce/agents/vendor/agency-agents.specs.json`
- `agents/workforce/registry/catalog.js:14` 💬 → `agents/meta/_template.md`
- `harness/adapters/_base.adapter.js:145` 💬 → `agents/commands/rules`
- `harness/adapters/index.js:64` 💬 → `agents/rules/skills/hooks/commands/mcp`
- `harness/parity/subagent/contract.js:2` ✅code → `../../../workforce/agents/agent-spec.js`
- `interfaces/console/components/console/views/PluginsView.jsx:6` ✅code → `agents/tools/skills`
- `interfaces/ui/preview/console.html:343` 💬 → `agents/sessions/memory/skills/etc.`
- `mind/brain/self/reflex.js:108` 💬 → `agents/roles`
- `server/agents/profiles/orchestrator/config.yaml:19` ✅code → `agents/orchestrator/memory.jsonl`
- `server/index.js:1124` 💬 → `agents/skills/tools`
- `server/src/services/AcpServer.js:5` 💬 → `agents/tools`
- `server/src/services/JexiPrompt.js:65` ✅code → `agents/skills/tools`
- `server/src/services/Planner.js:10` 💬 → `agents/tools`
- `server/src/services/Planner.js:567` ✅code → `agents/i.test`
- `server/src/services/ProfileCompleteness.js:15` 💬 → `agents/profiles/.`
- `server/src/services/director/MissionRunner.js:23` ✅code → `missions/agents/verification`
- `server/src/workforce/registry/index.js:318` 💬 → `agents/skills`
- `server/test-b206b.js:15` 💬 → `narrations/agents/by`
- `server/test-b206b.js:199` ✅code → `/agents/.test`
- `server/test-b49.js:3` 💬 → `agents/skills/tools`
- `server/test-identity.js:38` ✅code → `agents/.test`
- `server/test-roster-registry.js:83` ✅code → `agents/skills`

### `workforce/` → `agents/workforce/` — 48 MISSING refs (16 code) in 25 files

- `.github/workflows/docker-publish.yml:23` ✅code → `workforce/`
- `.github/workflows/validate-divisions.yml:3` 💬 → `workforce/divisions.json`
- `.github/workflows/validate-divisions.yml:13` ✅code → `workforce/divisions.json`
- `.github/workflows/validate-divisions.yml:19` ✅code → `workforce/divisions.json`
- `Dockerfile.slim:53` 💬 → `workforce/`
- `agents/workforce/agents/index.js:4` 💬 → `./workforce/agents/index.js`
- `agents/workforce/agents/index.js:10` 💬 → `./workforce/agents/index.js`
- `agents/workforce/agents/loader.js:10` 💬 → `workforce/agents/vendor/agency-agents.specs.json`
- `agents/workforce/agents/loader.js:231` ✅code → `workforce/agents/vendor/agency-agents.specs.json`
- `agents/workforce/agents/registry.js:33` ✅code → `workforce/divisions.json`
- `agents/workforce/agents/registry.js:36` 💬 → `workforce/divisions.json`
- `agents/workforce/divisions/division.js:5` 💬 → `workforce/divisions.json`
- `agents/workforce/divisions/division.js:61` 💬 → `workforce/divisions.json`
- `agents/workforce/divisions/division.js:80` ✅code → `workforce/divisions.json`
- `agents/workforce/divisions/index.js:4` 💬 → `./workforce/divisions/index.js`
- `agents/workforce/divisions/index.js:12` 💬 → `./workforce/divisions/index.js`
- `agents/workforce/divisions/registry.js:4` 💬 → `workforce/divisions.json`
- `agents/workforce/divisions/registry.js:39` ✅code → `workforce/divisions.json`
- `agents/workforce/divisions/registry.js:41` 💬 → `workforce/divisions.json.`
- `agents/workforce/identity/graph.js:45` ✅code → `workforce/identity/state`
- `agents/workforce/identity/graph.js:88` 💬 → `/workforce/identity/state`
- `agents/workforce/identity/index.js:4` 💬 → `./workforce/identity/index.js`
- `agents/workforce/identity/index.js:21` 💬 → `./workforce/identity/index.js`
- `agents/workforce/nexus/docs.js:8` 💬 → `workforce/nexus/vendor/agency-agents.strategies.json`
- `agents/workforce/nexus/docs.js:32` ✅code → `workforce/nexus/vendor/agency-agents.strategies.json`
- `agents/workforce/nexus/index.js:4` 💬 → `./workforce/nexus/index.js`
- `agents/workforce/nexus/index.js:11` 💬 → `./workforce/nexus/index.js`
- `agents/workforce/registry/index.js:4` 💬 → `./workforce/registry`
- `agents/workforce/registry/index.js:5` 💬 → `./workforce/registry`
- `agents/workforce/registry/index.js:9` 💬 → `workforce/divisions.json`
- `agents/workforce/registry/index.js:73` 💬 → `workforce/divisions.json`
- `agents/workforce/trust/index.js:4` 💬 → `./workforce/trust/index.js`
- `agents/workforce/trust/index.js:27` 💬 → `workforce/trust/state/trust-seq.txt`
- `harness/adapters/_convert.js:123` 💬 → `workforce/coworkers/`
- `harness/adapters/_convert.js:124` ✅code → `workforce/coworkers`
- `harness/adapters/_convert.js:125` ✅code → `workforce/coworkers`
- `harness/parity/subagent/contract.js:2` ✅code → `../../../workforce/agents/agent-spec.js`
- `interfaces/ui/web/console/chat/router.js:64` ✅code → `../../../../workforce/narration/index.js`
- `interfaces/ui/web/console/chat/runtime.js:58` ✅code → `../../../../workforce/narration/index.js`
- `runtime/router/resolve.js:15` 💬 → `workforce/registry`
- `runtime/router/resolve.js:19` ✅code → `../workforce/registry/index.js`
- `security/shield/index.js:105` 💬 → `workforce/.`
- `server/src/services/director/Employees.js:35` 💬 → `workforce/registry/catalog.js`
- `server/src/services/director/Employees.js:36` 💬 → `workforce/registry/index.js`
- `server/src/verification/verifiers/AgentVerifier.js:5` 💬 → `workforce/registry`
- `server/src/workforce/registry/catalog.js:7` 💬 → `workforce/registry/index.js`
- `server/src/workforce/registry/catalog.js:10` 💬 → `workforce/registry/index.js`
- `services/research/constraints/read-only.js:38` ✅code → `workforce/divisions.json`

### `swarm/` → `agents/swarm/` — 13 MISSING refs (5 code) in 9 files

- `agents/swarm/consensus/_internal.js:4` 💬 → `swarm/consensus/`
- `agents/swarm/hive/index.js:4` 💬 → `swarm/hive/index.js`
- `agents/swarm/topologies/_internal.js:4` 💬 → `swarm/topologies/`
- `server/src/wiring/phase31-bootstrap.js:69` ✅code → `../../../swarm/loops/looper.js`
- `server/src/wiring/phase31-bootstrap.js:70` ✅code → `../../../swarm/loops/ralph.js`
- `server/src/wiring/phase31-bootstrap.js:392` ✅code → `swarm/loops/looper.run`
- `server/src/wiring/phase31-bootstrap.js:395` 💬 → `swarm/loops/ralph.js`
- `server/src/wiring/phase31-wa4-topology.js:7` 💬 → `swarm/topologies/`
- `server/src/wiring/phase31-wa4-topology.js:19` ✅code → `../../../swarm/topologies/index.js`
- `services/research/constraints/read-only.js:24` ✅code → `research/swarm/`
- `services/research/swarm/dedup.js:1` 💬 → `research/swarm/dedup.js`
- `services/research/swarm/research-swarm.js:1` 💬 → `research/swarm/research-swarm.js`
- `services/research/swarm/shared-frontier.js:1` 💬 → `research/swarm/shared-frontier.js`

### `jexi-agents/` → `agents/jexi/` — 13 MISSING refs (4 code) in 8 files

- `harness/adapters/_convert.js:65` 💬 → `jexi-agents/coworkers/`
- `harness/adapters/_convert.js:66` ✅code → `jexi-agents/coworkers`
- `harness/adapters/_convert.js:68` ✅code → `jexi-agents/coworkers`
- `security/shield/index.js:105` 💬 → `jexi-agents/`
- `server/eslint.config.js:21` ✅code → `jexi-agents/`
- `server/src/services/CoworkerFiles.js:5` 💬 → `/jexi-agents/`
- `server/src/services/CoworkerFiles.js:8` 💬 → `jexi-agents/`
- `server/src/services/Orchestrator.js:924` 💬 → `jexi-agents/coworkers/github.md`
- `server/src/services/SimpleTask.js:85` 💬 → `jexi-agents/coworkers/`
- `server/test-b78.js:8` 💬 → `jexi-agents/`
- `server/test-b78.js:93` 💬 → `jexi-agents/`
- `server/test-b78.js:95` ✅code → `jexi-agents/`
- `server/tests/b78CoworkersChild.js:7` 💬 → `jexi-agents/`

### `tools/` → `capabilities/tools/` — 60 MISSING refs (25 code) in 36 files

- `.github/workflows/ci.yml:36` ✅code → `tools/registry/audit.js`
- `agents/workforce/registry/resolve.js:9` 💬 → `id/name/description/tools/division.`
- `capabilities/graph/code/graph-first.js:26` 💬 → `tools/domains/lsp/_graph.js`
- `capabilities/graph/code/mcp-server.js:5` 💬 → `tools/list`
- `capabilities/graph/code/mcp-server.js:5` 💬 → `tools/call.`
- `capabilities/graph/code/mcp-server.js:6` 💬 → `tools/list`
- `capabilities/graph/code/mcp-server.js:7` 💬 → `tools/call`
- `capabilities/graph/code/mcp-server.js:71` ✅code → `tools/list`
- `capabilities/graph/code/mcp-server.js:74` ✅code → `tools/call`
- `capabilities/graph/doctor/index.js:8` 💬 → `tools/list`
- `capabilities/graph/doctor/index.js:72` ✅code → `tools/domains/lsp/_graph.js`
- `capabilities/graph/doctor/index.js:73` ✅code → `tools/domains/lsp/check-index-coverage.tool.js`
- `capabilities/graph/doctor/index.js:164` ✅code → `tools/list`
- `capabilities/graph/internet/reach/mcp-server.js:157` ✅code → `tools/list`
- `capabilities/graph/internet/reach/mcp-server.js:160` ✅code → `tools/call`
- `capabilities/prompts/tools/budget.js:1` 💬 → `prompt/tools/budget.js`
- `capabilities/prompts/tools/descriptions.js:1` 💬 → `prompt/tools/descriptions.js`
- `capabilities/prompts/tools/descriptions.js:12` 💬 → `tools/domains/lsp/`
- `capabilities/prompts/tools/index.js:1` 💬 → `prompt/tools/index.js`
- `capabilities/tools/registry/audit.js:3` 💬 → `tools/registry/audit.js`
- `capabilities/tools/registry/audit.js:9` 💬 → `tools/registry/audit.js`
- `capabilities/tools/registry/audit.js:13` 💬 → `tools/registry/audit.js`
- `capabilities/tools/registry/audit.js:14` 💬 → `tools/registry/audit.js`
- `capabilities/tools/registry/governance.js:2` 💬 → `tools/registry/governance.js`
- `interfaces/ui/web/console/chat/toolcards.js:25` 💬 → `web/app/src/components/tools/approval-card.`
- `runtime/runtimes/browser/actions/registry.js:4` 💬 → `tools/registry/service.py`
- `security/shield/permission-scanner.js:41` 💬 → `tools/permissions.`
- `server/examples/acp-demo.mjs:20` ✅code → `tools/list`
- `server/examples/jsonrpc-demo.mjs:22` ✅code → `tools/list`
- `server/mcp-server.js:13` 💬 → `tools/resources`
- `server/mcp/registry.json:909` ✅code → `tools/list`
- `server/mcp/tool-directory.json:5773` ✅code → `tools/list`
- `server/src/services/AgentLoop.js:80` 💬 → `intent/teamSlugs/steps/tools/toolsLine`
- `server/src/services/ArchitectureViews.js:8` 💬 → `tools/skills/lifecycle`
- `server/src/services/CodeModeRuntime.js:3` 💬 → `packages/core/tools/src/code-mode.ts`
- `server/src/services/CodeModeRuntime.js:4` 💬 → `packages/core/tools/src/ts-types.ts`
- `server/src/services/ExternalProviders.js:157` ✅code → `memory/tools/MCPs/agents.`
- `server/src/services/JexiMarketProvider.js:10` 💬 → `memory/tools/MCPs.`
- `server/src/services/PlanMode.js:20` ✅code → `tools/agents`
- `server/src/services/PluginInventory.js:21` 💬 → `tools/skills`
- `server/src/services/WebSearch.js:553` ✅code → `tools/call`
- `server/src/services/WebSearch.js:560` 💬 → `tools/call`
- `server/src/tools/registry/ToolRegistry.js:52` 💬 → `tools/`
- `server/test-b208.js:5` 💬 → `LLM/tools/departments`
- `server/test-dsh-batch13.js:172` ✅code → `tools/list`
- `server/test-dsh-batch13.js:173` ✅code → `tools/list`
- `server/test-mcp.js:3` 💬 → `tools/list`
- `server/test-mcp.js:50` ✅code → `tools/list`
- `server/test-mcp.js:52` ✅code → `tools/list`
- `server/test-mcp.js:60` ✅code → `tools/call`
- `server/test-mcp.js:62` ✅code → `tools/call`
- `server/test-mcp.js:65` ✅code → `tools/call`
- `server/test-plugin-seam.js:3` 💬 → `tools/skills/events`
- `server/test-plugins-all.js:6` 💬 → `tools/skills`
- `server/test-support/acp-snapshot.js:10` 💬 → `tools/list`
- `server/test-unified-providers.js:322` ✅code → `system/tools/roles`
- `skills/aas/mcp-server.js:9` 💬 → `tools/list`
- `skills/aas/mcp-server.js:10` 💬 → `tools/call`
- `skills/aas/mcp-server.js:99` ✅code → `tools/list`
- `skills/aas/mcp-server.js:103` ✅code → `tools/call`

### `commands/` → `capabilities/commands/` — 30 MISSING refs (13 code) in 17 files

- `.github/workflows/docker-image.yml:32` ✅code → `commands/`
- `.github/workflows/docker-image.yml:35` ✅code → `commands/.`
- `.github/workflows/docker-publish.yml:19` ✅code → `commands/`
- `capabilities/commands/_context.js:22` 💬 → `/commands/`
- `capabilities/commands/_context.js:23` 💬 → `/app/commands/`
- `capabilities/commands/_context.js:24` 💬 → `commands/`
- `capabilities/commands/index.js:7` 💬 → `./commands/index.js`
- `capabilities/graph/doctor/cli.js:7` 💬 → `commands/doctor.command.js`
- `capabilities/graph/doctor/index.js:11` 💬 → `commands/doctor.command.js`
- `harness/adapters/_convert.js:242` ✅code → `commands/index.js`
- `harness/adapters/_convert.js:247` ✅code → `commands/index.js`
- `harness/adapters/index.js:64` 💬 → `agents/rules/skills/hooks/commands/mcp`
- `server/cli.js:143` 💬 → `commands/`
- `server/index.js:1845` 💬 → `commands/`
- `server/src/commands-seam.js:4` 💬 → `commands/`
- `server/src/commands-seam.js:5` 💬 → `commands/`
- `server/src/commands-seam.js:9` 💬 → `/commands/index.js`
- `server/src/commands-seam.js:10` 💬 → `/app/commands/index.js`
- `server/src/commands-seam.js:11` 💬 → `commands/`
- `server/src/commands-seam.js:44` ✅code → `commands/`
- `server/src/services/director/Verifier.js:107` ✅code → `commands/tests`
- `server/src/wiring/phase31-bootstrap.js:602` 💬 → `commands/registry.js`
- `server/src/wiring/phase31-hooks.js:21` 💬 → `commands/registry.js`
- `server/src/wiring/phase31-hooks.js:101` 💬 → `commands/registry.js`
- `server/test-b213.js:143` ✅code → `commands/tests`
- `server/test-commands.js:273` ✅code → `commands/`
- `server/test-commands.js:275` ✅code → `commands/`
- `server/test-commands.js:277` ✅code → `commands/.test`
- `server/test-commands.js:277` ✅code → `commands/`
- `services/research/constraints/read-only.js:39` ✅code → `commands/registry.js`

### `plugins/` → `capabilities/plugins/` — 8 MISSING refs (4 code) in 5 files

- `.jexi/config.yaml:8` 💬 → `plugins/`
- `.jexi/plugins.yaml:2` 💬 → `plugins/.`
- `agents/workforce/agents/vendor/agency-agents.specs.json:626` ✅code → `plugins/modules`
- `agents/workforce/agents/vendor/agency-agents.specs.json:627` ✅code → `plugins/modules`
- `server/bundles/manifest.json:386` ✅code → `plugins/python-run`
- `server/bundles/manifest.json:596` ✅code → `plugins/agent-team`
- `server/test-dsh-batch14.js:9` 💬 → `plugins/agent-team`
- `server/test-dsh-batch14.js:10` 💬 → `plugins/python-run`

### `prompt/` → `capabilities/prompts/` — 77 MISSING refs (7 code) in 43 files

- `capabilities/prompts/anti-patterns/index.js:1` 💬 → `prompt/anti-patterns/index.js`
- `capabilities/prompts/anti-patterns/index.js:32` 💬 → `prompt/assembly`
- `capabilities/prompts/anti-patterns/index.js:33` 💬 → `prompt/versioning`
- `capabilities/prompts/anti-patterns/lint.js:1` 💬 → `prompt/anti-patterns/lint.js`
- `capabilities/prompts/anti-patterns/rules.js:1` 💬 → `prompt/anti-patterns/rules.js`
- `capabilities/prompts/anti-patterns/rules.js:28` 💬 → `prompt/versioning`
- `capabilities/prompts/assembly/boundary.js:1` 💬 → `prompt/assembly/boundary.js`
- `capabilities/prompts/assembly/errors.js:1` 💬 → `prompt/assembly/errors.js`
- `capabilities/prompts/assembly/errors.js:7` 💬 → `prompt/`
- `capabilities/prompts/assembly/order.js:1` 💬 → `prompt/assembly/order.js`
- `capabilities/prompts/assembly/registry.js:1` 💬 → `prompt/assembly/registry.js`
- `capabilities/prompts/constitution/constraints.js:1` 💬 → `prompt/constitution/constraints.js`
- `capabilities/prompts/constitution/escalation.js:1` 💬 → `prompt/constitution/escalation.js`
- `capabilities/prompts/constitution/index.js:1` 💬 → `prompt/constitution/index.js`
- `capabilities/prompts/constitution/output-format.js:1` 💬 → `prompt/constitution/output-format.js`
- `capabilities/prompts/constitution/scope.js:1` 💬 → `prompt/constitution/scope.js`
- `capabilities/prompts/constitution/template.js:1` 💬 → `prompt/constitution/template.js`
- `capabilities/prompts/incidents/index.js:1` 💬 → `prompt/incidents/index.js`
- `capabilities/prompts/incidents/index.js:33` 💬 → `prompt/assembly`
- `capabilities/prompts/incidents/index.js:33` 💬 → `prompt/constitution`
- `capabilities/prompts/incidents/index.js:33` 💬 → `prompt/tools`
- `capabilities/prompts/incidents/index.js:34` 💬 → `prompt/memory-fs`
- `capabilities/prompts/incidents/log.js:1` 💬 → `prompt/incidents/log.js`
- `capabilities/prompts/incidents/log.js:32` 💬 → `prompt/incidents`
- `capabilities/prompts/incidents/log.js:33` 💬 → `prompt/assembly`
- `capabilities/prompts/incidents/log.js:40` 💬 → `/prompt/incidents/log.js`
- `capabilities/prompts/incidents/negative-shots.js:1` 💬 → `prompt/incidents/negative-shots.js`
- `capabilities/prompts/incidents/negative-shots.js:6` 💬 → `prompt/assembly`
- `capabilities/prompts/incidents/promote.js:1` 💬 → `prompt/incidents/promote.js`
- `capabilities/prompts/memory-fs/epistemic.js:1` 💬 → `prompt/memory-fs/epistemic.js`
- `capabilities/prompts/memory-fs/epistemic.js:38` 💬 → `prompt/memory-fs/`
- `capabilities/prompts/memory-fs/index.js:1` 💬 → `prompt/memory-fs/index.js`
- `capabilities/prompts/memory-fs/privacy-blacklist.js:1` 💬 → `prompt/memory-fs/privacy-blacklist.js`
- `capabilities/prompts/memory-fs/privacy-blacklist.js:59` 💬 → `prompt/memory-fs/`
- `capabilities/prompts/memory-fs/read-rules.js:1` 💬 → `prompt/memory-fs/read-rules.js`
- `capabilities/prompts/memory-fs/tree.js:1` 💬 → `prompt/memory-fs/tree.js`
- `capabilities/prompts/memory-fs/tree.js:24` 💬 → `prompt/assembly/`
- `capabilities/prompts/memory-fs/tree.js:26` 💬 → `prompt/assembly`
- `capabilities/prompts/memory-fs/tree.js:38` 💬 → `/prompt/memory-fs/tree.js`
- `capabilities/prompts/memory-fs/write-rules.js:1` 💬 → `prompt/memory-fs/write-rules.js`
- `capabilities/prompts/sections/08-instructions.js:1` 💬 → `prompt/sections/08-instructions.js`
- `capabilities/prompts/testing/assertions.js:1` 💬 → `prompt/testing/assertions.js`
- `capabilities/prompts/testing/framework.js:1` 💬 → `prompt/testing/framework.js`
- `capabilities/prompts/testing/index.js:1` 💬 → `prompt/testing/index.js`
- `capabilities/prompts/testing/registry.js:1` 💬 → `prompt/testing/registry.js`
- `capabilities/prompts/tools/budget.js:1` 💬 → `prompt/tools/budget.js`
- `capabilities/prompts/tools/budget.js:18` 💬 → `prompt/assembly/boundary.js`
- `capabilities/prompts/tools/descriptions.js:1` 💬 → `prompt/tools/descriptions.js`
- `capabilities/prompts/tools/descriptions.js:18` 💬 → `prompt/`
- `capabilities/prompts/tools/index.js:1` 💬 → `prompt/tools/index.js`
- `capabilities/prompts/versioning/diff.js:1` 💬 → `prompt/versioning/diff.js`
- `capabilities/prompts/versioning/index.js:1` 💬 → `prompt/versioning/index.js`
- `capabilities/prompts/versioning/index.js:29` 💬 → `prompt/assembly`
- `capabilities/prompts/versioning/index.js:29` 💬 → `prompt/constitution`
- `capabilities/prompts/versioning/index.js:29` 💬 → `prompt/tools`
- `capabilities/prompts/versioning/index.js:30` 💬 → `prompt/memory-fs`
- `capabilities/prompts/versioning/index.js:30` 💬 → `prompt/incidents`
- `capabilities/prompts/versioning/rollback.js:1` 💬 → `prompt/versioning/rollback.js`
- `capabilities/prompts/versioning/snapshot.js:1` 💬 → `prompt/versioning/snapshot.js`
- `capabilities/prompts/versioning/snapshot.js:21` 💬 → `prompt/testing`
- `capabilities/prompts/versioning/snapshot.js:30` 💬 → `prompt/assembly`
- `capabilities/prompts/versioning/snapshot.js:30` 💬 → `prompt/constitution`
- `capabilities/prompts/versioning/snapshot.js:30` 💬 → `prompt/tools`
- `capabilities/prompts/versioning/snapshot.js:31` 💬 → `prompt/memory-fs`
- `capabilities/prompts/versioning/snapshot.js:31` 💬 → `prompt/incidents`
- `capabilities/prompts/versioning/snapshot.js:40` 💬 → `/prompt/versioning/snapshot.js`
- `harness/parity/rules/rules.js:5` ✅code → `../../../prompt/sections/08-instructions.js`
- `runtime/rlm/kernel/context-variable.js:1` 💬 → `prompt/data`
- `server/src/kernel/hooks/hud-seam.js:52` 💬 → `prompt/completion`
- `server/src/services/GuardrailAgent.js:24` ✅code → `prompt/i`
- `server/src/services/director/ImaginationEngine.js:13` 💬 → `prompt/output`
- `server/test-audit-b48.js:316` 💬 → `loop/prompt/graph`
- `server/test-b197.js:82` ✅code → `//image.pollinations.ai/prompt/cat`
- `server/test-b197.js:86` ✅code → `//image.pollinations.ai/prompt/cat`
- `server/test-b197.js:97` ✅code → `//image.pollinations.ai/prompt/a`
- `server/test-b197.js:108` ✅code → `//image.pollinations.ai/prompt/a`
- `server/test-presenter.js:102` ✅code → `//image.pollinations.ai/prompt/`

### `lsp/` → `capabilities/lsp/` — 9 MISSING refs (5 code) in 6 files

- `capabilities/graph/code/graph-first.js:26` 💬 → `tools/domains/lsp/_graph.js`
- `capabilities/graph/doctor/index.js:72` ✅code → `tools/domains/lsp/_graph.js`
- `capabilities/graph/doctor/index.js:73` ✅code → `tools/domains/lsp/check-index-coverage.tool.js`
- `capabilities/prompts/tools/descriptions.js:12` 💬 → `tools/domains/lsp/`
- `server/bundles/manifest.json:908` ✅code → `lsp/lsp`
- `server/bundles/manifest.json:915` ✅code → `lsp/lsp-stdio`
- `server/bundles/manifest.json:922` ✅code → `lsp/tool-lsp`
- `server/plugins/lsp/plugin.js:2` 💬 → `packages/lsp/tool-lsp`
- `server/src/services/ToolRuntime.js:1308` 💬 → `delegation/lsp/communication`

### `capability/` → `capabilities/graph/` — 42 MISSING refs (26 code) in 23 files

- `agents/workforce/registry/resolve.js:7` 💬 → `capability/role`
- `capabilities/graph/code/graph-first.js:30` 💬 → `capability/.`
- `capabilities/graph/code/mcp-server.js:7` 💬 → `capability/code/graph`
- `capabilities/graph/code/mcp-server.js:10` 💬 → `capability/code/graph/db`
- `capabilities/graph/context-hook.js:1` 💬 → `capability/context-hook.js`
- `capabilities/graph/context-hook.js:18` ✅code → `capability/code/graph-first`
- `capabilities/graph/doctor/cli.js:3` 💬 → `capability/doctor/cli.js`
- `capabilities/graph/doctor/cli.js:4` 💬 → `capability/doctor/cli.js`
- `capabilities/graph/doctor/index.js:102` ✅code → `capability/internet/reach/doctor.js`
- `capabilities/graph/doctor/index.js:103` ✅code → `capability/internet/reach/channels/index.js`
- `capabilities/graph/doctor/index.js:104` ✅code → `capability/internet/reach/config.js`
- `capabilities/graph/doctor/index.js:183` ✅code → `capability/code/mcp-server.js`
- `capabilities/graph/doctor/index.js:184` ✅code → `capability/internet/reach/mcp-server.js`
- `capabilities/graph/internet/reach/doctor.js:47` 💬 → `capability/internet/reach/doctor.js`
- `capabilities/graph/rag/index.js:2` 💬 → `capability/rag`
- `capabilities/graph/rag/index.js:7` 💬 → `./capability/rag/index.js`
- `capabilities/tools/domains/lsp/_graph.js:8` ✅code → `../../../capability/code/graph/store.js`
- `capabilities/tools/domains/lsp/_graph.js:9` ✅code → `../../../capability/code/graph/pipeline/tree-sitter.js`
- `capabilities/tools/domains/lsp/_graph.js:32` ✅code → `capability/code/graph/db`
- `capabilities/tools/domains/lsp/get-code-snippet.tool.js:13` ✅code → `capability/code/graph/store.js`
- `capabilities/tools/domains/lsp/get-graph-schema.tool.js:4` ✅code → `../../../capability/code/graph/nodes/index.js`
- `capabilities/tools/domains/lsp/get-graph-schema.tool.js:5` ✅code → `../../../capability/code/graph/edges/index.js`
- `capabilities/tools/domains/lsp/index-repository.tool.js:5` ✅code → `../../../capability/code/graph/index.js`
- `runtime/context/offload/index.js:14` 💬 → `capability/code/graph-first.js`
- `runtime/kernel/daemon/client.js:15` ✅code → `capability/code/graph/db`
- `runtime/kernel/daemon/codegraph-daemon.js:24` ✅code → `capability/code/graph/db`
- `runtime/kernel/daemon/codegraph-daemon.js:224` ✅code → `../../capability/code/graph/store.js`
- `server/mcp/registry.json:871` ✅code → `capability/code/mcp-server.js`
- `server/mcp/registry.json:878` ✅code → `capability/code/graph/db.`
- `server/mcp/registry.json:886` ✅code → `capability/internet/reach/mcp-server.js`
- `server/mcp/tool-directory.json:13669` ✅code → `capability/code/graph/store.js`
- `server/src/capability/doctor/index.js:5` 💬 → `capability/doctor/index.js`
- `server/src/capability/doctor/preflight.js:4` 💬 → `capability/doctor`
- `server/src/wiring/phase31-bootstrap.js:59` ✅code → `../../../capability/code/graph-first.js`
- `services/research/constraints/read-only.js:31` ✅code → `capability/`
- `services/surfsense/search/hybrid.js:11` 💬 → `capability/rag/graph-rag.js`
- `services/surfsense/search/hybrid.js:35` 💬 → `capability/rag`
- `services/surfsense/search/hybrid.js:39` ✅code → `../../capability/rag/graph-rag.js`
- `services/surfsense/search/hybrid.js:45` ✅code → `capability/rag/graph-rag`
- `services/surfsense/search/hybrid.js:46` ✅code → `capability/rag/graph-rag`
- `services/surfsense/search/hybrid.js:91` ✅code → `capability/rag`
- `services/surfsense/search/index.js:10` 💬 → `capability/rag`

### `semantica/` → `services/semantica/` — 124 MISSING refs (110 code) in 106 files

- `benchmarks/_meta/cost.js:24` ✅code → `../../semantica/_internal.js`
- `benchmarks/_meta/index.js:34` ✅code → `../../semantica/_internal.js`
- `benchmarks/_meta/manifest.js:23` ✅code → `../../semantica/_internal.js`
- `benchmarks/_meta/result.js:51` ✅code → `../../semantica/_internal.js`
- `benchmarks/_meta/trace.js:29` ✅code → `../../semantica/_internal.js`
- `harness/hardening/forgejo/taxonomy.js:20` 💬 → `semantica/_internal.js`
- `harness/hardening/forgejo/taxonomy.js:27` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/forgejo/transport.js:32` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/madtea/atomic-finish.js:59` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/madtea/credentials.js:21` 💬 → `semantica/_internal.js`
- `harness/hardening/madtea/credentials.js:27` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/madtea/gates.js:30` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/ralph/add-context.js:30` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/ralph/ci-doctor.js:35` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/ralph/diagnostics.js:41` 💬 → `semantica/_internal.js`
- `harness/hardening/ralph/diagnostics.js:45` ✅code → `../../../semantica/_internal.js`
- `harness/hardening/ralph/index.js:16` 💬 → `semantica/_internal.js`
- `harness/parity/hooks/registry.js:3` ✅code → `../../../semantica/_internal.js`
- `harness/parity/lifecycle/permission-denied.js:2` ✅code → `../../../semantica/_internal.js`
- `harness/parity/lifecycle/post-tool-batch.js:2` ✅code → `../../../semantica/_internal.js`
- `harness/parity/lifecycle/prompt-expansion.js:2` ✅code → `../../../semantica/_internal.js`
- `harness/parity/rules/injection.js:2` ✅code → `../../../semantica/_internal.js`
- `harness/parity/rules/rules.js:4` ✅code → `../../../semantica/_internal.js`
- `harness/parity/self-evolve/audit.js:2` ✅code → `../../../semantica/_internal.js`
- `harness/parity/self-evolve/audit.js:3` ✅code → `../../../semantica/decisions/index.js`
- `harness/parity/self-evolve/audit.js:4` ✅code → `../../../semantica/provenance/index.js`
- `harness/parity/self-evolve/evolve.js:4` ✅code → `../../../semantica/_internal.js`
- `harness/parity/self-evolve/guardrail.js:5` ✅code → `../../../semantica/_internal.js`
- `harness/parity/skills/enforcement.js:5` ✅code → `../../../semantica/_internal.js`
- `harness/parity/skills/scoping.js:3` ✅code → `../../../semantica/_internal.js`
- `harness/parity/subagent/enforcement.js:2` ✅code → `../../../semantica/_internal.js`
- `harness/parity/worktree/cleanup.js:4` ✅code → `../../../semantica/_internal.js`
- `harness/parity/worktree/create.js:6` ✅code → `../../../semantica/_internal.js`
- `harness/parity/worktree/hooks.js:2` ✅code → `../../../semantica/_internal.js`
- `integrations/providers/routing/repo-context.js:9` 💬 → `semantica/repo-map`
- `integrations/providers/routing/repo-context.js:31` 💬 → `repo-root/semantica/repo-map/index.js`
- `integrations/providers/routing/repo-context.js:69` ✅code → `semantica/repo-map`
- `integrations/providers/routing/repo-context.js:76` ✅code → `semantica/repo-map`
- `mind/brain/ambient/ambient/boundary.js:6` ✅code → `../../../semantica/_internal.js`
- `mind/brain/ambient/ambient/context-pack.js:9` ✅code → `../../../semantica/_internal.js`
- `mind/brain/ambient/ambient/delta.js:6` ✅code → `../../../semantica/_internal.js`
- `mind/brain/ambient/reflex/pointer.js:8` ✅code → `../../../semantica/_internal.js`
- `mind/brain/cycle/budget.js:2` ✅code → `../../semantica/_internal.js`
- `mind/brain/cycle/cycle.js:6` ✅code → `../../semantica/_internal.js`
- `mind/brain/cycle/phases/lint.js:2` ✅code → `../../../semantica/_internal.js`
- `mind/brain/evals/brainbench.js:2` ✅code → `../../semantica/_internal.js`
- `mind/brain/evals/corpus.js:7` ✅code → `../../semantica/_internal.js`
- `mind/brain/evals/metrics.js:2` ✅code → `../../semantica/_internal.js`
- `mind/brain/hot/decay.js:11` ✅code → `../../semantica/_internal.js`
- `mind/brain/hot/extract-facts.js:12` ✅code → `../../semantica/_internal.js`
- `mind/brain/hot/index.js:15` ✅code → `../../semantica/_internal.js`
- `mind/brain/hot/kinds.js:6` ✅code → `../../semantica/_internal.js`
- `mind/brain/hot/mcp-meta.js:10` ✅code → `../../semantica/_internal.js`
- `mind/brain/hot/recall.js:5` ✅code → `../../semantica/_internal.js`
- `mind/brain/hot/supersession.js:8` ✅code → `../../semantica/_internal.js`
- `mind/brain/index/backends/provider.js:11` ✅code → `../../../semantica/_internal.js`
- `mind/brain/index/embedder.js:8` ✅code → `../../semantica/_internal.js`
- `mind/brain/index/index.js:23` ✅code → `../../semantica/_internal.js`
- `mind/brain/index/vector-store.js:11` ✅code → `../../semantica/_internal.js`
- `mind/brain/kg/extractor.js:13` ✅code → `../../semantica/_internal.js`
- `mind/brain/kg/frontmatter.js:12` ✅code → `../../semantica/_internal.js`
- `mind/brain/kg/verb-inference.js:12` ✅code → `../../semantica/_internal.js`
- `mind/brain/kg/watermark.js:14` ✅code → `../../semantica/_internal.js`
- `mind/brain/multi/acl.js:2` ✅code → `../../semantica/_internal.js`
- `mind/brain/multi/index.js:10` ✅code → `../../semantica/_internal.js`
- `mind/brain/multi/isolation.js:6` ✅code → `../../semantica/_internal.js`
- `mind/brain/multi/soft-delete.js:2` ✅code → `../../semantica/_internal.js`
- `mind/brain/multi/source.js:7` ✅code → `../../semantica/_internal.js`
- `mind/brain/protocol/conformance.js:5` ✅code → `../../semantica/_internal.js`
- `mind/brain/protocol/errors.js:5` ✅code → `../../semantica/_internal.js`
- `mind/brain/protocol/index.js:7` ✅code → `../../semantica/_internal.js`
- `mind/brain/publish/html.js:2` ✅code → `../../semantica/_internal.js`
- `mind/brain/publish/index.js:4` ✅code → `../../semantica/_internal.js`
- `mind/brain/repo/compiled-truth.js:9` ✅code → `../../semantica/_internal.js`
- `mind/brain/repo/index.js:21` ✅code → `../../semantica/_internal.js`
- `mind/brain/repo/layout.js:9` ✅code → `../../semantica/_internal.js`
- `mind/brain/repo/page.js:8` ✅code → `../../semantica/_internal.js`
- `mind/brain/repo/schema.js:13` ✅code → `../../semantica/_internal.js`
- `mind/brain/repo/timeline.js:9` ✅code → `../../semantica/_internal.js`
- `mind/brain/search/hybrid.js:14` ✅code → `../../semantica/_internal.js`
- `mind/brain/search/recency-decay.js:8` ✅code → `../../semantica/_internal.js`
- `mind/brain/search/rerank/backends/cross-encoder.js:13` ✅code → `../../../../semantica/_internal.js`
- `mind/brain/search/rerank/budget.js:9` ✅code → `../../../semantica/_internal.js`
- `mind/brain/search/rerank/index.js:16` ✅code → `../../../semantica/_internal.js`
- `mind/brain/search/rerank/interface.js:8` ✅code → `../../../semantica/_internal.js`
- `mind/brain/self/composer.js:21` ✅code → `../../semantica/_internal.js`
- `mind/brain/self/guard.js:19` ✅code → `../../semantica/_internal.js`
- `mind/brain/self/reflex.js:24` ✅code → `../../semantica/_internal.js`
- `mind/brain/self/validate.js:15` ✅code → `../../semantica/_internal.js`
- `mind/instincts/core/confidence.js:20` ✅code → `../../semantica/_internal.js`
- `mind/instincts/core/index.js:18` ✅code → `../../semantica/_internal.js`
- `mind/instincts/core/index.js:53` ✅code → `../../semantica/_internal.js`
- `mind/instincts/core/schema.js:13` ✅code → `../../semantica/_internal.js`
- `mind/instincts/evolve/cluster.js:20` ✅code → `../../semantica/_internal.js`
- `mind/instincts/evolve/evolve.js:13` ✅code → `../../semantica/_internal.js`
- `mind/instincts/evolve/index.js:13` ✅code → `../../semantica/_internal.js`
- `mind/instincts/evolve/index.js:42` ✅code → `../../semantica/_internal.js`
- `mind/instincts/io/import.js:26` ✅code → `../../semantica/_internal.js`
- `mind/instincts/io/index.js:13` ✅code → `../../semantica/_internal.js`
- `mind/instincts/io/index.js:34` ✅code → `../../semantica/_internal.js`
- `mind/instincts/observe/hook.js:15` ✅code → `../../semantica/_internal.js`
- `mind/instincts/observe/index.js:21` ✅code → `../../semantica/_internal.js`
- `mind/instincts/observe/index.js:75` ✅code → `../../semantica/_internal.js`
- `mind/instincts/observe/queue.js:13` ✅code → `../../semantica/_internal.js`
- `mind/instincts/observe/scope.js:11` ✅code → `../../semantica/_internal.js`
- `mind/instincts/prune/index.js:13` ✅code → `../../semantica/_internal.js`
- `mind/instincts/prune/index.js:33` ✅code → `../../semantica/_internal.js`
- `mind/instincts/prune/ttl.js:13` ✅code → `../../semantica/_internal.js`
- `mind/instincts/store/index.js:15` ✅code → `../../semantica/_internal.js`
- `mind/instincts/store/index.js:37` ✅code → `../../semantica/_internal.js`
- `mind/instincts/store/query.js:12` ✅code → `../../semantica/_internal.js`
- `mind/instincts/store/store.js:25` ✅code → `../../semantica/_internal.js`
- `server/src/wiring/phase31-bootstrap.js:55` ✅code → `../../../semantica/graph/index.js`
- `server/src/wiring/phase31-bootstrap.js:484` 💬 → `semantica/repo-map`
- `server/src/wiring/phase31-bootstrap.js:502` ✅code → `semantica/repo-map`
- `server/src/wiring/phase31-repoctx.js:2` 💬 → `semantica/repo-map`
- `server/src/wiring/phase31-repoctx.js:4` 💬 → `semantica/repo-map`
- `server/src/wiring/phase31-repoctx.js:14` ✅code → `../../../semantica/repo-map/index.js`
- `server/src/wiring/phase31-self-evolve.js:25` ✅code → `../../../semantica/decisions/index.js`
- `services/semantica/decisions/index.js:4` 💬 → `./semantica/decisions/index.js`
- `services/semantica/graph/index.js:4` 💬 → `./semantica/graph/index.js`
- `services/semantica/ontology/index.js:4` 💬 → `./semantica/ontology/index.js`
- `services/semantica/provenance/index.js:4` 💬 → `./semantica/provenance/index.js`
- `services/semantica/reasoning/index.js:4` 💬 → `./semantica/reasoning/index.js`

### `surfsense/` → `services/surfsense/` — 18 MISSING refs (3 code) in 10 files

- `mind/brain/index/backends/rule-based.js:10` ✅code → `../../../surfsense/connectors/local-search.js`
- `mind/brain/index/chunker.js:13` ✅code → `../../surfsense/connectors/local-search.js`
- `mind/brain/search/keyword.js:8` ✅code → `../../surfsense/search/keyword.js`
- `services/surfsense/output/formats.js:8` 💬 → `surfsense/search`
- `services/surfsense/output/formats.js:63` 💬 → `surfsense/connectors/local-search.js`
- `services/surfsense/output/index.js:2` 💬 → `surfsense/output`
- `services/surfsense/output/index.js:16` 💬 → `surfsense/connectors/_internal.js`
- `services/surfsense/output/index.js:23` 💬 → `surfsense/search/keyword.js`
- `services/surfsense/podcast/index.js:2` 💬 → `surfsense/podcast`
- `services/surfsense/podcast/index.js:25` 💬 → `surfsense/connectors/_internal.js`
- `services/surfsense/podcast/index.js:26` 💬 → `surfsense/search/keyword.js`
- `services/surfsense/podcast/index.js:27` 💬 → `surfsense/output/formats.js`
- `services/surfsense/podcast/script.js:17` 💬 → `surfsense/connectors/_internal.js`
- `services/surfsense/podcast/script.js:24` 💬 → `surfsense/search/keyword.js`
- `services/surfsense/podcast/segment.js:24` 💬 → `surfsense/output/formats.js`
- `services/surfsense/search/index.js:2` 💬 → `surfsense/search`
- `services/surfsense/search/index.js:16` 💬 → `surfsense/connectors/_internal.js`
- `services/surfsense/search/keyword.js:10` 💬 → `surfsense/connectors/local-search.js`

### `research/` → `services/research/` — 66 MISSING refs (27 code) in 36 files

- `agents/workforce/agents/vendor/agency-agents.specs.json:3275` ✅code → `research/research-synthesist.md`
- `server/scripts/audit-roster.js:233` 💬 → `research/news`
- `server/src/providers/catalog/ModelRouting.js:8` 💬 → `research/study`
- `server/src/services/DomainRegistry.js:62` ✅code → `research/i`
- `server/src/services/JexiIdentity.js:100` ✅code → `research/coding/vision`
- `server/src/services/MCPGateway.js:13` 💬 → `research/MCP.md`
- `server/src/services/Orchestrator.js:579` 💬 → `research/describe`
- `server/src/services/Planner.js:98` 💬 → `news/research/study`
- `server/src/services/Planner.js:170` 💬 → `research/web-search`
- `server/src/services/Planner.js:484` ✅code → `research/direct_answer.`
- `server/src/services/Planner.js:755` 💬 → `research/current-events`
- `server/src/services/Planner.js:787` 💬 → `search/research/current-events/multi-source`
- `server/src/services/ProfileCompleteness.js:4` 💬 → `orchestrator/dev/research/comms/scheduler`
- `server/src/services/TeamRouter.js:37` ✅code → `research/analysis`
- `server/src/services/director/Director.js:123` 💬 → `research/build`
- `server/test-auto-mode.js:5` 💬 → `code_task/research/news`
- `server/test-b52.js:102` 💬 → `research/study`
- `server/test-b52.js:118` 💬 → `research/study`
- `server/test-b52.js:124` ✅code → `research/study`
- `server/test-dsh-research.js:86` ✅code → `research/i.test`
- `server/test-planner-routing.js:161` 💬 → `research/current-events`
- `services/research/budget/cost.js:1` 💬 → `research/budget/cost.js`
- `services/research/budget/wall-clock.js:1` 💬 → `research/budget/wall-clock.js`
- `services/research/constraints/guards.js:1` 💬 → `research/constraints/guards.js`
- `services/research/constraints/guards.js:16` 💬 → `/abs/research/fixtures/toy-target/train.js`
- `services/research/constraints/mutable.js:1` 💬 → `research/constraints/mutable.js`
- `services/research/constraints/read-only.js:1` 💬 → `research/constraints/read-only.js`
- `services/research/constraints/read-only.js:10` ✅code → `research/fixtures/toy-target/data.js`
- `services/research/constraints/read-only.js:11` ✅code → `research/fixtures/toy-target/train.js`
- `services/research/constraints/read-only.js:13` ✅code → `research/program/program.md`
- `services/research/constraints/read-only.js:15` ✅code → `research/constraints/`
- `services/research/constraints/read-only.js:16` ✅code → `research/program/parse.js`
- `services/research/constraints/read-only.js:17` ✅code → `research/program/load.js`
- `services/research/constraints/read-only.js:18` ✅code → `research/program/load.js.map`
- `services/research/constraints/read-only.js:19` ✅code → `research/budget/`
- `services/research/constraints/read-only.js:20` ✅code → `research/tracking/results.tsv`
- `services/research/constraints/read-only.js:21` ✅code → `research/tracking/results.tsv.bak`
- `services/research/constraints/read-only.js:22` ✅code → `research/workgraph/`
- `services/research/constraints/read-only.js:23` ✅code → `research/simplicity/`
- `services/research/constraints/read-only.js:24` ✅code → `research/swarm/`
- `services/research/constraints/read-only.js:25` ✅code → `research/templates/`
- `services/research/constraints/read-only.js:26` ✅code → `research/overnight.js`
- `services/research/constraints/read-only.js:27` ✅code → `research/loop/`
- `services/research/constraints/read-only.js:44` ✅code → `research/fixtures/toy-target/candidate.js`
- `services/research/constraints/read-only.js:48` ✅code → `research/.probes/`
- `services/research/loop/experiment-loop.js:1` 💬 → `research/loop/experiment-loop.js`
- `services/research/loop/lifecycle.js:1` 💬 → `research/loop/lifecycle.js`
- `services/research/loop/lifecycle.js:9` 💬 → `research/tracking`
- `services/research/loop/lifecycle.js:10` 💬 → `research/budget`
- `services/research/loop/scheduler.js:1` 💬 → `research/loop/scheduler.js`
- `services/research/overnight.js:1` 💬 → `research/overnight.js`
- `services/research/overnight.js:5` 💬 → `research/loop`
- `services/research/program/load.js:1` 💬 → `research/program/load.js`
- `services/research/program/parse.js:1` 💬 → `research/program/parse.js`
- `services/research/simplicity/scorer.js:1` 💬 → `research/simplicity/scorer.js`
- `services/research/swarm/dedup.js:1` 💬 → `research/swarm/dedup.js`
- `services/research/swarm/research-swarm.js:1` 💬 → `research/swarm/research-swarm.js`
- `services/research/swarm/shared-frontier.js:1` 💬 → `research/swarm/shared-frontier.js`
- `services/research/templates/registry.js:1` 💬 → `research/templates/registry.js`
- `services/research/templates/template.skill.js:1` 💬 → `research/templates/template.skill.js`
- `services/research/tracking/dual.js:1` 💬 → `research/tracking/dual.js`
- `services/research/tracking/frontier.js:1` 💬 → `research/tracking/frontier.js`
- `services/research/tracking/frontier.js:38` ✅code → `/research/.probes/`
- `services/research/tracking/frontier.js:39` ✅code → `research/.probes/`
- `services/research/tracking/log.js:1` 💬 → `research/tracking/log.js`
- `services/research/workgraph/experiment-node.js:1` 💬 → `research/workgraph/experiment-node.js`

### `computer/` → `services/computer/` — 66 MISSING refs (3 code) in 47 files

- `benchmarks/osworld/adapter.js:25` 💬 → `computer/operators`
- `benchmarks/osworld/adapter.js:25` 💬 → `computer/loop`
- `benchmarks/osworld/adapter.js:117` 💬 → `computer/action/space.js`
- `benchmarks/osworld/adapter.js:428` ✅code → `computer/operators`
- `benchmarks/osworld/adapter.js:428` ✅code → `computer/loop`
- `benchmarks/osworld/index.js:24` 💬 → `computer/`
- `benchmarks/webarena/index.js:25` 💬 → `computer/`
- `interfaces/ui/web/console/chat/mount.js:23` 💬 → `computer/events`
- `server/test-b52.js:146` ✅code → `computer/i.test`
- `services/computer/action/coordinate.js:1` 💬 → `computer/action/coordinate.js`
- `services/computer/action/index.js:1` 💬 → `computer/action/index.js`
- `services/computer/action/parser.js:1` 💬 → `computer/action/parser.js`
- `services/computer/action/serializer.js:1` 💬 → `computer/action/serializer.js`
- `services/computer/action/space.js:1` 💬 → `computer/action/space.js`
- `services/computer/errors.js:1` 💬 → `computer/errors.js`
- `services/computer/errors.js:4` 💬 → `computer/`
- `services/computer/errors.js:7` 💬 → `computer/`
- `services/computer/events/emit.js:1` 💬 → `computer/events/emit.js`
- `services/computer/events/index.js:1` 💬 → `computer/events/index.js`
- `services/computer/events/map.js:1` 💬 → `computer/events/map.js`
- `services/computer/loop/gui-agent.js:1` 💬 → `computer/loop/gui-agent.js`
- `services/computer/loop/gui-agent.js:131` 💬 → `computer/`
- `services/computer/loop/index.js:1` 💬 → `computer/loop/index.js`
- `services/computer/loop/state.js:1` 💬 → `computer/loop/state.js`
- `services/computer/modes/index.js:1` 💬 → `computer/modes/index.js`
- `services/computer/modes/modes.js:1` 💬 → `computer/modes/modes.js`
- `services/computer/modes/modes.js:35` 💬 → `computer/errors.js`
- `services/computer/modes/modes.js:224` 💬 → `computer/errors.js`
- `services/computer/modes/schema.js:1` 💬 → `computer/modes/schema.js`
- `services/computer/modes/schema.js:9` 💬 → `computer/modes/modes.js`
- `services/computer/operators/browser-modes.js:1` 💬 → `computer/operators/browser-modes.js`
- `services/computer/operators/browser-modes.js:50` 💬 → `computer/errors.js`
- `services/computer/operators/browser.js:1` 💬 → `computer/operators/browser.js`
- `services/computer/operators/desktop.js:1` 💬 → `computer/operators/desktop.js`
- `services/computer/operators/fake.js:1` 💬 → `computer/operators/fake.js`
- `services/computer/operators/index.js:1` 💬 → `computer/operators/index.js`
- `services/computer/operators/interface.js:1` 💬 → `computer/operators/interface.js`
- `services/computer/remote/index.js:1` 💬 → `computer/remote/index.js`
- `services/computer/remote/operator.js:1` 💬 → `computer/remote/operator.js`
- `services/computer/remote/operator.js:10` 💬 → `computer/operators/desktop.js`
- `services/computer/remote/operator.js:35` 💬 → `computer/`
- `services/computer/remote/vnc.js:1` 💬 → `computer/remote/vnc.js`
- `services/computer/sandbox/client.js:1` 💬 → `computer/sandbox/client.js`
- `services/computer/sandbox/client.js:29` 💬 → `computer/errors.js`
- `services/computer/sandbox/exec.js:1` 💬 → `computer/sandbox/exec.js`
- `services/computer/sandbox/exec.js:7` 💬 → `computer/sandbox/`
- `services/computer/sandbox/health.js:1` 💬 → `computer/sandbox/health.js`
- `services/computer/sandbox/index.js:1` 💬 → `computer/sandbox/index.js`
- `services/computer/screenshot/capture.js:1` 💬 → `computer/screenshot/capture.js`
- `services/computer/screenshot/diff.js:1` 💬 → `computer/screenshot/diff.js`
- `services/computer/screenshot/index.js:1` 💬 → `computer/screenshot/index.js`
- `services/computer/screenshot/optimize.js:1` 💬 → `computer/screenshot/optimize.js`
- `services/computer/tool-call/engine.js:1` 💬 → `computer/tool-call/engine.js`
- `services/computer/tool-call/engine.js:24` 💬 → `computer/`
- `services/computer/tool-call/engine.js:46` 💬 → `computer/errors.js`
- `services/computer/tool-call/index.js:1` 💬 → `computer/tool-call/index.js`
- `services/computer/tool-call/selector.js:1` 💬 → `computer/tool-call/selector.js`
- `services/computer/tool-call/selector.js:24` 💬 → `computer/errors.js`
- `services/computer/tool-call/strategies/native.js:1` 💬 → `computer/tool-call/strategies/native.js`
- `services/computer/tool-call/strategies/prompt.js:1` 💬 → `computer/tool-call/strategies/prompt.js`
- `services/computer/tool-call/strategies/structured.js:1` 💬 → `computer/tool-call/strategies/structured.js`
- `services/computer/vlm/context.js:1` 💬 → `computer/vlm/context.js`
- `services/computer/vlm/index.js:1` 💬 → `computer/vlm/index.js`
- `services/computer/vlm/prompt.js:1` 💬 → `computer/vlm/prompt.js`
- `services/computer/vlm/prompt.js:7` 💬 → `computer/action/space.js`
- `services/computer/vlm/provider.js:1` 💬 → `computer/vlm/provider.js`

### `src/` → `interfaces/console/` — 295 MISSING refs (244 code) in 94 files

- `.github/workflows/ci.yml:39` ✅code → `src/services/`
- `.github/workflows/docker-publish.yml:17` ✅code → `src/`
- `Dockerfile.slim:40` 💬 → `src/services`
- `Dockerfile.slim:50` 💬 → `src/components/ChatWindow.jsx`
- `benchmarks/_fixtures/swebench-pro/mini-instances.json:15` ✅code → `src/slugify.js`
- `capabilities/commands/_context.js:23` 💬 → `../src/`
- `capabilities/commands/_context.js:52` 💬 → `/app/src/services`
- `capabilities/commands/_context.js:92` ✅code → `src/services/Observer.js`
- `capabilities/commands/_context.js:107` ✅code → `src/config.js`
- `capabilities/commands/build-fix.command.js:55` ✅code → `src/services/CodeJudge.js`
- `capabilities/commands/build-fix.command.js:117` ✅code → `src/providers/index.js`
- `capabilities/commands/build-fix.command.js:118` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/build-fix.command.js:121` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/checkpoint.command.js:23` ✅code → `src/workgraph/index.js`
- `capabilities/commands/checkpoint.command.js:24` ✅code → `src/workgraph/state/checkpoint.js`
- `capabilities/commands/checkpoint.command.js:39` ✅code → `src/services/director/Mission.js`
- `capabilities/commands/checkpoint.command.js:46` ✅code → `src/services/PlanStore.js`
- `capabilities/commands/checkpoint.command.js:53` ✅code → `src/services/TodoStore.js`
- `capabilities/commands/code-review.command.js:72` ✅code → `src/services/SubagentRuntime.js`
- `capabilities/commands/code-review.command.js:73` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/code-review.command.js:74` ✅code → `src/providers/index.js`
- `capabilities/commands/code-review.command.js:116` ✅code → `src/services/CodeJudge.js`
- `capabilities/commands/doctor.command.js:45` ✅code → `src/providers/index.js`
- `capabilities/commands/doctor.command.js:46` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/doctor.command.js:67` ✅code → `src/services/StorageHub.js`
- `capabilities/commands/doctor.command.js:74` ✅code → `src/workgraph/state/checkpoint.js`
- `capabilities/commands/doctor.command.js:88` ✅code → `src/services/Observer.js`
- `capabilities/commands/export.command.js:26` ✅code → `src/services/SessionConversations.js`
- `capabilities/commands/export.command.js:47` ✅code → `src/services/PlanStore.js`
- `capabilities/commands/handoff.command.js:42` ✅code → `src/services/TodoStore.js`
- `capabilities/commands/handoff.command.js:48` ✅code → `src/services/PlanStore.js`
- `capabilities/commands/handoff.command.js:69` ✅code → `src/services/director/Mission.js`
- `capabilities/commands/intel.command.js:42` ✅code → `src/services/PlanStore.js`
- `capabilities/commands/intel.command.js:87` ✅code → `src/providers/index.js`
- `capabilities/commands/intel.command.js:88` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/intel.command.js:91` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/graph/code/graph/edges/index.js:25` 💬 → `src/dst`
- `index.html:113` ✅code → `/src/main.jsx`
- `interfaces/cli/lib/wizard.js:100` ✅code → `src/services/providers/catalog.js`
- `interfaces/cli/lib/wizard.js:105` ✅code → `src/services/providers/modelConfig.js`
- `interfaces/cli/test-cli.js:64` ✅code → `src/services/providers/catalog.js`
- `interfaces/cli/test-cli.js:123` ✅code → `src/services/providers/modelConfig.js`
- `interfaces/console/components/ChatWindow.jsx:9` 💬 → `src/components/ChatWindow.jsx`
- `interfaces/ui/preview/agents-view.html:4` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/preview/agents-view.html:18` ✅code → `jexi/web/src/app/globals.css`
- `interfaces/ui/preview/agents-view.html:327` 💬 → `src/styles/jexi-theme.css`
- `interfaces/ui/preview/console.html:9` ✅code → `jexi/web/src/app/globals.css`
- `interfaces/ui/preview/console.html:559` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:597` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:629` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:687` ✅code → `src/auth/refresh.ts.`
- `interfaces/ui/preview/console.html:689` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:816` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:859` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:1009` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:1473` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/console.html:1533` ✅code → `src/auth/refresh.ts`
- `interfaces/ui/preview/globe.html:32` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/preview/globe.html:51` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/preview/globe.html:1411` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/artifacts.js:10` 💬 → `web/app/src/components/artifacts/.`
- `interfaces/ui/web/console/chat/rows/agent.js:3` 💬 → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/agent.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/approval.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/index.js:25` 💬 → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/narration.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/text.js:10` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/thinking.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/tool-error.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/tool-result.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/tool-use.js:3` 💬 → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/tool-use.js:10` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/turn-end-fail.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/rows/turn-end-ok.js:9` ✅code → `src/styles/jexi-theme.css`
- `interfaces/ui/web/console/chat/toolcards.js:25` 💬 → `web/app/src/components/tools/approval-card.`
- `interfaces/ui/web/console/shell/Shell.jsx:5` ✅code → `../../../../src/components/ChatWindow.jsx`
- `interfaces/ui/web/console/shell/Shell.jsx:18` ✅code → `../../../../src/components/console/views/AgentsView.jsx`
- `interfaces/ui/web/console/shell/Shell.jsx:19` ✅code → `../../../../src/styles/jexi-theme.css`
- `mind/memory/session-compress.js:15` 💬 → `src/server/generation/ProviderObservationGenerator.ts`
- `server/bundles/manifest.json:16` ✅code → `src/utils/gatewayClient.js`
- `server/bundles/manifest.json:72` ✅code → `src/`
- `server/bundles/manifest.json:100` ✅code → `src/utils/clientModules.js`
- `server/bundles/manifest.json:107` ✅code → `src/utils/jexiRuntime.js`
- `server/bundles/manifest.json:114` ✅code → `src/utils/schemaForm.js`
- `server/bundles/manifest.json:122` ✅code → `src/components`
- `server/bundles/manifest.json:129` ✅code → `src/components`
- `server/bundles/manifest.json:136` ✅code → `src/brand/official.jsx`
- `server/bundles/manifest.json:143` ✅code → `src/components`
- `server/bundles/manifest.json:150` ✅code → `src/components`
- `server/bundles/manifest.json:157` ✅code → `src/components`
- `server/bundles/manifest.json:165` ✅code → `src/components`
- `server/bundles/manifest.json:172` ✅code → `src/components`
- `server/bundles/manifest.json:179` ✅code → `src/components`
- `server/bundles/manifest.json:187` ✅code → `src/components`
- `server/bundles/manifest.json:194` ✅code → `src/components`
- `server/bundles/manifest.json:201` ✅code → `src/components`
- `server/bundles/manifest.json:208` ✅code → `src/components`
- `server/bundles/manifest.json:215` ✅code → `src/components`
- `server/bundles/manifest.json:222` ✅code → `src/components`
- `server/bundles/manifest.json:229` ✅code → `src/components`
- `server/bundles/manifest.json:236` ✅code → `src/components`
- `server/bundles/manifest.json:243` ✅code → `src/utils/referenceSource.js`
- `server/bundles/manifest.json:250` ✅code → `src/utils/uiRenderer.jsx`
- `server/bundles/manifest.json:257` ✅code → `src/components`
- `server/bundles/manifest.json:264` ✅code → `src/components`
- `server/bundles/manifest.json:271` ✅code → `src/components`
- `server/bundles/manifest.json:278` ✅code → `src/components`
- `server/bundles/manifest.json:285` ✅code → `src/components`
- `server/bundles/manifest.json:292` ✅code → `src/components`
- `server/bundles/manifest.json:299` ✅code → `src/components`
- `server/bundles/manifest.json:307` ✅code → `src/components`
- `server/bundles/manifest.json:314` ✅code → `src/components`
- `server/bundles/manifest.json:321` ✅code → `src/components`
- `server/bundles/manifest.json:328` ✅code → `src/components`
- `server/bundles/manifest.json:335` ✅code → `src/components`
- `server/bundles/manifest.json:342` ✅code → `src/components`
- `server/bundles/manifest.json:349` ✅code → `src/components`
- `server/bundles/manifest.json:356` ✅code → `src/components`
- `server/bundles/manifest.json:364` ✅code → `src/main.jsx`
- `server/bundles/manifest.json:371` ✅code → `src/hooks/index.js`
- `server/bundles/manifest.json:373` ✅code → `src/hooks`
- `server/bundles/manifest.json:603` ✅code → `src/utils/clientModules.js`
- `server/bundles/manifest.json:1430` ✅code → `src/utils/jexiRuntime.js`
- `server/bundles/manifest.json:1549` ✅code → `src/utils/web.js`
- `server/package-lock.json:4761` ✅code → `src/cli.js`
- `server/plugins/coding/plugin.js:51` ✅code → `src/`
- `server/plugins/github-engine/plugin.js:32` ✅code → `src/App.jsx`
- `server/scripts/scope-b-probe.mjs:45` ✅code → `src/plain-sum.js`
- `server/scripts/scope-b-probe.mjs:52` ✅code → `src/add.js`
- `server/scripts/scope-b-probe.mjs:53` ✅code → `src/plain-sum.js`
- `server/scripts/scope-b-probe.mjs:57` ✅code → `src/add.js`
- `server/src/commands-seam.js:10` 💬 → `/app/src/commands-seam.js`
- `server/src/kernel/hooks/hud-seam.js:22` 💬 → `/app/src/kernel/hooks`
- `server/src/providers/interface/NormalizedToolCall.js:10` 💬 → `src/x.js`
- `server/src/routes/hud.js:22` 💬 → `/app/src/routes`
- `server/src/services/CodeModeRuntime.js:3` 💬 → `packages/core/tools/src/code-mode.ts`
- `server/src/services/CodeModeRuntime.js:4` 💬 → `packages/core/tools/src/ts-types.ts`
- `server/src/services/ProfileCompleteness.js:122` ✅code → `src/services/Planner.js`
- `server/src/services/ProfileCompleteness.js:141` ✅code → `src/services/Planner.js`
- `server/src/services/WebSearch.js:6` 💬 → `packages/web/web/src/types.ts`
- `server/src/skills/executor.js:14` 💬 → `src/add.test.js`
- `server/src/skills/executor.js:14` 💬 → `src/add.js`
- `server/src/workgraph/index.js:267` 💬 → `src/verification`
- `server/test-api-surface.js:32` ✅code → `src/routes/surface.js`
- `server/test-api-surface.js:32` ✅code → `src/routes/arena.js`
- `server/test-api-surface.js:32` ✅code → `src/routes/missionStream.js`
- `server/test-api-surface.js:32` ✅code → `src/routes/hud.js`
- `server/test-api-surface.js:32` ✅code → `src/routes/scheduler.js`
- `server/test-api-surface.js:32` ✅code → `src/routes/context.js`
- `server/test-audit-b48.js:2` 💬 → `src/components/ChatWindow.jsx`
- `server/test-audit-b48.js:128` ✅code → `../src/components/ChatWindow.jsx`
- `server/test-audit-b48.js:129` ✅code → `../src/index.css`
- `server/test-audit-b48.js:140` ✅code → `../src/components/MarkdownRenderer.jsx`
- `server/test-audit-b48.js:167` ✅code → `../src/utils/helpers.js`
- `server/test-audit-b48.js:169` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-auto-mode.js:14` 💬 → `src/components/ChatWindow.jsx`
- `server/test-auto-mode.js:60` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-auto-mode.js:64` ✅code → `../src/components/ChatWindow.jsx`
- `server/test-auto-mode.js:73` ✅code → `../src/components/HomeView.jsx`
- `server/test-auto-mode.js:76` ✅code → `../src/components/SettingsPanel.jsx`
- `server/test-b197.js:37` 💬 → `src/components`
- `server/test-b197.js:52` ✅code → `src/.test`
- `server/test-b200.js:2` 💬 → `src/components/ChatWindow.jsx`
- `server/test-b200.js:94` ✅code → `src/hooks/useJexiEngine.js`
- `server/test-b200.js:96` ✅code → `src/components/ChatWindow.jsx`
- `server/test-b200.js:106` ✅code → `src/components/NarrationFeed.jsx`
- `server/test-b205.js:3` 💬 → `src/components/ChatWindow.jsx`
- `server/test-b205.js:29` 💬 → `../src/utils/agentStream.js`
- `server/test-b205.js:33` ✅code → `../src/utils/agentStream.js`
- `server/test-b205.js:103` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b205.js:110` ✅code → `../src/components/ChatWindow.jsx`
- `server/test-b205.js:114` ✅code → `../src/components/AgentThinking.jsx`
- `server/test-b205.js:120` ✅code → `../src/index.css`
- `server/test-b206.js:19` ✅code → `../src/utils/agentStream.js`
- `server/test-b206.js:97` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b206.js:102` ✅code → `../src/components/AgentThinking.jsx`
- `server/test-b206.js:110` ✅code → `../src/index.css`
- `server/test-b206b.js:38` ✅code → `src/components/AgentThinking.jsx`
- `server/test-b207.js:44` ✅code → `src/index.css`
- `server/test-b210.js:287` ✅code → `src/services/director/RealAdapters.js`
- `server/test-b210.js:290` ✅code → `src/services/director/EmployeeSession.js`
- `server/test-b217.js:12` 💬 → `src/config.js`
- `server/test-b223.js:150` ✅code → `src/services/director/Director.js`
- `server/test-b223.js:167` ✅code → `src/services/ToolDiscovery.js`
- `server/test-b224.js:174` ✅code → `src/routes/missionStream.js`
- `server/test-b224.js:189` ✅code → `../src/components/MissionsScreen.jsx`
- `server/test-b224.js:198` ✅code → `../src/components/MissionsScreen.jsx`
- `server/test-b224.js:205` ✅code → `../src/components/MissionsScreen.jsx`
- `server/test-b225.js:425` ✅code → `../src/components/Composer.jsx`
- `server/test-b226.js:2` 💬 → `src/components/ChatWindow.jsx`
- `server/test-b226.js:38` ✅code → `../src/components/Composer.jsx`
- `server/test-b226.js:50` ✅code → `../src/components/Composer.jsx`
- `server/test-b226.js:56` ✅code → `../src/components/ChatWindow.jsx`
- `server/test-b226.js:67` ✅code → `../src/components/ChatWindow.jsx`
- `server/test-b226.js:74` ✅code → `../src/components/VisionPanel.jsx`
- `server/test-b226.js:80` ✅code → `../src/App.jsx`
- `server/test-b226.js:81` ✅code → `../src/components/CommandCenter.jsx`
- `server/test-b226.js:88` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b227.js:126` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b51.js:88` ✅code → `src/services/Orchestrator.js`
- `server/test-b51.js:112` ✅code → `src/services/Orchestrator.js`
- `server/test-b51.js:136` ✅code → `src/services/Orchestrator.js`
- `server/test-b51.js:142` ✅code → `src/services/PipelineGraphs.js`
- `server/test-b51.js:172` ✅code → `src/services/Orchestrator.js`
- `server/test-b51.js:175` ✅code → `src/services/PipelineGraphs.js`
- `server/test-b51.js:178` ✅code → `src/services/CodingLoop.js`
- `server/test-b52.js:95` ✅code → `src/services/Orchestrator.js`
- `server/test-b52.js:126` ✅code → `src/services/Orchestrator.js`
- `server/test-b52.js:179` ✅code → `src/services/Orchestrator.js`
- `server/test-b52.js:236` ✅code → `src/services/Orchestrator.js`
- `server/test-b53.js:30` ✅code → `../src/components/CommandCenter.jsx`
- `server/test-b53.js:152` ✅code → `src/services/Orchestrator.js`
- `server/test-b53.js:221` ✅code → `src/services/CodingLoop.js`
- `server/test-b53.js:243` ✅code → `src/services/RESPONSE_VOICE.md`
- `server/test-b53.js:246` ✅code → `src/services/Groundedness.js`
- `server/test-context-engine.js:76` ✅code → `src/`
- `server/test-dsh-batch10.js:10` 💬 → `src/utils/schemaForm.js`
- `server/test-dsh-batch11.js:9` 💬 → `src/hooks/usePluginInventory.js`
- `server/test-dsh-batch12.js:5` 💬 → `src/utils/clientModules.js`
- `server/test-dsh-batch12.js:6` 💬 → `src/utils/web.js`
- `server/test-dsh-batch12.js:7` 💬 → `src/hooks/index.js`
- `server/test-dsh-batch12.js:8` 💬 → `src/hooks/useSlots.js`
- `server/test-dsh-batch12.js:8` 💬 → `src/utils/modelSelection.js`
- `server/test-dsh-batch14.js:11` 💬 → `src/utils/referenceSource.js`
- `server/test-dsh-batch14.js:12` 💬 → `src/utils/uiRenderer.jsx`
- `server/test-dsh-batch14.js:13` 💬 → `src/brand/official.jsx`
- `server/test-dsh-batch14.js:62` ✅code → `src/App.jsx`
- `server/test-dsh-batch14.js:181` ✅code → `src/utils/referenceSource.js`
- `server/test-dsh-batch14.js:183` ✅code → `src/utils/uiRenderer.jsx`
- `server/test-dsh-batch14.js:185` ✅code → `src/brand/official.jsx`
- `server/test-dsh-batch14.js:187` ✅code → `src/main.jsx`
- `server/test-dsh-batch14.js:189` ✅code → `src/App.jsx`
- `server/test-dsh-batch7.js:11` 💬 → `src/components/SettingsPanel.jsx`
- `server/test-dsh-batch9.js:6` 💬 → `src/utils/gatewayClient.js`
- `server/test-dsh-batch9.js:7` 💬 → `src/utils/jexiRuntime.js`
- `server/test-github-repo.js:26` ✅code → `//github.com/foo/bar/tree/main/src/utils`
- `server/test-github-repo.js:27` ✅code → `src/utils`
- `server/test-github-repo.js:60` ✅code → `src/app.js`
- `server/test-github-repo.js:97` ✅code → `src/bot.js`
- `server/test-math-stream.js:80` ✅code → `src/utils/mathPreprocess.js`
- `server/test-math-stream.js:104` ✅code → `src/components/MarkdownRenderer.jsx`
- `server/test-math-stream.js:106` ✅code → `src/index.css`
- `server/test-math-stream.js:117` ✅code → `src/hooks/useTypewriter.js`
- `server/test-math-stream.js:119` ✅code → `src/components/MarkdownRenderer.jsx`
- `server/test-model-coworkers.js:13` 💬 → `src/components/ChatWindow.jsx`
- `server/test-model-coworkers.js:112` ✅code → `src/hooks/useJexiEngine.js`
- `server/test-model-coworkers.js:116` ✅code → `src/hooks/useJexiEngine.js`
- `server/test-model-coworkers.js:118` ✅code → `src/components/ChatWindow.jsx`
- `server/test-model-coworkers.js:119` ✅code → `src/components/AgentThinking.jsx`
- `server/test-model-coworkers.js:125` ✅code → `src/components/SettingsView.jsx`
- `server/test-phone-notify.js:9` ✅code → `../src/utils/phoneNotify.js`
- `server/test-presenter.js:27` ✅code → `../src/utils/chartSvg.js`
- `server/test-presenter.js:127` ✅code → `src/components/MarkdownRenderer.jsx`
- `server/test-roster-registry.js:101` ✅code → `src/services/AgentRoster.js`
- `server/test-roster-registry.js:104` ✅code → `./src/services/AgentRoster.js`
- `server/test-team-router.js:62` ✅code → `src/index.css`
- `server/test-team-router.js:67` ✅code → `src/components/ChatWindow.jsx`
- `server/test-thinking.js:19` 💬 → `src/components/ChatWindow.jsx`
- `server/test-thinking.js:101` ✅code → `src/hooks/useJexiEngine.js`
- `server/test-thinking.js:107` ✅code → `src/components/ThinkRow.jsx`
- `server/test-thinking.js:112` ✅code → `src/components/ChatWindow.jsx`
- `server/test-thinking.js:118` ✅code → `src/components/AgentPipeline.jsx`
- `server/test-web-search.js:19` 💬 → `src/components/ChatWindow.jsx`
- `server/test-web-search.js:209` ✅code → `src/components/StepRow.jsx`
- `server/test-web-search.js:211` ✅code → `src/index.css`
- `server/test-web-search.js:213` ✅code → `src/components/ChatWindow.jsx`
- `server/tests/agi/fixtures/verify-pkg/run-from-cwd.js:1` 💬 → `src/plain-sum.js`
- `server/tests/agi/fixtures/verify-pkg/verification-fixture.test.js:21` 💬 → `src/add.js`
- `server/tests/agi/fixtures/verify-pkg/verification-fixture.test.js:22` ✅code → `src/add.js`
- `server/tests/agi/test-lsp-manager.js:210` ✅code → `src/a.ts`
- `server/tests/agi/test-lsp-manager.js:211` ✅code → `src/b.js`
- `server/tests/agi/test-observer-chat-events.js:62` ✅code → `src/services/director/MissionRunner.js`
- `server/tests/agi/test-skill-execution.js:107` ✅code → `src/bad.test.js`
- `server/tests/agi/test-skill-execution.js:115` ✅code → `src/bad.test.js`
- `server/tests/agi/test-skill-execution.js:123` ✅code → `src/good.test.js`
- `server/tests/agi/test-skill-execution.js:128` ✅code → `src/good.test.js`
- `server/tests/agi/test-skill-execution.js:191` ✅code → `src/main.js`
- `server/tests/agi/test-skill-execution.js:194` ✅code → `src/main.js`
- `server/tests/agi/test-verification-independence.js:55` ✅code → `src/a.js`
- `server/tests/agi/test-verification-independence.js:90` ✅code → `src/a.js`
- `server/tests/agi/test-verification-independence.js:95` ✅code → `src/a.js`
- `server/tests/agi/test-verification-spawn.js:62` ✅code → `src/plain-sum.js`
- `server/tests/agi/test-verification-spawn.js:89` ✅code → `src/ok.test.js`
- `server/tests/agi/test-verification-spawn.js:123` ✅code → `src/bad.js`
- `server/tests/agi/test-verification-spawn.js:159` ✅code → `src/bad.js`
- `server/tests/agi/test-verification-spawn.js:177` ✅code → `src/add.js`
- `server/tests/agi/test-verification-spawn.js:178` ✅code → `src/add.test.js`
- `server/tests/agi/test-verification-spawn.js:179` ✅code → `src/plain-sum.js`
- `server/tests/agi/test-verification-spawn.js:188` ✅code → `src/plain-sum.js`
- `server/tests/agi/test-verification-spawn.js:203` ✅code → `src/add.js`
- `server/tests/agi/test-verification-spawn.js:204` ✅code → `src/add.test.js`
- `server/tests/agi/test-verification-spawn.js:205` ✅code → `src/plain-sum.js`
- `skills/design/diagram-design/brand.js:4` 💬 → `src/styles/jexi-theme.css`
- `tailwind.config.js:2` ✅code → `./src/`
- `vite.config.js:27` 💬 → `android/app/src/main/assets/public/index.html`

### `ui/` → `interfaces/ui/` — 17 MISSING refs (6 code) in 14 files

- `.github/workflows/docker-publish.yml:9` 💬 → `ui/web/console/chat/mount.js`
- `.github/workflows/docker-publish.yml:20` ✅code → `ui/`
- `benchmarks/webarena/index.js:24` 💬 → `ui/web/console/chat/`
- `harness/parity/lifecycle/permission-denied.js:3` ✅code → `../../../ui/web/console/chat/approvals.js`
- `interfaces/console/components/ChatWindow.jsx:12` 💬 → `ui/web/console/chat/mount.js`
- `interfaces/console/components/console/ConsoleApp.jsx:22` 💬 → `ui/preview/console.html`
- `interfaces/console/main.jsx:39` 💬 → `ui/web/console/shell/main.jsx`
- `interfaces/ui/preview/agents-view.html:16` ✅code → `ui/preview/console.html`
- `interfaces/ui/web/console/_palette-preview.html:132` ✅code → `ui/web/console/_palette-preview.html`
- `interfaces/ui/web/console/chat/artifacts.js:55` 💬 → `ui/web/`
- `interfaces/ui/web/console/chat/mount.js:4` 💬 → `ui/web/console/chat/runtime.js`
- `server/src/wiring/phase31-hooks.js:21` 💬 → `ui/web/console/chat/approvals.js`
- `server/src/wiring/phase31-hooks.js:101` 💬 → `ui/web/console/chat/approvals.js`
- `services/computer/events/emit.js:5` 💬 → `ui/web/console/chat/router.js`
- `services/computer/events/emit.js:28` ✅code → `../../ui/web/console/chat/router.js`
- `services/computer/events/index.js:9` 💬 → `ui/web/console/chat/router.js`
- `skills/design/ui-ux-pro-max/data/data-provenance.json:1133` ✅code → `//developer.android.com/guide/topics/ui/accessibility/apps`

### `web/` → `interfaces/web/` — 54 MISSING refs (23 code) in 31 files

- `.github/workflows/docker-publish.yml:9` 💬 → `ui/web/console/chat/mount.js`
- `benchmarks/webarena/index.js:24` 💬 → `ui/web/console/chat/`
- `harness/parity/lifecycle/permission-denied.js:3` ✅code → `../../../ui/web/console/chat/approvals.js`
- `interfaces/console/components/ChatWindow.jsx:12` 💬 → `ui/web/console/chat/mount.js`
- `interfaces/console/hooks/index.js:2` 💬 → `packages/web/web-react`
- `interfaces/console/main.jsx:39` 💬 → `ui/web/console/shell/main.jsx`
- `interfaces/console/utils/web.js:2` 💬 → `packages/web/web`
- `interfaces/ui/preview/agents-view.html:18` ✅code → `jexi/web/src/app/globals.css`
- `interfaces/ui/preview/console.html:9` ✅code → `jexi/web/src/app/globals.css`
- `interfaces/ui/web/console/_palette-preview.html:132` ✅code → `ui/web/console/_palette-preview.html`
- `interfaces/ui/web/console/chat/artifacts.js:10` 💬 → `web/app/src/components/artifacts/.`
- `interfaces/ui/web/console/chat/artifacts.js:55` 💬 → `ui/web/`
- `interfaces/ui/web/console/chat/mount.js:4` 💬 → `ui/web/console/chat/runtime.js`
- `interfaces/ui/web/console/chat/toolcards.js:25` 💬 → `web/app/src/components/tools/approval-card.`
- `server/bundles/manifest.json:1539` ✅code → `web/tool-web`
- `server/bundles/manifest.json:1546` ✅code → `web/web`
- `server/bundles/manifest.json:1553` ✅code → `web/web-fetch-http`
- `server/bundles/manifest.json:1560` ✅code → `web/web-search-deepseek`
- `server/bundles/manifest.json:1567` ✅code → `web/web-search-exa`
- `server/bundles/manifest.json:1574` ✅code → `web/web-search-perplexity`
- `server/plugins/research/plugin.js:2` 💬 → `packages/web/tool-web`
- `server/src/services/Planner.js:39` 💬 → `web/browser/study`
- `server/src/services/Planner.js:213` ✅code → `web/study`
- `server/src/services/Planner.js:490` ✅code → `web/study`
- `server/src/services/ToolRuntime.js:1307` 💬 → `terminal/web/memory/git/github/testing/data/`
- `server/src/services/ToolRuntime.js:1580` 💬 → `web/browser/study`
- `server/src/services/WebSearch.js:2` 💬 → `packages/web/web`
- `server/src/services/WebSearch.js:6` 💬 → `packages/web/web/src/types.ts`
- `server/src/services/WebSearch.js:379` ✅code → `//api.search.brave.com/res/v1/web/search`
- `server/src/wiring/phase31-hooks.js:21` 💬 → `ui/web/console/chat/approvals.js`
- `server/src/wiring/phase31-hooks.js:101` 💬 → `ui/web/console/chat/approvals.js`
- `server/test-audit-b47.js:129` 💬 → `web/study`
- `server/test-b51.js:4` 💬 → `web/study`
- `server/test-b51.js:6` 💬 → `web/browser/search`
- `server/test-b51.js:97` 💬 → `web/study`
- `server/test-b51.js:121` ✅code → `web/browser/search`
- `server/test-b52.js:129` ✅code → `web/browser`
- `server/test-b52.js:130` 💬 → `web/study`
- `server/test-b52.js:144` ✅code → `web/browser/study`
- `server/test-b52.js:148` 💬 → `web/browser/study`
- `server/test-dsh-batch12.js:6` 💬 → `web/web`
- `server/test-dsh-batch12.js:7` 💬 → `web/web-react`
- `server/test-dsh-batch13.js:10` 💬 → `web/web-search-`
- `server/test-dsh-batch13.js:41` ✅code → `web/web-search-exa`
- `server/test-planner-routing.js:12` 💬 → `web/study`
- `server/test-reliability.js:93` 💬 → `web/study`
- `server/test-web-search.js:42` ✅code → `web/types`
- `server/test-web-search.js:127` ✅code → `web/search`
- `services/computer/events/emit.js:5` 💬 → `ui/web/console/chat/router.js`
- `services/computer/events/emit.js:28` ✅code → `../../ui/web/console/chat/router.js`
- `services/computer/events/index.js:9` 💬 → `ui/web/console/chat/router.js`
- `services/research/constraints/read-only.js:32` ✅code → `web/reach/`
- `skills/design/ui-ux-pro-max/data/data-provenance.json:1229` ✅code → `//fluent2.microsoft.design/components/web/react/core/tag/usage`
- `skills/design/ui-ux-pro-max/data/data-provenance.json:1233` ✅code → `//fluent2.microsoft.design/components/web/react/core/skeleton/u…`

### `public/` → `interfaces/public/` — 7 MISSING refs (5 code) in 6 files

- `.github/workflows/docker-publish.yml:18` ✅code → `public/`
- `server/eslint.config.js:17` ✅code → `public/`
- `server/src/services/Formatting.js:113` ✅code → `public/relative`
- `server/src/services/director/EmployeeSession.js:644` 💬 → `public/index.html`
- `server/tests/autonomy/long-horizon-mission.js:76` ✅code → `public/index.html`
- `server/tests/autonomy/long-horizon-mission.js:99` ✅code → `public/index.html.`
- `vite.config.js:27` 💬 → `android/app/src/main/assets/public/index.html`

### `android/` → `interfaces/android/` — 7 MISSING refs (5 code) in 5 files

- `.github/workflows/apk.yml:18` 💬 → `android/`
- `.github/workflows/apk.yml:106` ✅code → `android/app/build/outputs/apk/debug/app-debug.apk`
- `.github/workflows/apk.yml:138` ✅code → `android/app/build/outputs/apk/debug/app-debug.apk`
- `server/eslint.config.js:20` ✅code → `android/`
- `server/src/services/GitHubEngine.js:77` ✅code → `android/app/build.gradle`
- `server/test-b225.js:440` ✅code → `android/`
- `vite.config.js:27` 💬 → `android/app/src/main/assets/public/index.html`

### `cli/` → `interfaces/cli/` — 5 MISSING refs (1 code) in 4 files

- `capabilities/graph/code/graph/edges/cross-service.js:1` 💬 → `cli/`
- `interfaces/cli/lib/config.js:79` 💬 → `cli/lib/config.js`
- `interfaces/cli/lib/config.js:79` 💬 → `cli/`
- `interfaces/cli/test-cli.js:8` 💬 → `cli/`
- `server/package.json:7` ✅code → `../cli/test-cli.js`

### `providers/` → `integrations/providers/` — 39 MISSING refs (17 code) in 26 files

- `.github/workflows/docker-publish.yml:22` ✅code → `providers/`
- `Dockerfile.slim:52` 💬 → `providers/`
- `capabilities/commands/build-fix.command.js:117` ✅code → `src/providers/index.js`
- `capabilities/commands/build-fix.command.js:118` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/build-fix.command.js:121` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/code-review.command.js:73` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/code-review.command.js:74` ✅code → `src/providers/index.js`
- `capabilities/commands/doctor.command.js:45` ✅code → `src/providers/index.js`
- `capabilities/commands/doctor.command.js:46` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/intel.command.js:87` ✅code → `src/providers/index.js`
- `capabilities/commands/intel.command.js:88` ✅code → `src/providers/runtime/LLMClient.js`
- `capabilities/commands/intel.command.js:91` ✅code → `src/providers/runtime/LLMClient.js`
- `harness/hardening/madtea/credentials.js:5` 💬 → `providers/profiles`
- `harness/hardening/madtea/credentials.js:31` 💬 → `providers/profiles/schema.js`
- `integrations/providers/profiles/_internal.js:4` 💬 → `providers/routing/_internal.js`
- `integrations/providers/routing/repo-context.js:49` 💬 → `providers/routing`
- `integrations/providers/tokens/ephemeral.js:2` 💬 → `providers/tokens/ephemeral.js`
- `integrations/providers/tokens/ephemeral.js:238` 💬 → `providers/tokens/ephemeral.js`
- `integrations/providers/tokens/realtime.js:2` 💬 → `providers/tokens/realtime.js`
- `interfaces/ui/web/console/settings/KeyRefInput.jsx:2` ✅code → `../../../../providers/profiles/schema.js`
- `interfaces/ui/web/console/settings/ProviderSection.jsx:2` ✅code → `../../../../providers/profiles/schema.js`
- `server/src/providers/adapters/ollama.js:9` 💬 → `providers/adapters/ollama.provider.js`
- `server/src/providers/runtime/LLMClient.js:17` 💬 → `providers/cost/caps.js`
- `server/src/providers/runtime/LLMClient.js:19` ✅code → `../../../../providers/cost/caps.js`
- `server/src/providers/runtime/ProviderRouter.js:164` 💬 → `providers/`
- `server/src/providers/search/deepseek-search.js:6` 💬 → `providers/search/`
- `server/src/providers/search/index.js:7` 💬 → `providers/index.js`
- `server/src/routes/tokens.js:9` 💬 → `providers/tokens/ephemeral.js`
- `server/src/routes/tokens.js:22` ✅code → `../../../providers/tokens/ephemeral.js`
- `server/src/services/OfflineAgent.js:5` 💬 → `providers/`
- `server/src/services/OfflineAgent.js:10` 💬 → `providers/`
- `server/src/services/ReasoningEngine.js:7` 💬 → `providers/`
- `server/src/services/WebSearch.js:529` 💬 → `providers/`
- `server/src/wiring/phase31-providers.js:11` 💬 → `providers/profiles/schema.js`
- `server/src/wiring/phase31-providers.js:34` ✅code → `../../../providers/profiles/index.js`
- `server/test-b227.js:117` ✅code → `providers/`
- `services/computer/remote/operator.js:33` 💬 → `providers/profiles/schema.js`
- `services/computer/remote/operator.js:62` 💬 → `providers/profiles/schema.js`
- `services/surfsense/connectors/_internal.js:5` 💬 → `providers/routing/_internal.js`

### `deploy/` → `infra/deploy/` — 8 MISSING refs (4 code) in 4 files

- `.github/workflows/deploy-worker.yml:10` 💬 → `deploy/lb-worker.js`
- `.github/workflows/deploy-worker.yml:20` ✅code → `deploy/lb-worker.js`
- `.github/workflows/deploy-worker.yml:45` ✅code → `deploy/lb-worker.js`
- `.github/workflows/render-deploy.yml:6` 💬 → `//api.render.com/deploy/srv-daa3bie7bikc73fal0kg`
- `infra/deploy/test-lb.js:2` 💬 → `deploy/lb-worker.js`
- `infra/deploy/test-lb.js:7` 💬 → `deploy/test-lb.js`
- `server/src/services/director/ComplexityAnalyzer.js:96` ✅code → `send/deploy/publish`
- `server/src/services/director/ComplexityAnalyzer.js:131` ✅code → `send/deploy/publish/destructive`

### `hooks/` → `infra/hooks/` — 61 MISSING refs (39 code) in 34 files

- `harness/adapters/_convert.js:223` ✅code → `hooks/hooks.json`
- `harness/adapters/index.js:64` 💬 → `agents/rules/skills/hooks/commands/mcp`
- `harness/parity/hooks/registry.js:7` ✅code → `../../../hooks/hooks.json`
- `harness/parity/hooks/registry.js:14` ✅code → `hooks/hooks.json`
- `harness/parity/hooks/registry.js:17` ✅code → `hooks/hooks.json`
- `infra/hooks/hooks.json:9` ✅code → `hooks/scripts/pre-tool-use/dev-server-blocker.js`
- `infra/hooks/hooks.json:18` ✅code → `hooks/scripts/pre-tool-use/tmux-reminder.js`
- `infra/hooks/hooks.json:27` ✅code → `hooks/scripts/pre-tool-use/git-push-reminder.js`
- `infra/hooks/hooks.json:36` ✅code → `hooks/scripts/pre-tool-use/pre-commit-quality.js`
- `infra/hooks/hooks.json:45` ✅code → `hooks/scripts/stop/evaluate-session.js`
- `infra/hooks/hooks.json:54` ✅code → `hooks/scripts/session-start/restore-memory.js`
- `infra/hooks/hooks.json:63` ✅code → `hooks/scripts/pre-compact/save-checkpoint.js`
- `infra/hooks/hooks.json:72` ✅code → `hooks/scripts/session-end/persist-memory.js`
- `infra/hooks/hooks.metadata.json:27` ✅code → `hooks/state/session-evals.jsonl.`
- `infra/hooks/hooks.metadata.json:32` ✅code → `hooks/state/`
- `infra/hooks/hooks.metadata.json:37` ✅code → `hooks/state/`
- `infra/hooks/hooks.metadata.json:42` ✅code → `hooks/state/`
- `infra/hooks/scripts/pre-compact/save-checkpoint.js:6` 💬 → `hooks/state/`
- `infra/hooks/scripts/session-end/persist-memory.js:6` 💬 → `hooks/state/`
- `infra/hooks/scripts/session-start/restore-memory.js:6` 💬 → `hooks/state/`
- `infra/hooks/scripts/stop/evaluate-session.js:6` 💬 → `hooks/state/session-evals.jsonl`
- `interfaces/console/App.jsx:3` ✅code → `./hooks/useJexiEngine`
- `interfaces/console/App.jsx:4` ✅code → `./hooks/usePhoneNotifications`
- `interfaces/console/components/TypedMessage.jsx:1` ✅code → `../hooks/useTypewriter`
- `security/shield/hook-scanner.js:4` 💬 → `hooks/`
- `security/shield/hook-scanner.js:11` 💬 → `hooks/`
- `security/shield/index.js:7` 💬 → `hooks/`
- `server/bundles/manifest.json:371` ✅code → `src/hooks/index.js`
- `server/bundles/manifest.json:733` ✅code → `hooks/hook-protocol`
- `server/bundles/manifest.json:740` ✅code → `hooks/hooks-claude-code`
- `server/bundles/manifest.json:747` ✅code → `hooks/hooks-codex`
- `server/src/context/sources/index.js:99` 💬 → `hooks/`
- `server/src/kernel/hooks/learning-seam.js:12` 💬 → `hooks/`
- `server/src/kernel/hooks/runner.js:5` 💬 → `hooks/hooks.json.`
- `server/src/kernel/hooks/runner.js:18` 💬 → `hooks/hooks.json`
- `server/src/kernel/hooks/runner.js:19` 💬 → `hooks/`
- `server/src/kernel/hooks/runner.js:39` 💬 → `hooks/`
- `server/src/kernel/hooks/runner.js:57` 💬 → `hooks/hooks.json`
- `server/src/kernel/hooks/runner.js:97` 💬 → `hooks/scripts/...`
- `server/src/services/HookBridges.js:2` 💬 → `packages/hooks/hooks-codex`
- `server/test-audit-b48.js:169` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-auto-mode.js:60` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b200.js:94` ✅code → `src/hooks/useJexiEngine.js`
- `server/test-b205.js:103` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b206.js:97` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b226.js:88` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-b227.js:126` ✅code → `../src/hooks/useJexiEngine.js`
- `server/test-dsh-batch11.js:9` 💬 → `src/hooks/usePluginInventory.js`
- `server/test-dsh-batch12.js:7` 💬 → `src/hooks/index.js`
- `server/test-dsh-batch12.js:8` 💬 → `src/hooks/useSlots.js`
- `server/test-dsh-batch4.js:10` 💬 → `hooks/hooks-codex`
- `server/test-dsh-batch9.js:7` 💬 → `hooks/useProjection.js`
- `server/test-math-stream.js:117` ✅code → `src/hooks/useTypewriter.js`
- `server/test-model-coworkers.js:112` ✅code → `src/hooks/useJexiEngine.js`
- `server/test-model-coworkers.js:116` ✅code → `src/hooks/useJexiEngine.js`
- `server/test-thinking.js:101` ✅code → `src/hooks/useJexiEngine.js`
- `skills/library/claude-ecosystem/superpowers/IMPORT-MANIFEST.json:237` ✅code → `hooks/`
- `skills/library/claude-ecosystem/superpowers/IMPORT-MANIFEST.json:245` ✅code → `hooks/README.md`
- `skills/library/claude-ecosystem/superpowers/IMPORT-MANIFEST.json:246` ✅code → `hooks/run-hook.sh`
- `skills/library/claude-ecosystem/superpowers/IMPORT-MANIFEST.json:247` ✅code → `hooks/session-start.sh`
- `skills/library/claude-ecosystem/superpowers/hooks/hooks-cursor.json:6` ✅code → `./hooks/run-hook.cmd`

### `verification/` → `tests/verification/` — 20 MISSING refs (4 code) in 18 files

- `agents/workforce/agents/capabilities.js:22` ✅code → `verification/i`
- `mind/knowledge/attack-chain/entities/verification.entity.js:13` 💬 → `verification/verifiers/`
- `runtime/events/hud/schema.js:10` 💬 → `verification/eval/`
- `security/pipeline/phases/exploitation.phase.js:13` 💬 → `verification/verifiers/`
- `security/pipeline/phases/reporting.phase.js:29` ✅code → `../../../verification/verifiers/index.js`
- `security/pipeline/phases/verification.phase.js:6` 💬 → `verification/verifiers/`
- `security/pipeline/phases/verification.phase.js:34` ✅code → `../../../verification/verifiers/index.js`
- `server/src/wiring/phase31-bootstrap.js:61` ✅code → `../../../verification/visual/scene-qa.js`
- `tests/verification/eval/capsule.js:4` 💬 → `verification/eval/capsule.js`
- `tests/verification/eval/envelope.js:4` 💬 → `verification/eval/envelope.js`
- `tests/verification/eval/gate.js:4` 💬 → `verification/eval/gate.js`
- `tests/verification/eval/index.js:4` 💬 → `verification/eval/index.js`
- `tests/verification/eval/index.js:7` 💬 → `../verification/eval`
- `tests/verification/eval/receipt.js:4` 💬 → `verification/eval/receipt.js`
- `tests/verification/eval/replay.js:4` 💬 → `verification/eval/replay.js`
- `tests/verification/eval/rules.js:4` 💬 → `verification/eval/rules.js`
- `tests/verification/verifiers/index.js:8` 💬 → `verification/verifiers/index.js`
- `tests/verification/visual/puppeteer-runner.js:4` 💬 → `verification/visual/`
- `tests/verification/visual/scene-qa.js:5` 💬 → `verification/visual/`
- `tests/verification/visual/screenshot-diff.js:4` 💬 → `verification/visual/`

---

## APPENDIX B — refs that still RESOLVE (do not trust them) 

1,459 refs point at a path that exists today. Two sub-classes:

1. **legitimately unchanged** — `server/src/…` reinterpreted, or a path that never involved the moved dir;
2. **accidentally correct** — the referrer moved deeper and the old relative path now lands on a *different* existing file (F8). These need human judgement, one by one.

| file | resolving refs |
| --- | ---: |
| `server/index.js` | 134 |
| `server/test-everything.js` | 48 |
| `capabilities/graph/code/mcp-server.js` | 30 |
| `server/test-audit-b48.js` | 26 |
| `server/test-b199.js` | 19 |
| `server/test-f5-hardening.js` | 19 |
| `server/evaluation/tasks.js` | 18 |
| `server/test-model-coworkers.js` | 16 |
| `server/test-dsh-batch4.js` | 15 |
| `server/test-b209.js` | 14 |
| `server/test-dsh-batch5.js` | 14 |
| `server/tests/agi/test-scheduler.js` | 14 |
| `server/test-audit-b47.js` | 13 |
| `server/test-dsh-batch6.js` | 13 |
| `server/test-arena-astra.js` | 12 |
| `server/test-b227.js` | 12 |
| `server/test-dsh-batch13.js` | 12 |
| `server/test-reliability.js` | 12 |
| `server/tests/agi/test-director-mcp.js` | 12 |
| `server/cli.js` | 11 |
| `server/src/tools/domains/lsp/index.js` | 11 |
| `server/test-b208.js` | 11 |
| `server/test-plan-mode.js` | 11 |
| `server/tests/agi/benchmark.js` | 11 |
| `scripts/generate-divisions.js` | 10 |
| `server/test-b52.js` | 10 |
| `server/test-dsh-batch12.js` | 10 |
| `server/test-dsh-batch14.js` | 10 |
| `server/tests/agi/test-context-manager.js` | 10 |
| `server/test-b210.js` | 9 |
| `server/test-b211b3.js` | 9 |
| `server/test-b53.js` | 9 |
| `server/test-dsh-batch.js` | 9 |
| `server/test-dsh-batch7.js` | 9 |
| `server/test-dsh-batch8.js` | 9 |
| `server/test-unified-providers.js` | 9 |
| `server/test-b212.js` | 8 |
| `server/test-b215.js` | 8 |
| `server/test-b49.js` | 8 |
| `server/test-connectors.js` | 8 |
| `server/test-dsh-batch10.js` | 8 |
| `server/test-dsh-batch11.js` | 8 |
| `server/test-lifecycle.js` | 8 |
| `server/test-thinking.js` | 8 |
| `server/tests/agi/test-capability-router.js` | 8 |
| `server/tests/agi/test-lsp-manager.js` | 8 |
| `server/mcp-server.js` | 7 |
| `server/test-dsh-batch9.js` | 7 |
| `server/test-roster-skills.js` | 7 |
| `interfaces/console/main.jsx` | 6 |
| `server/plugins/coding/plugin.js` | 6 |
| `server/src/tools/execution/executor.js` | 6 |
| `server/src/tools/execution/permission-gate.js` | 6 |
| `server/test-autonomous-coding.js` | 6 |
| `server/test-b211b2.js` | 6 |
| `server/test-b225.js` | 6 |
| `server/test-dsh-batch2.js` | 6 |
| `server/test-dsh-batch3.js` | 6 |
| `server/test-dsh-coding.js` | 6 |
| `server/test-dsh-fidelity.js` | 6 |

…299 more files carry fewer than the shown counts. Full list reproducible with the command in Appendix D.

### Root-absolute refs (97) — separate semantics

| file:line | token | note |
| --- | --- | --- |
| `.github/workflows/docker-image.yml:24` | `/app/events/hud` | container path (`/app` = Docker WORKDIR) — not a repo path |
| `.github/workflows/render-deploy.yml:6` | `//api.render.com/deploy/srv-daa3bie7bikc73fal0kg` | web-root URL path |
| `agents/workforce/identity/graph.js:88` | `/workforce/identity/state` | web-root URL path |
| `capabilities/commands/_context.js:22` | `/commands/` | web-root URL path |
| `capabilities/commands/_context.js:23` | `/app/commands/` | container path (`/app` = Docker WORKDIR) — not a repo path |
| `capabilities/commands/_context.js:52` | `/app/src/services` | container path (`/app` = Docker WORKDIR) — not a repo path |
| `capabilities/prompts/incidents/log.js:40` | `/prompt/incidents/log.js` | web-root URL path |
| `capabilities/prompts/memory-fs/tree.js:38` | `/prompt/memory-fs/tree.js` | web-root URL path |
| `capabilities/prompts/versioning/snapshot.js:40` | `/prompt/versioning/snapshot.js` | web-root URL path |
| `harness/adapters/_convert.js:123` | `/agents/` | resolves |
| `index.html:113` | `/src/main.jsx` | web-root URL path |
| `mind/instincts/core/index.js:12` | `/instincts/` | web-root URL path |
| `runtime/context/viking/session.js:5` | `//session/` | web-root URL path |
| `runtime/context/viking/session.js:8` | `//session/` | web-root URL path |
| `runtime/context/viking/session.js:9` | `//session/` | web-root URL path |
| `runtime/context/viking/session.js:10` | `//session/` | web-root URL path |
| `runtime/context/viking/session.js:13` | `//session/` | web-root URL path |
| `scripts/phase10-c-probe.mjs:35` | `/events/0` | web-root URL path |
| `scripts/phase10-h-probe.mjs:177` | `/events/0` | web-root URL path |
| `scripts/phase10-h-probe.mjs:178` | `/events/1` | web-root URL path |
| `scripts/phase10-h-probe.mjs:179` | `/events/2` | web-root URL path |
| `scripts/phase13-scope-c-fix-2.mjs:44` | `/workforce/agents/vendor.` | web-root URL path |
| `scripts/phase13-scope-c-fix-2.mjs:44` | `/workforce/agents/vendor.` | web-root URL path |
| `scripts/phase13-scope-c-fix.mjs:73` | `/workforce/agents/vendor` | web-root URL path |
| `scripts/phase13-scope-c-fix.mjs:73` | `/workforce/agents/vendor` | web-root URL path |
| `scripts/phase16-k-probe.mjs:82` | `/src/app.js` | web-root URL path |
| `scripts/phase16-k-probe.mjs:93` | `/src/app.js` | web-root URL path |
| `scripts/phase16-k-probe.mjs:99` | `/src/app.js` | web-root URL path |
| `scripts/phase16-k-probe.mjs:111` | `/src/app.js` | web-root URL path |
| `scripts/phase16-k-probe.mjs:264` | `/src/x.js` | web-root URL path |
| `scripts/phase16-k-probe.mjs:278` | `/src/x.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:82` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:83` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:86` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:98` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:121` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:122` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:128` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:130` | `/src/app.js` | web-root URL path |
| `scripts/phase16-l-probe.mjs:132` | `/src/app.js` | web-root URL path |

---

## APPENDIX C — `scripts/` archaeology (1,036 MISSING refs, per file)

| file | MISSING refs |
| --- | ---: |
| `scripts/phase16-l-probe.mjs` | 45 |
| `scripts/phase31-0-wiring-plan.mjs` | 33 |
| `scripts/phase16-l-shots.mjs` | 32 |
| `scripts/phase29-scope-k-probe.mjs` | 23 |
| `scripts/phase31-scope-2-probe.mjs` | 22 |
| `scripts/phase22-d-import.mjs` | 21 |
| `scripts/phase16-o-probe.mjs` | 20 |
| `scripts/phase31-scope-3-probe.mjs` | 20 |
| `scripts/phase16-k-probe.mjs` | 19 |
| `scripts/phase16-m-probe.mjs` | 19 |
| `scripts/phase16-n-probe.mjs` | 19 |
| `scripts/phase9-j-probe.mjs` | 19 |
| `scripts/regenerate-capabilities.mjs` | 18 |
| `scripts/phase16-n-shots.mjs` | 17 |
| `scripts/phase13-scope-c-fix-2.mjs` | 15 |
| `scripts/phase16-m-shots.mjs` | 15 |
| `scripts/phase11-probe-g.mjs` | 14 |
| `scripts/phase11-probe-h.mjs` | 12 |
| `scripts/phase17-d-probe.mjs` | 12 |
| `scripts/phase30-rules-probe.mjs` | 12 |
| `scripts/phase10-j-probe.mjs` | 11 |
| `scripts/phase17-e-probe.mjs` | 11 |
| `scripts/phase9-g-probe.mjs` | 11 |
| `scripts/phase13-scope-e.mjs` | 10 |
| `scripts/phase16-j-probe.mjs` | 10 |
| `scripts/phase25-scope-d.mjs` | 10 |
| `scripts/phase25-scope-h.mjs` | 10 |
| `scripts/phase11-probe-b.mjs` | 9 |
| `scripts/phase11-probe-i.mjs` | 9 |
| `scripts/phase13-vendor-agency.mjs` | 9 |
| `scripts/phase21-b-constraints.mjs` | 9 |
| `scripts/phase30-worktree-probe.mjs` | 9 |
| `scripts/generate-divisions.js` | 8 |
| `scripts/phase13-scope-c-fix.mjs` | 8 |
| `scripts/phase13-scope-d.mjs` | 8 |
| `scripts/phase16-o-shots.mjs` | 8 |
| `scripts/phase19-scope-b.mjs` | 8 |
| `scripts/phase22-a-probe.mjs` | 8 |
| `scripts/phase30-lifecycle-probe.mjs` | 8 |
| `scripts/phase31-scope-6-probe.mjs` | 8 |
| `scripts/phase10-i-probe.mjs` | 7 |
| `scripts/phase11-probe-d.mjs` | 7 |
| `scripts/phase28-kg-probe.mjs` | 7 |
| `scripts/phase29-scope-j-probe.mjs` | 7 |
| `scripts/phase31-scope-12-probe.mjs` | 7 |
| `scripts/phase31-scope-5-probe.mjs` | 7 |
| `scripts/phase9-i-probe.mjs` | 7 |
| `scripts/phase17-c-probe.mjs` | 6 |
| `scripts/phase19-scope-c.mjs` | 6 |
| `scripts/phase22-d-probe.mjs` | 6 |
| `scripts/phase25-scope-c.mjs` | 6 |
| `scripts/phase25-scope-k.mjs` | 6 |
| `scripts/phase28-protocol-probe.mjs` | 6 |
| `scripts/phase29-scope-c-probe.mjs` | 6 |
| `scripts/phase29-scope-f-probe.mjs` | 6 |
| `scripts/phase30-self-evolve-probe.mjs` | 6 |
| `scripts/phase11-probe-e.mjs` | 5 |
| `scripts/phase16-i-probe.mjs` | 5 |
| `scripts/phase17-b-probe.mjs` | 5 |
| `scripts/phase19-scope-a.mjs` | 5 |
| `scripts/phase19-scope-d.mjs` | 5 |
| `scripts/phase25-scope-b.mjs` | 5 |
| `scripts/phase26-g-probe.mjs` | 5 |
| `scripts/phase28-cycle-probe.mjs` | 5 |
| `scripts/phase29-scope-b-probe.mjs` | 5 |
| `scripts/phase29-scope-d-probe.mjs` | 5 |
| `scripts/phase29-scope-e-probe.mjs` | 5 |
| `scripts/phase29-scope-g-probe.mjs` | 5 |
| `scripts/phase29-scope-h-probe.mjs` | 5 |
| `scripts/phase29-scope-i-probe.mjs` | 5 |
| `scripts/phase31-scope-19-probe.mjs` | 5 |
| `scripts/phase9-e-probe.mjs` | 5 |
| `scripts/phase9-h-probe.mjs` | 5 |
| `scripts/phase-hygiene-runner.mjs` | 4 |
| `scripts/phase10-a-probe.mjs` | 4 |
| `scripts/phase10-c-probe.mjs` | 4 |
| `scripts/phase10-e-probe.mjs` | 4 |
| `scripts/phase10-g-probe.mjs` | 4 |
| `scripts/phase11-probe-f.mjs` | 4 |
| `scripts/phase13-scope-b.mjs` | 4 |
| `scripts/phase13-scope-c.mjs` | 4 |
| `scripts/phase16-h-probe.mjs` | 4 |
| `scripts/phase21-a-loop.mjs` | 4 |
| `scripts/phase21-f-workgraph.mjs` | 4 |
| `scripts/phase21-i-templates.mjs` | 4 |
| `scripts/phase26-f-probe.mjs` | 4 |
| `scripts/phase27-scope-b.mjs` | 4 |
| `scripts/phase27-scope-c.mjs` | 4 |
| `scripts/phase27-scope-d.mjs` | 4 |
| `scripts/phase28-ambient-probe.mjs` | 4 |
| `scripts/phase28-search-probe.mjs` | 4 |
| `scripts/phase31-scope-10-probe.mjs` | 4 |
| `scripts/zone-owner-item3-probe.mjs` | 4 |
| `scripts/phase10-h-probe.mjs` | 3 |
| `scripts/phase11-index.mjs` | 3 |
| `scripts/phase13-vendor-nexus.mjs` | 3 |
| `scripts/phase14-e-probe.mjs` | 3 |
| `scripts/phase16-b-probe.mjs` | 3 |
| `scripts/phase16-c-probe.mjs` | 3 |
| `scripts/phase16-g-probe.mjs` | 3 |
| `scripts/phase17-j-probe.mjs` | 3 |
| `scripts/phase20-scope-b.mjs` | 3 |
| `scripts/phase21-c-program.mjs` | 3 |
| `scripts/phase22-c-probe.mjs` | 3 |
| `scripts/phase25-scope-e.mjs` | 3 |
| `scripts/phase25-scope-l.mjs` | 3 |
| `scripts/phase25-scope-m.mjs` | 3 |
| `scripts/phase26-c-probe.mjs` | 3 |
| `scripts/phase26-e-probe.mjs` | 3 |
| `scripts/phase28-evals-publish-probe.mjs` | 3 |
| `scripts/phase28-index-probe.mjs` | 3 |
| `scripts/phase29-scope-a-probe.mjs` | 3 |
| `scripts/phase31-scope-1-probe.mjs` | 3 |
| `scripts/phase9-a-probe.mjs` | 3 |
| `scripts/verify-apk.mjs` | 3 |
| `scripts/zone-owner-item2-probe.mjs` | 3 |
| `scripts/zone-owner-item4-probe.mjs` | 3 |
| `scripts/phase10-d-probe.mjs` | 2 |
| `scripts/phase10-f-probe.mjs` | 2 |
| `scripts/phase11-probe-a.mjs` | 2 |
| `scripts/phase13-scope-a.mjs` | 2 |
| `scripts/phase14-b-probe.mjs` | 2 |
| `scripts/phase14-c-probe.mjs` | 2 |
| `scripts/phase14-d-probe.mjs` | 2 |
| `scripts/phase16-d-probe.mjs` | 2 |
| `scripts/phase16-e-probe.mjs` | 2 |
| `scripts/phase16-f-probe.mjs` | 2 |
| `scripts/phase17-a-probe.mjs` | 2 |
| `scripts/phase20-scope-a.mjs` | 2 |
| `scripts/phase20-scope-c.mjs` | 2 |
| `scripts/phase20-scope-d.mjs` | 2 |
| `scripts/phase20-scope-e.mjs` | 2 |
| `scripts/phase20-scope-f.mjs` | 2 |
| `scripts/phase21-d-budget.mjs` | 2 |
| `scripts/phase21-e-tracking.mjs` | 2 |
| `scripts/phase21-h-swarm.mjs` | 2 |
| `scripts/phase21-j-overnight.mjs` | 2 |
| `scripts/phase22-g-probe.mjs` | 2 |
| `scripts/phase24-e-shots.mjs` | 2 |
| `scripts/phase24-f-walkthrough.mjs` | 2 |
| `scripts/phase24-palette-render.mjs` | 2 |
| `scripts/phase25-scope-a.mjs` | 2 |
| `scripts/phase25-scope-f.mjs` | 2 |
| `scripts/phase25-scope-g.mjs` | 2 |
| `scripts/phase26-a-probe.mjs` | 2 |
| `scripts/phase26-d-probe.mjs` | 2 |
| `scripts/phase27-scope-a.mjs` | 2 |
| `scripts/phase28-rerank-probe.mjs` | 2 |
| `scripts/phase30-readme-shots.mjs` | 2 |
| `scripts/phase30-subagent-probe.mjs` | 2 |
| `scripts/phase31-scope-13-probe.mjs` | 2 |
| `scripts/phase31-scope-15-probe.mjs` | 2 |
| `scripts/phase8-e-probe.mjs` | 2 |
| `scripts/phase8-g-probe.mjs` | 2 |
| `scripts/phase9-b-probe.mjs` | 2 |
| `scripts/phase9-c-probe.mjs` | 2 |
| `scripts/phase9-d-probe.mjs` | 2 |
| `scripts/scope-g/run-probes.mjs` | 2 |
| `scripts/generate-catalog.mjs` | 1 |
| `scripts/phase11-probe-c.mjs` | 1 |
| `scripts/phase14-a-probe.mjs` | 1 |
| `scripts/phase14-f-probe.mjs` | 1 |
| `scripts/phase15-a-probe.mjs` | 1 |
| `scripts/phase15-b-probe.mjs` | 1 |
| `scripts/phase15-c-probe.mjs` | 1 |
| `scripts/phase15-d-probe.mjs` | 1 |
| `scripts/phase15-e-probe.mjs` | 1 |
| `scripts/phase16-a-probe.mjs` | 1 |
| `scripts/phase17-g-probe.mjs` | 1 |
| `scripts/phase17-h-probe.mjs` | 1 |
| `scripts/phase21-g-simplicity.mjs` | 1 |
| `scripts/phase22-e-probe.mjs` | 1 |
| `scripts/phase22-f-probe.mjs` | 1 |
| `scripts/phase23-ralph-probe.mjs` | 1 |
| `scripts/phase26-b-probe.mjs` | 1 |
| `scripts/phase28-hot-probe.mjs` | 1 |
| `scripts/phase28-multi-probe.mjs` | 1 |
| `scripts/phase28-repo-probe.mjs` | 1 |
| `scripts/phase7-a-probe.mjs` | 1 |
| `scripts/phase9-f-check.mjs` | 1 |
| `scripts/zone-owner-item10-probe.mjs` | 1 |
| `scripts/zone-owner-item5-probe.mjs` | 1 |
| `scripts/zone-owner-item7-probe.mjs` | 1 |

---

## APPENDIX D — provenance & reproduction

```console
$ git -C jexi-os rev-parse HEAD
fcef3e7084838fbec7c298b9e82e91bf527fd020      # base this scan ran against
$ git grep -n -I -F <41 x -e 'dir/'> -- '*.js' '*.jsx' '*.mjs' '*.json' '*.yml' '*.yaml' '*.html' 'Dockerfile*' ':(exclude)docs/**'
```

Classifier (deterministic, applied per occurrence):

1. expand the match to the maximal path-like token;
2. require the old dir name to be a **whole path segment** (`@floating-ui/utils`, `.brain/`, `.jexi/learning/` excluded);
3. bucket: `NEW_STYLE` (parent is a new container) · `SERVER_INTERNAL` (`server/src/<name>`) · `API_ROUTE` / `URL` / `DEP_NOISE` / `DYNAMIC` (not filesystem refs) · `ROOT_ABS` (leading `/`) · `OLD_STYLE`;
4. for `OLD_STYLE` / `ROOT_ABS`, resolve the token against the file's directory and test existence → `MISSING` vs `resolves`.

| artifact | value |
| --- | --- |
| raw grep dump | 4,098 lines |
| occurrence records | 4,700 |
| scan passes | 3 (raw sweep → strict-segment resolver → special-case extraction) |
| false positives removed by hand | `@floating-ui/utils`, `@csstools/css-*` (segment rule); `.brain/`, `.jexi/learning/` (dot-dir rule); `node_modules/…`, `registry.npmjs.org/…` (dep noise) |

**Not touched, per scope guard:** no source file, config, workflow, Dockerfile, package.json, or test was modified. This document is the only change.

---

*Stage 3A/3 — reference discovery · read-only · base `fcef3e7` · 41 moved dirs · 4,700 references classified · 2,509 MISSING · 1,473 actionable outside `scripts/`.*
