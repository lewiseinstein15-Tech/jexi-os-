# FIXLOG-B98 — Skill Auto-Discovery (DeepSeek Harness `skill-filesystem` + `tool-skill` mirror)

**Phase:** B98 · **Shipped:** 2026-08-17 · **Branch:** main (direct) · **CI:** green · **APK:** rebuilt

## Why
DeepSeek Harness treats skills as **files on disk** discovered from **ranked roots** —
`.dsh/skills` (project, rank 100) → `.agents/skills` (200) → custom dirs (300) →
user dirs (400/500) → bundled (600) — with **progressive disclosure** (the model sees
metadata only; the full body loads via a `skill` tool on use) and **watch/invalidation**
(fs watchers + host-mutation hooks). JEXI previously had a static skill registry +
SkillChain bundled library only. B98 ports the whole model so JEXI discovers skills
the same way DSH does.

## What was built

### `server/src/services/SkillDiscovery.js` (new, DSH-faithful)
- **Ranked roots exactly like DSH:**
  - `WORKSPACE_DIR/.jexi/skills` → `project-dsh` · rank **100**
  - `WORKSPACE_DIR/.agents/skills` → `project-agents` · rank **200**
  - plugin-mounted skills (`ctx.skills`) → `custom` · rank **300**
  - `DATA_DIR/skills` → `user-dsh` · rank **400**
  - `server/skills` (SkillChain library) → `bundled` · rank **600**
- **Discovery rules (DSH `discoverRoot`/`parseSkillFile` mirror):**
  - directory entry → `<dir>/SKILL.md`; `.md` file → flat skill
  - frontmatter **requires** `name` (kebab-case) + `description`; optional
    `whenToUse`, `user-invocable`, `disable-model-invocation`, `metadata`
  - legacy camelCase invocation keys **rejected** (DSH `parseInvocationPolicy`)
  - invalid files **ignored with recorded warnings** — discovery never fatal
  - same-name collisions → **lowest rank wins**; sorted (rank, name)
- **Progressive disclosure:** catalog = metadata only; `getSkillBody(name)` loads the
  full body on demand (folders merge `reference.md`, matching SkillChain behavior).
- **Watch + invalidation (DSH `SkillWatchManager`):** fs watchers on every root and on
  the parents of missing roots; `invalidateSkillCache()`; **self-healing mtime probe**
  (re-stats roots + known files each pass → create/edit/delete converges even without a
  watcher event); `observeHostMutation(path)` called after first-party write tools.
- **Model-facing catalog** `buildSkillCatalog(limit)` — bounded, metadata-only,
  modelInvocable-only, injected into the agent system prompt.
- **User authoring** `createUserSkill()` → `DATA_DIR/skills/<name>/SKILL.md` (+
  optional `reference.md`) — validated, auto-discovered instantly.

### Tools (gated ToolRuntime, zod output contracts)
- **`skill-search`** (NEW, registry 184 → **185**): metadata-only ranked search across
  the discovered catalog (name > description > whenToUse > token match); full bodies
  never returned.
- **`skill-load`** (upgraded): resolves through discovery first (project → user →
  bundled), returns `name/provider/source/rank/resourceBase/body`; falls back to the
  SkillChain roster library for legacy slugs; **fails honestly** for unknown skills
  (DSH: "skill is unknown or no longer available").
- Write tools now call `observeHostMutationFromArgs` after success → skills edited by
  JEXI itself invalidate discovery immediately.

### API
- `GET /api/skills/discovery` — summary (total, bySource, roots, warnings) + catalog
- `GET /api/skills/discovery/:name` — progressive full-body fetch (UI preview)
- `POST /api/skills/discovery` — create a user skill (validated, path-safe)
- `POST /api/skills/discovery/invalidate` — manual rescan
- Boot: watcher starts + discovered-count log line.

### Frontend (`SkillsScreen.jsx` — upgraded)
- **Tab bar: CATALOG (507 built-ins) / DISCOVERED (auto-discovered)** with live counts
- Discovered tab: source chips with DSH rank colors (PROJECT·100 / AGENTS·200 /
  PLUGIN·300 / USER·400 / BUNDLED·600), search, `📂+REF` progressive badge,
  `whenToUse` hints, NO-MODEL badge for `disable-model-invocation` skills
- Detail sheet: **full body loaded only when opened** (progressive), reference.md
  shown, **USE IN CHAT** button
- **ADD SKILL form**: name/description/whenToUse/body/reference → saved to the user
  root → instantly discovered + usable with `skill-load`
- RESCAN button, invalid-file warnings surfaced.

### Tests & fixes
- **`test-skill-discovery.js`** — 40 checks: roots/ranks/collisions, folder+flat forms,
  frontmatter validation, invocation policy, warnings, progressive get, mtime
  invalidation, host-mutation, model catalog bounds, both tools through the gated
  runtime with contracts, user authoring, watcher smoke. **40/40 green.**
- **Fixed a latent race in `test-process.js`** (found by the full sweep): `stopProcess`
  returns before the child's async `close` handler persists — that persist could
  clobber the fake registry the interrupted-on-load check writes, making the suite
  intermittently red on CI. Now waits for the close handler deterministically.
- Counts updated: test-tools 184 → 185, test-b49, **AGENT-CATALOG.md regenerated**
  (251 agents · 507 skills · **185 tools** · 100% reachable).
- B97.1: committed the remaining plugin-seam wiring (boot loader, `/api/plugins/runtime`,
  ToolRuntime plugin-tool gate) that was left uncommitted after B97.

## Verification
- `npm test` full sweep (40+ suites): **exit 0, green**
- `eslint index.js src test-*.js`: **0 errors**
- Frontend: esbuild compile OK (real `vite build` runs in CI — 7GB runner)
- `audit-roster --check`: PASSED — 251 agents · 507 skills · 185 tools · 100% reachable

## How the user sees it
Skills are now **files** JEXI finds on its own — drop a `SKILL.md` folder into the
workspace and it shows up in the app, in the model's prompt catalog, and through
`skill-search`/`skill-load` without a restart. Or author one in the app with ADD SKILL.
This is exactly how DeepSeek Harness ships `tool-skill`.
