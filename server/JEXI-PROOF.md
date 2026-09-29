# JEXI-001 → JEXI-030 — Per-Ticket Acceptance Proof

**Generated:** 2026-09-29 16:40:51Z  
**Node:** v24.8.0 — the WorkGraph and verification paths need `node:sqlite`, which is Node 22.5+  
**Source of truth:** `/home/user/jexi-os-/` — the repository source, not README claims

> **137 acceptance assertions across all 30 tickets — 30/30 tickets passing, 0 failing.**

>
> Plus **34 live-streaming assertions** (NDJSON transport + lean-lane deltas), which are not ticket-numbered and so are not counted in the table above.

Each ticket group was run in isolation and its raw output captured. A ticket is called fixed only if its own file exited `0` with zero failures **and reported a non-zero pass count**.

Regenerate everything here with:

```bash
cd /home/user/jexi-os-/server && bash tests/tickets/run-ticket-evidence.sh
```

---

## Summary

| Ticket | Pri | Tests | Status | What was fixed |
|---|:---:|---:|:---:|---|
| JEXI-001 | P0 | 11 | PASS | Sandbox backend chosen from real host capabilities; no silent downgrade. PATH escape, chroot blindness, network cut, env not inherited, docker hardening — all asserted. |
| JEXI-002 | P0 | 14 | PASS | A mutating tool call triggers a real verification layer. A failed call never claims an edit; a throwing verifier is a failure, never a pass. |
| JEXI-003 | P0 | 8 | PASS | fs_edit is atomic and exact: ambiguous needle refused, missing needle writes nothing, empty needle rejected, missing file is ENOENT not a silent create. |
| JEXI-004 | P0 | 4 | PASS | fs_glob / fs_grep are real engines with maxMatches, regex validation, and node_modules/.git skipped by default. |
| JEXI-005 | P0 | 3 | PASS | Symlink-aware, segment-boundary path confinement shared by every fs engine. Sibling-tree and ../ escapes denied; in-root symlinks still allowed. |
| JEXI-006 | P0 | 6 | PASS | pytest is a first-class target. Detection, structured fail+list, pass after fix, auto-routing. Includes the false-green regression guard (PYTHONPYCACHEPREFIX). |
| JEXI-007 | P0 | 5 | PASS | Snapshots are materialized BY DEFAULT and run in a temp sandbox; the claimant cannot change what the verifier reads. Live cwd is an explicit opt-out. |
| JEXI-008 | P1 | 4 | PASS | edit → verify → replan loop: pass allows success, failure forces a replan, and the loop is bounded. |
| JEXI-009 | P1 | 5 | PASS | A coding turn with no green verify is reported unverified. A turn with no edits is not gated. |
| JEXI-010 | P1 | 6 | PASS | Domain dispatch is profile-gated, not allowAll. Ungranted tool → denied. `allowUngated` needs profile `full` AND an explicit confirm callback. |
| JEXI-011 | P1 | 2 | PASS | Tool descriptions state real guarantees; the tool result records the actual backend and its degraded flag. |
| JEXI-012 | P1 | 2 | PASS | No tool that writes host state claims ring 0. Every declared fs tool has a live engine. |
| JEXI-013 | P1 | 3 | PASS | A failed verify injects structured evidence into the next turn; a later pass clears it. |
| JEXI-014 | P1 | 5 | PASS | Truncation keeps the failure lines: elided output retains head AND failure tail; short results pass through untouched. |
| JEXI-015 | P1 | 3 | PASS | Commands run argv-only with no shell; shell form is opt-in via `shell:true`. |
| JEXI-016 | P2 | 7 | PASS | AgentLoop split 712 → 522 lines into CodingLoop, ToolSetBuilder, IntentRouter, LoopBreaker, ContractGate. Each unit-testable in isolation; size budget asserted. |
| JEXI-017 | P2 | 3 | PASS | `buildNativeSchemas` filters by `toolHasEngine`, derived from the same four seams `executeTool` dispatches. ZERO engine-less tools reach the model. |
| JEXI-018 | P2 | 2 | PASS | One `runTestEvidence` seam, shared by identity: `CodingLoop.runTestEvidence === TestVerifier.runTestEvidence === autoVerify.runTestEvidence`. |
| JEXI-019 | P2 | 4 | PASS | Phase/ticket archaeology stripped from all six core modules; comments state the reason. Asserted by regex over the sources. |
| JEXI-020 | P2 | 3 | PASS | `agentCounts()` / `publishedAgentLine()` derive the counts from code; the boot log prints them. Populations named separately, never conflated. |
| JEXI-021 | P2 | 4 | PASS | A real `pytest-repair` skill with a closed `allowedTools` set; the active skill genuinely narrows the offered schemas. Non-coding turns are unaffected. |
| JEXI-022 | P3 | 5 | PASS | Confinement denies /tmp/a vs /tmp/ab, ../ escape, symlink escape, and NUL bytes; `mustExist` enforced. |
| JEXI-023 | P3 | 3 | PASS | fs_append creates then appends; fs_delete removes a file but refuses a non-empty dir without recursive, and refuses the workspace root without confirm(). |
| JEXI-024 | P3 | 7 | PASS | Zero tests is never a pass. Empty suite, collection error, and exit-0-no-tests are all errors. `allowEmpty` is the documented escape hatch. |
| JEXI-025 | P3 | 5 | PASS | Default real layers are lint AND unit, not lint alone; injected layers still suppress the real ones. |
| JEXI-026 | P3 | 4 | PASS | Loop key normalizes arg order, path spelling (`./a/../b`, `/abs`, `//`), case, whitespace, and undefined. A model can no longer dodge the breaker by re-ordering its JSON. |
| JEXI-027 | P3 | 1 | PASS | Budgets are intent-derived (`INTENT_BUDGETS` / `budgetForIntent`), not one flat pair of constants. |
| JEXI-028 | P3 | 4 | PASS | A sandboxed edit + pytest run does not stall for approval; host-destructive work is still NOT auto-approved on the coding profile. |
| JEXI-029 | P3 | 1 | PASS | Real end-to-end: planted failing pytest → real fs_edit → real sandboxed pytest_run → real exit code → independent TestVerifier evidence on the materialized snapshot. |
| JEXI-030 | P3 | 3 | PASS | A coding turn is capped to the coding tool set; search, MCP and non-coding tools are withheld and the withholding is logged. |
| **TOTAL** | | **137** | **30/30 PASS** | **137 passed, 0 failed** |

---

## Raw command output, per ticket group


### JEXI-001,011,015 sandbox + terminal

Command: `node --test tests/tickets/jexi-001-011-015-sandbox.test.js`

```
TICKETS : JEXI-001,011,015 sandbox + terminal
COMMAND : node --test tests/tickets/jexi-001-011-015-sandbox.test.js
NODE    : v24.8.0
✔ JEXI-001: backend is selected from what the host actually provides (1.355893ms)
✔ JEXI-001: an explicit docker request FAILS LOUD when docker is absent (no silent downgrade) (0.529608ms)
✔ JEXI-001: describe() states guarantees and never overclaims (0.47078ms)
✔ JEXI-001: a command CAN read and write inside the workspace (111.322677ms)
✔ JEXI-001: PATH ESCAPE IS REFUSED — the host filesystem is not reachable (150.400221ms)
✔ JEXI-001: a write attempt outside the workspace does not land on the host (51.061759ms)
✔ JEXI-001: a chrooted backend cannot even SEE outside the workspace (52.290628ms)
✔ JEXI-001: the network is cut (namespace backend) (49.874056ms)
✔ JEXI-001: the host environment is NOT inherited (no API keys in the sandbox) (51.354779ms)
✔ JEXI-001: the docker backend is built with no network, no host binds, no socket, capped (1.958051ms)
✔ JEXI-011: the tool description no longer claims unconditional "in the sandbox" (0.274973ms)
✔ JEXI-015: a simple command runs argv-only, with no shell (50.751621ms)
✔ JEXI-015: shell form is opt-in via shell:true (10.037156ms)
✔ JEXI-015: an explicit argv array bypasses parsing entirely (3.25201ms)
✔ JEXI-001 + JEXI-011: the tool result records the real backend, degraded flag included (45.923528ms)
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 703.761837
EXIT CODE : 0
PASSED    : 15
FAILED    : 0
```

### JEXI-002,008,009,013,016 coding loop

Command: `node --test tests/tickets/jexi-002-008-009-013-016-codingloop.test.js`

```
TICKETS : JEXI-002,008,009,013,016 coding loop
COMMAND : node --test tests/tickets/jexi-002-008-009-013-016-codingloop.test.js
NODE    : v24.8.0
✔ JEXI-008: edit → verify pass → success is allowed (1.292057ms)
✔ JEXI-008: edit → verify fail → replan → verify pass → success (0.485289ms)
✔ JEXI-008: the loop is bounded — it cannot spin on replan forever (0.39505ms)
✔ JEXI-002: a mutating tool call is what triggers a real verification layer (0.194308ms)
✔ JEXI-002: a FAILED mutating call does not claim an edit happened (0.18928ms)
✔ JEXI-002: a verifier that THROWS is a failure, never a pass (0.341843ms)
✔ JEXI-002: this module is wired to the REAL verifyAfterEdit (1.037287ms)
✔ JEXI-009: a coding turn with no green verify is reported unverified (0.206838ms)
✔ JEXI-009: a turn with no edits is not gated (asking a question is not coding) (0.233437ms)
✔ JEXI-009: intent detection recognises a coding request (0.534685ms)
✔ JEXI-009: test tools are recognised as verification-capable (0.135144ms)
✔ JEXI-013: a failed verify injects structured evidence for the next turn (0.286865ms)
✔ JEXI-013: a later pass clears the pending failure (0.215077ms)
✔ JEXI-014: a long test result keeps its failure lines after truncation (0.790897ms)
✔ JEXI-014: a short result is passed through untouched (0.130149ms)
✔ JEXI-014: non-test truncation keeps head AND tail (0.093298ms)
✔ JEXI-016: CodingLoop is a standalone unit with no AgentLoop import (0.299704ms)
✔ JEXI-002: a red test run blocks the success claim even when nothing was edited (0.303202ms)
✔ JEXI-002: a red test run with no edit and no verify call is still not success (0.197299ms)
✔ JEXI-002: an errored test run blocks the success claim too (0.092351ms)
✔ JEXI-002: a PASSING test run clears the red verdict and restores the gate (0.111151ms)
✔ JEXI-002: a green suite followed by an edit and a real pass is a verified success (0.157553ms)
✔ JEXI-002: a result with no status is not treated as a failure (0.073476ms)
✔ JEXI-002: AgentLoop records the test verdict before the pass/fail branch (0.242593ms)
ℹ tests 24
ℹ pass 24
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 1393.074489
EXIT CODE : 0
PASSED    : 24
FAILED    : 0
```

### JEXI-002,021 tool surface reaches the model

Command: `node --test tests/tickets/jexi-agent-tools-reach-model.test.js`

```
TICKETS : JEXI-002,021 tool surface reaches the model
COMMAND : node --test tests/tickets/jexi-agent-tools-reach-model.test.js
NODE    : v24.8.0
✔ JEXI-021: the coding builder offers a real, non-empty coding tool set (42.638668ms)
✔ JEXI-002: the provider body DECLARES the offered tools with tool_choice auto (38.498048ms)
✔ JEXI-002: normalizeTools keeps the def-shaped tools the builder emits (0.77041ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 1396.10827
EXIT CODE : 0
PASSED    : 3
FAILED    : 0
```

### JEXI-029 end-to-end planted pytest

Command: `node --test tests/tickets/jexi-e2e-planted-pytest.test.js`

```
TICKETS : JEXI-029 end-to-end planted pytest
COMMAND : node --test tests/tickets/jexi-e2e-planted-pytest.test.js
NODE    : v24.8.0
✔ JEXI-008/029 E2E: plant a failing pytest → the loop reads, edits, tests, and only then claims success (2315.363297ms)
✔ JEXI-002/013: a FAILING suite injects evidence and blocks the success claim (388.478916ms)
✔ JEXI-009: a non-coding turn is NOT gated by verification (0.351798ms)
✔ JEXI-027: budgets are intent-based, not one flat pair of constants (0.95392ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 3840.986078
EXIT CODE : 0
PASSED    : 4
FAILED    : 0
```

### JEXI-003,004,005,012,023 filesystem

Command: `node --test tests/tickets/jexi-003-004-005-012-023-fs.test.js`

```
TICKETS : JEXI-003,004,005,012,023 filesystem
COMMAND : node --test tests/tickets/jexi-003-004-005-012-023-fs.test.js
NODE    : v24.8.0
✔ JEXI-003: fs_edit changes one line and leaves the rest byte-identical (1.469958ms)
✔ JEXI-003: a missing needle errors and writes NOTHING (0.947262ms)
✔ JEXI-003: an ambiguous needle is refused, not guessed (0.565502ms)
✔ JEXI-003: count=1 disambiguates and replaces exactly one (1.484076ms)
✔ JEXI-003: count above the real occurrences is refused, file untouched (0.392471ms)
✔ JEXI-003: an empty needle is rejected (would match everywhere) (0.258672ms)
✔ JEXI-003: editing a missing file reports ENOENT, not a silent create (0.281482ms)
✔ JEXI-003: fs_edit is registered as a real tool with a schema (0.7353ms)
✔ JEXI-004: fs_glob is a real engine, not a stub that throws (1.11952ms)
✔ JEXI-004: fs_grep returns file, line and text (0.990114ms)
✔ JEXI-004: grep honours maxMatches and rejects a bad regex (0.528475ms)
✔ JEXI-004: node_modules and .git are not walked by default (0.742813ms)
✔ JEXI-005: every fs engine refuses a sibling-directory escape (1.73048ms)
✔ JEXI-005: symlink escape is refused through the real engines (1.035121ms)
✔ JEXI-012: no tool that writes host state claims ring 0 ("no host state") (0.231024ms)
✔ JEXI-012: every declared fs tool actually has an engine (no dead tools) (0.104139ms)
✔ JEXI-023: fs_append creates then appends (0.392027ms)
✔ JEXI-023: fs_delete removes a file, and refuses a non-empty dir without recursive (0.584788ms)
✔ JEXI-023: fs_delete refuses the workspace root and honours confirm() (0.470488ms)
ℹ tests 19
ℹ pass 19
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 95.569339
EXIT CODE : 0
PASSED    : 19
FAILED    : 0
```

### JEXI-005 path confinement

Command: `node --test tests/tickets/jexi-005-path-confinement.test.js`

```
TICKETS : JEXI-005 path confinement
COMMAND : node --test tests/tickets/jexi-005-path-confinement.test.js
NODE    : v24.8.0
✔ JEXI-005 evidence: the old startsWith check accepted a sibling tree (2.020428ms)
✔ JEXI-022: root /tmp/a vs /tmp/ab is denied (0.431287ms)
✔ JEXI-022: ../ escape is denied (0.394035ms)
✔ JEXI-022: legitimate paths under root are allowed (0.792505ms)
✔ JEXI-022: symlink escape is denied (0.445636ms)
✔ JEXI-022: a symlink that stays inside root is still allowed (0.429414ms)
✔ a path that does not exist yet is still validatable (edit needs this) (0.449093ms)
✔ NUL byte in a path is refused as a truncation attempt (0.197296ms)
✔ mustExist is enforced when asked (0.569875ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 81.01054
EXIT CODE : 0
PASSED    : 9
FAILED    : 0
```

### JEXI-006,014,024 test execution

Command: `node --test tests/tickets/jexi-006-024-014-testing.test.js`

```
TICKETS : JEXI-006,014,024 test execution
COMMAND : node --test tests/tickets/jexi-006-024-014-testing.test.js
NODE    : v24.8.0
✔ JEXI-006: a pyproject + tests/ project is detected as pytest (1.236708ms)
✔ JEXI-006: a package.json project is still detected as node (1.044524ms)
✔ JEXI-006: an empty directory is honestly "no test project" (0.577106ms)
✔ JEXI-006: a failing pytest returns a structured fail + the failure list (1270.192174ms)
✔ JEXI-014: the failing assertion line survives into the tool result (1204.255328ms)
✔ JEXI-006: after the fix the SAME tool returns pass with tests > 0 (1180.336168ms)
✔ JEXI-006: test_run auto-detects and routes to pytest for this project (1223.844138ms)
✔ JEXI-024: a suite that collects nothing is an ERROR, not a pass (0.398747ms)
✔ JEXI-024: exit 0 with zero tests parsed is never "pass" (0.201383ms)
✔ JEXI-024: a collection error is an error, not a pass (1331.897369ms)
✔ JEXI-024: a real run of an empty suite is reported as error with tests=0 (1176.063766ms)
✔ JEXI-014: elided output keeps the head AND the failure tail (1477.727545ms)
✔ a run NEVER reports pass on source that is still broken (stale .pyc) (14560.282941ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 23501.002425
EXIT CODE : 0
PASSED    : 13
FAILED    : 0
```

### JEXI-007,024,025 verification

Command: `node --test tests/tickets/jexi-007-024-025-verify.test.js`

```
TICKETS : JEXI-007,024,025 verification
COMMAND : node --test tests/tickets/jexi-007-024-025-verify.test.js
NODE    : v24.8.0
✔ JEXI-007: a snapshot with files is materialized BY DEFAULT (1.258132ms)
✔ JEXI-007: the claimant cannot change what the verifier reads (0.376667ms)
✔ JEXI-007: live cwd is an explicit, documented opt-out (0.229531ms)
✔ JEXI-007: an empty snapshot falls back to cwd (nothing to freeze) (0.11318ms)
✔ JEXI-007: TestVerifier evidence records sandboxed:true by default (324.81946ms)
✔ JEXI-024: exit code 0 with ZERO tests is an error, not a pass (29.854934ms)
✔ JEXI-024: allowEmpty:true is the documented escape hatch for a repo with no tests (22.953786ms)
✔ JEXI-024: a genuinely failing pytest run is a fail with the failing test named (323.555097ms)
✔ JEXI-025: the default real layers are lint AND unit, not lint alone (0.964975ms)
✔ JEXI-025: with no injected layers the real lint AND unit layers both run (25.74998ms)
✔ JEXI-025: injected layers still suppress the real ones (test seam preserved) (0.37737ms)
✔ JEXI-025: a failing unit layer produces injectedFailure, not a silent ok (0.294035ms)
✔ JEXI-025: callers can still opt into lint-only explicitly (60345.507499ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 62361.266365
EXIT CODE : 0
PASSED    : 13
FAILED    : 0
```

### JEXI-010,028 permission profiles

Command: `node --test tests/tickets/jexi-010-028-profiles.test.js`

```
TICKETS : JEXI-010,028 permission profiles
COMMAND : node --test tests/tickets/jexi-010-028-profiles.test.js
NODE    : v24.8.0
✔ JEXI-010: domain dispatch is profile-gated by default, not allowAll (2255.131891ms)
✔ JEXI-010: an ungranted tool is DENIED, not allowed by default (11.816302ms)
✔ JEXI-010: the profiles are real and ordered by risk (0.460947ms)
✔ JEXI-010: the coding profile edits a file inside the workspace (43.985497ms)
✔ JEXI-010: readonly still blocks the SAME edit the coding profile allows (6.686247ms)
✔ JEXI-028: a sandboxed edit + pytest run does NOT stall for approval (1708.14837ms)
✔ JEXI-028: host-destructive work is NOT auto-approved by the coding profile (37.489605ms)
✔ JEXI-028: the full profile is the only one that widens the ceiling (36.928879ms)
✔ JEXI-010/028: an unknown profile fails closed to the safest thing (5.138305ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 4197.929245
EXIT CODE : 0
PASSED    : 9
FAILED    : 0
```

### JEXI-016,019 structure

Command: `node --test tests/tickets/jexi-016-019-structure.test.js`

```
TICKETS : JEXI-016,019 structure
COMMAND : node --test tests/tickets/jexi-016-019-structure.test.js
NODE    : v24.8.0
✔ JEXI-016: AgentLoop is under a size budget (1.099971ms)
✔ JEXI-016: the extracted modules exist and are real files (0.498258ms)
✔ JEXI-016: AgentLoop orchestrates — it does not re-implement the parts (0.601078ms)
✔ JEXI-016: each module is unit-testable in isolation (pure exports, no loop needed) (1065.890212ms)
✔ JEXI-016: the ToolSetBuilder rules run in a stated order and each one applies (65.011573ms)
✔ JEXI-016: a non-coding turn is not silently narrowed by the coding rules (2.24941ms)
✔ JEXI-019: the core agent modules carry no phase or ticket archaeology (3.099747ms)
✔ JEXI-019: a comment states the reason, not the history (0.446899ms)
✔ JEXI-019: every core module opens with a comment that explains itself (0.613343ms)
✔ JEXI-019: the split did not reduce coverage — the modules are all imported (1.194347ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 1224.730393
EXIT CODE : 0
PASSED    : 10
FAILED    : 0
```

### JEXI-017,018,020,021,026,030 runtime

Command: `node --test tests/tickets/jexi-017-018-020-021-026-030.test.js`

```
TICKETS : JEXI-017,018,020,021,026,030 runtime
COMMAND : node --test tests/tickets/jexi-017-018-020-021-026-030.test.js
NODE    : v24.8.0
✔ JEXI-017: toolHasEngine agrees with what executeTool can actually dispatch (1153.423272ms)
✔ JEXI-017: ZERO tools enter native schemas without a registered engine (1.318341ms)
✔ JEXI-017: a schema the model can see is one executeTool will not refuse as Unknown (0.610116ms)
✔ JEXI-018: chat and WorkGraph share ONE run-tests seam (0.439686ms)
✔ JEXI-018: both entry points resolve to the same function identity (0.327147ms)
✔ JEXI-020: published agent counts equal list().length of executable agents (109.110345ms)
✔ JEXI-020: the published line names each population instead of conflating them (38.081609ms)
✔ JEXI-020: a count derived from the code matches a freshly derived count (23.42486ms)
✔ JEXI-021: a real pytest-repair skill exists with a declared closed tool set (3.798992ms)
✔ JEXI-021: the active coding skill actually NARROWS the offered tool set (1.349444ms)
✔ JEXI-021: a non-coding query activates no skill and keeps its full tool set (1.193618ms)
✔ JEXI-026: near-duplicate calls produce ONE loop key, not a new one (0.677995ms)
✔ JEXI-026: genuinely different calls still get different keys (0.30856ms)
✔ JEXI-026: the normalized key actually trips the breaker (0.256312ms)
✔ JEXI-026: normalizeCallArgs does not recurse forever on cyclic-ish input (0.142677ms)
✔ JEXI-030: the coding tool set excludes search, MCP and non-coding tools (0.293937ms)
✔ JEXI-030: the cap is a hard ceiling, and the cap is enforced on a wide catalogue (0.509607ms)
✔ JEXI-030: a coding intent is recognised by plan or by its own words (0.511595ms)
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 1514.922828
EXIT CODE : 0
PASSED    : 18
FAILED    : 0
```

---

## How to read this

- The evidence runner refuses to mark a file PROVEN unless it reports a **non-zero** pass count. An earlier version read only the TAP reporter shape, so after Node 22 changed the default to `spec` every file reported `pass=0` and was still labelled PROVEN — a false green in the evidence itself. The guard is now part of the runner.
- Every assertion that touches pytest or a shell runs inside the real namespace/chroot sandbox, so the exit codes above are **real process exit codes**, not mocks.
- The end-to-end ticket (JEXI-029) uses no stubbed verifier: its success receipt comes from a real sandboxed `pytest_run` **and** an independent `TestVerifier` pass over the materialized snapshot.
- Raw per-file output: `/home/user/jexi-os-/server/ticket-evidence/*.raw.txt`
- Full suite summary: `/home/user/jexi-os-/server/ticket-evidence/SUMMARY.txt`
