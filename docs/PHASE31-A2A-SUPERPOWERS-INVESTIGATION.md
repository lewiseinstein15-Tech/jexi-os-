# PHASE 31 SCOPE 3.5 — INVESTIGATION: a2a/** + skills/library/superpowers/ on main

Investigation-only scope (no fixes). Branch `investigation/a2a-superpowers`
from main tip `115b1fc` (phase-30 merge), tagged `pre-investigation-a2a-superpowers`.

## Environment note (label: RE-CLONED, git transport)

The sandbox workspace was restarted before this scope; the local clone's
`.git` directory did not survive (working tree + node_modules aside, git
state was gone). Git transport to GitHub was intact, so the repo was
**fully re-cloned via git transport** (all branches, tags, full history)
using the scope-1 storage in `.gitignore/secrets` path — no REST
reconstruction was needed. All refs below verified against the remote.
No local-only work was lost on the branch (prior scope's unpushed duplicate
commit `48eac37` from scope 16.5 was intentionally never pushed and is not
recoverable here; the accepted scope-16.5 commit `852a035` is on the
remote branch).

## STEP 0 — refs (raw)

```
$ git clone https://github.com/lewiseinstein15-Tech/jexi-os-.git   # (token-auth, re-clone)
Cloning into 'jexi-os-recon'...
$ git fetch origin
Already on 'main'
Your branch is up to date with 'origin/main'.
From https://github.com/lewiseinstein15-Tech/jexi-os-
 * branch            main       -> FETCH_HEAD
Already up to date.
$ git checkout -b investigation/a2a-superpowers
Switched to a new branch 'investigation/a2a-superpowers'
$ git tag pre-investigation-a2a-superpowers
tag: pre-investigation-a2a-superpowers -> 115b1fc7675fbf4954420ae66f2807e429f118d5
$ git push origin investigation/a2a-superpowers
To https://github.com/lewiseinstein15-Tech/jexi-os-.git
 * [new branch]      investigation/a2a-superpowers -> investigation/a2a-superpowers
$ git push origin pre-investigation-a2a-superpowers
To https://github.com/lewiseinstein15-Tech/jexi-os-.git
 * [new tag]         pre-investigation-a2a-superpowers -> pre-investigation-a2a-superpowers
$ git ls-remote origin refs/heads/investigation/a2a-superpowers refs/tags/pre-investigation-a2a-superpowers refs/heads/main
115b1fc7675fbf4954420ae66f2807e429f118d5  refs/heads/investigation/a2a-superpowers
115b1fc7675fbf4954420ae66f2807e429f118d5  refs/heads/main
115b1fc7675fbf4954420ae66f2807e429f118d5  refs/tags/pre-investigation-a2a-superpowers
```

SHAs cited in the brief, verified present:

```
db32eeb: commit | db32eeb 2026-09-20 phase-10(J): Agents View UI
3b9ed62: commit | 3b9ed62 2026-09-20 phase-10: RLM + Continual Harness - persistent REPL, harness CRUD + immutable base, /refine loop, daemon architecture, JSONL session tree, nuclear family A2A, autonomous mode, executable Python skills, context offloading (1969x token reduction measured), Agents View UI
68a8070: commit | 68a8070 2026-09-20 phase-22(D): superpowers skills (15) + hooks enforcement layer
```

Note: the brief cites `db32eeb` as the Phase 10 F acceptance SHA; `db32eeb`
is actually **phase-10(J)** (Agents View UI). Phase 10 **F** is
`37fb012` (see Q1). The phase-10 merge `3b9ed62` includes F.

## Q1 — a2a/**

Raw output:

```
$ git log --all --full-history --oneline -- a2a/
(empty — no commit on any ref ever touched a2a/)

$ git show db32eeb --stat | grep -i a2a
(empty, grep exit 1)

$ git show 3b9ed62 --stat | grep -i a2a
    phase-10: RLM + Continual Harness - ... nuclear family A2A, ...   <- commit subject line only; no a2a/ files in the stat

$ git log --all --diff-filter=D --oneline --name-only -- 'a2a/**'
(empty — no deletion of any a2a/ path exists in history)

$ git show 3b9ed62 --stat | grep -iE "family|subagent|nuclear"
    phase-10: ... nuclear family A2A ...
 harness/state/subagent-specs.js        |   7 +
 workforce/subagent/README.md           |  78 ++++
 workforce/subagent/discovery.js        |  20 +
 workforce/subagent/family.js           |  85 +++++
 workforce/subagent/index.js            |  53 +++
 workforce/subagent/messaging.js        | 106 ++++++
 workforce/subagent/retention.js        |  73 ++++
 workforce/subagent/storage.js          | 140 +++++++

$ grep -rln "nuclear\|subagent.*family\|family.*subagent" --include="*.js" src/ server/ workforce/ rlm/ harness/ | head -20
server/src/services/DomainRegistry.js
server/src/workforce/registry/catalog.js
workforce/subagent/family.js

$ git ls-files | grep -iE "a2a|subagent|nuclear" | head -30
harness/parity/subagent/contract.js
harness/parity/subagent/enforcement.js
harness/parity/subagent/index.js
harness/state/subagent-specs.js
scripts/phase30-subagent-probe.mjs
server/src/services/SubagentProviders.js
server/src/services/SubagentReport.js
server/src/services/SubagentRuntime.js
server/test-subagent-isolation.js
server/test-subagents.js
skills/library/claude-ecosystem/superpowers/skills/subagent-driven-development/SKILL.md
workforce/subagent/README.md
workforce/subagent/discovery.js
workforce/subagent/family.js
workforce/subagent/index.js
workforce/subagent/messaging.js
workforce/subagent/retention.js
workforce/subagent/storage.js
```

Corroborating — the actual phase-10(F) commit:

```
$ git show --stat --format='%h %ad %s' --date=short 37fb012
37fb012 2026-09-20 phase-10(F): nuclear family A2A + retained subagents (corrected family semantics)

 scripts/phase10-f-probe.mjs     | 315 +++++++++++++++++++++++++++++++++++++++
 workforce/subagent/README.md    |  78 +++++++++
 workforce/subagent/discovery.js |  20 +++
 workforce/subagent/family.js    |  85 ++++++++++
 workforce/subagent/index.js     |  53 +++++
 workforce/subagent/messaging.js | 106 ++++++++++
 workforce/subagent/retention.js |  73 ++++++
 workforce/subagent/storage.js   | 140 ++++++++++++
 8 files changed, 870 insertions(+)
```

**Verdict: MOVED-TO (naming only) — the Phase 10 F "nuclear family A2A" was
never shipped under `a2a/`; it was shipped and still lives on main at
`workforce/subagent/` (7 tracked files + `scripts/phase10-f-probe.mjs`).
`a2a/` appears in no commit on any ref (never created, never deleted). The
string "A2A" exists only in commit subjects and in the `workforce/subagent/`
messaging/family implementation. Nothing is missing.**

## Q2 — skills/library/superpowers/

Raw output:

```
$ ls skills/library/
IMPORT-MANIFEST.json  README.md  aas  claude-ecosystem  curator.mjs  engineering  obsidian  scientific  security

$ git log --all --full-history --oneline -- 'skills/library/superpowers/*'
(empty — nothing ever existed at that exact path)

$ git show 68a8070 --stat | grep -i superpower   (abridged; full stat: 23 superpowers files)
 .../superpowers/IMPORT-MANIFEST.json               | 252 ++++++++++
 .../claude-ecosystem/superpowers/hooks/README.md   |  75 +++
 .../superpowers/hooks/hooks-cursor.json            |  10 +
 .../claude-ecosystem/superpowers/hooks/hooks.json  |  17 +
 .../superpowers/hooks/run-hook.cmd                 |  46 ++
 .../claude-ecosystem/superpowers/hooks/run-hook.sh |  36 ++
 .../superpowers/hooks/session-start                |  53 ++
 .../claude-ecosystem/superpowers/hooks/session-start.sh |  52 ++
 .../superpowers/skills/brainstorming/SKILL.md      | 310 +++++++++
 .../skills/diagnosing-superpowers/SKILL.md         | 145 +++++
 .../superpowers/skills/executing-plans/SKILL.md    | 398 +++++++++++
 .../superpowers/skills/using-superpowers/SKILL.md  |  90 +++
 .../superpowers/skills/writing-plans/SKILL.md      | 217 +++++++
 .../superpowers/skills/writing-skills/SKILL.md     | 706 +++++++++++++++++++
 (+ remaining skills per commit: 15 SKILL.md total, 23 files total in 68a8070)

$ find skills/ -name "SKILL.md" | grep -i superpower
skills/library/claude-ecosystem/superpowers/skills/brainstorming/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/diagnosing-superpowers/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/dispatching-parallel-agents/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/executing-plans/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/finishing-a-development-branch/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/receiving-code-review/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/requesting-code-review/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/subagent-driven-development/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/systematic-debugging/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/test-driven-development/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/using-git-worktrees/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/using-superpowers/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/verification-before-completion/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/writing-plans/SKILL.md
skills/library/claude-ecosystem/superpowers/skills/writing-skills/SKILL.md

$ ls skills/library/claude-ecosystem/
n8n-skills  superpowers

$ git ls-files | grep -i superpower | head -30
(23 tracked files, all under skills/library/claude-ecosystem/superpowers/)

$ git ls-files 'skills/library/claude-ecosystem/superpowers/*' | wc -l
23
$ find skills/library/claude-ecosystem/superpowers -name "SKILL.md" | wc -l
15
```

**Verdict: EXISTS-AT-PATH — `skills/library/claude-ecosystem/superpowers/`
(23 tracked files: 15 SKILL.md skills + hooks layer + IMPORT-MANIFEST.json).
The exact 15 skills Phase 22 D shipped at 68a8070 are all present on main,
one-to-one, in the same commit's path shape. The audit path
`skills/library/superpowers/` is simply missing the
`claude-ecosystem/` nesting level. Nothing is missing.**

## Q3 — broader artifact check (main @ 115b1fc)

| # | Artifact | Path checked | Tracked files | Status |
|---|----------|--------------|---------------|--------|
| 1 | Phase 10 E session tree | `workgraph/session/**` (also top-level `session/**` = fleet only) | 6 (+5) | **PRESENT** (branch.js, compact.js, index.js, store.js, README + 1) |
| 2 | Phase 10 H skills creator | `skills/creator.js` + `skills/executable/**` | 1 + 5 | **PRESENT** |
| 3 | Phase 14 semantica | `semantica/**` | 26 | **PRESENT** |
| 4 | Phase 15 omnia + evomap | `omnia/**` + `evomap/**` | 15 + 10 | **PRESENT** |
| 5 | Phase 19 surfsense | `surfsense/**` | 31 | **PRESENT** |
| 6 | Phase 22 memory compress | `memory/session-compress.js` + `memory/session-inject.js` | both | **PRESENT** |
| 7 | Phase 27 fleet + routing | `session/fleet/**` + `providers/routing/**` + `providers/profiles/**` | 5 + 5 + 4 | **PRESENT** |

All seven accepted-phase artifacts are present on main.

## Conclusion

Both "missing artifacts" are **false positives from path drift in the audit**:

1. `a2a/**` — never the shipped path; Phase 10 F shipped "nuclear family A2A"
   as `workforce/subagent/` (still tracked on main; 7 files + probe).
2. `skills/library/superpowers/` — the 15 Phase 22 D skills live at
   `skills/library/claude-ecosystem/superpowers/` (still tracked, 23 files).

No deletion commits, no moved-then-deleted history, no partial losses. The
broader Q3 sweep (7 artifacts, Phases 10/14/15/19/22/27) is fully PRESENT.

Suggested follow-up (NOT done in this scope): fix the audit's expected paths
(`workforce/subagent/`, `skills/library/claude-ecosystem/superpowers/`) so
future audits do not flag these again; optionally record the phase→path map
in docs.

## Zone

One file added by this scope: `docs/PHASE31-A2A-SUPERPOWERS-INVESTIGATION.md`.
`git diff --stat origin/main..HEAD` shows only that file. No shipped file
touched, moved, or deleted.
