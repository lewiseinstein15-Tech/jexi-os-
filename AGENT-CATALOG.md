# JEXI OS — Agent & Skill Catalog

**207 specialist agents · 495 skills · 151 tools · 1 orchestrator.** One plain-language request in,
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
│    (never all 207)          │  Security → Shipper → Reflector
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 3. SKILLS expand per agent  │  team skills = each agent's registry entry
│    (495-skill registry)     │  → streamed live in the UI as she works
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
│                             │  → OpenRouter → Cerebras → DeepInfra → Mistral
│                             │  → Grok → HuggingFace. A dead or rate-limited
│                             │  key auto-falls-through.
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
## The 207 agents (grouped by primary skill category)

### Life (26)
| Agent | What it does |
|---|---|
| **Strategy Analyst** | Frameworks, SWOT, decision analysis, planning. |
| **Health Coach** | Wellness, habits, trackers, routines. |
| **Career Coach** | Resumes, interviews, job search, growth plans. |
| **Legal Guide** | Plain-language legal explanations and document checks. |
| **Travel Planner** | Itineraries, budgets, must-see lists. |
| **Fitness Trainer** | Workout plans, form guidance, progress tracking. |
| **Nutritionist** | Meal plans, macros, dietary advice. |
| **Parenting Guide** | Family advice, routines, age-appropriate guidance. |
| **Historian** | Timelines, context, primary-source awareness. |
| **Interviewer** | Conducts practice interviews and gives feedback. |
| **Negotiator** | Drafting offers, replies, and negotiation strategy. |
| **Counselor** | Empathetic listening and grounded support. |
| **Relationship Coach** | Communication and conflict in relationships. |
| **Sleep Coach** | Sleep routines and recovery. |
| **Meditation Coach** | Meditation and mindfulness practice. |
| **Pet Care Advisor** | Pet care, training and routines. |
| **Gardener** | Gardens and plants — indoor and outdoor. |
| **Home Organizer** | Decluttering and organized spaces. |
| **Interior Designer** | Room layouts, styling and design systems for spaces. |
| **Fashion Stylist** | Style, wardrobe and personal image. |
| **Beauty Advisor** | Skincare and beauty routines. |
| **Wedding Planner** | Weddings — vendors, budgets, timelines. |
| **Event Planner** | Events — logistics, budgets, coordination. |
| **Dating Coach** | Dating profiles and first-date confidence. |
| **Chef** | Recipes, techniques and meal ideas. |
| **Legal Drafter** | Drafts contracts and legal documents. |

### Writing (20)
| Agent | What it does |
|---|---|
| **Shipper** | Release notes, handoff summary, final report. |
| **Technical Writer** | Long-form writing: READMEs, docs, guides, reports. |
| **Translator** | Meaning-first translation with a reflection loop. |
| **Copywriter** | Marketing copy, headlines, product descriptions. |
| **Editor** | Clarity, grammar, tone, and structure pass over any text. |
| **Summarizer** | Compresses long content into precise summaries. |
| **Resume Writer** | Tailors resumes and cover letters to roles. |
| **Social Media Manager** | Post ideas, captions, hashtags, content calendar. |
| **Email Composer** | Professional, warm, or persuasive emails. |
| **Proofreader** | Typos, punctuation, consistency checks. |
| **Localization Specialist** | Adapts content for regions and cultures, not just words. |
| **Content Strategist** | Content calendars and pillar content plans. |
| **Technical Editor** | Fact-checks and sharpens technical writing. |
| **UX Writer** | Microcopy and interface language. |
| **Copyeditor** | Line-level edits against style guides. |
| **Blog Writer** | Blog posts and web articles. |
| **White Paper Writer** | Long-form authority documents. |
| **Case Study Writer** | Customer stories with measurable outcomes. |
| **API Docs Writer** | Reference docs and guides for developers. |
| **Email Developer** | HTML emails that render everywhere. |

### Coding (17)
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
| **Performance Engineer** | Measures and fixes speed, memory, and bundle issues. |
| **Database Architect** | Schema design, queries, migrations, indexing. |
| **Frontend Engineer** | Component builds, responsive layout, styling. |
| **Backend Engineer** | APIs, routes, middleware, auth, server logic. |
| **Coding Tutor** | Teaches programming step-by-step with examples. |
| **Regex Specialist** | Patterns, parsing, text transformations. |
| **SQL Analyst** | Queries, joins, aggregations, data questions. |
| **UI Developer** | Builds pixel-perfect interfaces fast. |
| **Landing Page Builder** | Conversion-focused landing pages. |

### Engineering (16)
| Agent | What it does |
|---|---|
| **Mobile Engineer** | Cross-platform mobile apps — React Native, Flutter, Capacitor — tested on real devices. |
| **iOS Engineer** | Native iOS apps with Swift/SwiftUI, App Store packaging. |
| **Android Engineer** | Native Android apps with Kotlin/Jetpack Compose, APK builds. |
| **React Native Engineer** | React Native apps with native modules and perf tuning. |
| **Game Developer** | Games with Unity/Unreal — mechanics, graphics, playtesting. |
| **ML Engineer** | Trains, fine-tunes and serves machine-learning models. |
| **Data Scientist** | Modeling, experiments and evaluation on real datasets. |
| **DevTools Engineer** | CLIs, SDKs and developer tooling. |
| **Embedded Engineer** | Firmware, microcontrollers and IoT hardware. |
| **Cloud Engineer** | AWS/GCP/Azure architecture, services and security. |
| **Kubernetes Engineer** | Clusters, Helm charts and container orchestration. |
| **Terraform Engineer** | Infrastructure as code with Terraform/OpenTofu. |
| **API Engineer** | REST/GraphQL API design, OpenAPI specs, versioning. |
| **Auth Engineer** | OAuth, JWT, session security and identity flows. |
| **Database Ops** | Postgres/Redis administration, backups, failover. |
| **Backup Engineer** | Backup and disaster-recovery plans that actually restore. |

### Creative (15)
| Agent | What it does |
|---|---|
| **Novelist** | Fiction — plot, characters, world-building. |
| **Screenwriter** | Screenplays and TV scripts with real dialogue. |
| **Poet** | Poems and verse with rhythm and image. |
| **Songwriter** | Songs — hooks, lyrics, structure. |
| **Illustrator** | Visual concepts, sketches and art direction. |
| **Video Script Writer** | YouTube/TikTok scripts with hooks and retention. |
| **Podcaster** | Podcast episodes — topics, structure, interviews. |
| **Speech Writer** | Speeches with rhetoric that lands. |
| **Essayist** | Argument-driven essays and opinion pieces. |
| **Grant Writer** | Grant applications and funding proposals. |
| **Newsletter Writer** | Newsletters people actually open. |
| **SEO Writer** | Content that ranks and reads well. |
| **Ad Copywriter** | Ads and landing copy that convert. |
| **Ghostwriter** | Writes in the client's voice, invisibly. |
| **Sound Designer** | Audio direction for video and podcasts. |

### Business (14)
| Agent | What it does |
|---|---|
| **Business Analyst** | Requirements, processes and business cases. |
| **Market Analyst** | Market sizing, demand and competitive analysis. |
| **Startup Advisor** | MVP scoping, product-market fit, fundraising. |
| **Financial Advisor** | Financial planning, retirement, net worth. |
| **Investment Analyst** | Portfolios, stocks and risk-adjusted returns. |
| **Tax Advisor** | Taxes, deductions and filing strategy. |
| **Sales Representative** | Outreach, pipelines and closing deals. |
| **CRM Specialist** | Leads, records and follow-up systems. |
| **Customer Success Manager** | Onboarding, retention and expansion. |
| **Support Engineer** | Diagnoses and resolves user issues fast. |
| **HR Specialist** | Hiring, onboarding and people ops. |
| **Recruiter** | Sourcing, screening and hiring pipelines. |
| **Pricing Strategist** | Pricing tiers and monetization models. |
| **Operations Manager** | Workflows, processes and execution cadence. |

### DevOps (13)
| Agent | What it does |
|---|---|
| **DevOps Agent** | Deploy config, Dockerfile, CI/CD, infrastructure. |
| **GitHub Agent** | Commit, push, PRs, issues — real gh/git CLI. |
| **Network Engineer** | DNS, TLS, load balancers and network security. |
| **Site Reliability Engineer** | Uptime, SLIs/SLOs, incident response and runbooks. |
| **Monitoring Engineer** | Metrics, dashboards and alerting that actually fires. |
| **Log Analyst** | Reads logs and traces, correlates events to root causes. |
| **Cloud Cost Optimizer** | Finds wasted spend and right-sizes infrastructure. |
| **Release Engineer** | Versioning, tags, changelogs and safe releases. |
| **CI Engineer** | Build pipelines that catch bugs before they ship. |
| **Deploy Engineer** | Zero-downtime deploys and instant rollbacks. |
| **Infra Auditor** | Audits infrastructure for drift, waste and risk. |
| **MLOps Engineer** | Puts models in production: serving, drift, pipelines. |
| **Incident Commander** | Runs incident response and postmortems. |

### Research (10)
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
| **Books Agent** | Answers strictly from the user's own books and library with citations. |
| **Web Scraper** | Pulls structured data from pages and APIs. |

### Security (10)
| Agent | What it does |
|---|---|
| **Penetration Tester** | Finds and proves exploitable weaknesses before attackers do. |
| **Red Team Operator** | Simulates real adversaries end-to-end. |
| **Blue Team Defender** | Defends: detection, hardening, incident containment. |
| **Application Security Engineer** | SAST/DAST, secure code review, OWASP coverage. |
| **Cryptographer** | Encryption, hashing and secure key management. |
| **Privacy Officer** | GDPR and data-protection reviews. |
| **Compliance Officer** | ISO 27001 / SOC 2 readiness and audit trails. |
| **Forensic Analyst** | Preserves evidence and reconstructs incidents. |
| **Risk Analyst** | Threat modeling and risk mitigation plans. |
| **Security Trainer** | Awareness training and security policy writing. |

### Data (8)
| Agent | What it does |
|---|---|
| **Data Analyst** | Data analysis, statistics, charts, insight. |
| **Reporter** | Structured news/report style writing with who-what-when. |
| **Data Visualizer** | Turns numbers into clear charts and dashboards. |
| **Data Engineer** | Builds data pipelines: extract, transform, load and cleanse messy datasets. |
| **BI Analyst** | Dashboards and KPIs that tell the business story. |
| **Reporting Analyst** | Structured reports from raw numbers. |
| **Database Administrator** | Tuning, backups and day-to-day database care. |
| **Data Quality Engineer** | Validation, governance and clean pipelines. |

### Education (8)
| Agent | What it does |
|---|---|
| **Homework Helper** | Homework help with worked explanations. |
| **Exam Coach** | Exam prep plans and test strategy. |
| **Flashcard Maker** | Flashcard decks with spaced repetition. |
| **Grader** | Fair grading with clear rubrics. |
| **Curriculum Designer** | Courses and curricula aligned to standards. |
| **Lab Assistant** | Experiments, lab safety and write-ups. |
| **Research Mentor** | Mentors research projects and papers. |
| **Academic Writer** | Papers and theses with proper citations. |

### Productivity (7)
| Agent | What it does |
|---|---|
| **Executive Assistant** | Schedules, inbox, tasks and meeting prep. |
| **Scheduler** | Calendars, time-blocking and agendas. |
| **Note Taker** | Captures notes and action items. |
| **Meeting Planner** | Agendas and minutes that move things forward. |
| **Expense Tracker** | Tracks spending and receipts. |
| **Task Manager** | Tasks, priorities and follow-ups. |
| **Email Triage** | Inbox zero and draft replies. |

### Marketing (6)
| Agent | What it does |
|---|---|
| **Growth Marketer** | Funnels, loops and experiments that grow. |
| **SEO Specialist** | Ranking strategy and search analytics. |
| **Product Marketer** | Positioning, messaging and launches. |
| **Lifecycle Marketer** | Email campaigns and retention sequences. |
| **Community Manager** | Communities, moderation and engagement. |
| **DevRel Engineer** | Docs, tutorials and developer communities. |

### Agent (5)
| Agent | What it does |
|---|---|
| **Self-Diagnose** | Reads own health, memory, errors, and source to report root causes. |
| **Prompt Engineer** | Designs system prompts and instructions for other AIs. |
| **Agent Builder** | Designs new specialist agents and their skills. |
| **Tool Router** | Auto-selects the exact tool set for every task — no manual tool instruction ever needed. |
| **Toolsmith** | Designs new reusable tools and wires external APIs into the tool registry. |

### Core (5)
| Agent | What it does |
|---|---|
| **Planner** | Classifies every request and composes the right team before anything runs. |
| **Orchestrator** | Runs the chosen specialists one-by-one, enforcing strict handoffs and gates. |
| **JEXI Core** | Identity, conversation, and the system prompt every agent inherits. |
| **Reasoner** | Structured reasoning, math solving, and final-answer synthesis. |
| **Reflector** | Retrospective after each mission — what worked, what to remember. |

### Design (5)
| Agent | What it does |
|---|---|
| **Designer** | UI/UX design system, layouts, visual spec. |
| **UX Researcher** | User research, personas, journey maps, usability insight. |
| **Brand Strategist** | Naming, voice, tone, visual identity guidelines. |
| **Accessibility Auditor** | WCAG review, contrast, keyboard nav, screen-reader passes. |
| **Brand Designer** | Logos, identity and visual systems. |

### Math (4)
| Agent | What it does |
|---|---|
| **Math Solver** | LaTeX-structured math solving with given/formula/working/final. |
| **Finance Analyst** | Budgeting, financial calculations, money questions. |
| **Science Explainer** | Physics, chemistry, biology — accurate, visual explanations. |
| **Motion Designer** | Animation and motion for interfaces and video. |

### Teaching (4)
| Agent | What it does |
|---|---|
| **Study Coach** | Turns topics into structured, saved study notes. |
| **Tutor** | Explains concepts simply, checks understanding, adapts. |
| **Teacher** | Lesson plans, quizzes, curriculum building. |
| **Language Coach** | Practice, drills, vocabulary, corrections. |

### Memory (3)
| Agent | What it does |
|---|---|
| **Memory Agent** | Long-term memory: facts, preferences, tf-idf scoring, consolidation. |
| **Context Manager** | Keeps the conversation coherent: rolling summaries, compaction, and continuity across turns. |
| **Archivist** | Episodic memory: remembers past sessions and consolidates them with a forgetting curve. |

### News (3)
| Agent | What it does |
|---|---|
| **News Scout** | Fetches live headlines from free feeds. |
| **News Filter** | Dedupe and rank stories by relevance and recency. |
| **News Editor** | Writes the final brief from verified headlines. |

### Perception (3)
| Agent | What it does |
|---|---|
| **Vision Agent** | Image analysis — describe, read text, solve from photos. |
| **Navigator** | Drives the browser — navigate, click, type, scroll. |
| **Computer Use Agent** | Interactive browser control with numbered elements. |

### Knowledge (1)
| Agent | What it does |
|---|---|
| **Document Analyst** | Chunks uploaded documents and answers from the retrieved passages (RAG). |

### Media (1)
| Agent | What it does |
|---|---|
| **Video Analyst** | Watches videos frame-by-frame — timestamped captions, sampled visual frames, key moments (YouTube, TikTok, Instagram, direct files). |

### Product (1)
| Agent | What it does |
|---|---|
| **Product Manager** | Requirements, scope modes, success criteria, user stories. |

### Quality (1)
| Agent | What it does |
|---|---|
| **Critic** | MetaGPT-style strict critique of plans and outputs — the quality gate before anything ships. |

### Safety (1)
| Agent | What it does |
|---|---|
| **Guardrail** | Input/output safety: declines unsafe or destructive requests with a clear reason. |

---

## The 495 skills (by category)

- **Life (60):** strategy, swot, decision-making, budgeting, health, habits, wellness, fitness, workouts, progress, nutrition, meals, macros, career, interview, interviewing, feedback, practice, negotiation, drafting, travel, itinerary, parenting, routines, guidance, history, timelines, context, legal, compliance, plain-language, counseling, empathy, listening, relationships, conflict, sleep, rest, meditation, mindfulness, pets, pet-training, gardening, plants, organization, decluttering, interior-design, styling, fashion, wardrobe, skincare, beauty, weddings, vendors, events, logistics, dating, dating-profiles, cooking, recipes
- **Writing (45):** writing, documentation, technical-writing, translation, localization, reflection-loop, culture, adaptation, summarization, compression, key-points, editing, grammar, clarity, copywriting, marketing, headlines, proofreading, consistency, polish, reporting, objectivity, structure, email, professional-writing, social-media, captions, content-calendar, resume, cover-letter, ats, release-notes, handoff, technical-editing, accuracy, microcopy, ui-text, copyediting, style-guides, blogs, posts, white-papers, authority, case-studies, outcomes
- **Coding (40):** coding, debugging, refactoring, error-analysis, fix-loop, root-cause, code-generation, project-structure, architecture, tech-design, estimation, execution, sandbox, output-capture, testing, qa-gate, code-review, best-practices, review-gate, security, vulnerability-scan, security-gate, performance, profiling, optimization, frontend, react, css, responsive, backend, api, auth, server, sql, schema, migrations, indexing, regex, parsing, transformation
- **Engineering (40):** mobile, ios, android, react-native, flutter, swift, kotlin, game-dev, unity, unreal, graphics, ml, model-training, fine-tuning, embeddings, modeling, evaluation, cli, sdk, embedded, iot, hardware, cloud, aws, gcp, azure, kubernetes, containers, helm, terraform, iac, api-design, rest, graphql, openapi, oauth, database, postgres, redis, backups
- **Business (32):** business-analysis, process, market-research, competitive, tamo, startups, mvp, product-market-fit, financial-planning, retirement, investing, portfolio, stocks, tax, deductions, sales, outreach, crm, leads, retention, onboarding, support, troubleshooting, escalation, hr, hiring, recruiting, sourcing, pricing, monetization, ops, workflow
- **Creative (31):** fiction, storytelling, world-building, screenwriting, screenplay, dialogue, poetry, verse, songwriting, lyrics, illustration, art-direction, video-scripts, hooks, podcasting, audio, rhetoric, persuasion, essays, thesis, grants, proposals, newsletters, cadence, seo, keywords, ad-copy, conversion, a-b-testing, ghostwriting, voice-matching
- **DevOps (31):** deployment, docker, ci-cd, infrastructure, git, github, pull-requests, issues, sre, reliability, incident-response, on-call, monitoring, observability, alerting, tracing, correlation, cost, billing, release, versioning, pipelines, networking, dns, tls, disaster-recovery, rollback, zero-downtime, audit, mlops, model-serving
- **Research (24):** web-search, multi-engine, aggregation, query-expansion, search-strategy, ranking, trusted-sources, dedupe, scraping, content-extraction, cleaning, synthesis, citation, fact-grounded, fact-checking, verification, anti-hallucination, deep-research, knowledge-base, topic-study, books, papers, library-recall, quote
- **Security (24):** pentest, exploitation, owasp, red-team, social-engineering, blue-team, defense, appsec, sast, dast, cryptography, encryption, hashing, privacy, gdpr, data-protection, compliance, iso, soc2, forensics, evidence, threat-modeling, mitigation, security-awareness
- **Data (22):** data-analysis, charting, insights, data-viz, charts, dashboards, queries, aggregations, structured-data, apis, data-pipelines, etl, cleansing, bi, kpi, reporting, metrics, dba, tuning, data-quality, validation, governance
- **Education (15):** homework, practice-problems, exam-prep, test-prep, flashcards, spaced-repetition, grading, rubrics, curriculum-design, standards, labs, experiments, research-mentoring, academic-writing, formatting
- **Agent (14):** prompting, instruction-design, few-shot, agent-design, skills, catalog, self-check, diagnostics, tool-selection, function-calling, auto-routing, tool-building, api-integration, orchestration
- **Productivity (14):** scheduling, calendars, time-management, note-taking, action-items, agendas, minutes, expenses, receipts, tasks, priorities, gtd, email-triage, inbox
- **Design (13):** ui-design, ux, design-system, layout, user-research, personas, journey-mapping, branding, voice-tone, identity, a11y, wcag, contrast
- **Teaching (13):** lesson-planning, quizzes, curriculum, teaching, explanation, checking, study, notes, learning-path, language-practice, vocabulary, corrections, examples
- **Core (12):** intent-detection, team-composition, task-decomposition, pipeline-execution, gates, handoff, conversation, identity, system-prompt, reasoning, reflection, retrospective
- **Marketing (11):** growth, funnels, seo-strategy, ranking-analytics, positioning, messaging, launches, lifecycle, email-campaigns, community, moderation
- **Memory (11):** memory, facts, preferences, consolidation, recall, rolling-summary, context-compaction, continuity, episodic-memory, forgetting-curve, memory-consolidation
- **Perception (10):** vision, ocr, image-analysis, browser, navigation, automation, browser-control, click, typing, scrolling
- **Math (9):** math, latex, step-by-step, explanations, visuals, science, statistics, finance, calculations
- **News (7):** news, rss, headlines, news-filtering, relevance, news-writing, briefing
- **Media (5):** timestamped-captions, frame-analysis, visual-understanding, video-transcript-analysis, key-moments
- **Knowledge (3):** document-rag, chunking, retrieval
- **Product (3):** requirements, scope, acceptance-criteria
- **Quality (3):** critical-review, output-quality, self-consistency
- **Safety (3):** guardrails, safety-checks, refusal

---

## The 151 tools (by type)

### Data (17)
| Tool | What it does |
|---|---|
| **API Call** | Call and parse an external JSON/REST API. |
| **DB Query** | Write and run database queries safely. |
| **DB Schema** | Design schemas, indexes and constraints. |
| **Schema Migrate** | Plan and write safe migrations. |
| **Redis Ops** | Manage Redis keys, caching and state. |
| **Data Crunch** | Compute real statistics, aggregates and numbers from data. |
| **Chart Builder** | Turn numbers into clear charts and dashboards. |
| **Data Load** | Load data from files, URLs or APIs into a workable shape. |
| **Data Clean** | Clean messy data: missing values, dupes, types, outliers. |
| **Data Transform** | Transform data between shapes and formats. |
| **Data Merge** | Join and merge datasets correctly. |
| **Stats Compute** | Compute statistics, correlations and significance. |
| **Report Generate** | Turn data into a structured report with charts. |
| **KPI Track** | Define and track KPIs over time. |
| **Model Train** | Train, fine-tune or evaluate a machine-learning model. |
| **Eval Run** | Run benchmarks and quality evaluations. |
| **Spreadsheet Write** | Create and analyze spreadsheets. |

### Life (15)
| Tool | What it does |
|---|---|
| **Meal Plan** | Build meal plans from preferences and goals. |
| **Workout Plan** | Build workout plans and progress tracking. |
| **Sleep Plan** | Design sleep routines and wind-downs. |
| **Meditation Guide** | Guide meditation and breathing sessions. |
| **Pet Care Guide** | Care and training plans for pets. |
| **Garden Plan** | Plan gardens and plant care. |
| **Home Organize** | Declutter and organize spaces. |
| **Room Design** | Design room layouts and styling. |
| **Wardrobe Plan** | Plan a wardrobe and personal style. |
| **Skincare Routine** | Build skincare and beauty routines. |
| **Event Plan** | Plan events with budgets and logistics. |
| **Wedding Plan** | Plan weddings with vendors and timelines. |
| **Dating Profile** | Write dating profiles that stand out. |
| **Relationship Advice** | Advice for communication and conflict. |
| **Counseling** | Empathetic guided conversation and reflection. |

### Memory (11)
| Tool | What it does |
|---|---|
| **Memory Recall** | Retrieve facts, preferences, learned answers and prior research from the memory core. |
| **Memory Write** | Store durable facts, preferences and learned answers. |
| **Rolling Summary** | Keep a compact running summary of the whole conversation so nothing is forgotten. |
| **Episode Recall** | Remember what happened in past sessions, not just the last few turns. |
| **Memory Clear** | Wipe all or selected parts of the memory core. |
| **Preference Learn** | Extract and store "do it this way" preferences from an exchange. |
| **Profile Read** | Read the stored user profile: name, facts, preferences. |
| **Study Notes** | Create structured study notes saved to the knowledge library. |
| **Semantic Search** | Hybrid vector + keyword search across all memories. |
| **Vector Embed** | Embed a memory so semantic recall can find it. |
| **Episode Save** | Save the current session as an episode for future recall. |

### Business (10)
| Tool | What it does |
|---|---|
| **Grant Proposal** | Write grant applications and funding proposals. |
| **Business Plan** | Write a full business plan with financials. |
| **Pricing Model** | Build pricing tiers and revenue models. |
| **Pitch Deck** | Build investor pitch decks. |
| **Sales Outreach** | Write outreach sequences that get replies. |
| **CRM Update** | Structure leads and follow-up systems. |
| **Support Ticket** | Draft support replies and resolutions. |
| **Onboarding Plan** | Design customer and employee onboarding. |
| **Hire Pipeline** | Design a hiring pipeline with screens. |
| **Interview Guide** | Build role-specific interview guides. |

### Writing (10)
| Tool | What it does |
|---|---|
| **Changelog Write** | Write release notes and changelogs from git history. |
| **Word Doc Write** | Create and edit Word documents. |
| **Slides Write** | Create presentation decks. |
| **Newsletter Compose** | Compose newsletters people open. |
| **Blog Write** | Write blog posts and articles. |
| **White Paper Write** | Write long-form authority documents. |
| **Case Study Write** | Write customer stories with outcomes. |
| **Summarize Doc** | Compress long content into precise summaries. |
| **Proofread Text** | Fix typos, grammar and consistency. |
| **Email Draft** | Draft effective emails for any audience. |

### Education (9)
| Tool | What it does |
|---|---|
| **Homework Help** | Work through homework with explanations. |
| **Exam Prep** | Build exam prep plans and drills. |
| **Flashcard Generate** | Generate flashcard decks with spaced repetition. |
| **Quiz Generate** | Generate quizzes and practice tests. |
| **Rubric Grade** | Grade work against a rubric with feedback. |
| **Curriculum Build** | Design curricula aligned to standards. |
| **Lab Safety** | Plan experiments with safety checks. |
| **Thesis Support** | Support thesis structure, research and writing. |
| **Citation Format** | Format citations in any style. |

### Research (9)
| Tool | What it does |
|---|---|
| **Deep Read** | Open a URL server-side and extract its real content (strip ads, keep the text). |
| **News Feed** | Fetch live headlines from free RSS feeds (Google News, BBC) and dedupe them. |
| **Trusted Library** | Read free, trusted books, papers and overviews (Wikipedia, Gutenberg, arXiv, Open Library). |
| **Wikipedia Lookup** | Pull the trusted overview for any topic. |
| **arXiv Search** | Search academic papers on arXiv. |
| **PDF Extract** | Parse a PDF and extract its text for reading or indexing. |
| **Trend Scan** | Detect rising topics and trending themes from feeds and searches. |
| **Market Research** | Size a market, estimate demand and map the landscape. |
| **Competitor Scan** | Analyze competitors: positioning, pricing, strengths, gaps. |

### Quality (8)
| Tool | What it does |
|---|---|
| **Code Review** | Review the code with APPROVED / CHANGES-REQUESTED verdict. |
| **Security Scan** | OWASP-class vulnerability review with CLEARED / BLOCKED verdict. |
| **Fact Check** | Audit an answer against its sources and revise invented or unsupported claims. |
| **Self-Consistency** | Cross-check the answer against itself and the task before it ships. |
| **Test Automation** | Generate and run automated tests (unit, integration, E2E) for the code. |
| **Lint Check** | Run linters and static checks and fix what they flag. |
| **Dependency Audit** | Audit dependencies for known vulnerabilities and drift. |
| **Build Check** | Build the project and verify it compiles cleanly. |

### Security (8)
| Tool | What it does |
|---|---|
| **Vulnerability Scan** | Scan an app or repo for exploitable vulnerabilities. |
| **Secrets Scan** | Scan for leaked keys, tokens and credentials. |
| **SAST** | Run static analysis for security defects. |
| **Threat Model** | Model attack surfaces and rank risks. |
| **Compliance Check** | Check against standards: GDPR, ISO, SOC 2. |
| **Privacy Review** | Review data flows and privacy posture. |
| **Auth Audit** | Audit auth flows: sessions, tokens, permissions. |
| **Crypto Check** | Review encryption and hashing choices. |

### DevOps (7)
| Tool | What it does |
|---|---|
| **Deploy Config** | Generate deploy configs: render.yaml, vercel.json, nginx, systemd. |
| **Dockerfile Write** | Write and optimize a Dockerfile for the project. |
| **CI Pipeline** | Write CI/CD pipelines that build, test and ship. |
| **Infra Plan** | Design infrastructure-as-code: Terraform, cloud resources, networking. |
| **Cloud Cost** | Estimate and optimize cloud spend. |
| **Backup Plan** | Design backups and restore drills that actually work. |
| **Incident Runbook** | Write runbooks for known failure modes. |

### Browser (6)
| Tool | What it does |
|---|---|
| **Open Link** | Open a shared link in the real browser and summarize what it contains. |
| **Browser Control** | Click, type, scroll, and interact with live numbered elements on a page. |
| **Screenshot** | Capture the current page or screen as an image. |
| **Page Text** | Read all visible text on the current page. |
| **Form Fill** | Fill inputs, pick options and submit forms on a page. |
| **Tab Manage** | Open, switch and close browser tabs. |

### Creative (6)
| Tool | What it does |
|---|---|
| **Image Generate** | Generate or edit images from a description. |
| **Script Write** | Write screenplays and video scripts. |
| **Lyrics Write** | Write song lyrics with structure and rhyme. |
| **Poem Write** | Write poems in any style. |
| **Speech Write** | Write speeches with rhetoric that lands. |
| **Essay Write** | Write argument-driven essays. |

### DevTools (6)
| Tool | What it does |
|---|---|
| **PR Review** | Review an open pull request with a verdict and comments. |
| **Preview Server** | Spin up a live preview of a built app. |
| **GitHub CLI** | Run the real gh/git CLI: commit, push, PRs and issues. |
| **Git Status** | Inspect repo status, branches and diffs. |
| **Branch Manage** | Create, merge and clean up branches. |
| **Issue Track** | Create, list and manage GitHub issues. |

### Knowledge (6)
| Tool | What it does |
|---|---|
| **Knowledge Search** | Search the saved knowledge library and studied topics. |
| **Knowledge Save** | Save studied topics and notes into the knowledge library. |
| **Book Library** | Answer strictly from the user's own uploaded books with citations and quotes. |
| **Document RAG** | Chunk uploaded documents and answer from the retrieved passages. |
| **Book Fetch** | Fetch a free public-domain book or paper from the trusted library. |
| **Knowledge Index** | Index studied material so recall is instant and complete. |

### Productivity (6)
| Tool | What it does |
|---|---|
| **Schedule Plan** | Plan days, weeks and calendars. |
| **Meeting Minutes** | Write agendas and minutes with action items. |
| **Expense Log** | Track expenses and budgets. |
| **Task Board** | Build task lists and priority boards. |
| **Inbox Triage** | Triage email and draft replies. |
| **Notes Organize** | Organize notes and action items. |

### Marketing (4)
| Tool | What it does |
|---|---|
| **SEO Optimize** | Optimize content to rank and convert. |
| **Ad Copy Generate** | Write ad variations that convert. |
| **Social Schedule** | Plan and schedule social posts. |
| **Caption Write** | Write punchy captions and hashtags. |

### Execution (3)
| Tool | What it does |
|---|---|
| **Run Code** | Execute generated code and capture real stdout and errors. |
| **Write Files** | Generate and write project files into the workspace. |
| **Fix & Re-run** | Apply a fix to failing code and re-run until it is clean. |

### Media (3)
| Tool | What it does |
|---|---|
| **Video Analyze** | Watch any video link frame-by-frame: timestamped captions, sampled frames, key moments. |
| **Video Transcript** | Pull the full timestamped transcript of a YouTube/TikTok/Instagram video. |
| **Video Frames** | Sample visual frames across a video timeline for vision analysis. |

### Perception (3)
| Tool | What it does |
|---|---|
| **Vision** | Analyze images: describe, OCR text, and solve what is shown. |
| **OCR Read** | Extract text from an image or screenshot. |
| **Audio Transcribe** | Transcribe spoken audio to text. |

### System (2)
| Tool | What it does |
|---|---|
| **Self Diagnose** | Read own health, memory, errors and source code to report root causes. |
| **Settings** | Read and update JEXI's settings and provider keys. |

### Language (1)
| Tool | What it does |
|---|---|
| **Translate** | Translate text with a draft → critique → revise reflection loop. |

### Search (1)
| Tool | What it does |
|---|---|
| **Web Search** | Search multiple engines (SearXNG, DDG, Bing, Mojeek, Wikipedia, arXiv) and rank trusted sources. |


---

## Reliability layers (why answers stay honest)

1. **Gates, not vibes** — QA Lead (PASS/FAIL), Reviewer (APPROVED/CHANGES-REQUESTED), Security Officer (CLEARED/FLAGGED) must all pass before output ships.
2. **Verification Loop** — after research/learning, a Critic audits the draft against its sources; invented claims get flagged and a revision pass fixes them (capped at 2 rounds so it always terminates).
3. **Provider Router** — 8 optional providers: Groq → Gemini → OpenRouter → Cerebras → DeepInfra → Mistral → Grok (xAI) → HuggingFace, auto-fallback with cooldowns (quarantine); one dead key never kills a task.
4. **Strict handoffs** — each agent receives only its predecessor's output, so no context bleed or hallucinated earlier steps.
5. **Memory** — facts and preferences are scored (tf-idf) and consolidated into long-term memory, so JEXI learns you over time.

*Catalog source of truth: `server/src/services/AgentRoster.js` · endpoint: `GET /api/roster`*
