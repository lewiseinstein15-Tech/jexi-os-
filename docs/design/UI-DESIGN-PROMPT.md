# 🎨 JEXI OS — Frontend UI Redesign Prompt (for Claude)

Copy everything below this line into Claude. Claude's answer will be handed to a coding agent who implements it, so make the output a **concrete, implementable design spec** — exact layouts, components, colors, spacing, motion — not vague advice.

---

You are a senior product designer and frontend engineer. I need you to design a **complete, visually stunning frontend UI** for **JEXI OS**, a multi-agent AI operating system app. The design you produce will be implemented pixel-for-pixel by a coding agent, so be precise and concrete.

## 1. What the product IS

JEXI OS is a personal AI "operating system" that runs a team of **79 specialist AI agents** (Product, Designer, Engineer, Coder, QA, Reviewer, Security Officer, Shipper, Researcher, Searcher, Synthesizer, Fact Checker, Memory, Vision, Computer Use, GitHub, Translator, Data Analyst, DevOps, News team, and 60+ more) plus a **226-skill registry**. The user types ONE request in plain language ("build me a water-intake tracker", "research how solar panels work", "what's the latest AI news") and JEXI:

1. **Plans first** — a Planner classifies the request and composes the exact team needed.
2. **Runs the team one-by-one** — each specialist executes with strict handoffs, streaming **live activity logs** ("🧠 Plan first — team for this task…", "💻 Entering coding pipeline…", "✅ Code ran successfully").
3. **Verifies** — a Fact Checker audits answers against sources (anti-hallucination); QA and Security gates must PASS before anything ships.
4. **Reports** — a rich, structured final answer in markdown (headings, LaTeX math, code blocks with syntax highlighting, source links, live preview links to built apps).

Key user-visible moments: the live "JEXI AT WORK" agent pipeline stream, the final rich answer, camera vision ("use my eyes"), self-diagnosis ("check yourself"), knowledge/books library, memory (what she remembers about you), and built-app previews.

## 2. Hard technical constraints (design must respect these)

- **Target device: a phone.** The app is an Android APK (Capacitor) and also runs in a mobile browser. Primary design target: **small portrait screens** (~360–430px wide). Desktop is secondary — design mobile-first.
- **Stack (fixed, do NOT change):** React 18 + Vite + Tailwind CSS v3 + Framer Motion + lucide-react icons. All styling is Tailwind utility classes and CSS variables in `src/index.css`. No new UI libraries (no shadcn, no Material, no component kits) — everything is hand-rolled with Tailwind.
- **Backend is remote** (Render free tier, 512MB RAM) — responses can take 1–30s. The UI must feel alive during waits: typing indicators, shimmer bars, streaming logs, skeleton states. Never look frozen.
- **The app already works** — you are redesigning the look/feel/structure of the existing screens, not inventing new data flows. Every screen below already exists with working logic; your design restyles and reorganizes them.
- **Fonts:** Inter (UI), JetBrains Mono (code/terminal). Already available.

## 3. Current design language (evolve it, don't throw it away)

- **Premium dark terminal aesthetic** ("Vercel/Linear school"): near-black `#030303` background, layered radial glows (subtle cyan/green/violet), a faint blueprint dot-grid texture overlay.
- **One signature accent: neon green `#00FF9D`** — used for the active state, brand moments, success, the "online" pulse. Secondary accents: cyan `#22d3ee`, violet `#a78bfa`, pink `#f472b6`, amber `#fbbf24`.
- **Glass surfaces** (`backdrop-blur`, translucent panels with 1px white/6% borders, elevation by shade not heavy shadow).
- **Micro-interactions everywhere**: spring tab-switching (framer-motion layoutId glow), scale-on-tap buttons, hover glows, animated typing dots, conic-gradient spinning ring around the logo, shimmer loading bars.
- Everything is **compact** (tiny 7–11px uppercase tracking-wider labels, dense info) — a "mission control" feel.

**Your job: take this aesthetic and make it genuinely beautiful and cohesive.** Fix the cramped feeling, create clear visual hierarchy, unify card styles, improve spacing rhythm, and design a signature look that feels like a real OS, not a chat app with extra panels.

## 4. The screens (design each one)

### Screen A — HOME (chat + live activity)
The main screen. Top-to-bottom: **Header** (logo with spinning conic ring, "JEXI OS" wordmark, "ONLINE" pulse pill) → **Activity strip** (collapses to a slim status bar when idle: BRAIN / SITES / STREAM status pills; auto-expands while JEXI works showing live agent logs + visited websites) → **Chat** (fills the rest; internal scroll; input pinned at bottom, always visible). 

Chat content states to design:
- **Empty state:** "⚡ WHAT JEXI CAN DO" — a 2-column grid of capability launchers (BUILD AN APP, RESEARCH, STUDY, OPEN A LINK, USE MY EYES, SELF-CHECK) with colored icon tiles.
- **Conversation:** user bubbles (green gradient, right-aligned, dark text) and JEXI bubbles (dark glass, left-aligned) rendering **rich markdown** — headings, tables, code blocks (highlight.js), LaTeX math (KaTeX), links.
- **Processing:** a "THINKING" header with animated dots, an **AgentPipeline** panel streaming colored agent log lines live (each agent has its own color: Planner cyan, Coder green, QA amber, Security red…), and a **STOP** button replacing Send.
- **Input row:** quick-action buttons (EYES / PHOTO / CHECK) + text input + send/stop button. Frosted field with green focus glow.

### Screen B — AGENTS (the full live pipeline)
A full-screen version of the activity stream: agent timeline, per-agent colored logs, visited-website cards, search progress. Plus — new — a way to browse the **79-agent roster and 226 skills** (grid/cards of specialists, tap one to see its mandate and skills).

### Screen C — MEMORY (the memory core)
Stat tiles (USER / INTERNET / CODING / CHAT counts) + sections for user profile knowledge, learned preferences, internet knowledge, coding knowledge, chat history. Design it as a "memory bank" — something you'd want to browse.

### Screen D — BOOKS / KNOWLEDGE LIBRARY
Library structure by category (folders), book upload (PDF/TXT/MD), import from URL, search, file counts + storage size, category cards. Design as a real library/browser experience.

### Screen E — SETTINGS
AI key management (Groq / Gemini / OpenRouter / HuggingFace with status badges: ACTIVE — ENV VAR / STORED ON DEVICE / NOT SET), backend URL + access key, save states. Design clean credential rows with clear status.

### Screen F — APP (installer)
APK download + auto-update panel: big download button (progress %), release info, step-by-step install guide, "ALL BUILD VERSIONS" list, offline/retry status.

### Extras to design
- **Update banner** ("NEW UPDATE READY").
- **Camera/Vision panel** (live camera capture → analysis).
- **TypedMessage** — the typewriter effect for JEXI's answers.
- **System status pill row** (BRAIN / SITES / STREAM) for the collapsed activity bar.

## 5. What I need back from you (be concrete!)

1. **Design principles** (3–5 sentences max).
2. **Design tokens** — the exact updated color palette (hex values), typography scale, spacing scale, radius scale, elevation/surface rules. Keep it consistent with the dark + neon-green identity but make it feel designed.
3. **Per-screen layout specs** — for each of the 6 screens: the exact layout structure (regions, order, proportions), component list, and key interactions. Use clear region names I can map to components.
4. **Component inventory** — every reusable component with its visual spec (colors, radii, shadows, hover/active states): cards, tiles, buttons, pills, badges, stat tiles, section headers, bubbles, pipeline log rows, skeleton states, empty states.
5. **Motion language** — which framer-motion transitions/springs where (tab switch, panel expand/collapse, message entry, typing dots, shimmer).
6. **A signature visual idea** — one distinctive touch that makes JEXI OS feel like an OS, not a generic chat app (e.g., a boot sequence, a task "core" visualization, an orbital agent ring, a HUD-style status bar, a glowing task progress core). Pick ONE and spec it precisely.
7. **Mobile-first responsiveness rules** (how things collapse on small screens).

Keep the whole spec tight and actionable. Prefer concrete classes/values over prose. If you must choose between "clever" and "clean", choose **clean and premium**.

---

*(End of prompt. When you paste this into Claude, ask it to respond with the spec only, ready for implementation.)*
