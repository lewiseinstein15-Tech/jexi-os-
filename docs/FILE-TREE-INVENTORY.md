# FILE TREE INVENTORY — main @ 115b1fc7675fbf4954420ae66f2807e429f118d5

Read-only inventory of the tracked tree (`git ls-files`, 3998 files, tree `1d2503057ac4f4fdace61305b607b50b19ee669a`). Sizes are blob byte sizes; purposes are the first meaningful header/line of each file (auto-extracted, not edited). Facts only — no recommendations. Produced on a REST-RECONSTRUCTED worktree whose tree SHA equals origin/main.

Note on Section C: `docs/archive/` does not exist on main yet — it is introduced by the unmerged branch `hygiene/repo-cleanup` @ `ad17b4d11e5dea84151259575f09c37b8290eafd`. That part of Section C is reported from that branch and labeled.

## SECTION A — ROOT LEVEL

### A.1 Root files (168 total: 146 .md · 16 config · 6 other)

#### A.1.a `.md` files (146)

| path | bytes | type | purpose (first line) |
|---|---:|---|---|
| `AGENT-CATALOG.md` | 114,165 | .md | JEXI OS — Agent & Skill Catalog |
| `AGENTS.md` | 4,761 | .md | JEXI OS — agent memory |
| `ANDROID.md` | 8,279 | .md | 📱 JEXI OS — Real Android App (APK) |
| `ARCHITECTURE-REPORT.md` | 31,106 | .md | JEXI OS — Master Architecture Research Report |
| `ARCHITECTURE.md` | 17,801 | .md | JEXI OS — Agent Graph Architecture (Build 47) |
| `AUTONOMY-DESIGN.md` | 7,784 | .md | AUTONOMY-DESIGN.md — True Multi-Agent Autonomy in JEXI OS |
| `B96-IMPLEMENTATION-REPORT.md` | 4,966 | .md | JEXI OS — DeepSeek Harness Implementation Report (Build 96) |
| `DATA_SOURCES.md` | 8,805 | .md | DATA_SOURCES.md — External Data Source Licenses (Phase 9 F) |
| `DEEPSEEK-HARNESS-REPORT.md` | 13,871 | .md | DeepSeek Harness & The Modern Agent-Framework Landscape |
| `DEPLOY-IMAGE-RENDER.md` | 2,088 | .md | 🐳 JEXI brain on Render — ZERO build minutes (image deploy) |
| `DEPLOY.md` | 14,085 | .md | 🚀 Deploying JEXI OS — Render (backend) + GitHub Pages/Vercel (frontend) |
| `DEPLOYMENT.md` | 5,047 | .md | JEXI OS — Deployment Guide |
| `DSH-PARITY.md` | 21,915 | .md | DSH → JEXI Parity Tracker |
| `FINAL-PROOF-REPORT.md` | 18,098 | .md | JEXI OS — Final Proof Report (live-mission hardening) |
| `FIXLOG-B100.md` | 5,309 | .md | FIXLOG-B100 — Compaction + Spill (DeepSeek Harness `compaction-basic` + `spill-local`/`spi |
| `FIXLOG-B101.md` | 4,189 | .md | FIXLOG-B101 — Tool Output Contracts for ALL 187 Tools + Per-Tool timeouts (DeepSeek Harnes |
| `FIXLOG-B102.md` | 3,644 | .md | FIXLOG-B102 — Agent Presets (Standard/PTC/Minimal/Creator) + Session Trace (DeepSeek Harne |
| `FIXLOG-B103.md` | 3,982 | .md | FIXLOG-B103 — JEXI Identity + Question-Answering Prompt Fix (agent AND normal mode) |
| `FIXLOG-B104.md` | 2,850 | .md | FIXLOG-B104 — Time Context + Spill Retention (DeepSeek Harness `time-context` + `output-re |
| `FIXLOG-B105.md` | 4,295 | .md | FIXLOG-B105 — Connection-Drop Fix + Plugin Tools Now Actually Reachable (weather works) |
| `FIXLOG-B106.md` | 4,032 | .md | FIXLOG-B106 — Every DeepSeek Harness Plugin Is JEXI (gap-closing batch) |
| `FIXLOG-B107.md` | 2,545 | .md | FIXLOG-B107 — Skills Marketplace (one-tap installable skills) |
| `FIXLOG-B108.md` | 3,359 | .md | FIXLOG-B108 — Smart Session Titles + Session Stats (DeepSeek Harness `session-title` + `se |
| `FIXLOG-B109.md` | 4,986 | .md | FIXLOG-B109 — DSH-Fidelity Pass (pulling session-title / session-stats / session-reference |
| `FIXLOG-B110.md` | 3,890 | .md | FIXLOG-B110 — Plan Mode + Ask User (DeepSeek Harness `plan-mode` + `tool-ask-user`/`user-q |
| `FIXLOG-B111.md` | 3,351 | .md | FIXLOG-B111 — Plan Mode Enforcement (no preview-link promises, no execution before approva |
| `FIXLOG-B112.md` | 3,221 | .md | FIXLOG-B112 — Plan Approval Actually Builds (approval resumes the ORIGINAL task) |
| `FIXLOG-B113.md` | 3,052 | .md | FIXLOG-B113 — /plan = Plan AND Execute (no approval, no questions, updates stream) |
| `FIXLOG-B114.md` | 2,801 | .md | FIXLOG-B114 — AUTO Mode: Normal + Agent combined, JEXI decides per query |
| `FIXLOG-B115.md` | 4,307 | .md | FIXLOG-B115 — Workflow Engine + Subagent Control (DeepSeek Harness `workflow` + `tool-suba |
| `FIXLOG-B116.md` | 2,258 | .md | FIXLOG-B116 — Critical: "Cannot access 'mode' before initialization" (TDZ crash) |
| `FIXLOG-B117.md` | 2,734 | .md | FIXLOG-B117 — One Mode: Normal + Agent truly combined (no toggle, JEXI decides) |
| `FIXLOG-B118.md` | 1,426 | .md | FIXLOG-B118 — Fixed "freezing, can't send" (B117 left a stale mode reference) |
| `FIXLOG-B119.md` | 4,207 | .md | FIXLOG-B119 — Full Lifecycle Parity (question → response, exactly like DeepSeek Harness) |
| `FIXLOG-B120.md` | 2,168 | .md | FIXLOG-B120 — The freeze was a STALE LIVE SERVER (Render never redeployed) |
| `FIXLOG-B121.md` | 2,611 | .md | FIXLOG-B121 — AUTO routing was dead (preset forced agent) + every plugin now mounted |
| `FIXLOG-B122.md` | 1,660 | .md | FIXLOG-B122 — Two new plugins: crypto-price + ip-geo (free, no key) |
| `FIXLOG-B123.md` | 1,714 | .md | FIXLOG-B123 — Fresh APK on EVERY deploy + live confirmation searching is fixed |
| `FIXLOG-B124.md` | 2,491 | .md | FIXLOG-B124 — Plugins were still searching: root cause + fix |
| `FIXLOG-B125.md` | 2,453 | .md | FIXLOG-B125 — Research rebuilt exactly like DeepSeek Harness (tool-web mirror) |
| `FIXLOG-B126.md` | 2,403 | .md | FIXLOG-B126 — Coding rebuilt exactly like DeepSeek Harness: autonomous, model-driven |
| `FIXLOG-B127-B128.md` | 2,093 | .md | FIXLOG-B127+B128 — Tappable preview links + DSH project memory (continue anything) |
| `FIXLOG-B129.md` | 1,327 | .md | FIXLOG-B129 — Frontend matches: tappable preview links in chat + PROJECTS screen |
| `FIXLOG-B131.md` | 1,904 | .md | FIXLOG-B131 — LSP plugin: real code intelligence (DeepSeek Harness `tool-lsp` mirror) |
| `FIXLOG-B132.md` | 2,046 | .md | FIXLOG-B132 — Batch: tool-goal + checkpoint-policy + atomic-write + telemetry + token-mete |
| `FIXLOG-B133.md` | 1,996 | .md | FIXLOG-B133 — Batch 2: commands + llm-retry + anonymous-id + attachment policy + invariant |
| `FIXLOG-B134.md` | 2,000 | .md | FIXLOG-B134 — Batch 3: ACP + terminal + credentials + sandbox policy + goal rounds |
| `FIXLOG-B135.md` | 7,943 | .md | FIXLOG B135 — "Pull all" batch 4: the remaining DeepSeek Harness packages |
| `FIXLOG-B136.md` | 6,018 | .md | FIXLOG B136 — "Pull all, replace with JEXI": the next DSH packages, JEXI-branded |
| `FIXLOG-B137.md` | 3,804 | .md | FIXLOG B137 — "Pull the all": approval, permission presets, subagent report, personas, run |
| `FIXLOG-B138.md` | 3,648 | .md | FIXLOG B138 — "Pull all": external subagent providers, code-runtime hardening, config relo |
| `FIXLOG-B139.md` | 3,363 | .md | FIXLOG B139 — "Pulla all": typert generator/registry, client connection/HMR/locale, comman |
| `FIXLOG-B140.md` | 2,833 | .md | FIXLOG B140 — "Continue pulling all": schedule tools, bundle-base manifest, gateway client |
| `FIXLOG-B141.md` | 3,265 | .md | FIXLOG B141 — "Pull all continue": SDK protocol/server, pwsh tool, storage domain, api pro |
| `FIXLOG-B142.md` | 2,732 | .md | FIXLOG B142 — "Pull all": bash-sandbox, cordis inspect tools, agent-loop-testkit, SDK code |
| `FIXLOG-B143.md` | 2,978 | .md | FIXLOG B143 — "Do all pull them": the 100% finish |
| `FIXLOG-B144.md` | 3,475 | .md | FIXLOG B144 — "Make sure you have pulled every plugin and everything else" |
| `FIXLOG-B145.md` | 4,311 | .md | FIXLOG B145 — THE FULL GAUNTLET: test every part of JEXI OS, find and fix what's broken |
| `FIXLOG-B146.md` | 1,563 | .md | FIXLOG B146 — "I told it to build an app but it said it was unable": build-failure transpa |
| `FIXLOG-B147.md` | 2,633 | .md | FIXLOG B147 — Frontend redesign v3: monochrome, ☰ menu, Workshop, agent-process view |
| `FIXLOG-B150.md` | 2,049 | .md | FIXLOG B150 — speed (DSH-style token streaming), composer always visible, + button placeme |
| `FIXLOG-B151.md` | 3,779 | .md | FIXLOG B151 — ChatGPT-style rich answer renderer + repo-analysis fixes |
| `FIXLOG-B152.md` | 2,030 | .md | FIXLOG B152 — "When you update it breaks, I have to re-download the app" — fixed |
| `FIXLOG-B153.md` | 2,352 | .md | FIXLOG B153 — update still breaking → real fix; chat UI per the full spec |
| `FIXLOG-B154.md` | 4,141 | .md | FIXLOG B154 — GitHub repository analysis actually works now |
| `FIXLOG-B155.md` | 4,504 | .md | FIXLOG B155 — memory & conversation continuity really work; update stops wiping everything |
| `FIXLOG-B156.md` | 2,501 | .md | FIXLOG B156 — missing API surface, chat memory, stream crashes |
| `FIXLOG-B158-B160.md` | 7,971 | .md | FIXLOG B158–B160 — APK update fixes · Responsive tiers · Streaming step feed · DSH pull-sy |
| `FIXLOG-B197.md` | 3,979 | .md | FIXLOG B197 — The REAL image blink/glitch/zoom fix |
| `FIXLOG-B199.md` | 7,746 | .md | FIXLOG B199 — Long-task autonomy hardening (found live, fixed live) |
| `FIXLOG-B200.md` | 3,745 | .md | FIXLOG B200 — Arena-style streaming: she narrates her work, live |
| `FIXLOG-B201.md` | 2,198 | .md | FIXLOG B201 — the completeness pass: short deliverables get finished |
| `FIXLOG-B202.md` | 3,124 | .md | B202 — Ranked-List Anti-Hallucination + Domain False-Positive Fixes |
| `FIXLOG-B203.md` | 3,785 | .md | B203 — Small-Host Memory Hardening (Render free-tier OOM kill) |
| `FIXLOG-B204.md` | 3,151 | .md | B204 — Research Latency: Overlap + Core-Query + Adaptive Reads |
| `FIXLOG-B205.md` | 3,608 | .md | B205 — Arena-Style Streaming Rebuild (Unified Thinking Panel) |
| `FIXLOG-B206.md` | 4,777 | .md | B206 — Thinking-Panel Hardening ("thinking must never break the UI") |
| `FIXLOG-B207.md` | 3,668 | .md | FIXLOG B207 — thinking panel breaks the layout on phone width |
| `FIXLOG-B208.md` | 7,807 | .md | FIXLOG B208 — THE DIRECTOR: JEXI as the boss of a team of AI employees |
| `FIXLOG-B209.md` | 9,130 | .md | FIXLOG — B209: Live Supervision & The Final Gaps |
| `FIXLOG-B210.md` | 7,311 | .md | FIXLOG — B210: Employee Command Execution (the last §27 events, made real) |
| `FIXLOG-B211.md` | 5,644 | .md | FIXLOG — B211 Autonomy Engineering Upgrade (+ B212 gap closure) |
| `FIXLOG-B213.md` | 3,632 | .md | FIXLOG — B213 Method Provenance |
| `FIXLOG-B214.md` | 7,452 | .md | FIXLOG — B214 Preview Links Always Work |
| `FIXLOG-B215.md` | 4,781 | .md | FIXLOG B215 — Structured Objective State + World State (Ultimate Autonomy spec, Phase 1) |
| `FIXLOG-B216.md` | 5,902 | .md | FIXLOG B216 — THE MISSION INSTRUMENT (Human-First UI Evolution, Phase 1) |
| `FIXLOG-B217.md` | 9,365 | .md | FIXLOG B217 — Survive the sleep: keep-warm + Redis persistence mirror |
| `FIXLOG-B218.md` | 4,932 | .md | FIXLOG B218 — boot resilience: one slow Redis moment must not cost a boot its durable laye |
| `FIXLOG-B219.md` | 4,509 | .md | FIXLOG B219 — provider refresh: stop paying the dead-model tax on every question |
| `FIXLOG-B220.md` | 3,439 | .md | FIXLOG B220 — retry-after-aware cooldowns: stop re-poking quota-blocked providers |
| `FIXLOG-B48.md` | 18,411 | .md | JEXI OS — Build 48 Fix Log (Identity, Memory Honesty, Continuity, UI, Recovery, Per-Agent  |
| `FIXLOG-B49.md` | 13,618 | .md | JEXI OS — Build 49 Fix Log (Roster / Skills / Tools Honesty + Independent Gates) |
| `FIXLOG-B50.md` | 15,615 | .md | FIXLOG-B50 — Claude-Code Primitive Gaps (Implementation Directive) |
| `FIXLOG-B51.md` | 11,604 | .md | FIXLOG-B51 — Kill Narration, Enforce Tool Discipline, Harden Graph+Loop |
| `FIXLOG-B52.md` | 13,451 | .md | FIXLOG-B52 — Close Remaining Weaknesses After B50/B51 |
| `FIXLOG-B53.md` | 14,945 | .md | FIXLOG-B53 — Product Delivery, Task Isolation, Memory, UI, Zero Process Garbage |
| `FIXLOG-B54.md` | 7,642 | .md | FIXLOG-B54 — Autonomy by Default, No Stalled Turns, Parallel Gates, Honest Verification |
| `FIXLOG-B55.md` | 8,778 | .md | FIXLOG-B55 — OpenWorker Risk-Tiered Execution Model (non-destructive upgrade) |
| `FIXLOG-B56.md` | 8,699 | .md | FIXLOG-B56 — Jexi Connector System (Plugin/Connector upgrade) |
| `FIXLOG-B57.md` | 5,991 | .md | FIXLOG-B57 — Email connector switched SendGrid → Resend + connector verification pass |
| `FIXLOG-B58.md` | 2,205 | .md | FIXLOG-B58 — Live testing found: raw webhook parser was eating every POST body |
| `FIXLOG-B59.md` | 4,322 | .md | JEXI OS — Build 59 Fix Log (Live connector verification round 3) |
| `FIXLOG-B61.md` | 6,804 | .md | JEXI OS — Build 61 Fix Log (Connector expansion + Telegram removal) |
| `FIXLOG-B62.md` | 3,437 | .md | JEXI OS — Build 62 Fix Log (WhatsApp chat UX: fast replies + in-app Chats) |
| `FIXLOG-B63.md` | 3,273 | .md | FIXLOG-B63 — WhatsApp permanent-chat hardening (24h-window template fallback) |
| `FIXLOG-B64.md` | 3,285 | .md | FIXLOG-B64 — Email inbound: Svix verification corrected (Ed25519 → HMAC-SHA256) |
| `FIXLOG-B65.md` | 2,332 | .md | FIXLOG-B65 — Email inbound: fetch the real received-email endpoint + response shape |
| `FIXLOG-B66.md` | 12,479 | .md | FIXLOG-B66 — Orchestrator-Workers architecture · WhatsApp removed · Email primary · Format |
| `FIXLOG-B67.md` | 5,389 | .md | FIXLOG-B67 — Native tool-calling adoption completed (finishes B66 3a PARTIAL) |
| `FIXLOG-B68.md` | 9,882 | .md | FIXLOG-B68 — Memory persistence: REDIS_URL is now a first-class, verified persistence back |
| `FIXLOG-B69.md` | 7,141 | .md | FIXLOG-B69 — Verification audit of the B62 directive (WhatsApp removal / Email / Orchestra |
| `FIXLOG-B70.md` | 3,404 | .md | FIXLOG-B70 — Backend lock readiness + app update flow |
| `FIXLOG-B71.md` | 4,418 | .md | FIXLOG-B71 — Blank Android app after update: WebView parse-level incompatibility |
| `FIXLOG-B72.md` | 5,167 | .md | FIXLOG-B72 — "The task hit an unexpected error": dead model + hidden degraded message |
| `FIXLOG-B73.md` | 8,282 | .md | FIXLOG-B73 — Free-model audit: DeepSeek/Qwen free tiers researched and applied |
| `FIXLOG-B74.md` | 4,294 | .md | FIXLOG-B74 — vLLM: self-hosted, genuinely-free inference backend |
| `FIXLOG-B75.md` | 4,877 | .md | FIXLOG-B75 — No-card free AI API keys: research + NVIDIA NIM / SambaNova wired |
| `FIXLOG-B76.md` | 5,050 | .md | FIXLOG-B76 — Live provider test + best-model-per-part selection |
| `FIXLOG-B77.md` | 3,497 | .md | FIXLOG-B77 — Free-only routing + load spreading (never hit rate limits) |
| `FIXLOG-B78.md` | 7,394 | .md | FIXLOG-B78 — Event-sourced logging + token-threshold compaction + filesystem-native cowork |
| `FIXLOG-B79.md` | 3,691 | .md | FIXLOG-B79 — Fixed Command Center layout + boot loading screen + the missing update explai |
| `FIXLOG-B80.md` | 3,734 | .md | FIXLOG-B80.md — Phase 2: Durable Background Goals · Atomic Memory · Browser SSRF · Lint |
| `FIXLOG-B81.md` | 2,424 | .md | FIXLOG-B81.md — Goal Completion Notifications + Email Reports |
| `FIXLOG-B82.md` | 3,811 | .md | FIXLOG-B82.md — Scheduled Goals (JEXI runs proactively) |
| `FIXLOG-B84.md` | 2,773 | .md | FIXLOG-B84.md — Web Push: JEXI notifies you even when the app is closed |
| `FIXLOG-B85.md` | 1,578 | .md | FIXLOG-B85.md — Durable Chat: long chat tasks survive restarts |
| `FIXLOG-B86.md` | 2,592 | .md | FIXLOG-B86.md — FCM: closed-app push for the installed APK |
| `FIXLOG-B89.md` | 2,094 | .md | FIXLOG-B89.md — Do Anything Agent (free-form autonomous task agent) |
| `FIXLOG-B90.md` | 2,096 | .md | FIXLOG-B90.md — Browser Booking Flow (flights, hotels, cars) |
| `FIXLOG-B91.md` | 2,073 | .md | FIXLOG-B91.md — Universal Links · Autonomous GitHub Builder · File Uploads |
| `FIXLOG-B92.md` | 2,458 | .md | FIXLOG-B92.md — Normal Mode · Unified Attach · Tool-Fallback · UI Polish |
| `FIXLOG-B93.md` | 2,395 | .md | FIXLOG-B93.md — Connection recovery · Twitter news · Source diversity · Vision · Home card |
| `FIXLOG-B94.md` | 1,844 | .md | FIXLOG-B94.md — Camera/Vision: the REAL fix + native-camera fallback |
| `FIXLOG-B95.md` | 1,730 | .md | FIXLOG-B95.md — Camera: NATIVE camera preview (stop relying on WebView getUserMedia) |
| `FIXLOG-B96.md` | 2,656 | .md | FIXLOG-B96.md — DeepSeek-Harness-Style Session Model + Agent Tools |
| `FIXLOG-B97.md` | 2,673 | .md | FIXLOG-B97.md — Plugin Seam (the "everything is a plugin" core) |
| `FIXLOG-B98.md` | 5,889 | .md | FIXLOG-B98 — Skill Auto-Discovery (DeepSeek Harness `skill-filesystem` + `tool-skill` mirr |
| `FIXLOG-B99.md` | 5,144 | .md | FIXLOG-B99 — Code Mode / PTC (DeepSeek Harness `code` preset mirror) |
| `FIXLOG.md` | 18,654 | .md | JEXI OS — Build 47 Fix Log (Independent Audit) |
| `README.md` | 9,171 | .md | JEXI OS |
| `SCALING.md` | 7,341 | .md | 🚀 JEXI OS — Scaling Guide (vertical + horizontal, for $0) |
| `TEST.md` | 2,728 | .md | 🧪 JEXI OS — Testing |
| `THIRD_PARTY_NOTICES.md` | 4,846 | .md | THIRD_PARTY_NOTICES.md — Dependency Licenses (Phase 9 F) |
| `UI-DESIGN-PROMPT.md` | 8,681 | .md | 🎨 JEXI OS — Frontend UI Redesign Prompt (for Claude) |
| `WATCH.md` | 1,871 | .md | 📺 /watch — JEXI can watch videos |
| `ZONE-OWNER.md` | 37,644 | .md | ZONE-OWNER.md |

#### A.1.b Config files (16)

| path | bytes | type | purpose (first line) |
|---|---:|---|---|
| `.dockerignore` | 28 | (none) | node_modules |
| `.env.example` | 3,875 | .example | JEXI OS Environment Variables |
| `.env.production` | 345 | .production | JEXI OS — baked brain address for production builds (APK + static web). |
| `.gitignore` | 1,161 | (none) | Dependencies |
| `Dockerfile` | 2,727 | (none) | JEXI OS — single-container image (Hugging Face Spaces / Docker / VPS) |
| `Dockerfile.slim` | 3,784 | .slim | JEXI OS — SLIM image (no Chromium) for image-based deploys. |
| `bun.lock` | 151,752 | .lock | "lockfileVersion": 1, |
| `capacitor.config.json` | 492 | .json | JSON: keys appId, appName, webDir, backgroundColor, android |
| `docker-compose.yml` | 293 | .yml | version: '3.8' |
| `mcp.example.json` | 215 | .json | JSON: keys mcpServers |
| `package-lock.json` | 393,214 | .json | JSON: keys name, version, lockfileVersion, requires, packages |
| `package.json` | 1,723 | .json | JSON: keys name, private, version, type, scripts |
| `postcss.config.js` | 80 | .js | plugins: { |
| `render.yaml` | 3,242 | .yaml | Render Blueprint — JEXI OS Backend ("Brain") |
| `tailwind.config.js` | 2,737 | .js | content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"], |
| `vite.config.js` | 2,411 | .js | B158 — bake a per-build stamp into <meta name="jexi-build">. The inline |

#### A.1.c Everything else (6)

| path | bytes | type | purpose (first line) |
|---|---:|---|---|
| `AGENT_ONLINE.txt` | 8 | .txt | SUCCESS |
| `LICENSE` | 2,507 | (none) | MIT License |
| `b221-verify.cjs` | 4,716 | .cjs | B207/B221 — programmatic layout verification at 390×844 against the REAL brain. */ |
| `demo-banner.jpg` | 84,246 | .jpg | JPEG image |
| `demo-index.html` | 2,091 | .html | DOCTYPE html> |
| `index.html` | 6,962 | .html | DOCTYPE html> |

### A.2 Top-level directories (50)

| dir | files | bytes | purpose |
|---|---:|---:|---|
| `.github/` | 12 | 37,283 | GitHub Actions workflows |
| `.jexi/` | 4 | 712 | repo-local JEXI config |
| `agents/` | 89 | 204,686 | agent catalog (*.agent.md role definitions by division) |
| `android/` | 82 | 652,529 | Capacitor Android project (APK build) |
| `brain/` | 79 | 233,629 | Phase 28 persistent brain (repo + page schema + KG) |
| `capability/` | 52 | 178,110 | capability matrix / registries |
| `cli/` | 10 | 53,783 | CLI entry + commands |
| `commands/` | 19 | 79,961 | slash-command definitions |
| `computer/` | 42 | 223,449 | Phase 29 computer-use agent (action space, operators, VLM, loop) |
| `context/` | 10 | 51,555 | context assembly |
| `deploy/` | 4 | 21,364 | deployment manifests/scripts |
| `docs/` | 117 | 6,936,842 | project documentation, reports, screenshots |
| `events/` | 10 | 77,393 | Phase 16 chat-event taxonomy + producers |
| `evomap/` | 10 | 22,184 | evolution map |
| `harness/` | 82 | 280,095 | Phase 30 harness parity (hooks/skills/subagent primitives) + XBOW harness |
| `hooks/` | 11 | 18,206 | hook scripts/catalog dirs |
| `instincts/` | 20 | 51,719 | instinct layer |
| `intelligence/` | 20 | 101,524 | trust pipeline / intelligence layer |
| `jexi-agents/` | 6 | 9,878 | secondary agent bundle |
| `kernel/` | 7 | 37,845 | kernel / scheduler primitives |
| `knowledge/` | 19 | 67,578 | knowledge schema + migrations |
| `learning/` | 6 | 40,596 | learning loops |
| `lsp/` | 1 | 1,798 | LSP integration |
| `memory/` | 7 | 49,087 | memory subsystem (hybrid search, lifecycle, confidence) |
| `omnia/` | 15 | 30,594 | omnia module |
| `plugins/` | 1 | 162 | plugin manifests |
| `prompt/` | 36 | 222,558 | prompt assets / defense baseline |
| `providers/` | 16 | 71,710 | Phase 27 provider profiles + keyRef discipline |
| `public/` | 1 | 1,997 | static web assets |
| `research/` | 26 | 68,673 | research loop program (experiments, swarm, budgets) |
| `rlm/` | 10 | 26,373 | RLM module |
| `router/` | 2 | 1,809 | routing |
| `runtimes/` | 31 | 253,743 | runtime adapters |
| `scheduler/` | 8 | 22,454 | scheduler |
| `scripts/` | 217 | 2,122,945 | probes, generators, one-off utilities |
| `security/` | 51 | 298,076 | security shield / checks |
| `semantica/` | 26 | 48,282 | semantica error/ontology layer |
| `server/` | 876 | 6,654,118 | Node backend (Express API, services, tools, tests) |
| `session/` | 5 | 19,520 | session handling |
| `skills/` | 1466 | 16,012,948 | skill library (SKILL.md tree, installers, gates) |
| `src/` | 109 | 1,841,961 | Vite React front-end |
| `surfsense/` | 31 | 78,065 | surfsense integration |
| `swarm/` | 23 | 50,389 | swarm coordination |
| `tests/` | 6 | 47,352 | top-level tests (autonomy, agi) |
| `tools/` | 20 | 54,179 | tool registry + audit |
| `ui/` | 52 | 456,725 | Phase 16/24 web console (ui/web/console) |
| `verification/` | 18 | 109,552 | verification loops |
| `web/` | 1 | 172 | web shell |
| `workforce/` | 50 | 438,069 | workforce narration / roles |
| `workgraph/` | 14 | 49,061 | workgraph engine |

## SECTION B — TOP-LEVEL DIRECTORY BREAKDOWN

### `.github/` — 12 files, 37,283 bytes, 0 directly inside, 1 subdirs

- `.github/workflows/` · 12 files · 37,283 B

### `.jexi/` — 4 files, 712 bytes, 4 directly inside, 0 subdirs

- direct files (4): `config.yaml`, `permissions.yaml`, `plugins.yaml`, `providers.yaml`

### `agents/` — 89 files, 204,686 bytes, 0 directly inside, 18 subdirs

- `agents/automation/` · 1 files · 2,250 B
- `agents/business/` · 1 files · 2,170 B
- `agents/content/` · 1 files · 2,192 B
- `agents/data/` · 6 files · 13,122 B
- `agents/design/` · 5 files · 11,017 B
- `agents/engineering/` · 24 files · 59,818 B
- `agents/integration/` · 1 files · 2,179 B
- `agents/learning/` · 1 files · 2,112 B
- `agents/legal/` · 1 files · 2,228 B
- `agents/localization/` · 1 files · 2,337 B
- `agents/meta/` · 1 files · 877 B
- `agents/ops/` · 4 files · 8,945 B
- `agents/product/` · 3 files · 6,640 B
- `agents/research/` · 7 files · 14,926 B
- `agents/security/` · 24 files · 55,558 B
- `agents/testing/` · 6 files · 13,793 B
- `agents/visualization/` · 1 files · 2,301 B
- `agents/voice/` · 1 files · 2,221 B

### `android/` — 82 files, 652,529 bytes, 8 directly inside, 2 subdirs

- `android/app/` · 72 files · 591,479 B
- `android/gradle/` · 2 files · 44,104 B
- direct files (8): `.gitignore`, `build.gradle`, `capacitor.settings.gradle`, `gradle.properties`, `gradlew`, `gradlew.bat`, `settings.gradle`, `variables.gradle`

### `brain/` — 79 files, 233,629 bytes, 0 directly inside, 11 subdirs

- `brain/ambient/` · 7 files · 28,380 B
- `brain/cycle/` · 16 files · 25,545 B
- `brain/evals/` · 4 files · 10,429 B
- `brain/hot/` · 7 files · 26,595 B
- `brain/index/` · 6 files · 15,083 B
- `brain/kg/` · 6 files · 14,324 B
- `brain/multi/` · 5 files · 22,342 B
- `brain/protocol/` · 6 files · 23,695 B
- `brain/publish/` · 2 files · 13,168 B
- `brain/repo/` · 6 files · 16,491 B
- `brain/search/` · 14 files · 37,577 B

### `capability/` — 52 files, 178,110 bytes, 1 directly inside, 4 subdirs

- `capability/code/` · 23 files · 73,651 B
- `capability/doctor/` · 2 files · 13,186 B
- `capability/internet/` · 24 files · 63,833 B
- `capability/rag/` · 2 files · 25,061 B
- direct files (1): `context-hook.js`

### `cli/` — 10 files, 53,783 bytes, 4 directly inside, 1 subdirs

- `cli/lib/` · 6 files · 31,086 B
- direct files (4): `install.ps1`, `install.sh`, `jexi.js`, `test-cli.js`

### `commands/` — 19 files, 79,961 bytes, 19 directly inside, 0 subdirs

- direct files (19): `_context.js`, `autonomous.command.js`, `build-fix.command.js`, `catchup.command.js`, `checkpoint.command.js`, `code-review.command.js`, `cost-report.command.js`, `dispatcher.js`, `doctor.command.js`, `export.command.js`, `goal.command.js`, `handoff.command.js`, `heartbeat.command.js`, `index.js`, `intel.command.js`, `learn.command.js`, `refine.command.js`, `registry.js`, `status.command.js`

### `computer/` — 42 files, 223,449 bytes, 1 directly inside, 10 subdirs

- `computer/action/` · 5 files · 18,158 B
- `computer/events/` · 3 files · 18,132 B
- `computer/loop/` · 3 files · 21,335 B
- `computer/modes/` · 3 files · 13,284 B
- `computer/operators/` · 6 files · 26,657 B
- `computer/remote/` · 3 files · 23,472 B
- `computer/sandbox/` · 4 files · 23,513 B
- `computer/screenshot/` · 4 files · 22,600 B
- `computer/tool-call/` · 6 files · 35,050 B
- `computer/vlm/` · 4 files · 20,393 B
- direct files (1): `errors.js`

### `context/` — 10 files, 51,555 bytes, 1 directly inside, 2 subdirs

- `context/offload/` · 3 files · 17,272 B
- `context/viking/` · 6 files · 34,103 B
- direct files (1): `README.md`

### `deploy/` — 4 files, 21,364 bytes, 2 directly inside, 1 subdirs

- `deploy/selfhost/` · 2 files · 8,835 B
- direct files (2): `lb-worker.js`, `test-lb.js`

### `docs/` — 117 files, 6,936,842 bytes, 84 directly inside, 4 subdirs

- `docs/architecture/` · 7 files · 93,375 B
- `docs/assets/` · 18 files · 385,022 B
- `docs/research/` · 7 files · 23,783 B
- `docs/screenshots/` · 1 files · 2,000,441 B
- direct files (84): `AGI_ARCHITECTURE.md`, `AGI_BENCHMARK.md`, `ARENA-ASTRA-REBUILD-REPORT.md`, `ARENA-REBUILD-REPORT.md`, `ARENA-REBUILD-SPEC.md`, `AUTONOMY_AUDIT.md`, `AUTONOMY_IMPLEMENTATION_REPORT.md`, `BROWSER-PLAN.md`, `CAPABILITY_MATRIX.md`, `CRASH-REPORTS.md`, `DESIGN_SYSTEM.md`, `FIXLOG-B221.md`, `FIXLOG-B222.md`, `FIXLOG-B223.md`, `FIXLOG-B224.md`, `FIXLOG-B225.md`, `FIXLOG-B227.md`, `GENERAL_INTELLIGENCE_AUDIT.md`, `HUMAN_UI_AUDIT.md`, `IMPLEMENTATION_REPORT.md` +64 more.

### `events/` — 10 files, 77,393 bytes, 1 directly inside, 3 subdirs

- `events/chat/` · 1 files · 9,143 B
- `events/hud/` · 5 files · 39,089 B
- `events/provenance/` · 3 files · 28,999 B
- direct files (1): `README.md`

### `evomap/` — 10 files, 22,184 bytes, 4 directly inside, 1 subdirs

- `evomap/gep/` · 6 files · 14,704 B
- direct files (4): `audit.js`, `evolver.js`, `index.js`, `network.js`

### `harness/` — 82 files, 280,095 bytes, 1 directly inside, 7 subdirs

- `harness/adapters/` · 19 files · 45,942 B
- `harness/forge/` · 5 files · 26,185 B
- `harness/hardening/` · 16 files · 88,082 B
- `harness/immutable/` · 2 files · 1,569 B
- `harness/parity/` · 26 files · 91,901 B
- `harness/refine/` · 6 files · 12,773 B
- `harness/state/` · 7 files · 13,323 B
- direct files (1): `index.js`

### `hooks/` — 11 files, 18,206 bytes, 2 directly inside, 1 subdirs

- `hooks/scripts/` · 9 files · 13,743 B
- direct files (2): `hooks.json`, `hooks.metadata.json`

### `instincts/` — 20 files, 51,719 bytes, 0 directly inside, 6 subdirs

- `instincts/core/` · 3 files · 10,059 B
- `instincts/evolve/` · 4 files · 12,801 B
- `instincts/io/` · 3 files · 5,699 B
- `instincts/observe/` · 4 files · 10,313 B
- `instincts/prune/` · 3 files · 4,571 B
- `instincts/store/` · 3 files · 8,276 B

### `intelligence/` — 20 files, 101,524 bytes, 0 directly inside, 2 subdirs

- `intelligence/layers/` · 15 files · 70,295 B
- `intelligence/trust-pipeline/` · 5 files · 31,229 B

### `jexi-agents/` — 6 files, 9,878 bytes, 1 directly inside, 1 subdirs

- `jexi-agents/coworkers/` · 5 files · 7,708 B
- direct files (1): `ORCHESTRATOR.md`

### `kernel/` — 7 files, 37,845 bytes, 1 directly inside, 1 subdirs

- `kernel/daemon/` · 6 files · 37,662 B
- direct files (1): `README.md`

### `knowledge/` — 19 files, 67,578 bytes, 2 directly inside, 2 subdirs

- `knowledge/attack-chain/` · 15 files · 54,205 B
- `knowledge/schema/` · 2 files · 5,358 B
- direct files (2): `index.js`, `store.js`

### `learning/` — 6 files, 40,596 bytes, 6 directly inside, 0 subdirs

- direct files (6): `analyzer.js`, `index.js`, `instinct.js`, `observer.js`, `promoter.js`, `store.js`

### `lsp/` — 1 files, 1,798 bytes, 1 directly inside, 0 subdirs

- direct files (1): `README.md`

### `memory/` — 7 files, 49,087 bytes, 7 directly inside, 0 subdirs

- direct files (7): `README.md`, `confidence.js`, `hybrid-search.js`, `knowledge-graph.js`, `lifecycle.js`, `session-compress.js`, `session-inject.js`

### `omnia/` — 15 files, 30,594 bytes, 0 directly inside, 3 subdirs

- `omnia/council/` · 5 files · 10,888 B
- `omnia/relay/` · 5 files · 9,080 B
- `omnia/vault/` · 5 files · 10,626 B

### `plugins/` — 1 files, 162 bytes, 1 directly inside, 0 subdirs

- direct files (1): `README.md`

### `prompt/` — 36 files, 222,558 bytes, 0 directly inside, 9 subdirs

- `prompt/anti-patterns/` · 4 files · 25,065 B
- `prompt/assembly/` · 4 files · 16,771 B
- `prompt/constitution/` · 6 files · 35,925 B
- `prompt/incidents/` · 4 files · 27,732 B
- `prompt/memory-fs/` · 6 files · 48,012 B
- `prompt/sections/` · 1 files · 8,431 B
- `prompt/testing/` · 4 files · 19,091 B
- `prompt/tools/` · 3 files · 23,589 B
- `prompt/versioning/` · 4 files · 17,942 B

### `providers/` — 16 files, 71,710 bytes, 1 directly inside, 4 subdirs

- `providers/cost/` · 3 files · 26,190 B
- `providers/profiles/` · 4 files · 10,350 B
- `providers/routing/` · 5 files · 16,247 B
- `providers/tokens/` · 3 files · 18,788 B
- direct files (1): `README.md`

### `public/` — 1 files, 1,997 bytes, 1 directly inside, 0 subdirs

- direct files (1): `sw.js`

### `research/` — 26 files, 68,673 bytes, 2 directly inside, 10 subdirs

- `research/budget/` · 2 files · 6,132 B
- `research/constraints/` · 3 files · 7,617 B
- `research/fixtures/` · 3 files · 2,627 B
- `research/loop/` · 3 files · 7,639 B
- `research/program/` · 3 files · 3,429 B
- `research/simplicity/` · 1 files · 5,365 B
- `research/swarm/` · 3 files · 7,799 B
- `research/templates/` · 2 files · 5,282 B
- `research/tracking/` · 3 files · 9,043 B
- `research/workgraph/` · 1 files · 4,883 B
- direct files (2): `PHASE-21-PLAN.md`, `overnight.js`

### `rlm/` — 10 files, 26,373 bytes, 1 directly inside, 2 subdirs

- `rlm/daemon/` · 5 files · 15,365 B
- `rlm/kernel/` · 4 files · 7,909 B
- direct files (1): `RESEARCH.md`

### `router/` — 2 files, 1,809 bytes, 2 directly inside, 0 subdirs

- direct files (2): `README.md`, `resolve.js`

### `runtimes/` — 31 files, 253,743 bytes, 1 directly inside, 2 subdirs

- `runtimes/browser/` · 24 files · 223,513 B
- `runtimes/sandbox/` · 6 files · 30,030 B
- direct files (1): `README.md`

### `scheduler/` — 8 files, 22,454 bytes, 1 directly inside, 1 subdirs

- `scheduler/autonomous/` · 7 files · 22,285 B
- direct files (1): `README.md`

### `scripts/` — 217 files, 2,122,945 bytes, 214 directly inside, 2 subdirs

- `scripts/hooks/` · 1 files · 246 B
- `scripts/scope-g/` · 2 files · 18,762 B
- direct files (214): `arena-backup.sh`, `arena-benchmark.mjs`, `arena-chat-proof.mjs`, `arena-restore.sh`, `arena-screenshots.mjs`, `arena-trace-proof.mjs`, `arena-ui-verify.mjs`, `check-agent-overlap.mjs`, `cleanup-creds-grep.mjs`, `convert-harnesses.sh`, `generate-catalog.mjs`, `generate-divisions.js`, `install-harnesses.sh`, `lint-agent-baseline.sh`, `make-icon.js`, `phase10-a-probe.mjs`, `phase10-b-probe.mjs`, `phase10-c-probe.mjs`, `phase10-d-probe.mjs`, `phase10-e-probe.mjs` +194 more.

### `security/` — 51 files, 298,076 bytes, 1 directly inside, 4 subdirs

- `security/engagements/` · 16 files · 68,498 B
- `security/exec-bridge/` · 5 files · 20,101 B
- `security/pipeline/` · 16 files · 107,174 B
- `security/shield/` · 13 files · 102,107 B
- direct files (1): `README.md`

### `semantica/` — 26 files, 48,282 bytes, 1 directly inside, 6 subdirs

- `semantica/decisions/` · 4 files · 6,278 B
- `semantica/graph/` · 5 files · 8,634 B
- `semantica/ontology/` · 4 files · 9,290 B
- `semantica/provenance/` · 4 files · 8,322 B
- `semantica/reasoning/` · 4 files · 6,266 B
- `semantica/repo-map/` · 4 files · 8,319 B
- direct files (1): `_internal.js`

### `server/` — 876 files, 6,654,118 bytes, 191 directly inside, 14 subdirs

- `server/agents/` · 20 files · 36,888 B
- `server/bundles/` · 1 files · 40,914 B
- `server/evaluation/` · 2 files · 24,079 B
- `server/examples/` · 4 files · 5,379 B
- `server/knowledge/` · 5 files · 15,134 B
- `server/mcp/` · 3 files · 410,878 B
- `server/plugins/` · 121 files · 125,780 B
- `server/rules/` · 22 files · 23,360 B
- `server/scripts/` · 8 files · 94,665 B
- `server/sdk/` · 5 files · 16,525 B
- `server/skills/` · 2 files · 5,517 B
- `server/src/` · 425 files · 3,548,430 B
- `server/test-support/` · 4 files · 9,531 B
- `server/tests/` · 63 files · 351,630 B
- direct files (191): `.dockerignore`, `CONNECTORS.md`, `Dockerfile`, `audit-b207-culprit.js`, `audit-b207-layout.js`, `audit-b209-layout.js`, `build-stamp.json`, `cli.js`, `eslint.config.js`, `index.js`, `mcp-server.js`, `package-lock.json`, `package.json`, `public`, `test-agent-contracts.js`, `test-api-surface.js`, `test-arena-astra.js`, `test-audit-b47.js`, `test-audit-b48.js`, `test-auto-mode.js` +171 more.

### `session/` — 5 files, 19,520 bytes, 0 directly inside, 1 subdirs

- `session/fleet/` · 5 files · 19,520 B

### `skills/` — 1466 files, 16,012,948 bytes, 4 directly inside, 7 subdirs

- `skills/aas/` · 9 files · 23,178 B
- `skills/design/` · 140 files · 1,060,953 B
- `skills/engineering/` · 11 files · 47,220 B
- `skills/executable/` · 5 files · 11,006 B
- `skills/gates/` · 9 files · 13,474 B
- `skills/installer/` · 5 files · 15,485 B
- `skills/library/` · 1283 files · 14,835,296 B
- direct files (4): `README.md`, `creator.js`, `deploy-then-verify.json`, `research-with-sources.json`

### `src/` — 109 files, 1,841,961 bytes, 4 directly inside, 7 subdirs

- `src/assets/` · 7 files · 1,103,381 B
- `src/brand/` · 1 files · 2,455 B
- `src/components/` · 66 files · 419,374 B
- `src/hooks/` · 9 files · 55,486 B
- `src/services/` · 3 files · 14,744 B
- `src/styles/` · 1 files · 40,822 B
- `src/utils/` · 18 files · 75,594 B
- direct files (4): `App.jsx`, `index.css`, `jexi-theme.css`, `main.jsx`

### `surfsense/` — 31 files, 78,065 bytes, 1 directly inside, 4 subdirs

- `surfsense/connectors/` · 20 files · 30,055 B
- `surfsense/output/` · 3 files · 16,094 B
- `surfsense/podcast/` · 3 files · 13,380 B
- `surfsense/search/` · 4 files · 15,045 B
- direct files (1): `README.md`

### `swarm/` — 23 files, 50,389 bytes, 0 directly inside, 4 subdirs

- `swarm/consensus/` · 7 files · 12,520 B
- `swarm/hive/` · 5 files · 11,979 B
- `swarm/loops/` · 3 files · 12,225 B
- `swarm/topologies/` · 8 files · 13,665 B

### `tests/` — 6 files, 47,352 bytes, 0 directly inside, 1 subdirs

- `tests/security/` · 6 files · 47,352 B

### `tools/` — 20 files, 54,179 bytes, 1 directly inside, 2 subdirs

- `tools/domains/` · 17 files · 44,123 B
- `tools/registry/` · 2 files · 9,922 B
- direct files (1): `README.md`

### `ui/` — 52 files, 456,725 bytes, 1 directly inside, 2 subdirs

- `ui/preview/` · 3 files · 215,339 B
- `ui/web/` · 48 files · 241,232 B
- direct files (1): `README.md`

### `verification/` — 18 files, 109,552 bytes, 1 directly inside, 3 subdirs

- `verification/eval/` · 8 files · 32,850 B
- `verification/verifiers/` · 5 files · 38,381 B
- `verification/visual/` · 4 files · 38,158 B
- direct files (1): `README.md`

### `web/` — 1 files, 172 bytes, 1 directly inside, 0 subdirs

- direct files (1): `README.md`

### `workforce/` — 50 files, 438,069 bytes, 2 directly inside, 8 subdirs

- `workforce/agents/` · 8 files · 254,493 B
- `workforce/divisions/` · 3 files · 16,965 B
- `workforce/identity/` · 6 files · 35,140 B
- `workforce/narration/` · 8 files · 9,154 B
- `workforce/nexus/` · 7 files · 60,762 B
- `workforce/registry/` · 3 files · 14,110 B
- `workforce/subagent/` · 7 files · 21,506 B
- `workforce/trust/` · 6 files · 21,941 B
- direct files (2): `README.md`, `divisions.json`

### `workgraph/` — 14 files, 49,061 bytes, 1 directly inside, 2 subdirs

- `workgraph/phases/` · 7 files · 31,093 B
- `workgraph/session/` · 6 files · 16,692 B
- direct files (1): `README.md`

## SECTION C — docs/ DEEP DIVE

Total files under `docs/` on main: **117**

### C.1 Subdirectory structure

- `docs/` · 84 files · 4,434,221 B
- `docs/architecture/reconstruction/` · 7 files · 93,375 B
- `docs/assets/screenshots/` · 8 files · 369,112 B
- `docs/assets/screenshots/evidence/` · 10 files · 15,910 B
- `docs/research/` · 7 files · 23,783 B
- `docs/screenshots/` · 1 files · 2,000,441 B

### C.2 Every file under docs/ (main)

```
docs/AGI_ARCHITECTURE.md
docs/AGI_BENCHMARK.md
docs/ARENA-ASTRA-REBUILD-REPORT.md
docs/ARENA-REBUILD-REPORT.md
docs/ARENA-REBUILD-SPEC.md
docs/AUTONOMY_AUDIT.md
docs/AUTONOMY_IMPLEMENTATION_REPORT.md
docs/BROWSER-PLAN.md
docs/CAPABILITY_MATRIX.md
docs/CRASH-REPORTS.md
docs/DESIGN_SYSTEM.md
docs/FIXLOG-B221.md
docs/FIXLOG-B222.md
docs/FIXLOG-B223.md
docs/FIXLOG-B224.md
docs/FIXLOG-B225.md
docs/FIXLOG-B227.md
docs/GENERAL_INTELLIGENCE_AUDIT.md
docs/HUMAN_UI_AUDIT.md
docs/IMPLEMENTATION_REPORT.md
docs/JEXI_AGI_ROADMAP.md
docs/JEXI_ARCHITECTURE_AUDIT.md
docs/JEXI_CURRENT_ARCHITECTURE.md
docs/README-INDEX.md
docs/REBUILD-MAP.md
docs/SYSTEMS-M3-M8.md
docs/ULTIMATE-UPGRADE.md
docs/UPGRADE-FINAL-REPORT.md
docs/architecture/reconstruction/agent-catalog.md
docs/architecture/reconstruction/cross-harness.md
docs/architecture/reconstruction/harness-engineering.md
docs/architecture/reconstruction/scope-b-legacy-audit.md
docs/architecture/reconstruction/scope-e-migration-audit.md
docs/architecture/reconstruction/test-runner-requirements.md
docs/architecture/reconstruction/ui-references.md
docs/arena-benchmark-live.json
docs/arena-worklog-ci-sweep.md
docs/assets/screenshots/architecture.svg
docs/assets/screenshots/chat-toolcards.png
docs/assets/screenshots/evidence/capability-counts.txt
docs/assets/screenshots/evidence/capture-run.txt
docs/assets/screenshots/evidence/p1-readme-first-60.txt
docs/assets/screenshots/evidence/p3-live-capture-source.txt
docs/assets/screenshots/evidence/p4-screenshot-inventory.txt
docs/assets/screenshots/evidence/p5-docs-index-count.txt
docs/assets/screenshots/evidence/p6-no-roadmap.txt
docs/assets/screenshots/evidence/p7-quick-start.txt
docs/assets/screenshots/evidence/p8-markdown-links-images.txt
docs/assets/screenshots/evidence/p9-scope-zone.txt
docs/assets/screenshots/example-flow.png
docs/assets/screenshots/hero-qa.png
docs/assets/screenshots/legacy-console.png
docs/assets/screenshots/readme-rendered.png
docs/assets/screenshots/settings-provider.png
docs/assets/screenshots/workgraph-nodes.png
docs/phase24-design-spec.md
docs/phase24-scope0-palette-swatches.png
docs/phase24-scope0-palette-test-surface.png
docs/phase24-scopeA-chat-route.png
docs/phase24-scopeA-graph-route.png
docs/phase24-scopeA-header.png
docs/phase24-scopeA-settings-route.png
docs/phase24-scopeA-shell.png
docs/phase24-scopeA-tab-focus.png
docs/phase24-scopeA-tokens-applied.png
docs/phase24-scopeB-chat-answer.png
docs/phase24-scopeB-chat-backend-offline.png
docs/phase24-scopeB-chat-empty.png
docs/phase24-scopeB-chat-refused.png
docs/phase24-scopeB-chat-streaming.png
docs/phase24-scopeB-chat-toolcard.png
docs/phase24-scopeB-chat-typing.png
docs/phase24-scopeC-settings-general.png
docs/phase24-scopeC-settings-keyref-ok.png
docs/phase24-scopeC-settings-keyref-refused.png
docs/phase24-scopeC-settings-main.png
docs/phase24-scopeC-settings-mode-live.png
docs/phase24-scopeC-settings-modes.png
docs/phase24-scopeC-settings-provider.png
docs/phase24-scopeD-graph-empty.png
docs/phase24-scopeD-graph-node-detail.png
docs/phase24-scopeD-graph-overview.png
docs/phase24-scopeD-graph-zoomed.png
docs/phase24-scopeE-chat-after.png
docs/phase24-scopeE-chat-before.png
docs/phase24-scopeE-chat-mode-full.png
docs/phase24-scopeE-empty-chat.png
docs/phase24-scopeE-empty-graph.png
docs/phase24-scopeE-empty-settings.png
docs/phase24-scopeE-empty-states.png
docs/phase24-scopeE-error-graph-unreachable.png
docs/phase24-scopeE-error-keyref.png
docs/phase24-scopeE-error-offline.png
docs/phase24-scopeE-focus-ring.png
docs/phase24-scopeE-graph-after.png
docs/phase24-scopeE-graph-before.png
docs/phase24-scopeE-settings-after.png
docs/phase24-scopeE-settings-before.png
docs/phase24-scopeE-shell-after.png
docs/phase24-scopeE-shell-before.png
docs/phase24-scopeF-final-report.md
docs/phase24-scopeF-walkthrough-1-cold-boot.png
docs/phase24-scopeF-walkthrough-2-question-typed.png
docs/phase24-scopeF-walkthrough-3-answer-streaming.png
docs/phase24-scopeF-walkthrough-4-answer-complete.png
docs/phase24-scopeF-walkthrough-5-tool-card.png
docs/phase24-scopeF-walkthrough-7-settings-provider.png
docs/phase24-scopeF-walkthrough-8-graph-nodes.png
docs/phase24-scopeF-walkthrough-9-mode-switch.png
docs/research/ANTIDOOM.md
docs/research/AWESOME_MCP_SERVERS.md
docs/research/HERMES.md
docs/research/MCP.md
docs/research/OBLITERATUS.md
docs/research/PURO_RESEARCH.md
docs/research/orca-study.md
docs/screenshots/arena-ui-gallery.html
```

### C.3 docs/archive/ — from branch `hygiene/repo-cleanup` @ ad17b4d1 (NOT on main; unmerged)

- `docs/archive/` total: 101 files
- `docs/archive/fixlog/` — 96 files; first 10: `FIXLOG-B100.md`, `FIXLOG-B101.md`, `FIXLOG-B102.md`, `FIXLOG-B103.md`, `FIXLOG-B104.md`, `FIXLOG-B105.md`, `FIXLOG-B106.md`, `FIXLOG-B107.md`, `FIXLOG-B108.md`, `FIXLOG-B109.md`
- `docs/archive/reports/` — 3 files: `ARCHITECTURE-REPORT.md`, `B96-IMPLEMENTATION-REPORT.md`, `DEEPSEEK-HARNESS-REPORT.md`
- `docs/archive/MANIFEST.md` — first 30 lines:

```
# docs/archive — MANIFEST

Produced by `scripts/phase-hygiene-runner.mjs --execute` from the audit JSON of `scripts/audit-repo-hygiene.mjs` (age gate > 30 days). Every entry is a `git mv` — content byte-identical, history preserved (`git log --follow`).

Total moves: 99

| # | old path | new path | category | reason |
|---|---|---|---|---|
| 1 | `FIXLOG-B100.md` | `docs/archive/fixlog/FIXLOG-B100.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 2 | `FIXLOG-B101.md` | `docs/archive/fixlog/FIXLOG-B101.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 3 | `FIXLOG-B102.md` | `docs/archive/fixlog/FIXLOG-B102.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 4 | `FIXLOG-B103.md` | `docs/archive/fixlog/FIXLOG-B103.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 5 | `FIXLOG-B104.md` | `docs/archive/fixlog/FIXLOG-B104.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 6 | `FIXLOG-B105.md` | `docs/archive/fixlog/FIXLOG-B105.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 7 | `FIXLOG-B106.md` | `docs/archive/fixlog/FIXLOG-B106.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 8 | `FIXLOG-B107.md` | `docs/archive/fixlog/FIXLOG-B107.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 9 | `FIXLOG-B108.md` | `docs/archive/fixlog/FIXLOG-B108.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 10 | `FIXLOG-B109.md` | `docs/archive/fixlog/FIXLOG-B109.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 11 | `FIXLOG-B110.md` | `docs/archive/fixlog/FIXLOG-B110.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 12 | `FIXLOG-B111.md` | `docs/archive/fixlog/FIXLOG-B111.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 13 | `FIXLOG-B112.md` | `docs/archive/fixlog/FIXLOG-B112.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 14 | `FIXLOG-B113.md` | `docs/archive/fixlog/FIXLOG-B113.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 15 | `FIXLOG-B114.md` | `docs/archive/fixlog/FIXLOG-B114.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 16 | `FIXLOG-B115.md` | `docs/archive/fixlog/FIXLOG-B115.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 17 | `FIXLOG-B116.md` | `docs/archive/fixlog/FIXLOG-B116.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 18 | `FIXLOG-B117.md` | `docs/archive/fixlog/FIXLOG-B117.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 19 | `FIXLOG-B118.md` | `docs/archive/fixlog/FIXLOG-B118.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 20 | `FIXLOG-B119.md` | `docs/archive/fixlog/FIXLOG-B119.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 21 | `FIXLOG-B120.md` | `docs/archive/fixlog/FIXLOG-B120.md` | fixlog | age 35d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
| 22 | `FIXLOG-B121.md` | `docs/archive/fixlog/FIXLOG-B121.md` | fixlog | age 34d > 30d; R2 zero inbound references; R3/R4/R5/R6/R7/R8 clear |
```

## SECTION D — scripts/ BREAKDOWN

Total files in `scripts/`: **217** (214 direct, 3 in subdirs)

| phase | phase{N}-*.mjs total | of which phase{N}-scope-*.mjs | of which *-probe.mjs |
|---:|---:|---:|---:|
| 6 | 3 | 0 | 3 |
| 7 | 1 | 0 | 1 |
| 8 | 3 | 0 | 3 |
| 9 | 11 | 0 | 9 |
| 10 | 10 | 0 | 10 |
| 11 | 10 | 0 | 0 |
| 13 | 9 | 7 | 0 |
| 14 | 6 | 0 | 6 |
| 15 | 5 | 0 | 5 |
| 16 | 19 | 0 | 15 |
| 17 | 11 | 0 | 9 |
| 19 | 4 | 4 | 0 |
| 20 | 6 | 6 | 0 |
| 21 | 10 | 0 | 0 |
| 22 | 9 | 0 | 7 |
| 23 | 3 | 0 | 3 |
| 24 | 9 | 0 | 0 |
| 25 | 11 | 11 | 0 |
| 26 | 7 | 0 | 7 |
| 27 | 4 | 4 | 0 |
| 28 | 11 | 0 | 11 |
| 29 | 11 | 11 | 11 |
| 30 | 8 | 0 | 7 |
| **all** | **181** | **43** | **107** |

- `audit-*.mjs` (0): none on main (`scripts/audit-repo-hygiene.mjs` lives on branch audit/repo-hygiene)
- `cleanup-*.mjs` (1): `scripts/cleanup-creds-grep.mjs`
- `hygiene-*.mjs` (0): none on main (`scripts/phase-hygiene-runner.mjs` lives on branch hygiene/repo-cleanup)
- `zone-owner-*` (15): `zone-owner-item1-probe.mjs`, `zone-owner-item10-probe.mjs`, `zone-owner-item11-probe.mjs`, `zone-owner-item12-probe.mjs`, `zone-owner-item2-probe.mjs`, `zone-owner-item2c-probe.mjs`, `zone-owner-item3-probe.mjs`, `zone-owner-item39-probe.sh`, `zone-owner-item4-probe.mjs`, `zone-owner-item40-probe.sh`, `zone-owner-item5-probe.mjs`, `zone-owner-item6-probe.mjs`, `zone-owner-item7-probe.mjs`, `zone-owner-item8-probe.mjs`, `zone-owner-item9-probe.sh`
- other (20): first 20: `arena-backup.sh`, `arena-benchmark.mjs`, `arena-chat-proof.mjs`, `arena-restore.sh`, `arena-screenshots.mjs`, `arena-trace-proof.mjs`, `arena-ui-verify.mjs`, `check-agent-overlap.mjs`, `convert-harnesses.sh`, `generate-catalog.mjs`, `generate-divisions.js`, `hooks/post-commit`, `install-harnesses.sh`, `lint-agent-baseline.sh`, `make-icon.js`, `probe-v012.mjs`, `run-tests-chunked.js`, `scope-g/p15-chat.mjs`, `scope-g/run-probes.mjs`, `verify-apk.mjs`

Recommendation: _(left blank — lead decides)_

## SECTION E — SUSPICIOUS / AMBIGUOUS PATHS

| path | why flagged |
|---|---|
| `AGENT_ONLINE.txt` | 8-byte marker file; unreferenced |
| `b221-verify.cjs` | loose CommonJS verifier at root; not in package.json scripts; unreferenced |
| `demo-banner.jpg` | 84 KB image at root; not referenced by demo-index.html or README |
| `demo-index.html` | second HTML entry beside index.html |
| `agents/` ↔ `jexi-agents/` | two agent catalogs at top level (89 vs 6 files) |
| `server/agents/` ↔ `agents/` | role prompts inside server/ beside the top-level catalog |
| `server/skills/` ↔ `skills/` | skills tree under server/ and at top level |
| `server/mcp/` ↔ `mcp.example.json (root)` | MCP registry under server/ with a root-level example config |
| `server/knowledge/` ↔ `knowledge/` | knowledge dirs at two levels |
| `server/plugins/` ↔ `plugins/` | plugins dirs at two levels |
| `server/scripts/` ↔ `scripts/` | scripts dirs at two levels |
| `tests/` ↔ `server/test-*.js` | tests split between top-level tests/ and ~100 flat server/test-*.js files |
| `harness/parity/` ↔ `harness/ (XBOW)` | one harness dir holding two unrelated things (Phase 30 parity primitives + Phase 8 XBOW harness) |
| `DEPLOY.md / DEPLOYMENT.md / DEPLOY-IMAGE-RENDER.md` ↔ `(root)` | three deployment docs at root |
| `ARCHITECTURE.md / ARCHITECTURE-REPORT.md` ↔ `docs/JEXI_CURRENT_ARCHITECTURE.md / docs/JEXI_ARCHITECTURE_AUDIT.md` | four architecture documents in two places |
| `hooks/scripts/post-tool-use/` | empty directory held by `.gitkeep` |
| `android/app/src/main/res/xml/backup_rules.xml` | name matches older-era/legacy pattern (`backup`) |
| `docs/architecture/reconstruction/scope-b-legacy-audit.md` | name matches older-era/legacy pattern (`legacy`) |
| `docs/assets/screenshots/legacy-console.png` | name matches older-era/legacy pattern (`legacy`) |
| `scripts/arena-backup.sh` | name matches older-era/legacy pattern (`backup`) |
| `scripts/phase13-vendor-nexus.mjs` | name matches older-era/legacy pattern (`nexus`) |
| (content grep) | files mentioning `Noctryx`: 3 (`docs/ARENA-REBUILD-SPEC.md`, `docs/REBUILD-MAP.md`, `server/src/services/UserProfile.js`); `JEXI-v1`/`jexi v1`: 0 |
| `server/public` | tracked symlink → `../dist` |
| (root) | 146 Markdown files at repo root, 125 of them `FIXLOG*` |

## SECTION F — CURRENT COUNT

| metric | value |
|---|---:|
| total tracked files (git ls-files; node_modules never tracked) | 3998 |
| total files on disk excl. node_modules and .git (worktree) | 3997 |
| root-level file count | 168 |
| top-level directory count | 50 |
| docs/ total file count | 117 |
| scripts/ total file count | 217 |
| total tracked bytes | 40,011,832 |
| tracked symlinks | 1 |
