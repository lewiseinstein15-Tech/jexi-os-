# JEXI OS — Agent & Skill Catalog

**87 specialist agents · 250 skills · 28 tools · 1 orchestrator.** One plain-language request in,
a composed team runs it end-to-end, verifies the answer, and reports back.

---

## How it works (the full pipeline)

```
You type:  "Build me a water-intake tracker"
                │
                ▼
┌──────────────┴──────────────┐
│ 1. PLANNER  classifies the  │  intent = code_task
│    request into an intent   │  ("build", "research", "math", "news"…)
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 2. composeTeam() picks the  │  Product → Designer → Engineer → Architect →
│    exact specialists needed │  Coder → Runner → Debugger → QA → Reviewer →
│    (never all 87)           │  Security → Shipper → Reflector
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 3. SKILLS expand per agent  │  team skills = each agent's registry entry
│    (250-skill registry)     │  → streamed live in the UI as she works
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 4. ORCHESTRATOR runs them   │  strict handoffs: only the previous agent's
│    one-by-one               │  output moves forward; QA/Review/Security
│                             │  gates must PASS before anything ships
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 5. VERIFICATION LOOP        │  a Critic audits the draft against its
│    (anti-hallucination)     │  sources → flags invented claims → a
│                             │  revision pass fixes them (max 2 rounds)
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 6. PROVIDER ROUTER          │  every LLM key fights as one: Groq → Gemini
│                             │  → OpenRouter → HuggingFace. A dead or
│                             │  rate-limited key auto-falls-through.
└──────────────┬──────────────┘
               ▼
   Rich final answer (markdown, LaTeX, code, sources)
```

## Intent → team map (how agents get picked)

| Intent | Team composed |
|---|---|
| `code_task` | Product → Designer → Engineer → Architect → Coder → Runner → Debugger → QA → Reviewer → Security → Shipper → Reflector |
| `research` | Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer → Fact Checker → Memory |
| `news_latest` | News Scout → News Filter → News Editor → Reasoner → Memory |
| `study_topic` / `learning_research` | Scholar → Researcher → Memory (or Researcher → Reasoner → Memory) |
| `knowledge_recall` | Books Agent → Reasoner → Memory |
| `math_solve` | Math Solver → Reasoner → Memory |
| `image_recognition` | Vision → Reasoner → Memory |
| `link_analysis` | Navigator → Extractor → Reasoner → Memory |
| `computer_use` | Navigator → Vision → Reasoner → Memory |
| `self_check` | Self-Diagnose → Reasoner → Memory |
| `translate` | Translator → Reviewer |
| `github` | GitHub Agent → Shipper |
| `data` | Data Analyst → Reasoner |
| `devops` | DevOps Agent → Shipper |
| `docs` | Technical Writer → Reviewer |
| `perf` | Performance Engineer → Coder → Reviewer |
| `memory_query` / `clear_memory` | Memory Agent |
| `conversation` | JEXI Core |
| `compound_task` | Every agent named in the user's step list |

---

## The 87 agents (grouped by role)

### Command (5)
| Agent | What it does |
|---|---|
| **Planner** | Classifies every request and composes the right team before anything runs. |
| **Orchestrator** | Runs the chosen specialists one-by-one, enforcing strict handoffs and gates. |
| **JEXI Core** | Identity, conversation, and the system prompt every agent inherits. |
| **Reasoner** | Structured reasoning, math solving, final-answer synthesis. |
| **Reflector** | Retrospective after each mission — what worked, what to remember. |

### Product (5)
| Agent | What it does |
|---|---|
| **Product Manager** | Requirements, scope modes, success criteria, user stories. |
| **Designer** | UI/UX design system, layouts, visual spec. |
| **UX Researcher** | User research, personas, journey maps, usability insight. |
| **Brand Strategist** | Naming, voice, tone, visual identity guidelines. |
| **Accessibility Auditor** | WCAG review, contrast, keyboard nav, screen-reader passes. |

### Build (12)
| Agent | What it does |
|---|---|
| **Engineer** | Architecture, build plan, technical approach. |
| **Architect** | Generates project structure and code from the plan. |
| **Coder** | Writes actual code, fixes debug loops. |
| **Runner** | Executes the code, captures real output and errors. |
| **Debugger** | Reads errors and applies fixes until it runs clean. |
| **QA Lead** | Runs the app, verifies against spec, PASS/FAIL gate. |
| **Reviewer** | Code review with APPROVED / CHANGES-REQUESTED gate. |
| **Security Officer** | Security review with CLEARED / FLAGGED gate. |
| **Shipper** | Release notes, handoff summary, final report. |
| **Performance Engineer** | Measures and fixes speed, memory, and bundle issues. |
| **DevOps Agent** | Deploy config, Dockerfile, CI/CD, infrastructure. |
| **GitHub Agent** | Commit, push, PRs, issues — real gh/git CLI. |

### Engineering specialists (8)
| Agent | What it does |
|---|---|
| **Data Analyst** | Data analysis, statistics, charts, insight. |
| **Database Architect** | Schema design, queries, migrations, indexing. |
| **Frontend Engineer** | Component builds, responsive layout, styling. |
| **Backend Engineer** | APIs, routes, middleware, auth, server logic. |
| **Data Visualizer** | Turns numbers into clear charts and dashboards. |
| **Web Scraper** | Pulls structured data from pages and APIs. |
| **Regex Specialist** | Patterns, parsing, text transformations. |
| **SQL Analyst** | Queries, joins, aggregations, data questions. |

### Research (8)
| Agent | What it does |
|---|---|
| **Query Analyzer** | Splits a research question into precise search queries. |
| **Searcher** | Aggregates results from SearXNG, DDG, Bing, Mojeek, Wikipedia, arXiv. |
| **Re-ranker** | Trusted-source ranking, spam filtering, dedupe. |
| **Extractor** | Deep-reads pages and pulls out the real content. |
| **Synthesizer** | Combines sources into a grounded answer with citations. |
| **Researcher** | Deep study of a topic into the knowledge library. |
| **Scholar** | Trusted books, papers and knowledge-library recall. |
| **Fact Checker** | Verifies claims against sources before an answer ships. |

### News (3)
| Agent | What it does |
|---|---|
| **News Scout** | Fetches live headlines from free feeds. |
| **News Filter** | Dedupe and rank stories by relevance and recency. |
| **News Editor** | Writes the final brief from verified headlines. |

### Memory (2)
| Agent | What it does |
|---|---|
| **Memory Agent** | Long-term memory: facts, preferences, tf-idf scoring, consolidation. |
| **Books Agent** | Answers strictly from your own books and library with citations. |

### Perception (3)
| Agent | What it does |
|---|---|
| **Vision Agent** | Image analysis — describe, read text, solve from photos. |
| **Navigator** | Drives the browser — navigate, click, type, scroll. |
| **Computer Use Agent** | Interactive browser control with numbered elements. |

### Writing (8)
| Agent | What it does |
|---|---|
| **Technical Writer** | Long-form writing: READMEs, docs, guides, reports. |
| **Translator** | Meaning-first translation with a reflection loop. |
| **Copywriter** | Marketing copy, headlines, product descriptions. |
| **Editor** | Clarity, grammar, tone, and structure pass over any text. |
| **Summarizer** | Compresses long content into precise summaries. |
| **Reporter** | Structured news/report style writing with who-what-when. |
| **Proofreader** | Typos, punctuation, consistency checks. |
| **Localization Specialist** | Adapts content for regions and cultures, not just words. |

### Life & productivity (19)
| Agent | What it does |
|---|---|
| **Math Solver** | LaTeX-structured math solving with given/formula/working/final. |
| **Study Coach** | Turns topics into structured, saved study notes. |
| **Tutor** | Explains concepts simply, checks understanding, adapts. |
| **Coding Tutor** | Teaches programming step-by-step with examples. |
| **Strategy Analyst** | Frameworks, SWOT, decision analysis, planning. |
| **Finance Analyst** | Budgeting, financial calculations, money questions. |
| **Health Coach** | Wellness, habits, trackers, routines. |
| **Career Coach** | Resumes, interviews, job search, growth plans. |
| **Teacher** | Lesson plans, quizzes, curriculum building. |
| **Resume Writer** | Tailors resumes and cover letters to roles. |
| **Social Media Manager** | Post ideas, captions, hashtags, content calendar. |
| **Email Composer** | Professional, warm, or persuasive emails. |
| **Legal Guide** | Plain-language legal explanations and document checks. |
| **Travel Planner** | Itineraries, budgets, must-see lists. |
| **Fitness Trainer** | Workout plans, form guidance, progress tracking. |
| **Nutritionist** | Meal plans, macros, dietary advice. |
| **Language Coach** | Practice, drills, vocabulary, corrections. |
| **Parenting Guide** | Family advice, routines, age-appropriate guidance. |
| **Historian** | Timelines, context, primary-source awareness. |
| **Science Explainer** | Physics, chemistry, biology — accurate, visual explanations. |
| **Interviewer** | Conducts practice interviews and gives feedback. |
| **Negotiator** | Drafting offers, replies, and negotiation strategy. |

### Meta (4)
| Agent | What it does |
|---|---|
| **Self-Diagnose** | Reads own health, memory, errors, and source to report root causes. |
| **Prompt Engineer** | Designs system prompts and instructions for other AIs. |
| **Agent Builder** | Designs new specialist agents and their skills. |
| **Data Visualizer** | Turns numbers into clear charts and dashboards. |

---

## The 250 skills (by category)

- **Core (12):** intent-detection, team-composition, task-decomposition, pipeline-execution, gates, handoff, conversation, identity, system-prompt, reasoning, reflection, retrospective
- **Math (9):** math, latex, step-by-step, explanations, visuals, science, statistics, finance, calculations
- **Research (24):** web-search, multi-engine, aggregation, query-expansion, search-strategy, ranking, trusted-sources, dedupe, scraping, content-extraction, cleaning, synthesis, citation, fact-grounded, fact-checking, verification, anti-hallucination, deep-research, knowledge-base, topic-study, books, papers, library-recall, quote
- **News (7):** news, rss, headlines, news-filtering, relevance, news-writing, briefing
- **Memory (5):** memory, facts, preferences, consolidation, recall
- **Perception (10):** vision, ocr, image-analysis, browser, navigation, automation, browser-control, click, typing, scrolling
- **Coding (40):** coding, debugging, refactoring, error-analysis, fix-loop, root-cause, code-generation, project-structure, architecture, tech-design, estimation, execution, sandbox, output-capture, testing, qa-gate, code-review, best-practices, review-gate, security, vulnerability-scan, security-gate, performance, profiling, optimization, frontend, react, css, responsive, backend, api, auth, server, sql, schema, migrations, indexing, regex, parsing, transformation
- **DevOps (8):** deployment, docker, ci-cd, infrastructure, git, github, pull-requests, issues
- **Data (10):** data-analysis, charting, insights, data-viz, charts, dashboards, queries, aggregations, structured-data, apis
- **Writing (33):** writing, documentation, technical-writing, translation, localization, reflection-loop, culture, adaptation, summarization, compression, key-points, editing, grammar, clarity, copywriting, marketing, headlines, proofreading, consistency, polish, reporting, objectivity, structure, email, professional-writing, social-media, captions, content-calendar, resume, cover-letter, ats, release-notes, handoff
- **Teaching (13):** lesson-planning, quizzes, curriculum, teaching, explanation, checking, study, notes, learning-path, language-practice, vocabulary, corrections, examples
- **Life (31):** strategy, swot, decision-making, budgeting, health, habits, wellness, fitness, workouts, progress, nutrition, meals, macros, career, interview, interviewing, feedback, practice, negotiation, drafting, travel, itinerary, parenting, routines, guidance, history, timelines, context, legal, compliance, plain-language
- **Agent (8):** prompting, instruction-design, few-shot, agent-design, skills, catalog, self-check, diagnostics
- **Product (3):** requirements, scope, acceptance-criteria
- **Design (13):** ui-design, ux, design-system, layout, user-research, personas, journey-mapping, branding, voice-tone, identity, a11y, wcag, contrast

---

## Reliability layers (why answers stay honest)

1. **Gates, not vibes** — QA Lead (PASS/FAIL), Reviewer (APPROVED/CHANGES-REQUESTED), Security Officer (CLEARED/FLAGGED) must all pass before output ships.
2. **Verification Loop** — after research/learning, a Critic audits the draft against its sources; invented claims get flagged and a revision pass fixes them (capped at 2 rounds so it always terminates).
3. **Provider Router** — 7 optional free providers: Groq → Gemini → OpenRouter → Cerebras → DeepInfra → Mistral → HuggingFace, auto-fallback with cooldowns (quarantine); one dead key never kills a task.
4. **Strict handoffs** — each agent receives only its predecessor's output, so no context bleed or hallucinated earlier steps.
5. **Memory** — facts and preferences are scored (tf-idf) and consolidated into long-term memory, so JEXI learns you over time.

*Catalog source of truth: `server/src/services/AgentRoster.js` · endpoint: `GET /api/roster`*
