# ⚡ JEXI OS — Your Personal AI Operating System

**JEXI** is a multi-agent AI system you can talk to like a person. She plans, builds, researches, remembers, schedules, and ships — streaming every step live so you always see what she's doing.

> One chat box. Behind it: a 5-agent delegation team (Hermes-style profiles), 213 profiled specialists, 18 search engines, a coding loop that runs and fixes real code, isolated per-agent memory, a self-improving skill loop, and her own workspace where builds go live on the public internet — all on **100% free infrastructure, no credit card**.

---

## 🌐 Use JEXI

| Where | Link |
|---|---|
| **Web (always newest)** | https://lewiseinstein15-Tech.github.io/jexi-os-/ |
| **Android app (APK)** | https://github.com/lewiseinstein15-Tech/jexi-os-/releases/latest/download/app-debug.apk |
| **Her build workspace** (live apps she made) | https://lewiseinstein15-tech.github.io/jexi-workspace/ |

---

## ✨ What she does

### 🤖 The agent team (Hermes Agent architecture)
- **Nova** (orchestrator) receives every request and delegates: **Ada** (dev), **Kito** (research), **Zuri** (comms/delivery), **Tari** (scheduler)
- Each agent = its own **profile**: `config.yaml` (model lane, allowed tools, budgets) + `SOUL.md` (identity) + **isolated memory** + **auto-saved skills**
- **213/213 planner-deployable agents have profiles** — 5 hand-crafted + the rest auto-generated from the roster (`/api/agents/coverage`)
- Agents **talk to each other** mid-task (`agent_ask`, bounded to 2 questions/task) and return **structured envelopes** — parallel or sequential
- **Multi-model by design**: tasks rotate across all free providers (Groq, Gemini, OpenRouter, Mistral, NVIDIA, …) — never glued to one brain

### 🛠 Building (the DSH coding loop)
- One agent + real tools: `str_replace_editor` → shell → python → GitHub — **write → run → observe the exact error → fix → re-run**
- Narrates every action in first person: *"I created index.html (412 bytes)" · "I ran `node app.js` → success" · "🔁 I fixed it — the rerun passed"*
- If a first pass comes back empty she **rewrites the brief herself** and retries (never asks you to rephrase)
- Guaranteed build: if the smart loop stalls, the classic builder delivers — never a text-only reply to a build request

### 🚀 Her workspace (separate build home)
- Finished web builds **auto-publish** to a dedicated free site with a **public link that works on any phone**
- Portfolio-style index of every project; **auto-cleans 24h after publish** or on demand ("done with X", "clear my workspace")
- Zero localhost links, ever — enforced in every summary AND every live stream token

### 💾 Project memory
- "remember this project" → goal, files, decisions, next steps and the conversation are saved durably
- Days later: "continue my project" → a full **restore brief** — she picks up exactly where she stopped
- "my projects" lists them; "project X is done" archives it

### 🧠 Memory & self-improvement
- Per-agent isolated memory (no context bleed) + hybrid keyword/vector recall
- **Skill loop**: after every task she saves what worked as a portable skill (agentskills.io format); before every task she recalls precedent — `/refine` forces a save
- Conversation continuity: rolling summaries, episodes, learned facts/preferences

### 🔎 Whole-internet search (18 engines)
- **Tavily** (free key) + DeepSeek Search + Google News + DuckDuckGo ×2 + Mojeek + Bing + SearXNG + Marginalia + HN + DDG Answers + Wikipedia + arXiv + OpenAlex + Stack Overflow + Brave (optional)
- Health-aware rotation, cross-engine rank fusion, **diversity cap** (no single source floods results)

### 📺 Video watching (`/watch`)
- Paste a link (TikTok/Instagram/Vimeo/X/direct) or just say *"what is this YouTube video about ___"*
- Downloads → transcript (captions or free Whisper on Groq) → **scene-cut frames + 0–10s hook microscope** → answers with timestamps

### 🎨 The presenter (answers that look right)
- Real rendered **math** (KaTeX; every LaTeX dialect normalized, no half-typed formulas mid-stream)
- **Charts** (bar/line/pie, drawn as real graphs), **mermaid diagrams**, **vision-verified pictures**, AI **image generation** (free), tables with thousand separators
- Named coworkers stream live: *MAYA · WRITING…*, 💭 Think row, ⚡ per-answer speed line

### ⏰ Autonomy & delivery
- Natural-language scheduling: *"every morning at 8am give me tech news"* — no cron syntax
- Jobs run **unattended, survive restarts**, and **deliver** results (file + email + chat) without being asked
- `/agents` shows the team, jobs and recent skills; `/workspace` shows published builds

### 🐙 GitHub engine
- Scan any repo, read files, **edit + commit via API**, full repo/PR review — `GITHUB_TOKEN` already wired

### 🔐 Self-healing APK
- In-app updates with ZIP validation + browser fallback
- If her brain ever moves servers, installed apps **find the new home automatically** (brain.json discovery) — an app can never be stranded
- Boot warmup: the first message after a server restart answers in seconds

---

## 🗣 Try these

```
build me a quiz app as a web app          → Ada builds + publishes it live
give me the preview link                  → a working public link, no questions
what is 2/3 + 1/4? show working          → textbook math
compare rust vs go for backends           → sourced research + a chart
show me a picture of a cheetah            → vision-verified photo
every morning at 8am give me AI news      → scheduled + delivered
remember this project  …  continue it     → resumes days later
/agents · /workspace · /refine · /watch   → the command surface
```

---

## 🏗 Architecture (quick map)

```
chat ──► Nova's dispatcher (TeamRouter)
          ├─ build/fix → Ada (DSH coding loop) ──► workspace publish
          ├─ research → Kito (18-engine seam, fusion + diversity cap)
          ├─ schedule → Tari (NL jobs, restart-safe, delivery)
          └─ else → classic orchestrator graph (213 profiled specialists)
memory: per-agent stores · skills (agentskills.io) · project memory
hosting: Render image (GH Actions builds it — zero build minutes)
         + GitHub Pages (app) + GitHub Pages (workspace) — all free
```

Key modules: `AgentProfiles` · `AgentGateway` · `SkillLoop` · `TeamRouter` · `DshCoding` · `WebSearch` · `VideoWatch` · `WorkspacePublisher` · `ProjectMemory` · `ProfileCompleteness` · `updateCenter`

---

## 🧪 Quality

- **~3,947 automated checks**, 0 failures (`cd server && npm test`)
- CI on every push; live smoke tests for math/search/pictures/video/builds
- Every fix traced from real chat logs → regression test

## 🔧 Self-hosting

```bash
# brain
cd server && npm ci && npm start          # port 3002, DATA_DIR for memory
# web
npm ci && npm run dev                     # proxies /api → 3002
```
Env keys: any of GROQ/GEMINI/OPENROUTER/MISTRAL/NVIDIA/SAMBANOVA/TAVILY (all free tiers) + GITHUB_TOKEN. `JEXI_API_KEY` locks the API. Full guide: `DEPLOY-IMAGE-RENDER.md`.

---

*Built by Lewis & the JEXI agent · MIT · 100% free-tier infrastructure, no credit card, ever.*
