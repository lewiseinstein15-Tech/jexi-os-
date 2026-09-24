# ZONE-OWNER.md

Deferred fixes from merged phases, in version control. Six phases merged and
cross-verified: **8** (`6cd28ea`) · **9** (`8a748a4`) · **11** (`fc2e69e`) ·
**12** (`e7e0e1f`) · **17** (`5ce176e`) · **21** (`00b4786`).

Statuses: `OPEN` · `DONE` · `BLOCKED-FOR-DECISION` (owner call required) ·
`NOT-VERIFIED` (sandbox cannot prove it) · `MERGED→#n` (duplicate). Cross-verifier
(GLM) re-checks DONE items after each merge. One commit per item on
`cleanup/zone-owner`; every DONE needs a live probe.

---

## Wiring — production code hookups

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| 2 | DONE | Ph 17 J | P0 | `server/src/providers/adapters/ollama.js`, `providers/adapters/ollama.provider.js` | The runtime Ollama adapter never calls `security/shield/inference-exposure.js#checkBind()` — the 0.0.0.0 refusal only exists in the standalone checker; consolidate and remove the duplicate. (absorbs #35) — **DONE @ probe scripts/zone-owner-item2-probe.mjs (11/11 incl. real socket binds). Consolidation choice: runtime adapter is CANONICAL (init()/chat()/stream() enforce; default bind 127.0.0.1); standalone `providers/adapters/ollama.provider.js` REMOVED; scripts/phase17-j-probe.mjs repointed (still 10/10).** — **2-COMPLETION @ probe scripts/zone-owner-item2c-probe.mjs (7/7): the `runtime/LLMClient.js#tryOllama` leg (Step 2 discovery b) now consults the canonical adapter guard (`new OllamaAdapter({baseUrl}, env).init()`) BEFORE any fetch — public bind refused with fetch-spy 0 HTTP requests; loopback silent, 1 request; `ALLOW_OLLAMA_EXPOSED=1` proceeds with the WARNING line. One refusal point, zero duplicated guard logic.** |
| 3 | DONE | Ph 17 D | P0 | `server/src/memory/index.js` (recall 45–53, prefetch 56–63), `memory/{hybrid-search,lifecycle,confidence}.js` | The confidence/lifecycle/KG/hybrid upgrade is shipped but unwired — recall/prefetch return raw backend rows with no re-ranking or retrieval reinforcement. — **DONE @ probe scripts/zone-owner-item3-probe.mjs (9/9). recall/prefetch now: lifecycle advance() on read (AGING persisted; ARCHIVED excluded), hybrid BM25+vector RRF re-rank (E_NO_RESULTS → legacy scoreRelevance order), noteRetrieval() persisted with weight-0 discipline (confidence Δ=0 at pinned now). Requires Node ≥22.5 (node:sqlite) — on Node 20 the whole memory backend is pre-existing-broken (6/7 baseline fails).** |
| 4 | DONE | Ph 9 G | P0 | `intelligence/trust-pipeline/broker.js:178`, `events/provenance/label.js` | Broker `ok:true` responses carry no provenance label — fetched data enters the system unlabeled. — **DONE @ probe scripts/zone-owner-item4-probe.mjs (11/11 incl. REAL network fetch: celestrak.org 200 via SSRF-pinned transport → label 'observed'). ok:true return now carries frozen provenance (wrapBroker-parity, registration-driven label); refusals carry explicit `provenance: null`; phase9-g P9 assertion updated to the new contract (all 11 sub-probes green, 70/70).** |
| 5 | DONE | Ph 9 E | P0 | `server/src/providers/LLMClient.js:791`, `providers/cost/caps.js` | Cost caps are not consulted on the live model-call path — a capped session can still spend. — **DONE @ probe scripts/zone-owner-item5-probe.mjs (7/7). `costGate()` (caps.check) inserted beside the budget-gate precedent in generateContent AND before every model call in streamPlainText / __generateWalk / generateWithToolsLoop (incl. plain-text fallback) / runToolLoopForProvider rounds; E_SESSION_CAPPED is terminal (no ladder slide — mock got 0 calls); E_NO_BUDGET passes through (zero behavior change when caps unconfigured); cap survived real process death via JEXI_COST_LEDGER_PATH. NOTE: real file is `server/src/providers/runtime/LLMClient.js` (item text cited `providers/LLMClient.js:791` — the budget-gate line). Tests: request-economy+provider-health+ollama-provider 32/32, test-llm-models, test-unified-providers 25/25.** |
| 6 | DONE | Ph 9 D | P0 | `server/src/**` (routes), `providers/tokens/ephemeral.js` | Ephemeral mint/verify has no HTTP route — long-lived provider keys still reach clients by default. — **DONE @ probe scripts/zone-owner-item6-probe.mjs (7/7, REAL curl vs REAL express boot of the route). New `server/src/routes/tokens.js` (surface.js conventions, thin adapter — no new token logic): POST /api/tokens/mint → {ok,token,expiresAt,scope,subject}; GET /api/tokens/verify → {ok,reason?,scope,subject,expiresAt}; GET /api/tokens/policy (ceilings, no secrets). Mounted in server/index.js beside mountHud. Tampered→TAMPERED, past-TTL→EXPIRED, unknown scope→400 E_UNKNOWN_SCOPE, ttl>1h→400 E_TTL_ABOVE_CEILING. Token never printed (masked+sha256 fingerprint). test-api-surface 19/19; phase9-d p1–p10+su all pass.** |
| 13 | DEFERRED (future) | Ph 12 D | P2 | `server/src/tools/execution/executor.js` | Tools bypass `gatedDispatch` — permission gates are not enforced on the execution path. |
| 14 | DEFERRED (future) | Ph 12 E | P2 | `server/mcp/registry.json` | AAS MCP server unregistered — agent-selection layer can't route to it. |
| 15 | DEFERRED (future) | Ph 12 F | P2 | `skills/aas/catalog.js` | aas dir-skip is hardcoded, not path-based — `skills/library/aas` never joins the combined index. |
| 16 | DEFERRED (future) | Ph 12 | P2 | CodingLoop / VerificationLoop call sites, `skills/design/**` gates | Phase 12 skills and gates exist but nothing calls them at runtime. |
| 17 | DEFERRED (future) | Ph 11 I | P2 | `server/src/context/sources/code.js`, `capability/code/graph-first.js` | code source still raw-reads files instead of graph-first `answerStructuralQuery` (+fallback). |
| 18 | DEFERRED (future) | Ph 17 E | P2 | `server/src/context/sources/index.js:17`, `context/viking/**` | viking filesystem is merged but unregistered as a context source — tiered reads unused. |
| 19 | DEFERRED (future) | Ph 9 H | P2 | `server/src/services/director/Verifier.js:41`, `verification/visual/**` | `BROWSER_CLAIM_RE` verifies words, not pixels — visual QA harness unwired. |
| 24 | DEFERRED (future) | Ph 9 I | P4 | `intelligence/trust-pipeline/registered-urls.js` | Missing OSINT registrations: `api.open-meteo.com`, `api.tfl.gov.uk`, `api.nasa.gov`, `api.tidesandcurrents.noaa.gov`. |
| 25 | DEFERRED (future) | Ph 9 I | P4 | `intelligence/trust-pipeline/registered-urls.js` | NABSA relocated the GBFS systems index host — current registration 404s; re-register the new host. |
| 26 | DEFERRED (future) | Ph 9 I | P4 | ships layer, `registered-urls.js` | AISStream WSS client unimplemented behind the ships layer (honest `unauthorized` today). |
| 27 | DEFERRED (future) | Ph 9 J | P4 | `registered-urls.js`, layers | Remaining OSINT gaps: flights CORS workaround, fires size cap/chunked fetch, traffic overpass egress. |
| 33 | DONE | Ph 11 J | P4 | `tool-directory.json` | codegraph-mcp + reach-mcp registered — verified in Phase 11 J probe. |

## Bugs — real defects

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| 1 | DONE | Ph 17 H cross-verify | P0 | `server/src/services/SkillLoop.js:59`, `skills/design/diagram-design/SKILL.md` | `readSkillMeta` regex `^([a-z_]+):` silently DROPS camelCase frontmatter keys (`whenToUse`, `allowedTools`) across 818 security + 166 scientific + 144 library + Phase 12 skills. Fix to `[a-zA-Z_]+`; then optionally revert the H scope's lowercase workaround. — **DONE @ probe scripts/zone-owner-item1-probe.mjs (10/10; 323/1142 SKILL.md files were affected); lowercase workaround still loads; diagram-design revert left as optional follow-up.** |
| 7 | DONE | Ph 11 | P1 | `server/test-hud.js` (producer/assert) | "first publish bumps revision to 1" — the suite's one standing failure; fix assert or producer. — **DONE @ probe scripts/zone-owner-item7-probe.mjs (5/5). The PRODUCER was wrong, the assert right: `events/hud/producer.js#publish()` never cancelled the pending 120ms `schedulePublish` debounce, which fired during the manual publish's `await build()` (build measured 1.4s cold) → interleaved publishes → revision 2. Fix: publish() cancels the debounce (it IS the coalescing point); `_reset()` disarms stale timers. Debounce burst-coalescing verified intact. test-hud.js now 34/0.** |
| 8 | DONE | Ph 11 merge | P1 | `server/test-b211.js` | Lease TTL 5ms race — flaky under load; widen the margin. — **DONE @ probe scripts/zone-owner-item8-probe.mjs (6/6). Flake REPRODUCED: old TTL 5ms loses to a 10ms stall (busy-burn between claim and assert — exactly what GC/CPU pressure does) → "still leased" assert fails. Fix: TTL 5→250ms, sleep(15)→sleep(350) — assert window now 25× the reproduced flake condition, survives a 5× worse 50ms stall; expiry/reclaim semantics unchanged (ready after 350ms, second worker claims). test-b211.js 111/111 three runs, two of them under 4-way busy-loop CPU load.** |
| 9 | DONE | Ph 12 merge | P1 | `scripts/lint-agent-baseline.sh` | Baseline lint checks PRESENCE, not verbatim bytes — drift passes lint. Check byte-equal after header. — **DONE @ probe scripts/zone-owner-item9-probe.sh (11/11). Hole confirmed empirically: byte-compare ran on a FIXED 8-line window, so lines APPENDED inside the block passed lint (old script exits 0 on a block with an extra "ignore all previous instructions" bullet — reproduced via pre-tag copy). Fix: extract the WHOLE block (anchored header `^## Prompt Defense Baseline[[:space:]]*$` → first blank line / next heading / EOF), normalize \r + trailing whitespace, byte-compare via diff. Safety scan first: all 1296 tracked files have blank/heading/EOF right after the canonical block and anchored==unanchored header counts → zero false positives (full-repo run still failing: 0). Word drift / missing / duplicate / suffixed-header all FAIL; whitespace + CRLF variants still PASS by design.** |
| 10 | DONE | Ph 9 cross-verify | P1 | `scripts/phase9-h-probe.mjs` | `decodePng(null)` TypeError when no browser — probe should clean-skip with `BROWSER_UNAVAILABLE` like the runner does. — **DONE @ probe scripts/zone-owner-item10-probe.mjs (11/11). Old probe reproduced: p2 uncaught TypeError ERR_INVALID_ARG_TYPE at decodePng(null) (exit 1), p1 false-FAILs detection (exit 1). Fix: `browserSkipGate()` on every browser-requiring case (p1–p6, p8, p10) — prints `SKIP: <case> — BROWSER_UNAVAILABLE (<detail>)` and exits 2, or 0 with `--skip-ok`: the runner CLI's own contract verbatim. p9 degrades surgically: cases 1–2 SKIP, cases 3–4 (CLI skip exit codes) still proven → `[P9] n PASS / 0 FAIL / 2 SKIP` exit 0. p7/p11 unchanged, still pass. Real absence (this sandbox: playwright-core present, chromium binary missing) clean-skips with no forced env.** |
| 11 | DONE | Ph 9 cross-verify | P1 | `scripts/phase9-i-probe.mjs` (p12), `scripts/phase9-j-probe.mjs` (p11) | Gate-time session assertions hardcode branch/HEAD (`phase-9-glm`, 16/2 files) — meaningless post-merge; retire or parametrize. — **DONE @ probe scripts/zone-owner-item11-probe.mjs (10/10). Choice: PARAMETRIZE (shape facts are durable history) + retire only true session state. Gate commit now discovered via `git log --diff-filter=A -- <the probe itself>` (deterministic: exactly one add-commit each — 8858281 phase-9(I)/16 files, 53ca1d7 phase-9(J)/2 files, both verified ancestors of HEAD) or overridden via `--commit=<sha>` / `JEXI_PHASE_COMMIT`. `branch === 'phase-9-glm'` replaced by `merge-base --is-ancestor <commit> HEAD` containment; clean-tree `git status` check retired (old p12 flagged a tree with one untracked junk file; new p12 passes it). Override proven non-vacuous: wrong-shape commit → FAIL "exactly 16 files". Old probes reproduced failing post-merge (exit 1).** |
| 12 | DONE | Ph 8 H | P1 | XBOW harness payload/verifier | Pipeline coverage gaps: path-traversal (F-002 never emitted), hardcoded-secret (F-005 INCONCLUSIVE) — payload or verifier wrong; investigate and fix in-zone. — **DONE @ probe scripts/zone-owner-item12-probe.mjs (13/13). Verdict: BOTH payload AND verifier were wrong; fixed in the pipeline (harness README itself said "they belong to the pipeline" — harness untouched except its honesty baseline). (1) F-002: all three legs (A01 detection probe, doer PoC, verifier re-exec) used a FIXED `../../package.json` that 404s from the fixture's 3-deep jail (proved live: 404 vs 200 at depth 3) and a `....//` evasion for a filter the target doesn't have → depth-iterating payloads 1..6 + percent-encoded `%2e%2e%2f` second vector. (2) F-005: verifier's static branch produced exactly 1 method → HIGH's ≥2 bar unreachable → permanent INCONCLUSIVE; added a second independent static observation (blind source-tree rescan re-discovering the reported file; values redacted; doer side mirrored). Result: harness `--level all` → union resolved=10 missed=0 fp=0 (was 8/2/0), passRate 2/2 (was 1/2), F-002+F-005 VERIFIED 2/2, F-011 escape-trap STILL dropped (honesty guard), phase8-e green, phase8-g 32/32. README baseline section updated with old+new numbers. NOTE: scripts/phase8-h-probe.mjs crashes on a hardcoded foreign sandbox path (`/home/z/my-project/scratch`, line 25) — PRE-EXISTING (0-line diff vs pre-tag, imports no pipeline module, not in suite); left untouched, candidate for a hygiene item.** |
| 36 | RESOLVED (cleanup, doc path) | Step 2 discovery (a) | P1 | `server/src/memory/index.js`, `server/src/memory/backends/sqlite.js`, `server/package.json` (engines) | Node-version gate / broken fallback promise: index.js documents "SQLite when available, else an in-memory fallback", but on Node <22.5 `openSqliteMemoryBackend` returns a dead backend (`available:false`, `db:null`) and the first write TypeErrors — `test-memory-provider` fails 6/7 AT BASELINE on Node 20 (verified). Add an engines/boot-time version check OR implement the documented fallback. |

## Hygiene — docs, ignores, configs

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| 20 | RESOLVED (cleanup) | Ph 9 C | P3 | `docs/REBUILD-MAP.md:27`, `docs/AUTONOMY_AUDIT.md:72+99`, `docs/UPGRADE-FINAL-REPORT.md:72`, `.github/workflows/ci.yml` | 4 stale tool counts (218/~151) vs real 219 — `tools/registry/audit.js` FAILs; fix docs and wire the audit into CI. (absorbs #34) |
| 21 | RESOLVED (cleanup) | Ph 17 OpenHands flag | P3 | `AGENTS.md` | "direct to main, no branches" contradicts the multi-agent branch workflow actually in use — document both modes. |
| 38 | RESOLVED (cleanup) | Step 2 item 1 follow-up | P3 | `skills/design/diagram-design/SKILL.md` | Optional: revert the lowercase frontmatter workaround (`whentouse:`, `allowedtools:`) — item 1 fixed the underlying `readSkillMeta` regex, and the item-1 probe proved the camelCase variant loads correctly; the workaround is no longer load-bearing. |
| 22 | RESOLVED (cleanup) | Ph 12 merge | P3 | `.github/workflows/ci.yml`, `.github/workflows/validate-divisions.yml` | Workflows don't trigger on `phase-*`/`cleanup/*` pushes — no CI feedback before merge (root cause of the lint-verbatim gap). (absorbs #37 — the suite also requires a ROOT `npm install`: 4 tests (test-rich-render, test-setup-wizard, test-b197, test-b200) spawn root `node_modules/esbuild` and crash ENOENT without it; verified in Step 2 full-suite run. Document/automate the two-step install in CI + setup docs.) |
| 39 | DONE | Pass 1 merge finding | P3 | `data/provider-health.json`, `.gitignore` | Runtime ProviderHealth ledger got swept into git by a `git add -A` (pass-1 item-5 commit `7ec8f8c`) — untrack it and ignore the root `data/` dir. — **DONE @ probe scripts/zone-owner-item39-probe.sh (8/8). `git rm --cached data/provider-health.json` (working copy kept — it is the live ledger); `.gitignore` gains ROOT-ANCHORED `/data/` in the Runtime-data section — anchoring is load-bearing: `agents/data/**` and `skills/**/data/**` hold TRACKED files and an unanchored `data/` would silently ignore future additions there (probe checks 4–5). `git ls-files data/` now empty and was the only entry. Writer intact: `ProviderHealth.persist()` proven live under DATA_DIR override (fresh dir, atomic tmp+rename) and the on-disk ledger still parses. Affected tests raw: test-f5-hardening 37/0, test-memory-vector ALL PASSED, test-reliability ALL PASS.** |
| 40 | DONE | Pass 1 merge finding | P3 | `server/evaluation/RESULTS.md`, `.gitignore` | Evaluation results file is rewritten by tests at runtime (pass-1 suite run left it modified) — untrack + ignore, verify writing tests don't break. — **DONE @ probe scripts/zone-owner-item40-probe.sh (8/8). Root of the churn: `server/package.json`'s `test` script ENDS with `node evaluation/run.js`, so every suite run rewrites the dated row (2026-09-19 row = pass-1 suite). `git rm --cached` (local history kept on disk) + EXACT-path ignore `server/evaluation/RESULTS.md` (run.js/tasks.js stay tracked). Fresh-clone proof: with the file ABSENT, `node evaluation/run.js` recreates header+table+today's row and passes the 0.90 gate (OVERALL 1.000, exit 0); same-day re-run REPLACES the row (no duplicates); git status clean of the file through both runs.** |

## Probes — test/probe robustness

Covered by #10 and #11 (Bugs). No additional items.

## Security/Legal

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| 23 | BLOCKED-FOR-DECISION | Ph 9 F | P4 | `server/package.json`, Docker image | **ffmpeg-static is GPL-3.0-or-later** — resolve before public release: swap for a permissive build OR ship GPL compliance (source offers). Owner decision. |

## Infra — sandbox/CI/network

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| 28 | NOT-VERIFIED | Ph 9 I | P4 | — | Network egress to celestrak/firms/overpass unverifiable in this sandbox — infra, not code. |
| 29 | DEFERRED (future) | Codeberg Ralph mapping | P4 | unified doctor | Add pre-flight execution checks: agent CLIs + MCP servers + capability bundles verified before real runs. |
| 30 | DEFERRED (future) | GitLab mapping | P4 | `/code-review` eval set | GitLab Duo $0.25/review is the benchmark target for JEXI code-review quality. |
| 31 | BLOCKED-FOR-DECISION | Ph 8/9 | P4 | Render service | Render deploy hook 401 — service suspended; platform-side decision. |
| 32 | BLOCKED-FOR-DECISION | Ph 8/9 | P4 | `.github/workflows/*` | Docker publish fails at the suspended Render deploy step — blocked by #31. |

---

### Duplicates (kept for the record, folded into their targets)
- **34** → MERGED→#20 (stale doc counts).
- **35** → MERGED→#2 (Ollama provider consolidation).
- **37** → MERGED→#22 (suite requires root `npm install` — esbuild — Step 2 discovery c).

*Snapshot at creation: `pre-cleanup-zone-owner` @ `8a748a4a78e576cccec38f60b08f65f3ea71dabe`.*

## Cleanup Policy
Phases build. ZONE-OWNER.md grows. Cleanup runs
ONCE at the end — after all phases land, before
the benchmark phase. No interleaved cleanup passes.
Every phase is expected to leave ZONE-OWNER items
even if its own work is complete.

## Phase 10 carry-forward — Scope A

- **P10-A-01 DEFERRED (future) — runtime integration:** `rlm/kernel/` is independently usable;
  it is not registered in the server, command registry or existing kernel.
  Coordinate any out-of-zone wiring after in-zone daemon/subagent scopes.
- **P10-A-02 DEFERRED (future) — snapshot breadth:** A uses validated deterministic synchronous
  replay, not arbitrary heap serialization. Hidden nondeterminism, external I/O,
  async continuations and resource handles are not restorable by this format.
  Resolve before advertising unrestricted REPL recovery; details in
  `rlm/kernel/README.md`. Scope D/E durability must not silently replay effects.
- **P10-A-03 DEFERRED (future) — containment:** Node VM contexts isolate ordinary session
  namespaces, not malicious code. OS-level worker containment and host-call
  capabilities remain integration work; never advertise VM as a security sandbox.

## Phase 10 carry-forward — Scope C

- **P10-C-01 RESOLVED (cleanup) — /checkpoint sandbox failure:** `/checkpoint` fails in the
  current sandbox with the ORIGINAL Phase 7 G `/refine` handler restored.
  Pre-existing in this environment, not caused by Scope C. Source: Phase 10 C
  test-contract discovery. Original-handler test-commands.js run: 25/26, with
  `/refine` passing and `/checkpoint` failing. Investigate the environment and
  checkpoint path in the end-of-phases cleanup; do not fix in Scope C.

## Phase 25

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| P25-H-01 | RESOLVED (cleanup) | G disclosure | P2 | `scripts/phase25-scope-f.mjs` (P5) | Scope F probe P5 asserts write-level E_UNTAGGED for untagged content. Scope G's pipeline (excise -> tag -> assert -> disk) now auto-tags user content as `[stated]` before assertWritable runs. P5 should be updated at Scope N (final gate) to reflect the new pipeline — either assert the auto-tag or assert the pipeline outcome instead of the pre-G refusal. |

## Phase 24 carry-forward — Scope F final gate

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| P24-F-01 | DEFERRED (future) | Scope F P10 | P1 | `ui/web/console/chat/` + console chat surface | Checkpoints UI not wired: `chat/checkpoints.js` runtime module exists (Phase 16) but the Phase 24 chat surface has no checkpoint control. Wire a create/restore control or retire the module. |
| P24-F-02 | DEFERRED (future) | Scope F P6 | P1 | `ui/web/console/chat/` + console chat surface | Artifact panel UI not wired: `chat/artifacts.js` exists; no console surface renders artifacts for edit-tool events. |
| P24-F-03 | DEFERRED (future) | Scope F audit | P2 | `ui/web/console/chat/{queue,steer}.js` | Queue/steer UI not wired into the console. |
| P24-F-04 | DEFERRED (future) | Scope F audit | P2 | `ui/web/console/chat/multiagent.js` | Multi-agent view not wired into the console. |
| P24-F-05 | DEFERRED (future) | Scope F P4 | P1 | providers + Settings | No provider configured in the gate environment — answers are the deterministic in-process default agent. Real LLM answer path (provider setup end-to-end) unverified. |
| P24-F-06 | DEFERRED (future) | Scope F architecture | P2 | `ui/web/console/chat/runtime.js`, `server/` | Chat runtime is in-process (browser); brain serves only /api/health + missions/graph APIs. Server-side wiring for the chat runtime backend remains open. |
| P24-F-07 | DEFERRED (future) | Phase 10 J | P3 | console nav | Agents View (Phase 10 J) not wired into the Phase 24 console nav (sidebar is exactly 3 items by charter). |
| P24-F-08 | RESOLVED (cleanup) | Scope F suite | P1 | `server/test-b200.js`, `test-b205.js`, `test-b226.js`, `test-audit-b48.js`, `test-auto-mode.js`, `test-model-coworkers.js`, `test-web-search.js`, `test-thinking.js` | 8 tests assert legacy `src/components/ChatWindow.jsx` surfaces intentionally removed by approved Scope B. Retire or rewrite against the Phase 24 console; until then the suite baseline on Node>=22 shifts from 204/6 to 196/14. |
| P24-F-09 | RESOLVED (cleanup, doc path) | Scope F env | P2 | sandbox runtime | This environment runs Node v20.20.2 — `node:sqlite` unavailable → 6 sqlite-backed tests fail here but pass on Node>=22 (pristine-main control run proved it). Not a phase-24 issue. |

---

# CONSOLIDATED CLEANUP — FINAL STATE (one pass, one commit)

This pass is the single end-of-phases cleanup. Every former OPEN item is now
either **RESOLVED (cleanup)** with evidence below, or **DEFERRED (future)**
enumerated in the two deferred tables. Zero OPEN items remain. Statuses
`BLOCKED-FOR-DECISION` / `NOT-VERIFIED` are owner/platform calls, carried in
the infra table with reasons. Commit reference: the ONE commit on
`cleanup/consolidated-final` (rollback tag `pre-cleanup-final` @ `3c1446a4`).

## Resolved in this pass

| Cat | Item | Resolution + evidence |
|---|---|---|
| 1 | Zone-check precondition `touched.length > 0` (fails on committed trees) | Fixed in **11 probes**: phase23-{madtea,forgejo,ralph}-probe (P6), phase19-scope-{a,b,c,d} (P6/P7), phase25-scope-{k,l,m} (P11/P10/P7). Each now asserts only "zero out-of-zone paths"; a clean committed tree passes vacuously. Assertions not weakened — the substantive invariant (`outside.length === 0`) is unchanged. Verified clean-tree-safe already, left untouched: phase13-scope-{b,d,e}, phase25-scope-{e,f,g,h}, phase27-scope-{b,c,d} (assert `every()` / `stray.length === 0`); phase26-a and phase27-a have no zone check. |
| 1 | Hardcoded sandbox paths in probes | Replaced with `os.tmpdir()` / `import.meta.url`-derived paths: phase19-scope-b (JEXI_RAG_DIR), phase27-scope-a (BASE + reboot child-script import via `pathToFileURL(repo-root)`), phase27-scope-b (P27_LOGS), phase27-scope-c (routing child-script import + scratch file), phase27-scope-d (FIXTURE_DIR + doc), phase7-a-probe (OUTDIR default, env override kept), phase8-h-probe (SCRATCH — the pre-existing crash flagged in #12's note), probe-v012 (SHOTS + result JSON). Reviewed and LEFT AS-IS: `scripts/verify-apk.mjs` (aapt lookup is an external Android-SDK tool path, env-dependent by nature, not a probe fixture). |
| 1 | `.chunked-state.json` spurious zone-check failures | Added to root `.gitignore` (untracked runner scratch; `git status --porcelain` no longer lists it) — fixes every probe at once, no per-probe lists needed. |
| 1 | P25-H-01 | `scripts/phase25-scope-f.mjs` P5 re-targeted to the Scope G pipeline outcome (excise → tag → assert → disk): untagged user write now asserts auto-`[stated]` tag + written:true + on-disk content. Re-target per the item's own instruction, not a weakening. |
| 1 | ZONE-OWNER #1-probe vs #38 | `scripts/zone-owner-item1-probe.mjs` section 3 re-targeted to the post-#38 contract (camelCase committed frontmatter loads; lowercase workaround gone). Probe now 12/12. |
| 2 | P24-F-08 | 8 legacy-ChatWindow tests (test-auto-mode, test-model-coworkers, test-web-search, test-thinking, test-audit-b48, test-b200, test-b205, test-b226) removed from the `server/package.json` test manifest (210 → 202 commands) AND given top-of-file skip guards referencing P24-F-08 (standalone runs `SKIP … exit 0` instead of failing on removed surfaces). Suite baseline: 202 commands, retired 8 counted separately. |
| 2 | test-dsh-batch9 flaky (local-listener state) | Listener block now tears down deterministically: `server.closeAllConnections()` + awaited `close()` — no lingering keep-alive sockets/handles into later sections of the same process under suite load. Assertions unchanged. |
| 2 | test-b209 workspace-state sensitivity | Clean-room wipe of `server/jexi-workspace/director/` (gitignored runtime scratch) at test start — kills the `dirList.length === 1` cross-run taskId-dir collision. Assertions unchanged. |
| 2 | Node version documentation | `server/package.json` `engines: { node: ">=22.5" }` (node:sqlite requirement) + gate note below. Resolves the documentation drift of #36 and P24-F-09. |
| 2 | Pre-gate bootstrap | Documented below (npm ci at BOTH root and server/; both install steps already present in ci.yml). |
| 3 | Credential grep helper | `scripts/cleanup-creds-grep.mjs` — uniform token-boundary sweep (4 patterns: provider token shapes, PEM blocks, credential assignment literals, network/LLM call sites). Selftest 10/10 on the known false-positive corpus (task-type, risk-avoidance, disk-cache, vendored LLM prose, env-var reads) + true shapes. Repo sweep of `workforce/` + phase-13 probes: CLEAN. |
| 3 | Cache-dir policy | Documented below (os.tmpdir() scratch vs declared permanent `.jexi/` locations). |
| 4 | #20 | 4 stale tool counts fixed to the real 219 (docs/REBUILD-MAP.md:27, docs/AUTONOMY_AUDIT.md:72+99, docs/UPGRADE-FINAL-REPORT.md:72); `tools/registry/audit.js` now PASS and wired into ci.yml as a gate step. |
| 4 | #21 | AGENTS.md now documents BOTH git modes (direct-to-main early flow + the multi-agent branch/merge flow actually in use). |
| 4 | #22 | ci.yml `on.push.branches` now includes `'phase-**'` and `'cleanup/**'` beside main. |
| 4 | #38 | Lowercase frontmatter workaround reverted in `skills/design/diagram-design/SKILL.md` (whenToUse / allowedTools restored); item-1 probe proves the fixed regex loads camelCase in place (12/12). |
| 4 | workgraph/README.md drift | README reconciled: now documents its own trees (`phases/gsd/`, `session/`) AND the server-owned runtime files it relates to, instead of pointing only at `server/src/services/director/WorkGraph.js`. |
| 4 | merge-tree version note | Documented below (git >= 2.38 for `--write-tree`; structural proof fallback). |
| — | P10-C-01 | Does not reproduce on the current baseline: original-handler `server/test-commands.js` runs **26/26** including `/checkpoint` (was 25/26 with /checkpoint failing). The original failure was environment-bound (Node 20 class, P24-F-09). |

## DEFERRED-TO-FUTURE — wiring (Category 5; next project's work)

Each row: target module, integration point, blocker, owner-scope.

| ID | What | Target module | Integration point | Blocker | Owner-scope |
|---|---|---|---|---|---|
| W13 | Tools bypass `gatedDispatch` | `server/src/tools/execution/executor.js` | route every tool execution through `gatedDispatch` | permission-gate design owner call on default-deny vs audit-only | server tools owner |
| W14 | AAS MCP server unregistered | `server/mcp/registry.json` | register AAS server entry | live MCP endpoint/transport choice | server mcp owner |
| W15 | aas dir-skip hardcoded | `skills/aas/catalog.js` | join `skills/library/aas` into combined index | path-based skip policy decision | skills owner |
| W16 | Phase 12 skills + gates uncalled | CodingLoop / VerificationLoop call sites, `skills/design/**` gates | invoke gates at loop checkpoints | loop refactor owner call | loop owner |
| W17 | code source raw-reads | `server/src/context/sources/code.js`, `capability/code/graph-first.js` | prefer `answerStructuralQuery` + fallback | graph index freshness SLA | context owner |
| W18 | viking filesystem unregistered | `server/src/context/sources/index.js:17`, `context/viking/**` | register as context source | tiered-read cost policy | context owner |
| W19 | `BROWSER_CLAIM_RE` verifies words not pixels | `server/src/services/director/Verifier.js:41`, `verification/visual/**` | attach visual QA harness to verify path | browser availability in prod runner | verification owner |
| W24 | OSINT registrations missing | `intelligence/trust-pipeline/registered-urls.js` | register open-meteo/tfl/nasa/noaa | upstream API stability review | trust-pipeline owner |
| W25 | NABSA GBFS host relocated | `intelligence/trust-pipeline/registered-urls.js` | re-register new host | confirm canonical new host | trust-pipeline owner |
| W26 | AISStream WSS client unimplemented | ships layer + `registered-urls.js` | implement WSS client behind ships layer | WSS creds + egress policy | ships layer owner |
| W27 | OSINT gaps (flights CORS, fires cap, traffic egress) | `registered-urls.js`, layers | chunked fetch + egress | per-API rate/size policy | trust-pipeline owner |
| W29 | Ralph pre-flight execution checks | unified doctor | verify agent CLIs + MCP servers + bundles before runs | doctor CLI surface design | doctor owner |
| W30 | GitLab Duo benchmark target | `/code-review` eval set | benchmark $0.25/review quality | eval harness + GitLab project access | eval owner |
| WA1 | prompt assembly → provider bridge | prompt assembly modules | feed assembled prompts through the provider bridge | bridge interface freeze | provider owner |
| WA2 | semantica graph → server memory | `semantica/graph/**` | expose graph queries to memory subsystem | index scale policy | memory owner |
| WA3 | instincts observer → session lifecycle | `instincts/observe/hook.js` | hook observe() into session start/end | hook contract sign-off | session owner |
| WA4 | swarm topologies → workforce dispatch | `swarm/topologies/**` | topology-aware dispatch in workforce | dispatch contract | workforce owner |
| WA5 | fleet → server process supervisor | `session/fleet/**` | supervise fleet children from server | /proc-based liveness portability | server owner |
| WA6 | console chat surface → runtime modules | `ui/web/console/chat/` + artifacts/checkpoints/queue/steer/multiagent | render + control surfaces in chat runtime (P24-F-01/02/03/04) | chat runtime in-process (P24-F-06) | console owner |
| WA7 | Agents View → console nav | console nav (P24-F-07) | add Agents View entry | sidebar-by-charter decision | console owner |
| WA8 | provider config in Settings → real LLM path | providers + Settings (P24-F-05) | end-to-end provider setup → real answers | live provider creds in env | provider owner |
| WA9 | chat runtime server-side wiring | `ui/web/console/chat/runtime.js`, `server/` (P24-F-06) | move runtime backend into server | scope + latency design | server+console owners |
| W10A1 | rlm kernel unregistered | `rlm/kernel/` | register in server / command registry / kernel (P10-A-01) | daemon/subagent scope sequencing | kernel owner |
| W23 | wire madtea into server PR flow | `harness/hardening/madtea/` | call finish() from server PR flow when CI exists | CI availability on main | harness owner |
| W23b | decide madtea gate execution | `harness/hardening/madtea/gates.js` | local vs CI-hosted gate run | owner decision | harness owner |
| W23c | wire forgejo-mcp into server mcp/registry | `harness/hardening/forgejo/` + `server/mcp/registry.json` | register transport | live forge connection (W23d) | harness+server owners |
| W23d | live forge connection for forgejo transport | `harness/hardening/forgejo/transport.js` | real endpoint behind E_NO_FORGE_CONNECTION | forge creds + network egress | harness owner |
| W23e | wire ralph diagnostics into Ralph loop | `harness/hardening/ralph/` + `swarm/loops/ralph.js` (Phase 20 F) | evaluate() at loop checkpoints | loop wiring contract | swarm owner |
| W23f | wire ciDoctor into CI failure path | `harness/hardening/ralph/ci-doctor.js` | diagnose() on CI failures when CI exists | CI on phase branches (landed this pass) + real CI usage | harness owner |
| W36 | #36 code part: boot-time Node gate or sqlite fallback | `server/src/memory/index.js`, `backends/sqlite.js` | engines field landed (doc path); add boot check OR implement fallback | owner call gate-vs-fallback | memory owner |

## DEFERRED-TO-FUTURE — environment / infra (Category 6)

| Item | Reason deferred |
|---|---|
| #23 ffmpeg-static GPL-3.0 licensing | BLOCKED-FOR-DECISION: swap for permissive build vs GPL compliance (source offers) — owner/legal call before public release. |
| #28 network egress to celestrak/firms/overpass | NOT-VERIFIED: sandbox cannot prove egress; infra, not code. |
| #31 Render deploy hook 401 | BLOCKED-FOR-DECISION: service suspended; platform-side decision. |
| #32 Docker publish fails at Render step | BLOCKED-FOR-DECISION: blocked by #31. |
| GitHub name-resolution 404 | API name-resolution endpoints 404 — use ID-based API as the workaround; platform-side fix deferred. |
| exec-bit flips on tracked files | `core.fileMode=false` already set; environment churns the mode bit — infra hygiene only. |
| Sandbox workspace over-budget (~173MB vs 128MB) | Storage budget is platform-side; local scratch already redirected to os.tmpdir() by this pass. |
| Root+server node_modules stripping | Bootstrap documented below (npm ci at both roots); durable warm-cache infra is platform work. |
| P24-F-09 sandbox Node upgrade | Minimum Node (>=22.5) documented; the sandbox runtime upgrade itself is platform work. |

## Gate tooling notes (documentation deliverables of this pass)

- **git merge-tree:** `git merge-tree --write-tree <a> <b>` requires **git >= 2.38**. On older git
  (sandbox reported 2.34.1), substitute a structural proof: no-overlap check between the two
  branch deltas (`git diff --name-only <merge-base>..<branchA>` vs `..<branchB>` disjoint) plus
  clean `rev-parse`/`ls-remote` evidence — as used in Phase 23's and later gates.
- **Pre-gate bootstrap:** run `npm ci` at BOTH the repo root and `server/` before any full-suite
  run. The suite spawns root `node_modules/esbuild` (test-rich-render, test-setup-wizard,
  test-b197, test-b200) and server deps; a stripped tree fails 4+ tests with ENOENT —
  environmental class, not regressions. (Both install steps are already encoded in ci.yml.)
- **Minimum Node:** `>= 22.5` (`node:sqlite`). Encoded as `engines` in `server/package.json`.
  On Node 20 the sqlite-backed memory tests fail 6/7 at baseline — environmental, documented.
- **Cache-dir policy:** throwaway caches live under `os.tmpdir()` — `semantica/repo-map`
  (index cache), Phase 26 instincts probes, Phase 27 fleet roster/fixtures, and every probe
  scratch dir normalized by this pass. Declared PERMANENT locations stay under `.jexi/`
  (memory-fs stores, sessions). Probes must never write scratch inside the repo worktree.
- **Credential invariant:** use `node scripts/cleanup-creds-grep.mjs <paths>` (token-boundary
  patterns; `--selftest` proves the known false-positive corpus stays clean). The naive
  `sk-[a-z0-9]` pattern is retired — it false-positived on task-type / risk-propagation /
  disk-cache and vendored LLM prose.

## Close-out

Zero OPEN items. Every numbered item is DONE, RESOLVED (cleanup), DEFERRED (future),
MERGED→#n, or BLOCKED-FOR-DECISION / NOT-VERIFIED with a reason in the infra table.
