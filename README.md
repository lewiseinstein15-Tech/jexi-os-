# 🧠 JEXI OS — Multi-Agent AI Operating System

**JEXI OS** turns one AI coding agent into a **virtual team of 207 specialized agents (495 skills · 151 tools)** — each with a focused mandate, strict deliverables, and enforced review gates — all orchestrated through one chat interface.

Ask it to **"build an app that tracks my water intake"** and JEXI plans a team, then runs Product → Designer → Engineer → Coder → Runner → QA → Reviewer → Security → Shipper → Reflector in sequence, streaming live logs, writing real files you can preview and download, and reporting a full build report in chat.

---

## ✨ The Specialist Team

JEXI runs a **roster of 207 specialists (495 skills · 151 tools)** — the Planner composes a small focused team per task, never all of them at once. Here are the core specialists you'll see most often; the **full 207-agent catalog** (with every skill and tool) is in [AGENT-CATALOG.md](AGENT-CATALOG.md).

| # | Agent | What it does |
|---|-------|--------------|
| 01 | **Product Manager** | Defines requirements, scope modes, success criteria |
| 02 | **Designer** | UI/UX design system, layouts, visual spec |
| 03 | **Engineer** | Architecture, build plan, technical approach |
| 04 | **Coder** | Writes the actual code, fixes debug loops |
| 05 | **QA Lead** | Runs the app, verifies against spec, PASS/FAIL gate |
| 06 | **Reviewer** | Code review with APPROVED/CHANGES-REQUESTED gate |
| 07 | **Shipper** | Release notes, handoff summary |
| 08 | **Security Officer** | Security review with CLEARED/FLAGGED gate |
| 09 | **Reflector** | Retrospective on the completed mission |
| 10 | **Search Agent** | Web research with re-ranking + source synthesis |
| 11 | **News Agent** | Live headlines from free feeds (no API key) |
| 12 | **Memory Agent** | Long-term memory: tf-idf, recency×importance×relevance scoring, consolidation |
| 13 | **Computer Use Agent** | Real browser control — numbered elements, click/type/scroll |
| 14 | **Vision Agent** | Webcam eyes + on-device face/gesture landmarking |
| 15 | **Video Analyst** | Watches videos frame-by-frame — timestamped captions, sampled frames, key moments (YouTube, TikTok, Instagram, Vimeo, direct files) |
| 16 | **GitHub Agent** | Commit, push, PRs, issues — powered by your token |
| 17 | **Data Agent** | Data analysis, statistics |
| 18 | **DevOps Agent** | Deploy config, infrastructure |
| 19 | **Writer Agent** | Long-form writing |
| 20 | **Translator Agent** | Translation between languages |
| 21 | **Perf Agent** | Performance analysis & optimization |

The **Planner** reads your request and picks the right team — including *compound tasks* (e.g. "research X, then build Y" runs the Research team, then hands its findings to the Coding team).

---

## 🚀 Quick Start (local)

```bash
# Terminal 1 — the Brain (Express backend, port 3002)
cd server && npm ci && npm start

# Terminal 2 — the UI (Vite, port 3000, proxies /api → 3002)
npm ci && npm run dev
```

Open http://localhost:3000 and say *"build an app that tracks my water intake"*.

> Without an AI key, research, news, memory and book-library features still work.
> Add a key in **Settings** (or set env vars) to unlock app-building, vision and full chat.

## 🔑 Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GROQ_API_KEY` | one of the two | Fast chat/code generation (Groq) |
| `GEMINI_API_KEY` | one of the two | Code tasks & vision (Gemini, preferred for code) |
| `OPENROUTER_API_KEY` | optional | **Seed vision + free text** (ByteDance `bytedance-seed/seed-2.0-mini`, Seed 1.6, free Llama/DeepSeek routes) |
| `CEREBRAS_API_KEY` | optional | **Cerebras free tier** (GPT-OSS 120B, no card) — extra fallback |
| `DEEPINFRA_API_KEY` | optional | **DeepInfra free tier** (Llama 3.1 8B etc., no card) — extra fallback |
| `MISTRAL_API_KEY` | optional | **Mistral free Experiment tier** (open models, no card) — extra fallback |
| `HF_TOKEN` | optional | **HuggingFace free Inference API** (text) — last-resort provider when the others rate-limit (often blocked from datacenter IPs — usually skipped) |
| `GITHUB_TOKEN` | optional | GitHub Agent (commit/push/PRs) |
| `JEXI_API_KEY` | optional | **Locks the API** — all requests must send `x-jexi-key` |
| `JEXI_MCP_KEY` | optional | **Locks the MCP endpoint** (`/mcp`) — clients must send `Authorization: Bearer <key>` |
| `CORS_ORIGINS` | optional | Comma-separated browser origins allowed to call the API |
| `REDIS_URL` | optional | Shared memory across instances/restarts |
| `DATA_DIR` | optional | Persistent data location (defaults to `server/data`) |
| `PORT` | optional | Backend port (default 3002) |

Env vars always win over values pasted in the Settings panel — ideal for Render/Vercel/serverless.

## 🧠 The 207-Specialist Roster, 495 Skills, Auto Tool Routing, Provider Router & Verification Loop

Inspired by the research on open-source agent frameworks (OmniRoute's provider auto-fallback, Atomic Agents' role catalog, LangGraph's loop/graph engineering, MetaGPT's SOP teams), JEXI's brain now has four layers:

**1. Agent Roster — 207 specialists.** A catalog of specialist roles (Planner, Product, Designer, Engineer, Coder, QA, Reviewer, Critic, Security, Shipper, Tool Router, Toolsmith, Context Manager, Archivist, Document Analyst, Data Engineer, Guardrail, Researcher, Searcher, Synthesizer, Fact Checker, Translator, Data Analyst, DevOps, GitHub, Vision, Computer Use and more). The Planner **composes only the small subset a task needs** — the whole trick of running big rosters is that the catalog is large but the active team is small and focused. Every plan announces it live: `Roster (207 specialists) → 6 deployed for this task.`

**2. Skill Registry — 495 skills.** Every specialist masters a set of named skills (web search, citation, fact-grounding, code generation, QA gates, translation reflection loops, math LaTeX, rolling-summary, context-compaction, episodic-memory, document-rag, tool-selection, critical-review, guardrails, …). The pipeline streams which skills a task will use.

**2.5 Auto Tool Routing — 151 tools, picked per task.** JEXI has a first-class **Tool Registry** (Web Search, Deep Read, Browser Control, Memory Recall, Rolling Summary, Knowledge Search, Book Library, Run Code, Write Files, Fix & Re-run, Code Review, Security Scan, Fact Check, GitHub CLI, Data Crunch, Chart Builder, Self Diagnose, Translate, … — the smolagents/OpenAI Agents SDK pattern: tools are atomic actions, skills are workflows). For **every** task the Tool Router derives the exact tool set from the composed team automatically — `Auto-selected tools for this task (6): Web Search · Deep Read · Fact Check · …` — no manual tool instruction is ever needed, and the tool set is kept small on purpose (AutoTool-style pruning so decisions stay reliable).

**3. Provider Router — auto-fallback across every free key.** OmniRoute-style: Groq → Gemini → OpenRouter (Seed vision + free text) → Cerebras → DeepInfra → Mistral → HuggingFace (free Inference API) — every provider optional, keyed by `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `CEREBRAS_API_KEY` / `DEEPINFRA_API_KEY` / `MISTRAL_API_KEY` / `HF_TOKEN`. If a provider rate-limits or errors 3× it enters a 30s cooldown and the router slides to the next healthy provider automatically — one dead key never kills a task. `get_health`/`/api/health` report live per-provider health (never keys).

**4. Verification Loop — anti-hallucination.** After research/learning/knowledge answers are synthesized, a Critic re-reads the draft against the sources it cites, flags invented or unsupported claims, and a revision pass fixes them — bounded to 2 rounds so it always terminates. With no AI keys or for short answers it no-ops instantly, so it never slows a plain reply.

**5. Layered Conversation Memory — remembers like a real AI.** A three-layer memory (the Mem0 / DeepAgents / OpenAI sessions pattern): recent turns stay verbatim, older turns are compressed into a **rolling running summary** (Context Manager), memorable exchanges are kept as **episodes** (Archivist), and anything JEXI already researched is **recalled from her mind** and injected into the next reply ("I remembered this from my mind."). Long conversation replies also pass the anti-hallucination loop, so JEXI doesn't invent facts while chatting.

**5.4 Conversational Continuity — never forgets the thread.** Ask "what is computer science?", then say "give me a roadmap for a beginner in this course" — JEXI resolves "this course" against the recent conversation before planning (the Conversational-RAG / LlamaIndex condense_question pattern): a context-dependent message is rewritten into a self-contained query using the transcript (one cheap LLM call, only when needed; deterministic topic-anchor fallback with no key), the resolved query is what the Planner classifies and the Search Team searches, and the recent thread is injected into the Search Team's analyzer + synthesizer so answers stay in the flow. Watch for the live `🧠 Continuity — resolved …` log event.

**5.5 Hybrid Vector Memory — the TencentDB-Agent-Memory pattern.** Every memory (research, code solutions, user facts) also gets a **vector embedding** via Groq's free `nomic-embed-text-v1.5` (rides the existing `GROQ_API_KEY` — no new key). Recall fuses **keyword tf-idf + vector cosine** (TencentDB's "BM25 + vector + RRF" idea), so JEXI finds memories *semantically* — "machine intelligence" can surface her notes on "neural networks" even when no word matches. Each task's specialists are also **equipped with the memories they need** (Coder → past solutions, Researcher → past research — the "agent loadout" idea), and retrieval is capped by count + character budget so memory never floods the context window. Try it: `GET /api/memory/search?q=...` (locked behind `x-jexi-key` when the API is locked). Run a live per-provider key test at `GET /api/health/providers` to see exactly which AI keys work end-to-end.

## 🧪 Testing

```bash
npm test          # runs all 15 backend test suites (routing, agents, books, memory, perf, PDF…)
```

See [TEST.md](TEST.md) for the suite list.

---

## 🔌 Model Context Protocol (MCP)

JEXI exposes a **Model Context Protocol** server so AI assistants (Claude Desktop, Cursor, Claude Code, ChatGPT…) can securely call JEXI's tools and read her data — the same brain the chat UI uses, over one endpoint: **`/mcp`**.

### Start it

It's mounted inside the main server — just run JEXI normally:

```bash
cd server && npm start        # http://127.0.0.1:3002/mcp
# or standalone on its own port:
node mcp-server.js            # http://127.0.0.1:3457/mcp
```

Your deployed instance exposes it at `https://<your-host>/mcp` (e.g. `https://jexi-os-brain.onrender.com/mcp`) — you can point Claude Desktop / Cursor straight at that public URL instead of localhost.

### Exposed tools (allowlist)

| Tool | What it does |
|------|--------------|
| `ask_jexi` | Run any task/question through JEXI's full agent team (planner → agents → verified result) |
| `memory_lookup` | Read what JEXI remembers about you (profile, facts, memory stats) |
| `knowledge_search` | Search the saved knowledge library |
| `list_books` | List books in the library |
| `get_health` | Check brain status + which AI providers are configured |

### Exposed resources (read-only)

| Resource | Contents |
|----------|----------|
| `memory://user` | User profile + learned preferences/facts |
| `memory://chat` | Recent chat history |
| `knowledge://structure` | Knowledge library structure & status |
| `knowledge://files/{category}` | Knowledge files for a category |

> **Safety:** this is a deliberate minimal surface — the only action tool is `ask_jexi`, which runs JEXI's own safe planner (no destructive operations are exposed: no memory wipe, no deletes, no settings writes). Unknown tools are rejected automatically by the SDK. Set `JEXI_MCP_KEY` to require a bearer token on every MCP request.

### Connect Claude Desktop

Add to `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "jexi-os": {
      "type": "http",
      "url": "http://127.0.0.1:3002/mcp",
      "headers": { "Authorization": "Bearer YOUR_JEXI_MCP_KEY_IF_SET" }
    }
  }
}
```

### Connect Cursor

Cursor → **Settings → MCP → + Add new MCP server** → mode **HTTP** → URL `http://127.0.0.1:3002/mcp` (add the bearer header if `JEXI_MCP_KEY` is set). Then ask Cursor to use the `ask_jexi` tool.

### Test it

```bash
npx @modelcontextprotocol/inspector --url http://127.0.0.1:3002/mcp
# or with curl:
curl -X POST http://127.0.0.1:3002/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

A full example client config lives in [`mcp.example.json`](mcp.example.json).

## 🚢 Deployment

- **Render (backend):** the repo ships a [render.yaml](render.yaml) blueprint — New → Blueprint → pick repo. Free tier included.
- **Frontend:** GitHub Pages workflow (`.github/workflows/deploy.yml`) or Vercel (set `VITE_JEXI_BACKEND_URL` to your Render URL).
- **Docker / Hugging Face Spaces:** `docker build -t jexi-os . && docker compose up -d` (see [Dockerfile](Dockerfile)).
- **Scaling:** [SCALING.md](SCALING.md) covers Redis-mirrored memory and the Cloudflare Worker load balancer.
- **Android app:** [ANDROID.md](ANDROID.md) builds the Capacitor APK.

Full instructions: **[DEPLOY.md](DEPLOY.md)**.

## 📚 Built-in Knowledge

JEXI reads books & news herself — Wikipedia, Project Gutenberg, arXiv, Open Library, Google News/BBC RSS — no API keys. Say *"study calculus"* and she distills the topic into your knowledge library for good. Upload your own PDFs/TXT/MD in the **Knowledge** tab too.

---

Built for **Lewis Einstein** (AI & ML Engineer) — the entire team works for you, 24/7, free.
