# EXCLUDED SCOPES INVESTIGATION — PHASES 0 → 31 — REPORT ONLY

| | |
|---|---|
| Branch | `investigation/excluded-scopes` (off main `d4b273f`) |
| Tag | `pre-excluded-scopes-investigation` → `d4b273f` |
| origin/main SHA at start | `d4b273f454532addea8366feaec69375cf5ee23d` |
| Zone | `docs/EXCLUDED-SCOPES-INVESTIGATION.md` ONLY |
| Mode | READ-ONLY. No merges. No deletions. No rewrites. No tags beyond the pre-tag. One commit. |
| Scope count | 5 excluded scopes investigated (8B, 9J, 11I, 17B, 21J). Phase 18 not investigated (lead-resolved). |

---

## 0. METHOD

For each scope, six questions were answered from raw git evidence only:

- **Q1 WHAT DID IT BUILD** — `git show <sha> --stat` / `--name-status`; delivery summarized.
- **Q2 STATED SCOPE** — the scope line from its commit message / phase plan, with phase parent and sub-scope letter.
- **Q3 REPLACED?** — equivalent capability searched on main (paths, content grep, log grep).
- **Q4 SUPERSEDED?** — later-phase absorption checked against phase ordering and gate commits.
- **Q5 MIS-MERGED?** — `git log --all --oneline --grep`, `git branch -a --contains`, `git tag --contains`, `git merge-base --is-ancestor`; content diffed byte-for-byte against main HEAD.
- **Q6 PARITY GAP** — features in the excluded delivery not present in what main carries; empty list = full parity.

## 1. HEADLINE FINDING

**No scope was lost. All five excluded scopes are already on main.**

Every excluded SHA has a same-message twin commit inside main's history (the repo's established re-commit delivery pattern). In every case the on-main content was diffed against the excluded SHA: byte-identical for 11I, 17B (base files), and 21J; identical for 9J's deliverable with only its probe evolved post-merge; identical for 8B's 20 agents with main's security fleet since grown from 20 to 24. Four of the five phase gate commits name the excluded scope's capability explicitly in their messages.

| Excluded SHA | Twin on main | Content vs main HEAD |
|---|---|---|
| `c8b8bb0` (8B) | `9a2e4e5` | agents + registry identical; main since grew 20 → 24 security agents |
| `a809023` (9J) | `53ca1d7` | `globe.html` byte-identical; probe `P11` parametrized post-merge |
| `930ec6f` (11I) | `b33eab2` | all 3 files byte-identical |
| `c394139` (17B) | `d4fde5e` | all 15 files identical; `agent-loop.js` extended by 17C; vision layer added on top |
| `a63a820` (21J) | `dc81d27` | all 3 files byte-identical |

## 2. SCOPE 8B — 20 SECURITY AGENTS (`c8b8bb0`, tag-only, branch deleted)

**Q1 — What it built.** 22 files, +1214/−5: twenty 52-line specialist agent definitions (16 under `agents/security/`: ad-operator, auth, authz, cloud-hunter, contract-auditor, detector, exploit, injection, mobile-operator, phisher, post-exploit, recon, scanner, ssrf, wireless-operator, xss; plus `agents/engineering/security-patcher`, `agents/research/reverser`, `agents/testing/fuzzer`, `agents/testing/security-verifier`), a 169-line `scripts/check-agent-overlap.mjs`, and a `workforce/divisions.json` wiring (10 lines changed) registering the security division.

**Q2 — Stated scope.** `phase-8(B): 20 security agents — Shannon OWASP + Decepticon specialists wired into workforce and division registry` (phase parent: `phase-8: Security`, sub-scope B).

**Q3 — Replaced?** Not replaced — the same delivery is present. `git log main --diff-filter=A -- agents/security/recon.agent.md` → `9a2e4e5` with the identical message. Five sampled files (`recon`, `xss`, `security-patcher`, `fuzzer`, `check-agent-overlap.mjs`) diff empty between `c8b8bb0` and main. `workforce/divisions.json` on main carries the `security` division (`agentCount: 24`).

**Q4 — Superseded?** No later phase absorbed it; its own phase gate `6cd28ea phase-8: Security — … 24 agents …` includes the re-landed scope and main's fleet has since grown to 24.

**Q5 — Mis-merged?** YES. `git tag --contains c8b8bb0` → `apk-build-445` only; no branch contains it; `merge-base --is-ancestor c8b8bb0 main` → false. Twin `9a2e4e5` IS an ancestor of main. Tree diff `c8b8bb0`↔`9a2e4e5`: one file, `scripts/generate-divisions.js` (+26/−3) — later evolution on main, not a content gap in the 20-agent delivery.

**Q6 — Parity gap.** EMPTY. All 20 agents, the overlap checker, and the division wiring are on main. Main now exceeds the scope (24 security agents incl. appsec-engineer, cloud-security, compliance-auditor, crypto-specialist, incident-responder, pentester, security-reviewer, threat-modeler).

**VERDICT: MIS-MERGED (already on main, full parity).**

## 3. SCOPE 9J — 3D GLOBE UI (`a809023`, branch `phase-9-glm`)

**Q1 — What it built.** 2 files, +1921: `ui/preview/globe.html` (1443 lines — the JEXI OS OSINT Globe preview page, "JEXI OS — OSINT Globe (Phase 9 Scope J)") and `scripts/phase9-j-probe.mjs` (478 lines — the scope's gate probe).

**Q2 — Stated scope.** `phase-9(J): 3D globe UI` (phase parent: `phase-9: Spatial Intelligence (GEV)`, sub-scope J).

**Q3 — Replaced?** No — same delivery present. Main carries `ui/preview/globe.html` byte-identical (empty diff `a809023`↔main for that file) plus a same-message twin `53ca1d7 phase-9(J): 3D globe UI` that IS an ancestor of main. It sits beside the other preview pages (`agents-view.html`, `console.html`).

**Q4 — Superseded?** No. Phase-9 gate `8a748a4` lists "3D globe UI" among its delivered capabilities — the scope's own phase, not a later one.

**Q5 — Mis-merged?** YES. `a809023` is contained by branch `phase-9-glm` and tag `pre-phase-9-final` only; not an ancestor of main. Twin `53ca1d7` on main. The probe `scripts/phase9-j-probe.mjs` was deliberately improved on main after landing: its `P11` zone-compliance check was parametrized (gate-time `branch === 'phase-9-glm'` assertion retired in favor of a durable ancestor-of-HEAD containment check) — a maintenance edit, not a capability change.

**Q6 — Parity gap.** EMPTY. The deliverable page is byte-identical; the probe is strictly more durable on main.

**VERDICT: MIS-MERGED (already on main, full parity).**

## 4. SCOPE 11I — TOKEN-EFFICIENT GRAPH-FIRST QUERIES (`930ec6f`, tag-only)

**Q1 — What it built.** 3 files, +457: `capability/code/graph-first.js` (275 lines), `capability/context-hook.js` (58 lines), `scripts/phase11-probe-i.mjs` (124 lines).

**Q2 — Stated scope.** `phase-11(I): token-efficient graph-first queries` (phase parent: `phase-11: Unified Capability Layer`, sub-scope I).

**Q3 — Replaced?** No — same delivery present. All 3 paths exist on main and the diff of those 3 files between `930ec6f` and main HEAD is EMPTY (byte-identical). Twin `b33eab2` with the identical message IS an ancestor of main.

**Q4 — Superseded?** No. Phase-11 gate `fc2e69e phase-11: Unified Capability Layer — … graph-first queries` includes it.

**Q5 — Mis-merged?** YES. `git tag --contains 930ec6f` → `pre-phase-11-final` only; no branch; not an ancestor of main. Twin `b33eab2` on main.

**Q6 — Parity gap.** EMPTY. Wiring on main is intact and grew: `capability/context-hook.js` and `context/offload/index.js` reference graph-first, and phase-31 wiring (`scripts/phase31-0-wiring-plan.mjs`, `server/src/wiring/phase31-bootstrap.js`) consumes it.

**VERDICT: MIS-MERGED (already on main, full parity).**

## 5. SCOPE 21J — OVERNIGHT AUTONOMOUS RUN (`a63a820`, tag-only)

**Q1 — What it built.** 3 files, +230/−4: `research/overnight.js` (125 lines — the overnight driver), `research/loop/lifecycle.js` (9-line adjustment), `scripts/phase21-j-overnight.mjs` (100 lines — the gate probe).

**Q2 — Stated scope.** `phase-21(J): overnight autonomous run` (phase parent: `phase-21: AutoResearch Integration`, sub-scope J). `research/PHASE-21-PLAN.md` on main lists `(J) research/overnight.js` with the loop designed to "repeat overnight (~100 experiments/8h at fixed 5 min budget)."

**Q3 — Replaced?** No — same delivery present. `research/overnight.js` and `scripts/phase21-j-overnight.mjs` exist on main; the 3-file diff between `a63a820` and main HEAD is EMPTY (byte-identical). Twin `dc81d27` with the identical message IS an ancestor of main. (A third same-message commit `df7ba43` exists but is on no main lineage — an intermediate duplicate, footnote only.)

**Q4 — Superseded?** No. Phase-21 gate `00b4786` lists "overnight autonomous run" as delivered.

**Q5 — Mis-merged?** YES. `git tag --contains a63a820` → `pre-phase-21-arena`, `pre-phase-21-final`; no branch; not an ancestor of main. Twin `dc81d27` on main.

**Q6 — Parity gap.** EMPTY at the capability level. Note (pre-existing, declared — not caused by the exclusion): the phase-21 gate message itself declares the subsystem "Standalone research subsystem; zone-owner task to wire into server's live work-graph" — `research/loop/experiment-loop.js` provides the LoopEvent stream "so overnight drivers (scheduler, overnight.js)" can consume it; no `server/src` import exists yet. This is the declared zone-owner wiring item, unchanged by this investigation.

**VERDICT: MIS-MERGED (already on main, full parity; server-side wiring remains a separately declared zone-owner task).**

---

# 6. SCOPE 17B — 45+ BROWSER ACTIONS — FULL PHASE 17 DEEP DIVE

Excluded ref: `origin/phase-17-openhands` @ `c394139` (`phase-17(B): 45+ browser actions + agent loop`; parent `09e21cd` = 17A). Lead's question: "the browser was changed to a better one — was 17B replaced?"

## 17-1. What was Phase 17 as a whole?

Phase 17 = **Browser Runtime + Capability Expansion** (gate commit `5ce176e`, 2026-09-19). Ten sub-scopes:

| Sub-scope | Commit on main | Delivered |
|---|---|---|
| 17(A) | `07c4757` (re-landed; orig `09e21cd`) | Obscura browser engine — CDP, stealth, ~30 MB RAM, replaces Chromium |
| 17(B) | `d4fde5e` (re-landed; orig `c394139`) | 59 browser actions + agent loop (45+ declared) |
| 17(C) | `d2c50c8` (same SHA on main) | Vision-based browser control (screenshot → detector → coordinate map → `vision_click`) |
| 17(D) | `653ce29` (same SHA) | Memory upgrade — confidence, lifecycle, knowledge graph, hybrid search |
| 17(E) | `7d2b408` (same SHA) | Context filesystem — `viking://`, L0/L1/L2 tiers, session pipeline, compile |
| 17(F) | `44c9708` (same SHA) | 166 scientific skills imported (K-Dense-AI/scientific-agent-skills) |
| 17(G) | `9c932ab` (same SHA) | Cybersecurity framework mapping index |
| 17(H) | `aa85037` (same SHA) | Diagram design — 39 editorial types |
| 17(I) | `b75bd4f` (same SHA) | Harness engineering reference document |
| 17(J) | `b347a88` (same SHA) | Ollama exposure detection + localhost default |

Containment, verified: `d2c50c8`, `653ce29`, `7d2b408`, `44c9708`, `9c932ab`, `aa85037`, `b75bd4f`, `b347a88` are all ancestors of main **under the same SHAs** (17C–17G via direct lineage; 17H–17J via the `phase-17-arena` line, tip `b347a88`, confirmed ancestor of main). Only 17(A) and 17(B) — the two commits carried by `phase-17-openhands` — re-landed under different SHAs (`07c4757`, `d4fde5e`), byte-identical in content.

## 17-2. What was 17B specifically?

15 files, +3744: `runtimes/browser/actions/{dialogs,extraction,files,forms,index,interaction,navigation,registry,resolve,tabs}.js`, `runtimes/browser/{agent-loop,cdp,dom-service}.js`, `runtimes/browser/README.md`, `scripts/phase17-b-probe.mjs`.

- **Stated scope:** `phase-17(B): 45+ browser actions + agent loop` (phase parent 17, sub-scope B). Delivered **59 actions** in 8 groups (inventory-derived, not hardcoded): navigation 8, interaction 12, forms 6, tabs 7, dialogs 5, extraction 7, dom_mutation 9, files 5.
- **Agent loop:** observe → think → act, ported from browser-use's `Agent.run`/`Agent.step` cycle; the model is injectable (`decide({snapshot, history, task, step})`); a `ScriptedDecider` drives the same code path a model would, so probes never fake a pass. Action registry ported from browser-use's `tools/registry/service.py` with risk levels (`low|medium|high`), permission flags (`navigate|read|interact|write|eval|filesystem|network|admin`), timeouts, retries, and a NO-STUBS policy (every handler is a real CDP call).
- **Engine:** built directly on 17(A)'s **Obscura** via a raw CDP WebSocket client (`ws://127.0.0.1:9222/devtools/browser`) — explicitly "no Playwright, no Puppeteer." Note the branch NAME (`phase-17-openhands`) refers to the loop lineage; the code contains zero OpenHands mentions and credits **browser-use** in 5 files.
- **Gating discipline:** when the engine binary is absent the probe verdict is `NOT VERIFIED` (exit 2), never a fake pass.

## 17-3. What is the CURRENT browser implementation on main?

The same Phase 17 stack — 17B was not swapped out:

- **Engine:** Obscura (`runtimes/browser/engine.js` spawns `obscura serve`; `compose.yaml` = distroless/cc nonroot, port bound to 127.0.0.1 only, SSRF guard blocking loopback/RFC1918/link-local incl. cloud-metadata, DNS-rebinding-safe; `stealth.js`; `fallback.js`). SHAs: `07c4757` (A), `d4fde5e` (B), `d2c50c8` (C), gate `5ce176e` — all ancestors of main `d4b273f`.
- **Action surface on main today:** 59 registry actions (verified by running `actionInventory()` from main's tree: `TOTAL: 59`, `duplicate_names: []`, risk mix `medium 37 / low 22`) **plus** the 17(C) vision additions `vision_click` and `capture_page` (`runtimes/browser/vision/{screenshot,element-detector,coordinate-map,vision-decider,index}.js`).
- **Policy layer:** `server/src/services/BrowserRouter.js` (ARENA Phase 3 `35384c7`, 2026-09-07 — predates Phase 17) — one policy-gated entry point (CAPTCHA never solved; browser-private storage never read; http/https only; audit log).
- **Consumer:** Phase 29(C) `computer/operators/browser.js` (`9706748`) consumes the Phase 17 DOM browser runtime read-only via an injected adapter seam (`setDomRuntime(rt)`).
- Wiring note: `runtimes/browser/**` is referenced by its own probes (`scripts/phase17-{a,b,c}-probe.mjs`) and the phase-29 seam; the runtime is a standalone subsystem by design, consistent with the ARENA router's worker model.

## 17-4. What was the "better one" that replaced it?

The "better browser" the lead remembers is **17(A) itself: Obscura replacing headless Chromium/Playwright** — a deliberate, documented swap INSIDE Phase 17, before 17B was written:

- `runtimes/browser/README.md` (main): "Obscura replaces Chromium as the browser engine" — measured on the host: Obscura 24.1 MB RSS cold vs Chromium (playwright headless shell) 394.4 MB with a page loaded; ~70 MiB binary vs 300+ MB; anti-detect built in.
- `docs/BROWSER-PLAN.md` (Lewis's note): the free brain server has no browser "because a browser eats more memory than the whole free server has" and adding one brought back the crashes — the ~24 MB CDP-compatible engine is what makes browser access viable there.
- `compose.yaml`: "Obscura replaces Chromium as the browser engine: ~30 MB RSS vs 200+ MB … CDP-compatible, so Playwright's connectOverCDP and browser-use's CDP transport attach unchanged."

Timeline: Chromium-based era ended when 17(A) landed 2026-09-18; 17(B) was authored against Obscura from the start (2026-09-19). **Deliberate swap — not an accidental supersede, and not a later replacement of 17B.** 17B and the "better one" are the same delivery train.

## 17-5. PARITY — full action comparison

Inventory derived from main's tree (`actionInventory()`), cross-checked against the `c394139` file set: **all 59 actions present. Zero missing.** Main adds 2 vision actions beyond 17B.

## 17-6. What was lost, if anything?

**Nothing.** No 17B action is absent from main; no capability of the excluded SHA is missing. The only non-capability difference: the original branch SHAs (`09e21cd`, `c394139`) are not in main's commit graph — a provenance artifact of the repo's re-commit delivery pattern, not a lost capability. Environmental note (declared, not a loss): the Obscura binary is not present in this sandbox, so engine-dependent probes report NOT VERIFIED here.

## 17-7. Phase 17 status on main

- **On main:** every sub-scope A–J (see 17-1 table). 17B is fully on main and was live-verified at the original gate; it is NOT part of any deferral.
- **Declared deferrals (per gate commit `5ce176e`):** K-gate re-verification PARTIAL "due to sandbox lacking Obscura binary" (confirmed: `which obscura` → not found here); "vision model quality + SVG rasterization deferred per scope reports." The vision layer's honest `no-model` detector and labeled fixture detector on main reflect exactly this deferral.
- 17B vs the deferral: **separate.** The deferral concerns the engine binary's availability in sandboxed verification environments and the injected vision model's quality — not the 59-action registry or the agent loop.

## 17-8. VERDICT on 17B

**MIS-MERGED** — 17B's commits are on main under different SHAs (`c394139` → `d4fde5e`, `09e21cd` → `07c4757`), byte-identical, 59/59 actions live, vision extras layered on top by 17(C). Not REPLACED (nothing superseded it — the "better engine" IS its own foundation), not SUPERSEDED, not LOST.

## 17B ACTION COMPARISON TABLE

Legend: in 17B? = declared in the excluded `c394139` registry; on main? = present in main's `actionInventory()` (verified live); replacement = n/a — main carries the same implementation, not a different engine.

| # | Action | Group | in 17B? | on main? | in replacement? | verdict | notes |
|---|---|---|---|---|---|---|---|
| 1 | navigate | navigation | yes | yes | n/a | PARITY | real CDP navigation |
| 2 | go_back | navigation | yes | yes | n/a | PARITY | |
| 3 | go_forward | navigation | yes | yes | n/a | PARITY | |
| 4 | refresh | navigation | yes | yes | n/a | PARITY | |
| 5 | wait | navigation | yes | yes | n/a | PARITY | |
| 6 | scroll | navigation | yes | yes | n/a | PARITY | |
| 7 | hover | navigation | yes | yes | n/a | PARITY | |
| 8 | mouse_move | navigation | yes | yes | n/a | PARITY | |
| 9 | click_element | interaction | yes | yes | n/a | PARITY | index-based via DOM snapshot |
| 10 | double_click | interaction | yes | yes | n/a | PARITY | |
| 11 | right_click | interaction | yes | yes | n/a | PARITY | |
| 12 | ctrl_click | interaction | yes | yes | n/a | PARITY | modifier click |
| 13 | shift_click | interaction | yes | yes | n/a | PARITY | modifier click |
| 14 | type_text | interaction | yes | yes | n/a | PARITY | |
| 15 | send_keys | interaction | yes | yes | n/a | PARITY | |
| 16 | key_press | interaction | yes | yes | n/a | PARITY | KEY_SPECS/MODIFIERS |
| 17 | focus_element | interaction | yes | yes | n/a | PARITY | |
| 18 | blur_element | interaction | yes | yes | n/a | PARITY | |
| 19 | drag_element | interaction | yes | yes | n/a | PARITY | |
| 20 | scroll_element | interaction | yes | yes | n/a | PARITY | |
| 21 | select_option | forms | yes | yes | n/a | PARITY | |
| 22 | set_checkbox | forms | yes | yes | n/a | PARITY | |
| 23 | set_radio | forms | yes | yes | n/a | PARITY | |
| 24 | set_date | forms | yes | yes | n/a | PARITY | |
| 25 | upload_file | forms | yes | yes | n/a | PARITY | engine-gated; surfaces Obscura's own refusal (honest) |
| 26 | submit_form | forms | yes | yes | n/a | PARITY | |
| 27 | list_tabs | tabs | yes | yes | n/a | PARITY | |
| 28 | new_tab | tabs | yes | yes | n/a | PARITY | |
| 29 | close_tab | tabs | yes | yes | n/a | PARITY | |
| 30 | switch_tab | tabs | yes | yes | n/a | PARITY | |
| 31 | iframe_enter | tabs | yes | yes | n/a | PARITY | |
| 32 | iframe_exit | tabs | yes | yes | n/a | PARITY | |
| 33 | switch_window | tabs | yes | yes | n/a | PARITY | |
| 34 | set_dialog_policy | tabs | yes | yes | n/a | PARITY | |
| 35 | alert_accept | dialogs | yes | yes | n/a | PARITY | dialogs shim installed |
| 36 | alert_dismiss | dialogs | yes | yes | n/a | PARITY | |
| 37 | prompt_answer | dialogs | yes | yes | n/a | PARITY | |
| 38 | get_dialogs | dialogs | yes | yes | n/a | PARITY | |
| 39 | get_text | extraction | yes | yes | n/a | PARITY | |
| 40 | get_html | extraction | yes | yes | n/a | PARITY | |
| 41 | get_attributes | extraction | yes | yes | n/a | PARITY | |
| 42 | get_value | extraction | yes | yes | n/a | PARITY | |
| 43 | extract_links | extraction | yes | yes | n/a | PARITY | |
| 44 | screenshot | extraction | yes | yes | n/a | PARITY | registry action |
| 45 | eval_js | extraction | yes | yes | n/a | PARITY | `eval` permission-gated |
| 46 | set_attribute | dom_mutation | yes | yes | n/a | PARITY | |
| 47 | remove_attribute | dom_mutation | yes | yes | n/a | PARITY | |
| 48 | insert_html | dom_mutation | yes | yes | n/a | PARITY | |
| 49 | remove_element | dom_mutation | yes | yes | n/a | PARITY | |
| 50 | scroll_into_view | dom_mutation | yes | yes | n/a | PARITY | |
| 51 | set_viewport | dom_mutation | yes | yes | n/a | PARITY | |
| 52 | set_user_agent | dom_mutation | yes | yes | n/a | PARITY | |
| 53 | get_page_info | dom_mutation | yes | yes | n/a | PARITY | |
| 54 | set_network_throttle | dom_mutation | yes | yes | n/a | PARITY | |
| 55 | download_file | files | yes | yes | n/a | PARITY | |
| 56 | read_file | files | yes | yes | n/a | PARITY | filesystem permission |
| 57 | write_file | files | yes | yes | n/a | PARITY | write permission |
| 58 | list_files | files | yes | yes | n/a | PARITY | |
| 59 | save_screenshot | files | yes | yes | n/a | PARITY | |
| — | vision_click | vision (17C extra) | no | yes | — | MAIN EXCEEDS | screenshot → detect → map → real mouse events |
| — | capture_page | vision (17C extra) | no | yes | — | MAIN EXCEEDS | real CDP screenshot, dims + timing |

**MISSING actions: NONE (0 of 59). Main total: 59 + 2 vision extras.**

---

# 7. PER-SCOPE DELIVERABLE TABLE

| scope | SHA (excluded) | what it built | stated scope | verdict | replacement (if any) | parity gap |
|---|---|---|---|---|---|---|
| 8B — 20 security agents | `c8b8bb0` (tag `apk-build-445` only; branch deleted) | 20 specialist agents (16 `agents/security/` + patcher/reverser/fuzzer/security-verifier), overlap checker, divisions wiring — 22 files, +1214/−5 | `phase-8(B): 20 security agents — Shannon OWASP + Decepticon specialists wired into workforce and division registry` | **MIS-MERGED** | none needed — on main as `9a2e4e5` (identical) | EMPTY — main now has 24 security agents (> 20) |
| 9J — 3D globe UI | `a809023` (branch `phase-9-glm`, tag `pre-phase-9-final`) | `ui/preview/globe.html` (1443 lines) + gate probe — 2 files, +1921 | `phase-9(J): 3D globe UI` | **MIS-MERGED** | none needed — on main as `53ca1d7` | EMPTY — `globe.html` byte-identical; probe hardened post-merge |
| 11I — token-efficient graph queries | `930ec6f` (tag `pre-phase-11-final` only) | `capability/code/graph-first.js`, `capability/context-hook.js`, probe — 3 files, +457 | `phase-11(I): token-efficient graph-first queries` | **MIS-MERGED** | none needed — on main as `b33eab2` | EMPTY — all 3 files byte-identical; phase-31 wiring consumes it |
| 17B — 45+ browser actions | `c394139` (branch `origin/phase-17-openhands`) | 59-action registry (8 groups) + agent loop + raw CDP client + DOM service — 15 files, +3744 | `phase-17(B): 45+ browser actions + agent loop` | **MIS-MERGED** | none needed — on main as `d4fde5e` (identical); "better engine" = 17(A) Obscura, its own foundation | EMPTY — 59/59 actions on main + 2 vision extras (17C) |
| 21J — overnight autonomous run | `a63a820` (tags `pre-phase-21-arena`, `pre-phase-21-final`) | `research/overnight.js` + lifecycle adjustment + probe — 3 files, +230/−4 | `phase-21(J): overnight autonomous run` (plan: ~100 experiments/8h @ 5-min budget) | **MIS-MERGED** | none needed — on main as `dc81d27` (identical) | EMPTY — files byte-identical; server work-graph wiring was already a declared zone-owner task in gate `00b4786`, unchanged |

---

# 8. SUMMARY — VERDICT + ACTION NEEDED

| scope | verdict | action needed |
|---|---|---|
| 8B — 20 security agents | MIS-MERGED (already on main, full parity) | CLOSE — no merge, no rebuild (content on main via `9a2e4e5`) |
| 9J — 3D globe UI | MIS-MERGED (already on main, full parity) | CLOSE — no merge, no rebuild (content on main via `53ca1d7`) |
| 11I — token-efficient graph queries | MIS-MERGED (already on main, full parity) | CLOSE — no merge, no rebuild (content on main via `b33eab2`) |
| 17B — 45+ browser actions | MIS-MERGED (already on main, full parity; deep-dive §6) | CLOSE — no merge, no rebuild (content on main via `d4fde5e`; 59/59 actions verified live) |
| 21J — overnight autonomous run | MIS-MERGED (already on main, full parity) | CLOSE — no merge, no rebuild (content on main via `dc81d27`); the pre-declared zone-owner task "wire research subsystem into server's live work-graph" remains open on its own track, unchanged by this investigation |

**Totals: 5 investigated / 5 MIS-MERGED / 0 REPLACED / 0 SUPERSEDED / 0 LOST / 0 ABANDONED-BY-DESIGN / 0 NEEDS-LEAD-DECISION. Capability gaps introduced by the exclusions: 0.**

## Resolved Outside Scope

- **Phase 18 (voice):** Resolved by lead — deliberately NOT built; deferred to post-benchmark / post-go-live, and will be JEXI's first self-upgrade after go-live (Step 5). Not investigated here.

---

# 9. ZERO-TOUCH + ZONE CHECK

- `git diff --stat origin/main..HEAD` → exactly one file: `docs/EXCLUDED-SCOPES-INVESTIGATION.md` (this document). No code, no deps, no config touched.
- Zone compliance: the only change on this branch is the one file in the declared ZONE.
- No merges, no deletions, no branch rewrites; only tag created: `pre-excluded-scopes-investigation` (= base `d4b273f`).
- Live-verified evidence produced on main's tree during this investigation: `actionInventory()` → total 59, duplicate_names: [] (17B registry), and `git merge-base --is-ancestor` checks for every twin SHA listed in §1 and §6.

---

# 10. CLOSE-OUT — LEAD RULING (FINAL)

Investigation completed at `066be2d`. Lead ruling received and recorded verbatim in substance:

> **CLOSE all 5 scopes as MIS-MERGED — no merge, no rebuild, no tag-delete.**
>
> - 8B  `c8b8bb0` → `9a2e4e5`
> - 9J  `a809023` → `53ca1d7`
> - 11I `930ec6f` → `b33eab2`
> - 17B `c394139` → `d4fde5e`
> - 21J `a63a820` → `dc81d27`
>
> **17B browser:** Obscura is the intended replacement. The Chromium/Playwright swap was deliberate. 59/59 actions live. No gap. **Confirmed.**
>
> **Phase 17 deferrals** (K-gate PARTIAL, vision model, SVG raster): environmental, separate, **keep as declared**.
>
> **Phase 21 zone-owner wiring task: FOLD INTO CONSOLIDATED CLEANUP.** Do not wire now. Record and close this investigation branch.

## Disposition

| Item | Ruling | Status after close-out |
|---|---|---|
| 8B — 20 security agents | CLOSED (MIS-MERGED, full parity) | no action; content on main via `9a2e4e5` |
| 9J — 3D globe UI | CLOSED (MIS-MERGED, full parity) | no action; content on main via `53ca1d7` |
| 11I — token-efficient graph queries | CLOSED (MIS-MERGED, full parity) | no action; content on main via `b33eab2` |
| 17B — 45+ browser actions | CLOSED (MIS-MERGED, full parity; Obscura confirmed as intended engine) | no action; content on main via `d4fde5e` |
| 21J — overnight autonomous run | CLOSED (MIS-MERGED, full parity) | no action; content on main via `dc81d27` |
| Phase 21 wiring (research subsystem → server live work-graph) | FOLDED into Consolidated Cleanup | not wired now; ownership transferred to the consolidated-cleanup track |
| Phase 17 deferrals (K-gate PARTIAL / vision model / SVG raster) | KEEP AS DECLARED | unchanged; environmental, separate from scope exclusion |
| Phase 18 (voice) | RESOLVED OUTSIDE SCOPE (§ Resolved Outside Scope) | unchanged |
| Branch `investigation/excluded-scopes` | KEPT | no branch deletion, no tag deletion (per close-out constraints) |

**Final ledger: 5 investigated / 5 CLOSED as MIS-MERGED / 0 rebuilt / 0 merged-from-excluded-refs / 0 tags or branches deleted. Capability gaps introduced by the exclusions: 0.**

This close-out is doc-only (one commit, insertions only, zero deletions) and merges to main via PR. With this section, `docs/EXCLUDED-SCOPES-INVESTIGATION.md` is the permanent record of the exclusion question and its resolution.


