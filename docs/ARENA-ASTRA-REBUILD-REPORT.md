# ⚡ ARENA ASTRA REBUILD — JEXI OS Executive Architecture (Sept 7, 2026)

**One intelligent executive system.** Lewis talks to JEXI. JEXI handles the machinery.

This rebuild audited the existing JEXI OS repository first, kept everything real that
already worked (Executive Kernel fast path, Director/employee supervision, WorkGraph +
MissionRunner persistence, CapabilityRouter, ToolRegistry, MCPGateway, BrowserRouter,
EventInterpreter, RequestMeter, MemoryLifecycle, ExternalProviders), and added the
missing executive structure around it — no rewrites for vanity, no fake capabilities.

---

## 1. What was built

### New backend services (`server/src/services/`)

| Module | Spec part | What it is |
|---|---|---|
| `Observer.js` | 20 | ONE typed runtime event bus (`mission.*`, `task.*`, `model.*`, `tool.*`, `browser.*`, `verification.*`, `replan.*`, …). Bounded ring buffer, safe fan-out, never throws. |
| `IntentEngine.js` | 5 | Deterministic-first classification: conversation / question / research / coding / debugging / file_op / browser_op / computer_op / creative / document / data / market / mission / schedule / memory / system. Zero model calls; lean-lane gate; active mission owns the turn. |
| `OllamaProvider.js` | 6 | Ollama as a first-class provider (`OLLAMA_BASE_URL`, `MODEL_NAME`, health probe, `/api/chat` generation). The ONLY file that knows the Ollama HTTP shape. |
| `ReasoningEngine.js` | 6 | Provider-independent reasoning: `ReasoningEngine → ladder → providers`. Budget-capped every call, metered, observed; honest ladder walk with fallback. |
| `ContextEngine.js` | 7 | Task-scoped context assembly with hard budgets (never the whole history + memory), relevant-memory retrieval, deterministic checkpoints. |
| `MemoryVault.js` | 19 | ONE persistent vault over the decision store: 12 categories, quality floor (thin content is honestly refused), lifecycle annotation (FRESH/AGING/STALE). |
| `Scheduler.js` | 8/9/10 | Real scheduler over the persisted WorkGraph: ready-task detection, bounded concurrency, pause/resume/cancel, idempotent dispatch, honest completion hooks. |
| `Recovery.js` | 22 | Diagnose → safe retry → verify; repeated failure → replan. Bounded, transient-aware (never retries permission bugs endlessly). |
| `SelfImprovement.js` | 23 | Telemetry → … → validation → promotion pipeline with a HARD human-approval gate. JEXI can never silently modify production. |
| `JexiMarketProvider.js` | 18 | External JEXI Market via authenticated API only. Unconfigured → honest "not connected", never a fake success. Zero Market-internal imports. |
| `UserProfile.js` | 31 | Persistent PRIVATE owner profile (Lewis). API exposes only the public persona (`/api/persona`); the full profile never leaves the server. |

### New API surface (`server/src/routes/arena.js`, mounted in `server/index.js`)

`GET /api/kernel/status` · `POST /api/intent/classify` · `GET /api/observer/recent|stats` ·
`GET /api/vault/status` · `POST /api/vault/remember` · `GET /api/market/status` ·
`GET /api/reasoning/health` · `GET /api/scheduler/status` · `POST /api/scheduler/control` ·
`GET /api/persona` · `GET /api/improve/anomalies|proposals`

No secrets are ever returned (status booleans only).

### Pre-existing systems this rebuild stands on (audited, kept, wired)

- `JexiKernel.js` — deterministic gate + fast path (small talk = ZERO model calls)
- `RequestMeter.js` — AsyncLocalStorage meter: every model call + per-stage latency
- `director/` — Director, EmployeeSession, Supervisor, WorkGraph, MissionRunner, Mission, Verifier, EventInterpreter, ModelRouter, Permissions
- `CapabilityRouter.js`, `ToolRegistry.js`, `MCPGateway.js`, `BrowserRouter.js`, `ComputerRuntime.js`, `APKBrowserChannel.js`
- `MemoryManager.js`, `DecisionMemory.js`, `MemoryLifecycle.js`, `ProjectMemory.js`, `SkillLoop.js`
- `RiskGuard.js`, `Authorization.js`, `Security.js`, `GuardrailAgent.js` (permissions incl. READ/WRITE/EXECUTE/NETWORK/SENSITIVE/DESTRUCTIVE)

### UI polish (reference-look, `src/`)

- Reference palette: Background `#0B0E14`, panels `#121826`, text `#EAEAEA`/`#A0A6B1`, user bubble `#1E2838`, JEXI bubble `#262126`, warm orange/coral/salmon/peach accents, zero neon green.
- Desktop: persistent left rail (7 destinations) + centered top search ("Ask JEXI anything…", sends to chat) + Lewis owner chip + **right mission rail** (`MissionPanel.jsx`: live Active Mission with real progress %, Current Tasks checklist from the work graph, "JEXI is using" with live Ollama/remote status, handwritten note). Conversation stays the hero — no giant cards inside chat.
- Phone: ☰ hamburger top-left, JEXI wordmark, 👑, ONLINE pill — no bottom nav bar, composer always reachable, decluttered top bar.
- Handwriting (bundled Caveat) for JEXI's voice + notes only; code/logs/metrics stay clean mono.
- Sidebar tagline "Think · Plan · Do · With You" + handwritten "Big goals. Real progress. — JEXI".

---

## 2. Proof (all from the RUNNING app — nothing mocked)

### Automated checks
- **New:** `server/test-arena-astra.js` — **11/11 suites green** (Observer, IntentEngine, OllamaProvider config, ReasoningEngine ladder+fallback, ContextEngine budgets, Scheduler bounds+pause/resume/cancel, Recovery ladder, SelfImprovement approval gate, Market honest-offline, UserProfile privacy, MemoryVault floor+recall). Wired into `npm test`.
- **Regressions:** `test-planner-routing` ✅ · `test-tasks` ✅ · `test-scheduler` ✅ · `tests/agi/test-jexi-kernel.js` ✅ · `tests/agi/test-request-meter.js` ✅
- **DOM verification** (`scripts/arena-ui-verify.mjs`): **14/14 PASS** — spec-7 rail, permanent desktop nav, hidden desktop burger, warm accent, no neon green, Caveat loaded + applied, Home default, chat input present, phone burger, phone drawer pattern, no bottom nav, drawer lists spec 7.

### Benchmarks (live local brain, 2026-09-07)
- `POST /api/intent/classify` ×25: **min 2ms · p50 2ms · max 52ms · 0 model calls**
- `GET /api/kernel/status`: **3ms**
- `hello` → JEXI in the running UI: **0.0s, deterministic fast path, 0 model calls** (screenshot below)

### Screenshots (`docs/screenshots/`, real Chromium against live brain+UI)
- `arena-desktop-home.png` — desktop: rail + search + Lewis chip + orb hero + mission rail
- `arena-desktop-chat.png` — REAL conversation ("hello" → "Hello, Boss — JEXI online and ready.", handwritten, Thought 0.0s)
- `arena-desktop-missions.png` · `arena-desktop-memory.png` · `arena-desktop-tools.png`
- `arena-phone-home.png` — phone: hamburger + crown + ONLINE, no bottom nav, reachable composer
- `arena-phone-drawer.png` — phone drawer with the spec 7

Capture tools: `scripts/arena-screenshots.mjs` (suite) + `scripts/arena-chat-proof.mjs` (real typed conversation).

---

## 3. Honesty notes (what this report does NOT claim)

- The sandbox has **no Ollama and no provider API keys**, so the UI honestly shows "Remote models" and the ladder reports Ollama down. On Lewis's machine / Render with keys, `MODEL_PROVIDER=ollama` + `MODEL_NAME` puts local models first with zero architecture changes.
- JEXI Market is **not connected** here (`JEXI_MARKET_URL`/`KEY` unset) — the provider returns an honest unconfigured state and JEXI falls back to built-in research.
- Long-horizon provider behavior (retries across real keys) is covered by the airtight budget + ladder design and the pre-existing provider test suites, not by live paid calls from this sandbox.

## 4. Run it

```bash
# brain (open API, no key)
cd server && npm ci && PORT=3002 npm start
# web
npm ci && npm run dev            # dev, or: npm run build && npx vite preview --host --port 4173
# tests
cd server && node test-arena-astra.js
```

Local models: `MODEL_PROVIDER=ollama MODEL_NAME=qwen3` (Ollama on `OLLAMA_BASE_URL`, default `http://127.0.0.1:11434`).

## 5. Reference-match UI pass (same day)

After the architecture landed, the UI was rebuilt pixel-close to the
approved reference image (desktop + phone):

- Chat = reference bubbles: slate user bubble (timestamp + ✓✓ + avatar),
  warm JEXI bubble (orange 👑 JEXI header, Caveat handwriting body,
  timestamp), telemetry footer split into clean mono.
- Live "Mission in Progress" card inside the chat (real work-graph
  progress, renders null when no mission — never fake).
- Bolt + rounded-JEXI lockup (bundled Baloo 2), sidebar gradient Home
  pill, centered top search, Lewis chip, right mission rail with icon
  rows + mint done-checks, handwritten notes.
- Phone: ☰ left, JEXI centered, 👑 + ONLINE right, no bottom nav,
  reachable composer (attach 📎 opens the real picker, 🙂 inserts).
- Bundled fonts (offline-safe): Caveat + Baloo 2 + Inter.
- Verified: fresh build, 7 real screenshots, 14/14 DOM checks green.

## 6. Agent-trace transcript rebuild (same day)

The chat was rebuilt from bubbles to a live agent-trace view
(Claude Code / Cursor style):

- Agent card (`jx-jbub` JSX + all its CSS) DELETED — agent text prints
  directly on the page: computed `transparent / 0px / none`.
- Every tool call streams as one row: `[icon] used <Tool> ✓ 180ms ⌄`
  (terminal / magnifier / pencil; spinner → green ✓ / red ✗ live;
  chevron expands raw command + full output; collapsed by default).
- Consecutive same-tool runs fold into one summary row
  ("Explored 4 reads", "Ran N commands") — proven live in screenshots.
- Narration = plain handwriting paragraphs between rows (existing
  `.jx-hand` / `var(--hand)` — no new font anywhere).
- Backend: `executeTool` (the universal choke point: AgentLoop,
  DshResearch, WorkerRouter, run_code dispatch…) emits `tool_use`
  running → success|error pairs keyed by id; the keyless search path
  (`runSearchTeam` scan + each `deepRead`) emits the same contract.
  Proven: 10 events, 5 ids, 5 clean pairs, 0 unpaired, interleaved
  live order. Regression suite: `server/test-trace-events.js` (9/9).
- User bubble untouched (slate, timestamp, ✓✓, avatar).
- Connection drops fixed permanently: (1) V8 heap capped at 384MB
  (`NODE_OPTIONS` in `Dockerfile.slim` + `render.yaml` — the 512MB
  Render container was OOM-killing the brain mid-task; boot log now
  prints the cap as proof); (2) the chat POST now wakes + retries
  once on fetch-level failure (sleeping host, no response), not just
  on 5xx; (3) `JEXI_SELF_PING=1` baked into the Blueprint so the
  keep-warm no longer depends on dashboard env entry.
- Verified: fresh build, real research task in a real browser,
  `scripts/arena-trace-proof.mjs` 12/12 green, backend 11+41+4+9
  green, DOM 14/14 green, desktop + phone screenshots eyeballed.

---

*Built by Arena for Lewis · MIT · free-tier infrastructure, no credit card, ever.*
