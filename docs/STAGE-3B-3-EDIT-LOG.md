# STAGE 3B-3 — EDIT LOG: residual flags, unresolvable classification, final reference sweep

- **Branch**: `restructure/file-structure`
- **Base**: `fa9958d` (3B-2b) → this commit
- **Scope**: close the 3 flagged files from 3B-2b · classify the 115 tracked UNRESOLVABLEs · fix restructure residuals among the 25 suite failures · zero net-new broken refs
- **Rules honoured**: compute-every-path (no sed), no deletes (edits only), one commit, false-friend guard before every edit, `server/src/**` touched only where the ref points *outside* `server/`.

---

## PART A — the three 3B-2b flags

| Flag | Old | New | Reasoning / evidence |
|---|---|---|---|
| **A1** `.gitignore:42` | `hooks/state/` | `infra/hooks/state/` | Top-level `hooks/` → `infra/hooks/` in the restructure; the ignore pattern stopped matching and hook checkpoint state became visible to `git status`. Verified with `git check-ignore infra/hooks/state/*` (6 files) and a clean `git status`. |
| **A2** `agents/workforce/agents/loader.js`, `agents/workforce/registry/catalog.js`, `agents/workforce/trust/index.js` | `DEFAULT_ROOT = ../..` (resolved to *old* top-level `agents/` pre-move) | loader `DEFAULT_ROOT = ../../..` + walk roots `agents/catalog`, `agents/jexi`; vendor spec `agents/workforce/agents/vendor/…`; `REPO_ROOT` 3-up in `catalog.js` / `trust` | Intent determined as the **old top-level `agents/`** (sibling `catalog.js` holds the 88 `.agent.md`; `agents/jexi/` holds the coworkers). The 2-up anchor silently shifted to `agents/workforce` after the move. **Live proof**: roster `279 → 400` agents across 7 origins (agency-agents 278, jexi-canonical 88, runtime-employee 9, plugin 10, jexi-coworker 6, soul-profile 3, server-contract 6), 7 duplicates, **0 errors**. The pre-state 279 was 100 % vendor — the live tree was silently empty. |
| **A3** `scripts/scope-g/run-probes.mjs` | hard-coded `/home/z/my-project/jexi-os` (author machine) | runtime-computed `REPO_ROOT` / `SERVER_ROOT` / `OUT` (**option a**) + 2 literals (`commands/index.js` → `capabilities/commands/index.js`, `learning/observer.js` → `mind/learning/observer.js`) | Foreign absolute path would break on every machine but the author's; runtime computation matches the stage-wide convention. `node --check` clean. |

---

## PART B — classification of the UNRESOLVABLE set

Tracked re-run = **115** (doc run listed 84). Class | count | sample files | action:

| Class | Count | Sample files | Action |
|---|---|---|---|
| **MOVED-DIR-RESIDUAL** | 8 | `docker/DEPLOY.md`-class doc self-refs; `mind/knowledge/index.js` (self-ref example); `scripts/phase25-scope-h.mjs` (2× `console.log`); `scripts/generate-catalog.mjs`; `scripts/phase9-f-check.mjs`; `server/scripts/audit-bundles.js` | **7 fixed in 3B-3**; 1 left: `server/src/workforce/registry/catalog.js:10` — false friend (`server/src/workforce/registry/index.js` exists) → do-not-touch |
| **PRE-EXISTING-ROT** | 87 | refs already dangling at `e6bde65` (`git show e6bde65:<path>` absent) — retired phase scripts, deleted fixtures | logged only (out of zone) |
| **OTHER** | 20 | non-path contexts, ambiguous/description strings, env-name lookalikes | logged only |
| **FALSE-POSITIVE** | 73 (33 manual + 40 engine) | `SERVER_ROOT`, `SRC_DIR`, `tmp`, `fixtureRoot`, `MINI_REPO`, `ws`, `DATA_DIR`, bundle-internal `phase22-*`, MCP name `'memory'`, test-content assertions | never rewritten (kept in the FP list — re-confirmed in the Part D re-run) |
| **SERVER-INTERNAL-ONLY** | 40 | `server/src/{memory,context,kernel,scheduler,workgraph,tools,lsp,capability,workforce,providers}/**` — `server/src/` has its OWN subdirs → these refs resolve today | never touched (guard) |
| **FOREIGN-ABSOLUTE** | 1 tracked | `scripts/scope-g/run-probes.mjs` (`/home/z/my-project/jexi-os`) | **fixed in A3** (option a) |

---

## PART C — the 25 failing tests, classified per-test after a standalone run

### C1. RESTRUCTURE-RESIDUAL — fixed (18 tests)

| Test | Class | Action (computed, verified target exists) | New status |
|---|---|---|---|
| `[28] test-learning` | RESIDUAL (computed-root) | `server/src/kernel/hooks/learning-seam.js:22` repo-root seam `learning/index.js` → `mind/learning/index.js` | **PASS 46/46** |
| `[62] test-dsh-batch7` | RESIDUAL | `'..','src','components','SettingsPanel.jsx'` → `interfaces/console/…` (+ header doc) | PASS |
| `[64] test-dsh-batch9` | RESIDUAL | 2× console `utils/` imports; transitive `BundleBase.PARITY_FILE` | PASS |
| `[65] test-dsh-batch10` | RESIDUAL | 2× console `utils/` (`schemaForm`, `theme`) | PASS |
| `[66] test-dsh-batch11` | RESIDUAL | console `hooks/usePluginInventory.js` + `DSH-PARITY.md` → `docs/guides/` | PASS |
| `[67] test-dsh-batch12` | RESIDUAL | `SRC_DIR` → `interfaces/console` + `DSH-PARITY.md` | PASS |
| `[68] test-dsh-batch13` | RESIDUAL | `DSH-PARITY.md` → `docs/guides/` | PASS |
| `[88] audit-roster` | RESIDUAL | `CATALOG_PATH` → `docs/guides/AGENT-CATALOG.md` | **PASS** (252 agents · 508 skills · 219 tools) |
| `[89] test-b49` | RESIDUAL | `AGENT-CATALOG.md` → `docs/guides/` | PASS |
| `[98] test-b53` | RESIDUAL | `CommandCenter.jsx` → `interfaces/console/components/` | PASS |
| `[103] test-b78` | RESIDUAL (computed-root) | `server/src/services/CoworkerFiles.js:31` `AGENTS_DIR` `jexi-agents` → `agents/jexi` | **PASS 45/45** |
| `[123] test-permissions-modes` | RESIDUAL | `SettingsView.jsx` → `interfaces/console/components/` | PASS |
| `[126] test-cli` | RESIDUAL | `interfaces/cli/lib/config.js` `findServerDir()` one `..` short (found `interfaces/server`) → repo `server/` | **PASS 11 checks** |
| `[142] test-b206` | RESIDUAL | `AgentThinking.jsx`, `index.css`, `hooks/useJexiEngine.js` → `interfaces/console/` | PASS |
| `[143] test-b206b` | RESIDUAL | esbuild input `src/…` → `interfaces/console/…` | PASS |
| `[145] test-b207` | RESIDUAL | `read('src/index.css')` → `interfaces/console/index.css` | PASS |
| `[165] test-b224` | RESIDUAL | `MissionsScreen.jsx` ×3 → `interfaces/console/components/` | PASS |
| `[166] test-b225` | RESIDUAL | `Composer.jsx` → `interfaces/console/`; `ANDROID.md` → `docs/guides/` | PASS |

### C2. ENVIRONMENTAL — logged, not fixed (6 tests)

| Test | Class | Evidence | Status |
|---|---|---|---|
| `[83] test-everything` | ENVIRONMENTAL | `W36 NODE FLOOR: requires Node >= 22.5 (node:sqlite); running v20.20.2. Refusing to boot.` → 2 checks fail (`server boots`, `sdk server booted`) | FAIL (env) 123/2 |
| `[186] workgraph-persistence` | ENVIRONMENTAL | `error: 'node:sqlite unavailable'` | FAIL (env) 1/5 |
| `[187] verification-independence` | ENVIRONMENTAL | `node:sqlite unavailable` | FAIL (env) 6/2 |
| `[188] verification-spawn` | ENVIRONMENTAL | `node:sqlite unavailable` | FAIL (env) 9/1 |
| `[190] test-scheduler` | ENVIRONMENTAL | `node:sqlite` → null store (`reading 'cron'`) | FAIL (env) 8/2 |
| `[194] memory-provider` | ENVIRONMENTAL | `node:sqlite` → null store (`reading 'prepare'`) | FAIL (env) 1/6 |

Proof: `node -e "require('node:sqlite')"` → `ERR_UNKNOWN_BUILTIN_MODULE` on v20.20.2; the module landed in Node 22.5. Independent of the restructure.

### C3. PRE-EXISTING-FLAKY — logged, not fixed (1 test)

| Test | Class | Evidence | Status |
|---|---|---|---|
| `[29] test-hud` | PRE-EXISTING-FLAKY | All five `runtime/events/hud/*.js` are **byte-identical to `e6bde65`** (pure rename, 0-byte change); prior commit `45e9b8a` names the *HUD producer race*; `producer.js:385-391` documents it: the 120 ms debounce can fire *during* `await build()` (observed 1.4 s cold) → interleaved publish → check `consumer fan-out received the publish` races. | FLAKY 33–34/34 (6/10 under load, 5/5 idle) |

### C4. Source/script residuals surfaced while classifying (8 files, beyond the 14 test files)

| File | Fix |
|---|---|
| `server/src/services/BundleBase.js:24` | `PARITY_FILE` → `docs/guides/DSH-PARITY.md` |
| `server/scripts/audit-bundles.js:17` | `PARITY` → `docs/guides/DSH-PARITY.md` |
| `scripts/generate-catalog.mjs:19` | `CATALOG` → `docs/guides/AGENT-CATALOG.md` |
| `scripts/phase9-f-check.mjs:28` | `DATA_SOURCES.md` → `docs/guides/` |
| `server/src/kernel/hooks/learning-seam.js:22` | `learning/index.js` → `mind/learning/index.js` |
| `server/src/routes/hud.js:24` | dev candidate → `runtime/events/hud/index.js` (candidate 2 kept: CI `cp -r runtime/events/hud server/events/` populates it by design) |
| `server/src/services/CoworkerFiles.js:31` | `jexi-agents` → `agents/jexi` |
| `interfaces/cli/lib/config.js:78-80` | `findServerDir()` 3-up from `interfaces/cli/lib` → repo `server/` |

---

## PART D — final reference sweep (post-edit, whole tree)

| Metric | Value |
|---|---|
| Files scanned (source/config, `docs/` + `node_modules/` excluded) | **1 934** |
| Engine "FIXES planned" (post-3B-3) | **27** — identical set to the pre-3B-3 run → **all prior false positives** (bare `'src'`, `'brain'`, `'hooks'`, `'public'`, `'memory'`, `'knowledge'`, `'agents'` in root-variable / fixture / MCP-name contexts) |
| Skipped by engine (server-internal false friends) | 40 |
| UNRESOLVABLE | 109 (PRE-EXISTING-ROT + logged OTHER) |
| **NEW path-like literals introduced by 3B-3** | **19 — all 19 resolve to an existing target** |
| **NET-NEW broken refs** | **0** ✅ |

---

## VERIFICATION

| Check | Result |
|---|---|
| Build (`npx vite build`) | **GREEN** — `✓ built in 21.23s`, `dist/index.html` 7 072 B, `dist/sw.js` 1 997 B |
| `node --check` on all 22 source/test files edited in Part C | **0 syntax errors** |
| Checkpoint suite (chunked runner, 200 cmds) | **193 pass / 7 fail** — baseline was 175/25 → **+18, 0 new failures** |
| Remaining 7 | hud (pre-existing race) + everything & 5× AGI (Node-floor environmental) |
| `node scripts/audit-roster.js --check` | **PASS** — 252 agents · 508 skills · 219 tools · 100 % reachable |
| Loader roster (A2 live proof) | 400 agents / 7 origins / 0 errors |
| Diff shape | 34 files modified + this doc, **+60 / −60 lines** (pure 1:1 ref rewrites — no deletions) |
| False-friend guard | `server/src/{memory,context,kernel,scheduler,workgraph,tools,lsp,capability,workforce,providers}/**` untouched except refs pointing outside `server/` (learning-seam, BundleBase, CoworkerFiles, routes/hud) |

## FILES CHANGED IN 3B-3 (34 + 1)

```
.gitignore                                     A1
agents/workforce/agents/loader.js              A2
agents/workforce/registry/catalog.js           A2
agents/workforce/trust/index.js                A2
agents/swarm/hive/index.js                     B (doc-comment residual)
capabilities/tools/registry/audit.js           B (doc-comment residual)
integrations/providers/tokens/ephemeral.js     B (doc-comment residual)
mind/knowledge/index.js                        B (self-ref doc example)
tests/verification/verifiers/index.js          B (doc-comment residual)
scripts/phase25-scope-h.mjs                    B (2× console.log)
scripts/scope-g/run-probes.mjs                 A3
scripts/generate-catalog.mjs                   C4
scripts/phase9-f-check.mjs                     C4
server/scripts/audit-bundles.js                C4
server/scripts/audit-roster.js                 C (CATALOG_PATH)
server/src/kernel/hooks/learning-seam.js       C1/C4
server/src/routes/hud.js                       C4
server/src/services/BundleBase.js              C4
server/src/services/CoworkerFiles.js           C4
interfaces/cli/lib/config.js                   C1/C4
server/test-dsh-batch7.js  test-dsh-batch9.js  test-dsh-batch10.js   C1
server/test-dsh-batch11.js test-dsh-batch12.js test-dsh-batch13.js   C1
server/test-b49.js         test-b53.js         test-permissions-modes.js  C1
server/test-b206.js        test-b206b.js       test-b207.js         C1
server/test-b224.js        test-b225.js                             C1
docs/STAGE-3B-3-EDIT-LOG.md                    this record
```
