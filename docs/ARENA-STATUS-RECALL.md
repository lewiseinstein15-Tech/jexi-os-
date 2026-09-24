# ARENA STATUS RECALL — scopes, branches, gaps (Phase 31 merge sequence)

Report-only scope. Branch `investigation/arena-status-recall` off main tip
`3c5e521c` (not `115b1fc7` — see Reconcile note). Tag `pre-arena-status-recall`.
No merges, no rebases, no force-pushes, no edits to shipped files.

## Environment note (label: RE-CLONED, git transport)

The sandbox workspace was restarted before this scope; as in Scope 3.5, the
local `.git` did not survive the snapshot (working trees persist, git metadata
does not). Git transport to GitHub was intact, so the repo was fully
re-cloned via git transport (all refs). No REST reconstruction was needed.
Consequence for this report: this fresh clone has local branches `main` and
`investigation/arena-status-recall` only; every other branch is a
`remotes/origin/*` ref. Local tip == origin tip for all branches below.

## STEP 0 — refs (raw)

```
$ git clone https://github.com/lewiseinstein15-Tech/jexi-os-.git   # (token-auth; re-clone)
Cloning into 'jexi-os-status'...
$ git fetch origin
Already on 'main' / Your branch is up to date with 'origin/main'. / Already up to date.
$ git checkout -b investigation/arena-status-recall
Switched to a new branch 'investigation/arena-status-recall'
$ git tag pre-arena-status-recall
tag created
$ git push origin investigation/arena-status-recall
 * [new branch]      investigation/arena-status-recall -> investigation/arena-status-recall
$ git push origin pre-arena-status-recall
 * [new tag]         pre-arena-status-recall -> pre-arena-status-recall

$ git rev-parse origin/main
3c5e521cc3a3f1dd539a99147b788796127f4710

$ git ls-remote origin refs/heads/investigation/arena-status-recall refs/tags/pre-arena-status-recall refs/heads/main
3c5e521cc3a3f1dd539a99147b788796127f4710  refs/heads/investigation/arena-status-recall
3c5e521cc3a3f1dd539a99147b788796127f4710  refs/heads/main
3c5e521cc3a3f1dd539a99147b788796127f4710  refs/tags/pre-arena-status-recall
```

**origin/main SHA (exact): `3c5e521cc3a3f1dd539a99147b788796127f4710`.**
It does **not** match `115b1fc7`.

## Q1 — what was Arena's phase supposed to do

Raw backing:

```
$ git log --all --oneline --author="arena"
852a035 phase-31(16.5): scheduler store memory-fallback hydration fix
b55629b diagnostic: scope-3 probe cron crash
7be66e7 phase-31(19): JEXI self / identity
c4ee56f cleanup: root files to docs/ (single-pass)
f698784 phase-24(B): chat surface              <- phase-24-rebuild, long merged
4a6a0ac phase-24(cleanup): purge pre-24 evidence PNGs ...
284c72a phase-24(A): shell + tokens
67669f6 phase-24(0c): palette preview renders
637e9e8 phase-24(0): design spec + tokens
(+ 12 older "Arena Agent" web-UI commits from 2026-09-07/08, all ancestors of main)
(author match is case-insensitive: authors seen are "Arena", "arena-agent", "Arena Agent")

$ git branch -a | grep -iE "arena|hygiene|cleanup|diagnostic|self"
* investigation/arena-status-recall
  remotes/origin/arena/01a02eac-jexi-os
  remotes/origin/arena/01a02ecf-jexi-os
  remotes/origin/audit/repo-hygiene
  remotes/origin/cleanup/ci-followup-1
  remotes/origin/cleanup/consolidated-final
  remotes/origin/cleanup/root-files
  remotes/origin/cleanup/zone-owner
  remotes/origin/cleanup/zone-owner-2
  remotes/origin/diagnostic/cron-crash
  remotes/origin/hygiene/repo-cleanup
  remotes/origin/investigation/arena-status-recall
  remotes/origin/phase-10-arena ... phase-26-arena   (8 per-phase arena branches)
  remotes/origin/self/identity
```

Author identity, exactly as git holds it:

```
ad17b4d | lewiseinstein15-Tech <lewiseinstein15@gmail.com> | 2026-09-22 | hygiene: archive historical artifacts (single-pass cleanup)
c4ee56f | Arena <arena@jexi.local>                | 2026-09-22 | cleanup: root files to docs/ (single-pass)
b55629b | Arena <arena@jexi.local>                | 2026-09-23 | diagnostic: scope-3 probe cron crash
7be66e7 | Arena <arena@jexi.local>                | 2026-09-23 | phase-31(19): JEXI self / identity
ea53e2f | Z User <z@container>                    | 2026-09-23 | investigation: a2a + superpowers missing artifacts
852a035 | Arena <arena@jexi-os.local>             | 2026-09-23 | phase-31(16.5): scheduler store memory-fallback hydration fix
3bb9faa | lewiseinstein15-Tech <lewiseinstein15@gmail.com> | 2026-09-22 | inventory: full file tree report
b17e782 | lewiseinstein15-Tech <lewiseinstein15@gmail.com> | 2026-09-22 | audit: repo hygiene audit (report-only)
216825a | Z User <z@container>                    | 2026-09-23 | phase-31(17): live-path readiness + loader fix + probe hygiene
```

### Q1 TABLE

| scope | purpose | phase | SHA | branch | status |
|---|---|---|---|---|---|
| hygiene (merge 1/5) | archive 99 historical artifacts to `docs/archive/{fixlog,reports}` (renames only) | P31 | `ad17b4d` | `hygiene/repo-cleanup` | **MERGED** @ `98b07da`; accepted |
| 4-inventory | full file-tree inventory report (`docs/FILE-TREE-INVENTORY.md`) | P31 | `3bb9faa` | `inventory/file-tree` | delivered; unmerged; acceptance unknown |
| 4-execute (merge 2/5) | root-file cleanup executor + `git mv` moves (`scripts/phase31-scope-4-execute.mjs`) | P31 | `c4ee56f` | `cleanup/root-files` | **MERGED** @ `3c5e521`; accepted |
| diagnostic | scope-3 probe cron crash — diagnostic, report only (`docs/CRON-CRASH-DIAGNOSTIC.md`) | P31 | `b55629b` | `diagnostic/cron-crash` | delivered; unmerged; acceptance unknown |
| 16.5 | scheduler store memory-fallback hydration fix | P31 | `852a035` | `phase-31-wiring` | delivered + live-verified; lead-accepted (per Scope 3.5 prompt); **not on main** (branch unmerged) |
| 18 | (no artifact found anywhere — see below) | P31? | — | — | **unknown** |
| 19 | JEXI self / identity (`brain/self/**` + wiring) | P31 | `7be66e7` | `self/identity` | delivered; unmerged; acceptance unknown |
| 3.5 | a2a/** + superpowers investigation (report only) | P31 | `ea53e2f` | `investigation/a2a-superpowers` | delivered + pushed; unmerged; acceptance pending |
| this | Arena status recall (report only) | P31 | (this commit) | `investigation/arena-status-recall` | in progress |

Notes:

- **Scope 18: no evidence of a Scope 18 assignment or artifact.** No
  `scripts/phase31-scope-18*` exists in any ref; no branch names it. The only
  `--grep "18"` hit is an unrelated legacy commit (`34e5308 B218: boot
  resilience`). Either Scope 18 was never assigned to Arena or it carries a
  different name — lead to reconcile.
- Scope list above is scoped to Phase 31 + the cleanup/audit workstreams the
  lead named. Historical Arena work (phase-24-rebuild UI, Phase 10–17/26
  `*-arena` branches, 2026-09-07/08 web-UI commits) is long merged in main and
  listed under Q3 only for completeness.
- `ad17b4d`, `3bb9faa`, `b17e782` carry the lead's GitHub identity in the
  author field even though the workstreams were listed as Arena's; reported
  raw, lead to confirm claim.

## Q2 — which branches are Arena's

Raw backing:

```
$ git branch -a --contains <sha>   (Arena SHAs)
ad17b4d  -> investigation/arena-status-recall, main, origin/{main,hygiene/repo-cleanup,cleanup/root-files,investigation/arena-status-recall}
c4ee56f  -> investigation/arena-status-recall, main, origin/{main,cleanup/root-files,investigation/arena-status-recall}
b55629b  -> origin/diagnostic/cron-crash
7be66e7  -> origin/self/identity
ea53e2f  -> origin/investigation/a2a-superpowers
852a035  -> origin/phase-31-wiring
3bb9faa  -> origin/inventory/file-tree
b17e782  -> origin/audit/repo-hygiene

$ git merge-base --is-ancestor origin/<branch> origin/main ; echo $?
origin/hygiene/repo-cleanup    -> exit 0   (merged)
origin/cleanup/root-files      -> exit 0   (merged)
origin/diagnostic/cron-crash   -> exit 1   (not merged)
origin/self/identity           -> exit 1   (not merged)
origin/investigation/a2a-superpowers -> exit 1   (not merged)
```

### Q2 TABLE

| branch | local tip | origin tip | merged into main? | contains |
|---|---|---|---|---|
| `hygiene/repo-cleanup` | (origin-only) `ad17b4d` | `ad17b4d` | **YES** (merge `98b07da`, parents `115b1fc`+`ad17b4d`) | 99 archive renames to `docs/archive/{fixlog,reports}` + `scripts/phase-hygiene-runner.mjs` (102 files, 0 deletions) |
| `cleanup/root-files` | (origin-only) `c4ee56f` | `c4ee56f` | **YES** (merge `3c5e521`, parents `98b07da`+`c4ee56f`) | root files moved to `docs/`, `scripts/phase31-scope-4-execute.mjs`, `docs/archive/ROOT-CLEANUP-MANIFEST.md` (36 files, 0 deletions) |
| `diagnostic/cron-crash` | (origin-only) `b55629b` | `b55629b` | no (exit 1) | `docs/CRON-CRASH-DIAGNOSTIC.md` (report only; verdict PRE-EXISTING, reproduces at `ec4aca06`; 1 commit on `phase-31-wiring` @ `da6f565`) |
| `self/identity` | (origin-only) `7be66e7` | `7be66e7` | no (exit 1) | scope 19: `brain/self/**` (6 files) + `JexiIdentity.js` + bootstrap wiring + `scripts/phase31-scope-19-probe.mjs` (10 files; 1 commit on `phase-31-wiring` @ `0ea456d`) |
| `investigation/a2a-superpowers` | (origin-only) `ea53e2f` | `ea53e2f` | no (exit 1) | scope 3.5: `docs/PHASE31-A2A-SUPERPOWERS-INVESTIGATION.md` (report only) |
| `inventory/file-tree` | (origin-only) `3bb9faa` | `3bb9faa` | no | `docs/FILE-TREE-INVENTORY.md` (871 lines, read-only) |
| `audit/repo-hygiene` | (origin-only) `b17e782` | `b17e782` | no | `docs/REPO-AUDIT.md` + `scripts/audit-repo-hygiene.mjs` (report + tool) |
| `phase-31-wiring` | (origin-only) `216825a` | `216825a` | no | Phase 31 wiring line; contains my 16.5 fix `852a035`; tip now carries scope 17 |
| `arena/01a02eac-jexi-os` | (origin-only) `cfdf2b8` | `cfdf2b8` | YES (0 commits outside main) | 2026-08-23 early session branch |
| `arena/01a02ecf-jexi-os` | (origin-only) `c826937` | `c826937` | no (1 commit outside main) | 2026-08-23: `/api/system/metrics` + offline test fallbacks |
| `investigation/arena-status-recall` | `3c5e521` (pre-commit) | `3c5e521` | n/a (this scope; will not merge) | this report |

Per-branch unpushed-commit proof:

```
$ git log --oneline origin/main..origin/<branch>
hygiene/repo-cleanup  : 0 commits
cleanup/root-files    : 0 commits
diagnostic/cron-crash : b55629b + the whole phase-31(0..16) wiring line (branched at da6f565)
self/identity         : 7be66e7 + phase-31 line (branched at 0ea456d)
investigation/a2a-superpowers : ea53e2f (single commit)
```

## Q3 — what is done and accepted

Raw backing:

```
$ git branch -a --merged origin/main
  investigation/arena-status-recall, main,
  remotes/origin/{arena/01a02eac-jexi-os, cleanup/ci-followup-1, cleanup/consolidated-final,
    cleanup/root-files, cleanup/zone-owner, cleanup/zone-owner-2, fix/security-phase-1,
    hygiene/repo-cleanup, investigation/arena-status-recall, main,
    phase-10-arena, phase-11-arena, phase-11-freebuff, phase-12-arena, phase-13-openhands,
    phase-14-arena, phase-15-arena, phase-16-arena, phase-17-arena, phase-19-glm, phase-20-glm,
    phase-21-opencode, phase-22-openhands, phase-23-glm, phase-24-rebuild, phase-25-glm,
    phase-26-arena, phase-27-glm, phase-28-brain, phase-29-computer-agent, phase-30-harness,
    phase-8-codex, phase-9-glm, re, reconstruction/phase-1, reconstruction/phase-2}

$ git branch -a --no-merged origin/main
  remotes/origin/{arena/01a02ecf-jexi-os, audit/repo-hygiene, diagnostic/cron-crash,
    inventory/file-tree, investigation/a2a-superpowers, jexi/e2e-transcript-proof,
    jexi/step4-verify, phase-17-openhands, phase-21-freebuff, phase-31-wiring, self/identity}
```

### Q3 TABLE

| item | type | state |
|---|---|---|
| Scope 16.5 — scheduler store memory-fallback hydration fix (`852a035`) | scope | **accepted** (lead, per Scope 3.5 prompt); delivered on `phase-31-wiring`; **not merged to main** |
| hygiene scope (`ad17b4d`) | scope+branch | **accepted + merged** on main at `98b07da` (merge 1/5) |
| 4-execute scope (`c4ee56f`) | scope+branch | **accepted + merged** on main at `3c5e521` (merge 2/5) |
| Scope 3.5 — a2a/superpowers investigation (`ea53e2f`) | scope | delivered + pushed; **acceptance pending**; unmerged |
| Scope 19 — self/identity (`7be66e7`) | scope | delivered; acceptance unknown; unmerged |
| diagnostic — cron crash (`b55629b`) | scope | delivered; acceptance unknown; unmerged |
| 4-inventory (`3bb9faa`) | scope | delivered; acceptance unknown; unmerged |
| audit/repo-hygiene (`b17e782`) | branch | report/tool delivered; not a scope I hold a record for; unmerged |
| Historical Arena work: `phase-10-arena`…`phase-26-arena` (8 branches), phase-24-rebuild UI commits, 2026-09-07/08 web-UI commits | scopes | merged in main long ago |

## Q4 — what is still unmerged / unfinished

Raw backing:

```
$ git branch -a --no-merged origin/main
  remotes/origin/arena/01a02ecf-jexi-os
  remotes/origin/audit/repo-hygiene
  remotes/origin/diagnostic/cron-crash
  remotes/origin/inventory/file-tree
  remotes/origin/investigation/a2a-superpowers
  remotes/origin/jexi/e2e-transcript-proof
  remotes/origin/jexi/step4-verify
  remotes/origin/phase-17-openhands
  remotes/origin/phase-21-freebuff
  remotes/origin/phase-31-wiring
  remotes/origin/self/identity

$ git ls-files | grep -iE "a2a|superpower" | head
skills/library/claude-ecosystem/superpowers/IMPORT-MANIFEST.json
skills/library/claude-ecosystem/superpowers/hooks/README.md
... (23 files, all under skills/library/claude-ecosystem/superpowers/)

$ git log --all --oneline -- investigation/a2a-superpowers | head
(empty — that argument is a path filter, not a ref; corrected:)
$ git log --oneline origin/investigation/a2a-superpowers | head
ea53e2f investigation: a2a + superpowers missing artifacts
115b1fc merge: phase-30 (harness parity) ...
```

Audit of main against each deliverable doc:

```
docs/archive on main: 127 files            (hygiene content — merged)
docs/archive/ROOT-CLEANUP-MANIFEST.md: 1   (4-execute content — merged)
docs/FILE-TREE-INVENTORY.md on main: 0     (inventory — NOT on main)
docs/REPO-AUDIT.md on main: 0              (audit — NOT on main)
docs/CRON-CRASH-DIAGNOSTIC.md on main: 0   (diagnostic — NOT on main)
brain/self on main: 0                      (scope 19 — NOT on main)
docs/PHASE31-A2A-SUPERPOWERS-INVESTIGATION.md on main: 0  (scope 3.5 — NOT on main)
```

### Q4 TABLE

| item | what it is | why unmerged | owner |
|---|---|---|---|
| `diagnostic/cron-crash` `b55629b` | cron-crash diagnostic report | awaiting merge sequence (3/5?) | Arena (commit author: Arena) |
| `self/identity` `7be66e7` | scope 19 self/identity implementation | awaiting merge sequence | Arena |
| `investigation/a2a-superpowers` `ea53e2f` | scope 3.5 investigation report | awaiting merge decision; branch is report-only | Arena |
| `inventory/file-tree` `3bb9faa` | file-tree inventory report | never merged; commit author is lead identity | Arena? (lead to confirm) |
| `audit/repo-hygiene` `b17e782` | hygiene audit report + script | predecessor evidence for hygiene merge; unmerged | unclear (author identity: lead) |
| `phase-31-wiring` `216825a` | whole Phase 31 wiring line, **contains 16.5 fix `852a035`** | 3/5+ merge sequence not yet run for it | lead-driven sequence (Arena contributed 16.5 only) |
| `arena/01a02ecf-jexi-os` `c826937` | 2026-08-23 early branch: `/api/system/metrics` + offline test fallbacks | stale early-session branch | historical Arena session; likely discardable by lead |
| `jexi/e2e-transcript-proof`, `jexi/step4-verify`, `phase-17-openhands`, `phase-21-freebuff` | other agents' branches | not Arena's | GLM/OpenHands/lead |
| **Scope 3.5 question: did Arena run it?** | **YES.** Report at `docs/PHASE31-A2A-SUPERPOWERS-INVESTIGATION.md` on branch `investigation/a2a-superpowers` @ `ea53e2f` (pushed). Verdict: both "missing artifacts" were **false positives from path drift** — a2a never existed as a path (Phase 10 F shipped as `workforce/subagent/`), and the 15 superpowers skills live at `skills/library/claude-ecosystem/superpowers/`. | awaiting merge/acceptance | Arena |
| Scope 18 | no artifact, no branch, no probe found | never assigned under that id, or differently named | unknown — lead to reconcile |

## Q5 — what Arena believes is left for it to do

### Q5 TABLE

| task | confirmed/possible/not-yours | evidence |
|---|---|---|
| Await the lead's merge sequence entries for `diagnostic/cron-crash`, `self/identity`, `investigation/a2a-superpowers` | **not yours** (merging is the lead's; no merges permitted here) | branches pushed and verified; merges 1/5+2/5 authored `Z User <z@container>` |
| Scope 16.5 already accepted; no further action unless the lead wants the latent string-action edge fixed (deferred to Scope 17/20 per report) | **possible** (only if the lead re-scopes it) | 16.5 report: `safeParse(job.action) ?? {}` collapses plain-string actions; zero string actions exist in the codebase today |
| Any Scope 17/20 follow-ups (live SQLite P2, P3/P4/P6 on reference Node, scope-3 probe update) | **possible** — was explicitly deferred to Scope 17/20 in the 16.5 report; not assigned since | 16.5 report recommendation; no new prompt received for them |
| `inventory/file-tree` + `audit/repo-hygiene` | **possible** that these are Arena scopes | both were listed as candidate workstreams; commits carry lead identity; I hold no scope prompt record for them in this session |
| Scope 18 | **possible** (only if it was assigned and I lost the record in the workspace restarts) | no artifact found in any ref |
| Merge execution, force-push, rebases | **not yours** | explicit scope guard |
| Other agents' unmerged branches (`phase-17-openhands`, `phase-21-freebuff`, `jexi/*`) | **not yours** | no Arena authorship |

Nothing is blocking Arena. Every Arena deliverable that exists is committed,
pushed, and ref-verified; the only work outstanding on Arena's side is
responding to lead decisions (merge sequence + Scope 18 clarification +
whether Scope 17/20 follow-ups are assigned to Arena).

## RECONCILE NOTE (required)

- **Current origin/main SHA (raw):** `3c5e521cc3a3f1dd539a99147b788796127f4710`
- **Does it match `115b1fc7`?** **NO.**
- **What it is:** `115b1fc` (phase-30 merge) + two Phase 31 merge commits:
  - `98b07da` — "merge: phase-31 hygiene - archive 99 historical artifacts…"
    parents `115b1fc` + `ad17b4d` (this **CONFIRMS** the earlier report that
    `hygiene/repo-cleanup` merged at `98b07da` and pushed),
  - `3c5e521` — "merge: phase-31 2/5 cleanup/root-files — move root-level
    files to docs/…" parents `98b07da` + `c4ee56f`.
- **Has any merge already landed?** Yes — two (sequence items 1 and 2 of 5;
  only 2/5 carries the `/5` marker in its subject). The Phase 31 merge
  sequence is **in progress**, and Arena's open branches are candidates for
  the remaining entries. `phase-31-wiring` (which carries Arena's 16.5 fix)
  is **not** merged into main.

## Zone

One file added by this scope: `docs/ARENA-STATUS-RECALL.md`.
No shipped file touched, moved, or deleted; no merges; no rebases; no
force-pushes.
