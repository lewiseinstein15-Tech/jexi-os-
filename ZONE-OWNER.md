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
| 2 | DONE | Ph 17 J | P0 | `server/src/providers/adapters/ollama.js`, `providers/adapters/ollama.provider.js` | The runtime Ollama adapter never calls `security/shield/inference-exposure.js#checkBind()` — the 0.0.0.0 refusal only exists in the standalone checker; consolidate and remove the duplicate. (absorbs #35) — **DONE @ probe scripts/zone-owner-item2-probe.mjs (11/11 incl. real socket binds). Consolidation choice: runtime adapter is CANONICAL (init()/chat()/stream() enforce; default bind 127.0.0.1); standalone `providers/adapters/ollama.provider.js` REMOVED; scripts/phase17-j-probe.mjs repointed (still 10/10).** |
| 3 | DONE | Ph 17 D | P0 | `server/src/memory/index.js` (recall 45–53, prefetch 56–63), `memory/{hybrid-search,lifecycle,confidence}.js` | The confidence/lifecycle/KG/hybrid upgrade is shipped but unwired — recall/prefetch return raw backend rows with no re-ranking or retrieval reinforcement. — **DONE @ probe scripts/zone-owner-item3-probe.mjs (9/9). recall/prefetch now: lifecycle advance() on read (AGING persisted; ARCHIVED excluded), hybrid BM25+vector RRF re-rank (E_NO_RESULTS → legacy scoreRelevance order), noteRetrieval() persisted with weight-0 discipline (confidence Δ=0 at pinned now). Requires Node ≥22.5 (node:sqlite) — on Node 20 the whole memory backend is pre-existing-broken (6/7 baseline fails).** |
| 4 | DONE | Ph 9 G | P0 | `intelligence/trust-pipeline/broker.js:178`, `events/provenance/label.js` | Broker `ok:true` responses carry no provenance label — fetched data enters the system unlabeled. — **DONE @ probe scripts/zone-owner-item4-probe.mjs (11/11 incl. REAL network fetch: celestrak.org 200 via SSRF-pinned transport → label 'observed'). ok:true return now carries frozen provenance (wrapBroker-parity, registration-driven label); refusals carry explicit `provenance: null`; phase9-g P9 assertion updated to the new contract (all 11 sub-probes green, 70/70).** |
| 5 | DONE | Ph 9 E | P0 | `server/src/providers/LLMClient.js:791`, `providers/cost/caps.js` | Cost caps are not consulted on the live model-call path — a capped session can still spend. — **DONE @ probe scripts/zone-owner-item5-probe.mjs (7/7). `costGate()` (caps.check) inserted beside the budget-gate precedent in generateContent AND before every model call in streamPlainText / __generateWalk / generateWithToolsLoop (incl. plain-text fallback) / runToolLoopForProvider rounds; E_SESSION_CAPPED is terminal (no ladder slide — mock got 0 calls); E_NO_BUDGET passes through (zero behavior change when caps unconfigured); cap survived real process death via JEXI_COST_LEDGER_PATH. NOTE: real file is `server/src/providers/runtime/LLMClient.js` (item text cited `providers/LLMClient.js:791` — the budget-gate line). Tests: request-economy+provider-health+ollama-provider 32/32, test-llm-models, test-unified-providers 25/25.** |
| 6 | OPEN | Ph 9 D | P0 | `server/src/**` (routes), `providers/tokens/ephemeral.js` | Ephemeral mint/verify has no HTTP route — long-lived provider keys still reach clients by default. |
| 13 | OPEN | Ph 12 D | P2 | `server/src/tools/execution/executor.js` | Tools bypass `gatedDispatch` — permission gates are not enforced on the execution path. |
| 14 | OPEN | Ph 12 E | P2 | `server/mcp/registry.json` | AAS MCP server unregistered — agent-selection layer can't route to it. |
| 15 | OPEN | Ph 12 F | P2 | `skills/aas/catalog.js` | aas dir-skip is hardcoded, not path-based — `skills/library/aas` never joins the combined index. |
| 16 | OPEN | Ph 12 | P2 | CodingLoop / VerificationLoop call sites, `skills/design/**` gates | Phase 12 skills and gates exist but nothing calls them at runtime. |
| 17 | OPEN | Ph 11 I | P2 | `server/src/context/sources/code.js`, `capability/code/graph-first.js` | code source still raw-reads files instead of graph-first `answerStructuralQuery` (+fallback). |
| 18 | OPEN | Ph 17 E | P2 | `server/src/context/sources/index.js:17`, `context/viking/**` | viking filesystem is merged but unregistered as a context source — tiered reads unused. |
| 19 | OPEN | Ph 9 H | P2 | `server/src/services/director/Verifier.js:41`, `verification/visual/**` | `BROWSER_CLAIM_RE` verifies words, not pixels — visual QA harness unwired. |
| 24 | OPEN | Ph 9 I | P4 | `intelligence/trust-pipeline/registered-urls.js` | Missing OSINT registrations: `api.open-meteo.com`, `api.tfl.gov.uk`, `api.nasa.gov`, `api.tidesandcurrents.noaa.gov`. |
| 25 | OPEN | Ph 9 I | P4 | `intelligence/trust-pipeline/registered-urls.js` | NABSA relocated the GBFS systems index host — current registration 404s; re-register the new host. |
| 26 | OPEN | Ph 9 I | P4 | ships layer, `registered-urls.js` | AISStream WSS client unimplemented behind the ships layer (honest `unauthorized` today). |
| 27 | OPEN | Ph 9 J | P4 | `registered-urls.js`, layers | Remaining OSINT gaps: flights CORS workaround, fires size cap/chunked fetch, traffic overpass egress. |
| 33 | DONE | Ph 11 J | P4 | `tool-directory.json` | codegraph-mcp + reach-mcp registered — verified in Phase 11 J probe. |

## Bugs — real defects

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| 1 | DONE | Ph 17 H cross-verify | P0 | `server/src/services/SkillLoop.js:59`, `skills/design/diagram-design/SKILL.md` | `readSkillMeta` regex `^([a-z_]+):` silently DROPS camelCase frontmatter keys (`whenToUse`, `allowedTools`) across 818 security + 166 scientific + 144 library + Phase 12 skills. Fix to `[a-zA-Z_]+`; then optionally revert the H scope's lowercase workaround. — **DONE @ probe scripts/zone-owner-item1-probe.mjs (10/10; 323/1142 SKILL.md files were affected); lowercase workaround still loads; diagram-design revert left as optional follow-up.** |
| 7 | OPEN | Ph 11 | P1 | `server/test-hud.js` (producer/assert) | "first publish bumps revision to 1" — the suite's one standing failure; fix assert or producer. |
| 8 | OPEN | Ph 11 merge | P1 | `server/test-b211.js` | Lease TTL 5ms race — flaky under load; widen the margin. |
| 9 | OPEN | Ph 12 merge | P1 | `scripts/lint-agent-baseline.sh` | Baseline lint checks PRESENCE, not verbatim bytes — drift passes lint. Check byte-equal after header. |
| 10 | OPEN | Ph 9 cross-verify | P1 | `scripts/phase9-h-probe.mjs` | `decodePng(null)` TypeError when no browser — probe should clean-skip with `BROWSER_UNAVAILABLE` like the runner does. |
| 11 | OPEN | Ph 9 cross-verify | P1 | `scripts/phase9-i-probe.mjs` (p12), `scripts/phase9-j-probe.mjs` (p11) | Gate-time session assertions hardcode branch/HEAD (`phase-9-glm`, 16/2 files) — meaningless post-merge; retire or parametrize. |
| 12 | OPEN | Ph 8 H | P1 | XBOW harness payload/verifier | Pipeline coverage gaps: path-traversal (F-002 never emitted), hardcoded-secret (F-005 INCONCLUSIVE) — payload or verifier wrong; investigate and fix in-zone. |

## Hygiene — docs, ignores, configs

| ID | Status | Source | Pri | Files | Why it matters |
|---|---|---|---|---|---|
| 20 | OPEN | Ph 9 C | P3 | `docs/REBUILD-MAP.md:27`, `docs/AUTONOMY_AUDIT.md:72+99`, `docs/UPGRADE-FINAL-REPORT.md:72`, `.github/workflows/ci.yml` | 4 stale tool counts (218/~151) vs real 219 — `tools/registry/audit.js` FAILs; fix docs and wire the audit into CI. (absorbs #34) |
| 21 | OPEN | Ph 17 OpenHands flag | P3 | `AGENTS.md` | "direct to main, no branches" contradicts the multi-agent branch workflow actually in use — document both modes. |
| 22 | OPEN | Ph 12 merge | P3 | `.github/workflows/ci.yml`, `.github/workflows/validate-divisions.yml` | Workflows don't trigger on `phase-*`/`cleanup/*` pushes — no CI feedback before merge (root cause of the lint-verbatim gap). |

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
| 29 | OPEN | Codeberg Ralph mapping | P4 | unified doctor | Add pre-flight execution checks: agent CLIs + MCP servers + capability bundles verified before real runs. |
| 30 | OPEN | GitLab mapping | P4 | `/code-review` eval set | GitLab Duo $0.25/review is the benchmark target for JEXI code-review quality. |
| 31 | BLOCKED-FOR-DECISION | Ph 8/9 | P4 | Render service | Render deploy hook 401 — service suspended; platform-side decision. |
| 32 | BLOCKED-FOR-DECISION | Ph 8/9 | P4 | `.github/workflows/*` | Docker publish fails at the suspended Render deploy step — blocked by #31. |

---

### Duplicates (kept for the record, folded into their targets)
- **34** → MERGED→#20 (stale doc counts).
- **35** → MERGED→#2 (Ollama provider consolidation).

*Snapshot at creation: `pre-cleanup-zone-owner` @ `8a748a4a78e576cccec38f60b08f65f3ea71dabe`.*
