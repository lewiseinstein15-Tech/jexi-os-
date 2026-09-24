# ROOT CLEANUP — MANIFEST (Phase 31 Scope 4-execute)

Produced by `scripts/phase31-scope-4-execute.mjs --execute`. Input: `docs/FILE-TREE-INVENTORY.md` (root universe) + last-touched dates. Every move is a `git mv` (content byte-identical, history preserved). Age gate for archive moves: 14 days.

Moves: 34 · Skipped: 11

## Moved

| # | old path | new path | group | reason |
|---|---|---|---|---|
| 1 | `TEST.md` | `docs/TEST.md` | MOVE 7 docs | age 13d; referrers: docs/SYSTEMS-M3-M8.md |
| 2 | `WATCH.md` | `docs/WATCH.md` | MOVE 7 docs | age 24d; no inbound references |
| 3 | `FIXLOG-B156.md` | `docs/archive/fixlog/FIXLOG-B156.md` | MOVE 1 fixlog | age 29d; no inbound references |
| 4 | `FIXLOG-B158-B160.md` | `docs/archive/fixlog/FIXLOG-B158-B160.md` | MOVE 1 fixlog | age 24d; no inbound references |
| 5 | `FIXLOG-B197.md` | `docs/archive/fixlog/FIXLOG-B197.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 6 | `FIXLOG-B199.md` | `docs/archive/fixlog/FIXLOG-B199.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 7 | `FIXLOG-B200.md` | `docs/archive/fixlog/FIXLOG-B200.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 8 | `FIXLOG-B201.md` | `docs/archive/fixlog/FIXLOG-B201.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 9 | `FIXLOG-B202.md` | `docs/archive/fixlog/FIXLOG-B202.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 10 | `FIXLOG-B203.md` | `docs/archive/fixlog/FIXLOG-B203.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 11 | `FIXLOG-B204.md` | `docs/archive/fixlog/FIXLOG-B204.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 12 | `FIXLOG-B205.md` | `docs/archive/fixlog/FIXLOG-B205.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 13 | `FIXLOG-B206.md` | `docs/archive/fixlog/FIXLOG-B206.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 14 | `FIXLOG-B207.md` | `docs/archive/fixlog/FIXLOG-B207.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 15 | `FIXLOG-B208.md` | `docs/archive/fixlog/FIXLOG-B208.md` | MOVE 1 fixlog | age 18d; no inbound references |
| 16 | `FIXLOG-B209.md` | `docs/archive/fixlog/FIXLOG-B209.md` | MOVE 1 fixlog | age 18d; referrers: FIXLOG-B208.md |
| 17 | `FIXLOG-B210.md` | `docs/archive/fixlog/FIXLOG-B210.md` | MOVE 1 fixlog | age 17d; referrers: FIXLOG-B208.md, FIXLOG-B209.md |
| 18 | `FIXLOG-B211.md` | `docs/archive/fixlog/FIXLOG-B211.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 19 | `FIXLOG-B213.md` | `docs/archive/fixlog/FIXLOG-B213.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 20 | `FIXLOG-B214.md` | `docs/archive/fixlog/FIXLOG-B214.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 21 | `FIXLOG-B215.md` | `docs/archive/fixlog/FIXLOG-B215.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 22 | `FIXLOG-B217.md` | `docs/archive/fixlog/FIXLOG-B217.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 23 | `FIXLOG-B218.md` | `docs/archive/fixlog/FIXLOG-B218.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 24 | `FIXLOG-B219.md` | `docs/archive/fixlog/FIXLOG-B219.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 25 | `FIXLOG-B220.md` | `docs/archive/fixlog/FIXLOG-B220.md` | MOVE 1 fixlog | age 17d; no inbound references |
| 26 | `AGENT_ONLINE.txt` | `docs/archive/misc/AGENT_ONLINE.txt` | MOVE 8 misc | age 30d; no inbound references |
| 27 | `demo-index.html` | `docs/archive/misc/demo-index.html` | MOVE 8 misc | age 17d; no inbound references |
| 28 | `demo-banner.jpg` | `docs/assets/demo-banner.jpg` | MOVE 8 misc | age 17d; no inbound references |
| 29 | `DEPLOY-IMAGE-RENDER.md` | `docs/deploy/DEPLOY-IMAGE-RENDER.md` | MOVE 3 docs/deploy | age 12d; no inbound references |
| 30 | `DEPLOY.md` | `docs/deploy/DEPLOY.md` | MOVE 3 docs/deploy | age 12d; no inbound references |
| 31 | `DEPLOYMENT.md` | `docs/deploy/DEPLOYMENT.md` | MOVE 3 docs/deploy | age 12d; referrers: docs/archive/reports/ARCHITECTURE-REPORT.md |
| 32 | `AUTONOMY-DESIGN.md` | `docs/design/AUTONOMY-DESIGN.md` | MOVE 4 docs/design | age 36d; referrers: docs/archive/fixlog/FIXLOG-B80.md |
| 33 | `UI-DESIGN-PROMPT.md` | `docs/design/UI-DESIGN-PROMPT.md` | MOVE 4 docs/design | age 41d; no inbound references |
| 34 | `b221-verify.cjs` | `scripts/tools/b221-verify.cjs` | MOVE 8 misc | age 3d; no inbound references |

## Skipped (still at root)

| path | group | status | reason |
|---|---|---|---|
| `FIXLOG-B216.md` | MOVE 1 fixlog | SKIP | referenced by operational file(s): .github/workflows/keepalive.yml; referenced by probe(s): scripts/phase17-g-probe.mjs; pinned (lead list); age 3d < 14d |
| `FIXLOG-B51.md` | MOVE 1 fixlog | SKIP | pinned (lead list) |
| `FIXLOG-B52.md` | MOVE 1 fixlog | SKIP | pinned (lead list) |
| `FIXLOG-B53.md` | MOVE 1 fixlog | SKIP | pinned (lead list) |
| `FIXLOG-B68.md` | MOVE 1 fixlog | SKIP | pinned (lead list) |
| `FINAL-PROOF-REPORT.md` | MOVE 2 reports | SKIP | age 12d < 14d |
| `ARCHITECTURE.md` | MOVE 5 docs/architecture | SKIP | referenced by read-only code/tests: tools/registry/governance.js (lead: BLOCKED) |
| `ANDROID.md` | MOVE 6 docs/guides | SKIP | referenced by read-only code/tests: server/test-b225.js (lead: BLOCKED) |
| `DATA_SOURCES.md` | MOVE 7 docs | SKIP | referenced by operational file(s): README.md; referenced by probe(s): scripts/phase9-f-check.mjs, scripts/phase9-f-notices.mjs; referenced by read-only code/tests: scripts/phase9-f-check.mjs, scripts/phase9-f-notices.mjs (lead: BLOCKED) |
| `DSH-PARITY.md` | MOVE 7 docs | SKIP | referenced by read-only code/tests: server/scripts/audit-bundles.js, server/src/services/BundleBase.js, server/test-dsh-batch11.js, server/test-dsh-batch12.js, server/test-dsh-batch13.js, server/test-dsh-batch9.js (lead: BLOCKED) |
| `SCALING.md` | MOVE 7 docs | SKIP | referenced by read-only code/tests: deploy/lb-worker.js (lead: BLOCKED) |

## Staying docs that mention a moved file

| doc | mentions |
|---|---|
| `docs/SYSTEMS-M3-M8.md` | `TEST.md` |
| `docs/archive/reports/ARCHITECTURE-REPORT.md` | `DEPLOYMENT.md` |
| `docs/archive/fixlog/FIXLOG-B80.md` | `AUTONOMY-DESIGN.md` |
