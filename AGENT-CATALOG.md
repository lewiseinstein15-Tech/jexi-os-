# JEXI OS — Agent & Skill Catalog

**251 specialist agents · 507 skills · 177 tools · 1 orchestrator.** One plain-language request in,
a composed team runs it end-to-end, verifies the answer, and reports back.

> ⚙️ GENERATED FILE — updated 2026-08-15 by `cd server && npm run audit-roster`. Do not edit by hand.
> The audit (`node scripts/audit-roster.js --check`, wired into `npm test`) fails CI if this file drifts from the registries.

---

## Reachability report (what the audit proves)

| Metric | Value |
|---|---|
| Agents | 251 (251 reachable — 100%) |
| Skills | 507 |
| Tools | 177 |
| Intents / teams | 154 |
| Orphaned agents | 0 |
| Orphaned skills | 0 |
| Orphaned tools | 0 |
| Dangling refs (any direction) | 0 |

**✅ PASS — every roster entry is reachable, zero orphans, zero dangling references.**

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
│    (never all 251)          │  Security → Critic → Shipper → Reflector
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 3. SKILLS expand per agent  │  team skills = each agent's registry entry
│    (507-skill registry)       │  → streamed live in the UI as she works
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ 4. ORCHESTRATOR runs them   │  strict handoffs: only the previous agent's
│    one-by-one               │  output moves forward; QA/Review/Security/
│                             │  Critic gates are own nodes with own verdicts
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

| Intent | Team composed | Execution |
|---|---|---|
| `image_recognition` | Vision Agent → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `clear_memory` | Memory Agent | 0 independent · 1 bundled |
| `link_analysis` | Video Analyst → Navigator → Extractor → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `math_solve` | Math Solver → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `self_check` | Self-Diagnose → Reasoner → Memory Agent → Tool Router → Toolsmith → Agent Builder → Prompt Engineer → Guardrail | 0 independent · 8 bundled |
| `code_task` | Product Manager → Designer → Engineer → UX Researcher → Accessibility Auditor → Architect → Coder → Runner → Sandbox Agent → Debugger → QA Lead → Reviewer → Critic → Security Officer → Shipper → Reflector → UI Developer → Frontend Engineer → Landing Page Builder → Email Developer | 13 independent · 7 bundled |
| `computer_use` | Navigator → Vision Agent → Computer Use Agent → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `study_topic` | Scholar → Researcher → Historian → Science Explainer → Document Analyst → Memory Agent | 0 independent · 6 bundled |
| `direct_answer` | JEXI Core → Context Manager | 0 independent · 2 bundled |
| `conversation` | JEXI Core → Context Manager → Archivist | 0 independent · 3 bundled |
| `memory_query` | Memory Agent → Archivist → Context Manager | 0 independent · 3 bundled |
| `knowledge_recall` | Books Agent → Document Analyst → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `news_latest` | News Scout → News Filter → News Editor → Reporter → Reasoner → Memory Agent | 0 independent · 6 bundled |
| `research` | Query Analyzer → Searcher → Re-ranker → Extractor → Synthesizer → Fact Checker → Critic → Memory Agent | 1 independent · 7 bundled |
| `learning_research` | Researcher → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `explain_team` | Planner → Orchestrator | 0 independent · 2 bundled |
| `github` | GitHub Agent → Shipper | 1 independent · 1 bundled |
| `translate` | Translator → Localization Specialist → Reviewer → Editor → Proofreader | 1 independent · 4 bundled |
| `data` | Data Analyst → Data Engineer → Data Visualizer → Web Scraper → SQL Analyst → Regex Specialist → Reasoner | 0 independent · 7 bundled |
| `devops` | DevOps Agent → Shipper | 1 independent · 1 bundled |
| `docs` | Technical Writer → Reviewer → Summarizer | 1 independent · 2 bundled |
| `perf` | Performance Engineer → Coder → Reviewer | 2 independent · 1 bundled |
| `creative_writing` | Novelist → Screenwriter → Poet → Songwriter → Editor → Critic → Summarizer | 1 independent · 6 bundled |
| `business_plan` | Business Analyst → Startup Advisor → Financial Advisor → Market Analyst → Strategy Analyst → Sales Representative → CRM Specialist → Customer Success Manager | 0 independent · 8 bundled |
| `marketing_plan` | Market Analyst → Growth Marketer → SEO Specialist → Copywriter → Brand Strategist → Product Marketer → Lifecycle Marketer → Community Manager → DevRel Engineer → Social Media Manager → Email Composer → Ad Copywriter → Newsletter Writer → Brand Designer | 0 independent · 14 bundled |
| `event_planning` | Event Planner → Wedding Planner → Travel Planner → Finance Analyst | 0 independent · 4 bundled |
| `meal_plan` | Chef → Nutritionist → Health Coach | 0 independent · 3 bundled |
| `workout_plan` | Fitness Trainer → Health Coach → Nutritionist → Sleep Coach → Meditation Coach | 0 independent · 5 bundled |
| `investing_advice` | Investment Analyst → Financial Advisor → Tax Advisor | 0 independent · 3 bundled |
| `tech_support` | Support Engineer → Debugger → Coder → Technical Writer | 2 independent · 2 bundled |
| `security_audit` | Penetration Tester → Security Officer → Application Security Engineer → Risk Analyst → Red Team Operator → Blue Team Defender → Cryptographer → Privacy Officer → Compliance Officer → Forensic Analyst → Security Trainer → Guardrail | 1 independent · 11 bundled |
| `content_creation` | Content Strategist → Blog Writer → SEO Writer → Video Script Writer → Editor → Technical Editor → UX Writer → Copyeditor → White Paper Writer → Case Study Writer → API Docs Writer → Podcaster → Speech Writer → Essayist → Grant Writer → Newsletter Writer → Ad Copywriter → Ghostwriter → Illustrator → Motion Designer → Sound Designer | 0 independent · 21 bundled |
| `study_exam` | Exam Coach → Study Coach → Teacher → Flashcard Maker → Homework Helper → Grader → Curriculum Designer → Lab Assistant → Research Mentor → Academic Writer → Coding Tutor → Language Coach → Tutor | 0 independent · 13 bundled |
| `career_plan` | Career Coach → Recruiter → Resume Writer → Interviewer → HR Specialist | 0 independent · 5 bundled |
| `observability` | Observability Agent → Concurrency Agent → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `offline_mode` | Offline Agent → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `voice_command` | Voice Orchestrator → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `plugin_task` | Plugin Manager → Reasoner | 0 independent · 2 bundled |
| `chaos_test` | Chaos Agent → Orchestrator → Reflector | 1 independent · 2 bundled |
| `relationship_advice` | Relationship Coach → Counselor → Dating Coach | 0 independent · 3 bundled |
| `startup_advice` | Startup Advisor → Business Analyst → Pricing Strategist → Investment Analyst | 0 independent · 4 bundled |
| `productivity` | Task Manager → Scheduler → Note Taker → Email Triage → Meeting Planner → Expense Tracker → Operations Manager → Executive Assistant | 0 independent · 8 bundled |
| `data_ml` | Data Scientist → ML Engineer → MLOps Engineer → Data Engineer → Data Quality Engineer → BI Analyst → Reporting Analyst → Database Administrator | 0 independent · 8 bundled |
| `cloud_devops` | Cloud Engineer → Kubernetes Engineer → Terraform Engineer → Site Reliability Engineer → DevOps Agent → Network Engineer → Log Analyst → Monitoring Engineer → Deploy Engineer → Infra Auditor → Database Ops → Backup Engineer → Release Engineer → CI Engineer → Cloud Cost Optimizer → Incident Commander | 0 independent · 16 bundled |
| `api_backend` | API Engineer → Auth Engineer → Backend Engineer → Database Architect → DevTools Engineer | 0 independent · 5 bundled |
| `mobile_app` | Mobile Engineer → iOS Engineer → Android Engineer → React Native Engineer → QA Lead | 1 independent · 4 bundled |
| `game_dev` | Game Developer → Designer → Coder → QA Lead | 3 independent · 1 bundled |
| `home_life` | Home Organizer → Interior Designer → Event Planner → Gardener → Fashion Stylist → Beauty Advisor → Pet Care Advisor → Parenting Guide | 0 independent · 8 bundled |
| `legal_task` | Legal Drafter → Negotiator → Legal Guide → Privacy Officer → Compliance Officer | 0 independent · 5 bundled |
| `domain:mathematics` | Math Solver → Applied Mathematician → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:applied-mathematics` | Applied Mathematician → Math Solver → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:theoretical-mathematics` | Math Solver → Theoretical Computer Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:mathematical-physics` | Physicist → Applied Mathematician → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:statistics` | Statistician → Data Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:probability-theory` | Statistician → Applied Mathematician → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:econometrics` | Economist → Statistician → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:actuarial-science` | Economist → Statistician → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:operations-research` | Applied Mathematician → Industrial Engineer → Data Scientist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:decision-science` | Systems Scientist → Cognitive Scientist → Applied Mathematician → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:computational-mathematics` | Applied Mathematician → Computational Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:computer-science` | Theoretical Computer Scientist → Engineer → Reasoner → Memory Agent | 1 independent · 3 bundled |
| `domain:artificial-intelligence` | ML Engineer → Systems Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:machine-learning` | ML Engineer → Data Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:computer-vision` | ML Engineer → Vision Agent → Robotics Engineer → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:nlp` | ML Engineer → Computational Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:software-engineering` | Engineer → Architect → Coder → Reasoner → Memory Agent | 3 independent · 2 bundled |
| `domain:computer-graphics` | Computer Engineer → Designer → Game Developer → Reasoner → Memory Agent | 1 independent · 4 bundled |
| `domain:virtual-reality` | Computer Engineer → Designer → Game Developer → Reasoner → Memory Agent | 1 independent · 4 bundled |
| `domain:game-technology` | Game Developer → Computer Engineer → Designer → Reasoner → Memory Agent | 1 independent · 4 bundled |
| `domain:internet-of-things` | Electrical Engineer → Electrical Engineer → Computer Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:cloud-computing` | Cloud Engineer → Distributed Systems Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:distributed-systems` | Distributed Systems Engineer → Cloud Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:hpc` | Computational Scientist → Distributed Systems Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:quantum-computing` | Quantum Engineer → Physicist → Computational Scientist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:quantum-information` | Quantum Engineer → Theoretical Computer Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:computational-science` | Computational Scientist → Applied Mathematician → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:theoretical-cs` | Theoretical Computer Scientist → Math Solver → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:multi-agent-systems` | Systems Scientist → ML Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:cyber-physical-systems` | Robotics Engineer → Electrical Engineer → Systems Scientist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:digital-twin` | Systems Scientist → Computational Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:autonomous-systems` | Robotics Engineer → Systems Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:ai-for-science` | ML Engineer → Computational Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:ai-for-engineering` | ML Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:ai-for-mathematics` | Applied Mathematician → ML Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:ai-research` | ML Engineer → Deep Tech Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:scientific-machine-learning` | ML Engineer → Computational Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:physics` | Physicist → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `domain:engineering-physics` | Physicist → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:chemistry` | Chemist → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `domain:physical-chemistry` | Chemist → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:materials-science` | Materials Scientist → Chemical Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:nanotechnology` | Materials Scientist → Chemist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:optical-engineering` | Optical Engineer → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:quantum-engineering` | Quantum Engineer → Electrical Engineer → Physicist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:biology` | Biologist → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `domain:biochemistry` | Biochemist → Chemist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:biophysics` | Biochemist → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:molecular-biology` | Biochemist → Microbiologist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:microbiology` | Microbiologist → Medical Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:genetics-genomics` | Microbiologist → Computational Biologist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:neuroscience` | Neuroscientist → Cognitive Scientist → Medical Scientist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:cognitive-science` | Cognitive Scientist → Neuroscientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:psychology` | Cognitive Scientist → Neuroscientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:computational-biology` | Computational Biologist → Data Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:ecology` | Biologist → Environmental Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:medical-science` | Medical Scientist → Public Health Specialist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:pharmaceutical-science` | Medical Scientist → Chemist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:public-health` | Public Health Specialist → Statistician → Medical Scientist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:health-informatics` | Health Tech Engineer → Data Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:biomedical-engineering` | Biomedical Engineer → Medical Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:biotechnology` | Biomedical Engineer → Microbiologist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:computational-medicine` | Medical Scientist → Computational Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:tissue-regenerative` | Biomedical Engineer → Materials Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:neurotechnology` | Neuroscientist → Biomedical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:electrical-engineering` | Electrical Engineer → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:electronics-engineering` | Electrical Engineer → Electrical Engineer → Reasoner → Memory Agent | 0 independent · 3 bundled |
| `domain:computer-engineering` | Computer Engineer → Electrical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:telecommunications` | Electrical Engineer → Network Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:network-engineering` | Network Engineer → Security Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:mechanical-engineering` | Mechanical Engineer → Engineer → Reasoner → Memory Agent | 1 independent · 3 bundled |
| `domain:civil-engineering` | Civil Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:structural-engineering` | Civil Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:chemical-engineering` | Chemical Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:aerospace-engineering` | Aerospace Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:astronautical-engineering` | Aerospace Engineer → Astronomer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:astrophysics` | Astronomer → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:cosmology` | Astronomer → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:planetary-science` | Astronomer → Geoscientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:astronomy` | Astronomer → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:automotive-engineering` | Mechanical Engineer → Electrical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:industrial-engineering` | Industrial Engineer → Data Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:manufacturing-engineering` | Mechanical Engineer → Industrial Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:systems-engineering` | Systems Scientist → Industrial Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:mechatronics-engineering` | Robotics Engineer → Electrical Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:robotics-engineering` | Robotics Engineer → Computer Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:control-engineering` | Robotics Engineer → Applied Mathematician → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:energy-engineering` | Environmental Scientist → Electrical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:nuclear-engineering` | Nuclear Engineer → Physicist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:petroleum-engineering` | Petroleum Engineer → Geoscientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:ocean-marine-engineering` | Marine Engineer → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:data-science` | Data Scientist → Statistician → ML Engineer → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:hci` | Designer → UX Researcher → Cognitive Scientist → Reasoner → Memory Agent | 1 independent · 4 bundled |
| `domain:augmented-reality` | Game Developer → Computer Engineer → Designer → Reasoner → Memory Agent | 1 independent · 4 bundled |
| `domain:environmental-engineering` | Environmental Scientist → Civil Engineer → Chemical Engineer → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:geological-geotechnical` | Civil Engineer → Geoscientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:transportation-engineering` | Civil Engineer → Industrial Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:water-resources-engineering` | Civil Engineer → Environmental Scientist → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:architectural-engineering` | Civil Engineer → Mechanical Engineer → Electrical Engineer → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:construction-engineering` | Civil Engineer → Industrial Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:agricultural-engineering` | Biologist → Environmental Scientist → Mechanical Engineer → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:food-engineering` | Biochemist → Chemical Engineer → Reasoner → Memory Agent | 0 independent · 4 bundled |
| `domain:bioinformatics` | Computational Biologist → Biologist → Data Scientist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:synthetic-biology` | Computational Biologist → Biochemist → Biologist → Reasoner → Memory Agent | 0 independent · 5 bundled |
| `domain:epidemiology` | Public Health Specialist → Statistician → Data Scientist → Reasoner → Memory Agent | 0 independent · 5 bundled |

---
## How execution actually works

How execution actually works (B49):
- **Independent** — the agent takes its own observable reasoning turn: its own graph node / LLM call with its own verdict or output.
- **Bundled** — the agent's persona is composed into another pass: its role text is injected into a shared prompt, but it does not reason on its own.

Today's verified independent passes live in the coding pipeline (`code_task`): Product → Designer → Engineer (planForBuild's three sequential calls), Architect/Coder/Debugger (codegen + fix calls), Runner (real sandbox execution), and the QA / Reviewer / Security Officer / Critic / Shipper / Reflector gates (each its own call with its own PASS/FAIL verdict). Every other team member in every team is honestly marked *bundled* — one well-constructed composite prompt covers closely related, low-stakes roles, and the roster table above says so per intent.

This section and every table below are GENERATED from the live registries by `cd server && npm run audit-roster` — they cannot drift from the code.

---
## The 251 agents (grouped by primary skill category)

### Agent (5)
| Agent | Tier | What it does |
|---|---|---|
| **Agent Builder** | team | Designs new specialist agents and their skills. |
| **Prompt Engineer** | team | Designs system prompts and instructions for other AIs. |
| **Self-Diagnose** | pipeline | Reads own health, memory, errors, and source to report root causes. |
| **Tool Router** | team | Auto-selects the exact tool set for every task — no manual tool instruction ever needed. |
| **Toolsmith** | team | Designs new reusable tools and wires external APIs into the tool registry. |

### Business (16)
| Agent | Tier | What it does |
|---|---|---|
| **Business Analyst** | team | Requirements, processes and business cases. |
| **Chemical Engineer** | team | Process engineering, reactors, separations, thermo for industry. |
| **CRM Specialist** | team | Leads, records and follow-up systems. |
| **Customer Success Manager** | team | Onboarding, retention and expansion. |
| **Financial Advisor** | team | Financial planning, retirement, net worth. |
| **HR Specialist** | team | Hiring, onboarding and people ops. |
| **Industrial Engineer** | team | Process optimization, operations, logistics, workflow design. |
| **Investment Analyst** | team | Portfolios, stocks and risk-adjusted returns. |
| **Market Analyst** | team | Market sizing, demand and competitive analysis. |
| **Operations Manager** | team | Workflows, processes and execution cadence. |
| **Pricing Strategist** | team | Pricing tiers and monetization models. |
| **Recruiter** | team | Sourcing, screening and hiring pipelines. |
| **Sales Representative** | team | Outreach, pipelines and closing deals. |
| **Startup Advisor** | team | MVP scoping, product-market fit, fundraising. |
| **Support Engineer** | team | Diagnoses and resolves user issues fast. |
| **Tax Advisor** | team | Taxes, deductions and filing strategy. |

### Coding (24)
| Agent | Tier | What it does |
|---|---|---|
| **Architect** | pipeline | Generates project structure and code from the plan. |
| **Backend Engineer** | team | APIs, routes, middleware, auth, server logic. |
| **Coder** | pipeline | Writes actual code, fixes debug loops. |
| **Coding Tutor** | team | Teaches programming step-by-step with examples. |
| **Computational Biologist** | team | Genomics, proteomics, modeling of biological systems. |
| **Computational Scientist** | team | Scientific computing, simulation, HPC and numerical methods. |
| **Database Architect** | team | Schema design, queries, migrations, indexing. |
| **Debugger** | pipeline | Reads errors and applies fixes until it runs clean. |
| **Distributed Systems Engineer** | team | Scale-out architectures, consensus, sharding, reliability. |
| **Engineer** | team | Architecture, build plan, technical approach. |
| **Frontend Engineer** | team | Component builds, responsive layout, styling. |
| **Health Tech Engineer** | team | Digital health: EHR, telehealth, devices, health AI. |
| **Landing Page Builder** | team | Conversion-focused landing pages. |
| **Performance Engineer** | pipeline | Measures and fixes speed, memory, and bundle issues. |
| **QA Lead** | pipeline | Runs the app, verifies against spec, PASS/FAIL gate. |
| **Regex Specialist** | team | Patterns, parsing, text transformations. |
| **Reviewer** | pipeline | Code review with APPROVED / CHANGES-REQUESTED gate. |
| **Runner** | pipeline | Executes the code, captures real output and errors. |
| **Security Engineer** | team | Defensive security: network defense, identity, hardening. |
| **Security Officer** | pipeline | Security review with CLEARED / FLAGGED gate. |
| **SQL Analyst** | team | Queries, joins, aggregations, data questions. |
| **Systems Scientist** | team | Systems thinking, feedback loops, emergence, complex dynamics. |
| **Theoretical Computer Scientist** | team | Computability, complexity, algorithms, formal methods, proofs. |
| **UI Developer** | team | Builds pixel-perfect interfaces fast. |

### Core (6)
| Agent | Tier | What it does |
|---|---|---|
| **Cognitive Scientist** | team | Cognition, perception, language, learning and decision models. |
| **JEXI Core** | core | Identity, conversation, and the system prompt every agent inherits. |
| **Orchestrator** | core | Runs the chosen specialists one-by-one, enforcing strict handoffs and gates. |
| **Planner** | core | Classifies every request and composes the right team before anything runs. |
| **Reasoner** | core | Structured reasoning, math solving, and final-answer synthesis. |
| **Reflector** | core | Retrospective after each mission — what worked, what to remember. |

### Creative (15)
| Agent | Tier | What it does |
|---|---|---|
| **Ad Copywriter** | team | Ads and landing copy that convert. |
| **Essayist** | team | Argument-driven essays and opinion pieces. |
| **Ghostwriter** | team | Writes in the client's voice, invisibly. |
| **Grant Writer** | team | Grant applications and funding proposals. |
| **Illustrator** | team | Visual concepts, sketches and art direction. |
| **Newsletter Writer** | team | Newsletters people actually open. |
| **Novelist** | team | Fiction — plot, characters, world-building. |
| **Podcaster** | team | Podcast episodes — topics, structure, interviews. |
| **Poet** | team | Poems and verse with rhythm and image. |
| **Screenwriter** | team | Screenplays and TV scripts with real dialogue. |
| **SEO Writer** | team | Content that ranks and reads well. |
| **Songwriter** | team | Songs — hooks, lyrics, structure. |
| **Sound Designer** | team | Audio direction for video and podcasts. |
| **Speech Writer** | team | Speeches with rhetoric that lands. |
| **Video Script Writer** | team | YouTube/TikTok scripts with hooks and retention. |

### Data (8)
| Agent | Tier | What it does |
|---|---|---|
| **BI Analyst** | team | Dashboards and KPIs that tell the business story. |
| **Data Analyst** | pipeline | Data analysis, statistics, charts, insight. |
| **Data Engineer** | team | Builds data pipelines: extract, transform, load and cleanse messy datasets. |
| **Data Quality Engineer** | team | Validation, governance and clean pipelines. |
| **Data Visualizer** | team | Turns numbers into clear charts and dashboards. |
| **Database Administrator** | team | Tuning, backups and day-to-day database care. |
| **Reporter** | team | Structured news/report style writing with who-what-when. |
| **Reporting Analyst** | team | Structured reports from raw numbers. |

### Design (5)
| Agent | Tier | What it does |
|---|---|---|
| **Accessibility Auditor** | team | WCAG review, contrast, keyboard nav, screen-reader passes. |
| **Brand Designer** | team | Logos, identity and visual systems. |
| **Brand Strategist** | team | Naming, voice, tone, visual identity guidelines. |
| **Designer** | team | UI/UX design system, layouts, visual spec. |
| **UX Researcher** | team | User research, personas, journey maps, usability insight. |

### DevOps (13)
| Agent | Tier | What it does |
|---|---|---|
| **CI Engineer** | team | Build pipelines that catch bugs before they ship. |
| **Cloud Cost Optimizer** | team | Finds wasted spend and right-sizes infrastructure. |
| **Deploy Engineer** | team | Zero-downtime deploys and instant rollbacks. |
| **DevOps Agent** | pipeline | Deploy config, Dockerfile, CI/CD, infrastructure. |
| **GitHub Agent** | pipeline | Commit, push, PRs, issues — real gh/git CLI. |
| **Incident Commander** | team | Runs incident response and postmortems. |
| **Infra Auditor** | team | Audits infrastructure for drift, waste and risk. |
| **Log Analyst** | team | Reads logs and traces, correlates events to root causes. |
| **MLOps Engineer** | team | Puts models in production: serving, drift, pipelines. |
| **Monitoring Engineer** | team | Metrics, dashboards and alerting that actually fires. |
| **Network Engineer** | team | DNS, TLS, load balancers and network security. |
| **Release Engineer** | team | Versioning, tags, changelogs and safe releases. |
| **Site Reliability Engineer** | team | Uptime, SLIs/SLOs, incident response and runbooks. |

### Education (8)
| Agent | Tier | What it does |
|---|---|---|
| **Academic Writer** | team | Papers and theses with proper citations. |
| **Curriculum Designer** | team | Courses and curricula aligned to standards. |
| **Exam Coach** | team | Exam prep plans and test strategy. |
| **Flashcard Maker** | team | Flashcard decks with spaced repetition. |
| **Grader** | team | Fair grading with clear rubrics. |
| **Homework Helper** | team | Homework help with worked explanations. |
| **Lab Assistant** | team | Experiments, lab safety and write-ups. |
| **Research Mentor** | team | Mentors research projects and papers. |

### Engineering (19)
| Agent | Tier | What it does |
|---|---|---|
| **Android Engineer** | team | Native Android apps with Kotlin/Jetpack Compose, APK builds. |
| **API Engineer** | team | REST/GraphQL API design, OpenAPI specs, versioning. |
| **Auth Engineer** | team | OAuth, JWT, session security and identity flows. |
| **Backup Engineer** | team | Backup and disaster-recovery plans that actually restore. |
| **Biomedical Engineer** | team | Medical devices, imaging, prosthetics, biomechanics. |
| **Cloud Engineer** | team | AWS/GCP/Azure architecture, services and security. |
| **Computer Engineer** | team | Hardware-software co-design, processors, embedded systems. |
| **Data Scientist** | team | Modeling, experiments and evaluation on real datasets. |
| **Database Ops** | team | Postgres/Redis administration, backups, failover. |
| **DevTools Engineer** | team | CLIs, SDKs and developer tooling. |
| **Electrical Engineer** | team | Circuits, power systems, electronics, control, signal analysis. |
| **Game Developer** | team | Games with Unity/Unreal — mechanics, graphics, playtesting. |
| **iOS Engineer** | team | Native iOS apps with Swift/SwiftUI, App Store packaging. |
| **Kubernetes Engineer** | team | Clusters, Helm charts and container orchestration. |
| **ML Engineer** | team | Trains, fine-tunes and serves machine-learning models. |
| **Mobile Engineer** | team | Cross-platform mobile apps — React Native, Flutter, Capacitor — tested on real devices. |
| **React Native Engineer** | team | React Native apps with native modules and perf tuning. |
| **Robotics Engineer** | team | Robots: kinematics, control, perception, navigation, ROS. |
| **Terraform Engineer** | team | Infrastructure as code with Terraform/OpenTofu. |

### Knowledge (1)
| Agent | Tier | What it does |
|---|---|---|
| **Document Analyst** | pipeline | Chunks uploaded documents and answers from the retrieved passages (RAG). |

### Life (28)
| Agent | Tier | What it does |
|---|---|---|
| **Beauty Advisor** | team | Skincare and beauty routines. |
| **Career Coach** | team | Resumes, interviews, job search, growth plans. |
| **Chef** | team | Recipes, techniques and meal ideas. |
| **Counselor** | team | Empathetic listening and grounded support. |
| **Dating Coach** | team | Dating profiles and first-date confidence. |
| **Economist** | team | Micro and macro economics, markets, policy, econometric analysis. |
| **Event Planner** | team | Events — logistics, budgets, coordination. |
| **Fashion Stylist** | team | Style, wardrobe and personal image. |
| **Fitness Trainer** | team | Workout plans, form guidance, progress tracking. |
| **Gardener** | team | Gardens and plants — indoor and outdoor. |
| **Health Coach** | team | Wellness, habits, trackers, routines. |
| **Historian** | team | Timelines, context, primary-source awareness. |
| **Home Organizer** | team | Decluttering and organized spaces. |
| **Interior Designer** | team | Room layouts, styling and design systems for spaces. |
| **Interviewer** | team | Conducts practice interviews and gives feedback. |
| **Legal Drafter** | team | Drafts contracts and legal documents. |
| **Legal Guide** | team | Plain-language legal explanations and document checks. |
| **Meditation Coach** | team | Meditation and mindfulness practice. |
| **Negotiator** | team | Drafting offers, replies, and negotiation strategy. |
| **Nutritionist** | team | Meal plans, macros, dietary advice. |
| **Parenting Guide** | team | Family advice, routines, age-appropriate guidance. |
| **Pet Care Advisor** | team | Pet care, training and routines. |
| **Public Health Specialist** | team | Population health, epidemiology, prevention, health policy. |
| **Relationship Coach** | team | Communication and conflict in relationships. |
| **Sleep Coach** | team | Sleep routines and recovery. |
| **Strategy Analyst** | team | Frameworks, SWOT, decision analysis, planning. |
| **Travel Planner** | team | Itineraries, budgets, must-see lists. |
| **Wedding Planner** | team | Weddings — vendors, budgets, timelines. |

### Marketing (6)
| Agent | Tier | What it does |
|---|---|---|
| **Community Manager** | team | Communities, moderation and engagement. |
| **DevRel Engineer** | team | Docs, tutorials and developer communities. |
| **Growth Marketer** | team | Funnels, loops and experiments that grow. |
| **Lifecycle Marketer** | team | Email campaigns and retention sequences. |
| **Product Marketer** | team | Positioning, messaging and launches. |
| **SEO Specialist** | team | Ranking strategy and search analytics. |

### Math (25)
| Agent | Tier | What it does |
|---|---|---|
| **Aerospace Engineer** | team | Aircraft and spacecraft: aerodynamics, structures, propulsion. |
| **Applied Mathematician** | team | Numerical analysis, optimization, differential equations, modeling. |
| **Astronomer** | team | Stars, galaxies, exoplanets, observational and theoretical astro. |
| **Biochemist** | team | Biomolecules, metabolism, enzymology, molecular mechanisms. |
| **Biologist** | team | Life science: cells, organisms, evolution, ecosystems. |
| **Chemist** | team | Chemistry across organic, inorganic, physical and analytical. |
| **Civil Engineer** | team | Structures, foundations, materials for buildings and infra. |
| **Environmental Scientist** | team | Ecosystems, pollution, remediation, environmental assessment. |
| **Finance Analyst** | team | Budgeting, financial calculations, money questions. |
| **Geoscientist** | team | Earth: geology, geophysics, resources, hazards. |
| **Marine Engineer** | team | Ships, offshore systems, propulsion, marine structures. |
| **Materials Scientist** | team | Materials: structure, properties, processing, performance. |
| **Math Solver** | pipeline | LaTeX-structured math solving with given/formula/working/final. |
| **Mechanical Engineer** | team | Mechanics, thermofluids, machine design, materials selection. |
| **Medical Scientist** | team | Medicine, physiology, pharmacology, clinical research. |
| **Microbiologist** | team | Microbes: bacteriology, virology, immunology, microbial ecology. |
| **Motion Designer** | team | Animation and motion for interfaces and video. |
| **Neuroscientist** | team | Nervous system: structure, function, circuits, disorders. |
| **Nuclear Engineer** | team | Reactors, radiation, nuclear energy, safety, fuel cycle. |
| **Optical Engineer** | team | Optics, photonics, lenses, lasers, imaging systems. |
| **Petroleum Engineer** | team | Reservoirs, drilling, production, subsurface engineering. |
| **Physicist** | team | Physics from classical mechanics to quantum field theory. |
| **Quantum Engineer** | team | Quantum devices, qubits, error correction, quantum hardware stacks. |
| **Science Explainer** | team | Physics, chemistry, biology — accurate, visual explanations. |
| **Statistician** | team | Experimental design, inference, distributions, hypothesis testing. |

### Media (1)
| Agent | Tier | What it does |
|---|---|---|
| **Video Analyst** | pipeline | Watches videos frame-by-frame — timestamped captions, sampled visual frames, key moments (YouTube, TikTok, Instagram, direct files). |

### Memory (3)
| Agent | Tier | What it does |
|---|---|---|
| **Archivist** | team | Episodic memory: remembers past sessions and consolidates them with a forgetting curve. |
| **Context Manager** | team | Keeps the conversation coherent: rolling summaries, compaction, and continuity across turns. |
| **Memory Agent** | pipeline | Long-term memory: facts, preferences, tf-idf scoring, consolidation. |

### News (3)
| Agent | Tier | What it does |
|---|---|---|
| **News Editor** | pipeline | Writes the final brief from verified headlines. |
| **News Filter** | pipeline | Dedupe and rank stories by relevance and recency. |
| **News Scout** | pipeline | Fetches live headlines from free feeds. |

### Perception (3)
| Agent | Tier | What it does |
|---|---|---|
| **Computer Use Agent** | pipeline | Interactive browser control with numbered elements. |
| **Navigator** | pipeline | Drives the browser — navigate, click, type, scroll. |
| **Vision Agent** | pipeline | Image analysis — describe, read text, solve from photos. |

### Platform (7)
| Agent | Tier | What it does |
|---|---|---|
| **Chaos Agent** | team | Injects controlled failures (provider timeouts, tool errors, memory pressure) during test runs to harden the system. |
| **Concurrency Agent** | team | Multi-user / multi-workspace isolation, locking, and concurrent memory access without bleed between sessions. |
| **Observability Agent** | team | Streams structured traces, latency, token usage, gate results and provider health for every task. |
| **Offline Agent** | team | Detects cloud-provider unavailability and routes suitable tasks to a local LLM backend (Ollama / llama.cpp). |
| **Plugin Manager** | team | Discovers, validates and loads external skill/tool packages at runtime; keeps a versioned registry. |
| **Sandbox Agent** | team | Creates and runs isolated execution workspaces with strict CPU/memory/network limits and timeouts. |
| **Voice Orchestrator** | team | Owns the full speech pipeline: streaming STT, barge-in, interruption handling, TTS selection, wake-word readiness. |

### Product (1)
| Agent | Tier | What it does |
|---|---|---|
| **Product Manager** | team | Requirements, scope modes, success criteria, user stories. |

### Productivity (7)
| Agent | Tier | What it does |
|---|---|---|
| **Email Triage** | team | Inbox zero and draft replies. |
| **Executive Assistant** | team | Schedules, inbox, tasks and meeting prep. |
| **Expense Tracker** | team | Tracks spending and receipts. |
| **Meeting Planner** | team | Agendas and minutes that move things forward. |
| **Note Taker** | team | Captures notes and action items. |
| **Scheduler** | team | Calendars, time-blocking and agendas. |
| **Task Manager** | team | Tasks, priorities and follow-ups. |

### Quality (1)
| Agent | Tier | What it does |
|---|---|---|
| **Critic** | pipeline | MetaGPT-style strict critique of plans and outputs — the quality gate before anything ships. |

### Research (11)
| Agent | Tier | What it does |
|---|---|---|
| **Books Agent** | pipeline | Answers strictly from the user's own books and library with citations. |
| **Deep Tech Scientist** | team | Frontier R and D: physics, materials, chemistry, biotech moonshots. |
| **Extractor** | pipeline | Deep-reads pages and pulls out the real content. |
| **Fact Checker** | pipeline | Verifies claims against sources before an answer ships. |
| **Query Analyzer** | pipeline | Splits a research question into precise search queries. |
| **Re-ranker** | pipeline | Trusted-source ranking, spam filtering, dedupe. |
| **Researcher** | pipeline | Deep study of a topic into the knowledge library. |
| **Scholar** | pipeline | Trusted books, papers and knowledge-library recall. |
| **Searcher** | pipeline | Aggregates results from SearXNG, DDG, Bing, Mojeek, Wikipedia, arXiv. |
| **Synthesizer** | pipeline | Combines sources into a grounded answer with citations. |
| **Web Scraper** | team | Pulls structured data from pages and APIs. |

### Safety (1)
| Agent | Tier | What it does |
|---|---|---|
| **Guardrail** | team | Input/output safety: declines unsafe or destructive requests with a clear reason; continuous prompt-injection, jailbreak and tool-abuse detection with safe-mode enforcement. |

### Security (10)
| Agent | Tier | What it does |
|---|---|---|
| **Application Security Engineer** | team | SAST/DAST, secure code review, OWASP coverage. |
| **Blue Team Defender** | team | Defends: detection, hardening, incident containment. |
| **Compliance Officer** | team | ISO 27001 / SOC 2 readiness and audit trails. |
| **Cryptographer** | team | Encryption, hashing and secure key management. |
| **Forensic Analyst** | team | Preserves evidence and reconstructs incidents. |
| **Penetration Tester** | team | Finds and proves exploitable weaknesses before attackers do. |
| **Privacy Officer** | team | GDPR and data-protection reviews. |
| **Red Team Operator** | team | Simulates real adversaries end-to-end. |
| **Risk Analyst** | team | Threat modeling and risk mitigation plans. |
| **Security Trainer** | team | Awareness training and security policy writing. |

### Teaching (4)
| Agent | Tier | What it does |
|---|---|---|
| **Language Coach** | team | Practice, drills, vocabulary, corrections. |
| **Study Coach** | team | Turns topics into structured, saved study notes. |
| **Teacher** | team | Lesson plans, quizzes, curriculum building. |
| **Tutor** | team | Explains concepts simply, checks understanding, adapts. |

### Writing (20)
| Agent | Tier | What it does |
|---|---|---|
| **API Docs Writer** | team | Reference docs and guides for developers. |
| **Blog Writer** | team | Blog posts and web articles. |
| **Case Study Writer** | team | Customer stories with measurable outcomes. |
| **Content Strategist** | team | Content calendars and pillar content plans. |
| **Copyeditor** | team | Line-level edits against style guides. |
| **Copywriter** | team | Marketing copy, headlines, product descriptions. |
| **Editor** | team | Clarity, grammar, tone, and structure pass over any text. |
| **Email Composer** | team | Professional, warm, or persuasive emails. |
| **Email Developer** | team | HTML emails that render everywhere. |
| **Localization Specialist** | team | Adapts content for regions and cultures, not just words. |
| **Proofreader** | team | Typos, punctuation, consistency checks. |
| **Resume Writer** | team | Tailors resumes and cover letters to roles. |
| **Shipper** | pipeline | Release notes, handoff summary, final report. |
| **Social Media Manager** | team | Post ideas, captions, hashtags, content calendar. |
| **Summarizer** | team | Compresses long content into precise summaries. |
| **Technical Editor** | team | Fact-checks and sharpens technical writing. |
| **Technical Writer** | pipeline | Long-form writing: READMEs, docs, guides, reports. |
| **Translator** | pipeline | Meaning-first translation with a reflection loop. |
| **UX Writer** | team | Microcopy and interface language. |
| **White Paper Writer** | team | Long-form authority documents. |


## The 507 skills (grouped by category)

### Agent (14)
| Skill | Owner agent | What it does |
|---|---|---|
| `agent-design` | Agent Builder | Build new specialists. |
| `api-integration` | Toolsmith | Wire external APIs as tools. |
| `auto-routing` | Tool Router | Route every task to the agents + tools it needs — no manual instruction. |
| `catalog` | Agent Builder | Maintain the roster. |
| `diagnostics` | Self-Diagnose | Read logs, memory, errors. |
| `few-shot` | Prompt Engineer | Teach with examples. |
| `function-calling` | Tool Router | Call tools with correct arguments. |
| `instruction-design` | Prompt Engineer | Clear, testable instructions. |
| `orchestration` | Toolsmith | Sequence tools and agents safely. |
| `prompting` | Prompt Engineer | Design instructions for AIs. |
| `self-check` | Self-Diagnose | Diagnose own health. |
| `skills` | Agent Builder | Add capabilities to the catalog. |
| `tool-building` | Toolsmith | Design new reusable tools. |
| `tool-selection` | Tool Router | Auto-pick the right tools for the task. |

### Business (32)
| Skill | Owner agent | What it does |
|---|---|---|
| `business-analysis` | Business Analyst | Requirements and process. |
| `competitive` | Market Analyst | Competitor analysis. |
| `crm` | CRM Specialist | Customer records. |
| `deductions` | Tax Advisor | Legitimate deductions. |
| `escalation` | Support Engineer | Route hard cases. |
| `financial-planning` | Financial Advisor | Long-term money plans. |
| `hiring` | HR Specialist | Hiring process. |
| `hr` | HR Specialist | People operations. |
| `investing` | Investment Analyst | Investment strategy. |
| `leads` | CRM Specialist | Lead tracking. |
| `market-research` | Market Analyst | Market sizing and demand. |
| `monetization` | Pricing Strategist | Revenue models. |
| `mvp` | Startup Advisor | Minimum viable product. |
| `onboarding` | Customer Success Manager | First-week success. |
| `ops` | Operations Manager | Run the business. |
| `outreach` | Sales Representative | Prospecting messages. |
| `portfolio` | Investment Analyst | Portfolio allocation. |
| `pricing` | Pricing Strategist | Price strategy. |
| `process` | Business Analyst | Workflow design. |
| `product-market-fit` | Startup Advisor | Fit and traction. |
| `recruiting` | Recruiter | Talent sourcing. |
| `retention` | Customer Success Manager | Keep customers. |
| `retirement` | Financial Advisor | Retirement planning. |
| `sales` | Sales Representative | Sales pipeline. |
| `sourcing` | Recruiter | Candidate search. |
| `startups` | Startup Advisor | Early-stage strategy. |
| `stocks` | Investment Analyst | Equities and markets. |
| `support` | Support Engineer | Customer support. |
| `tamo` | Market Analyst | Market math. |
| `tax` | Tax Advisor | Taxes and deductions. |
| `troubleshooting` | Support Engineer | Diagnose issues. |
| `workflow` | Operations Manager | Process automation. |

### Coding (40)
| Skill | Owner agent | What it does |
|---|---|---|
| `api` | Backend Engineer | Endpoints and contracts. |
| `architecture` | Engineer | Design the technical approach. |
| `auth` | Backend Engineer | Login and permissions. |
| `backend` | Backend Engineer | Server-side logic. |
| `best-practices` | Reviewer | Enforce solid conventions. |
| `code-generation` | Architect | Generate whole project files. |
| `code-review` | Reviewer | Review for quality and bugs. |
| `coding` | Coder | Write working code. |
| `css` | Frontend Engineer | Styling and layout. |
| `debugging` | Debugger | Find and fix bugs. |
| `error-analysis` | Debugger | Read tracebacks and root-cause them. |
| `estimation` | Engineer | Scope and effort sizing. |
| `execution` | Runner | Run code in a sandbox. |
| `fix-loop` | Debugger | Run → fix → re-run until clean. |
| `frontend` | Frontend Engineer | UI implementation. |
| `indexing` | Database Architect | Query performance. |
| `migrations` | Database Architect | Safe data changes. |
| `optimization` | Performance Engineer | Make it measurably faster. |
| `output-capture` | Runner | Capture stdout and errors. |
| `parsing` | Regex Specialist | Extract structure from text. |
| `performance` | Performance Engineer | Speed and memory optimization. |
| `profiling` | Performance Engineer | Find the slow parts. |
| `project-structure` | Architect | Sensible file layout. |
| `qa-gate` | QA Lead | PASS or NEEDS FIX verdict. |
| `react` | Frontend Engineer | Component-based UI. |
| `refactoring` | Coder | Improve code without changing behavior. |
| `regex` | Regex Specialist | Pattern matching. |
| `responsive` | Frontend Engineer | Works on any screen. |
| `review-gate` | Reviewer | APPROVED or CHANGES-REQUESTED. |
| `root-cause` | Debugger | Find the real cause, not the symptom. |
| `sandbox` | Runner | Isolated safe execution. |
| `schema` | Database Architect | Data model design. |
| `security` | Security Officer | Find vulnerabilities. |
| `security-gate` | Security Officer | CLEARED or BLOCKED verdict. |
| `server` | Backend Engineer | Middleware and routing. |
| `sql` | SQL Analyst | Queries and schema. |
| `tech-design` | Engineer | Concrete implementation plan. |
| `testing` | QA Lead | Verify against the spec. |
| `transformation` | Regex Specialist | Rewrite text programmatically. |
| `vulnerability-scan` | Security Officer | Check for OWASP-class issues. |

### Core (12)
| Skill | Owner agent | What it does |
|---|---|---|
| `conversation` | JEXI Core | Natural multi-turn dialogue. |
| `gates` | Orchestrator | PASS/FAIL and CLEARED/BLOCKED gates in code. |
| `handoff` | Orchestrator | Pass only the prior agent's output forward. |
| `identity` | JEXI Core | Knows name, creator, and origin always. |
| `intent-detection` | Planner | Classify what a request actually asks for. |
| `pipeline-execution` | Orchestrator | Run specialists in order with handoffs. |
| `reasoning` | Reasoner | Structured step-by-step thinking. |
| `reflection` | Reflector | Critique own output and improve it. |
| `retrospective` | Reflector | Post-task review of what worked. |
| `system-prompt` | JEXI Core | The inherited instruction set for every agent. |
| `task-decomposition` | Planner | Split big asks into ordered subtasks. |
| `team-composition` | Planner | Pick the right specialists for a task. |

### Creative (31)
| Skill | Owner agent | What it does |
|---|---|---|
| `a-b-testing` | Ad Copywriter | Test copy variations. |
| `ad-copy` | Ad Copywriter | Ads that convert. |
| `art-direction` | Illustrator | Visual concept direction. |
| `audio` | Podcaster | Audio production. |
| `cadence` | Newsletter Writer | Publishing rhythm. |
| `conversion` | Ad Copywriter | Call-to-action craft. |
| `dialogue` | Screenwriter | Natural character voices. |
| `essays` | Essayist | Argument-driven essays. |
| `fiction` | Novelist | Novels and short stories. |
| `ghostwriting` | Ghostwriter | Write in another voice. |
| `grants` | Grant Writer | Grant applications. |
| `hooks` | Video Script Writer | Openings that grab. |
| `illustration` | Illustrator | Drawings and visuals. |
| `keywords` | SEO Writer | Keyword targeting. |
| `lyrics` | Songwriter | Lyrics that sing. |
| `newsletters` | Newsletter Writer | Email newsletters. |
| `persuasion` | Speech Writer | Convincing arguments. |
| `podcasting` | Podcaster | Podcast episodes. |
| `poetry` | Poet | Poems and verse. |
| `proposals` | Grant Writer | Persuasive proposals. |
| `rhetoric` | Speech Writer | Persuasive structure. |
| `screenplay` | Screenwriter | Format and structure. |
| `screenwriting` | Screenwriter | Scripts for film and TV. |
| `seo` | SEO Writer | Search-optimized content. |
| `songwriting` | Songwriter | Songs and hooks. |
| `storytelling` | Novelist | Narrative craft. |
| `thesis` | Essayist | Central argument craft. |
| `verse` | Poet | Meter and rhyme. |
| `video-scripts` | Video Script Writer | Scripts for video. |
| `voice-matching` | Ghostwriter | Match tone and style. |
| `world-building` | Novelist | Believable settings. |

### Data (22)
| Skill | Owner agent | What it does |
|---|---|---|
| `aggregations` | SQL Analyst | Group and summarize. |
| `apis` | Web Scraper | Call and parse external APIs. |
| `bi` | BI Analyst | Dashboards and KPIs. |
| `charting` | Data Analyst | Visualize the numbers. |
| `charts` | Data Visualizer | Bar, line, pie, scatter. |
| `cleansing` | Data Engineer | Clean messy datasets. |
| `dashboards` | Data Visualizer | Everything on one screen. |
| `data-analysis` | Data Analyst | Analyze datasets. |
| `data-pipelines` | Data Engineer | Move and transform data. |
| `data-quality` | Data Quality Engineer | Clean, valid data. |
| `data-viz` | Data Visualizer | Clear chart design. |
| `dba` | Database Administrator | Database administration. |
| `etl` | Data Engineer | Extract, transform, load. |
| `governance` | Data Quality Engineer | Data ownership and policy. |
| `insights` | Data Analyst | What the data actually says. |
| `kpi` | BI Analyst | Track the right metrics. |
| `metrics` | Reporting Analyst | Measure outcomes. |
| `queries` | SQL Analyst | Ask data questions. |
| `reporting` | Reporting Analyst | Structured reports. |
| `structured-data` | Web Scraper | Extract fields, not prose. |
| `tuning` | Database Administrator | Query and index tuning. |
| `validation` | Data Quality Engineer | Schema and constraint checks. |

### Design (13)
| Skill | Owner agent | What it does |
|---|---|---|
| `a11y` | Accessibility Auditor | Usable by everyone. |
| `branding` | Brand Strategist | Identity and voice. |
| `contrast` | Accessibility Auditor | Readable colors. |
| `design-system` | Designer | Consistent components. |
| `identity` | Brand Strategist | Visual identity. |
| `journey-mapping` | UX Researcher | User flows. |
| `layout` | Designer | Space and hierarchy. |
| `personas` | UX Researcher | User archetypes. |
| `ui-design` | Designer | Interface design. |
| `user-research` | UX Researcher | Understand users. |
| `ux` | Designer | Usability and flow. |
| `voice-tone` | Brand Strategist | How JEXI sounds. |
| `wcag` | Accessibility Auditor | Accessibility standards. |

### DevOps (31)
| Skill | Owner agent | What it does |
|---|---|---|
| `alerting` | Monitoring Engineer | Alert rules and paging. |
| `audit` | Infra Auditor | Infrastructure audits. |
| `billing` | Cloud Cost Optimizer | Usage and billing data. |
| `ci-cd` | DevOps Agent | Automated build and release. |
| `correlation` | Log Analyst | Connect logs and events. |
| `cost` | Cloud Cost Optimizer | Cost analysis and savings. |
| `deployment` | DevOps Agent | Ship it somewhere real. |
| `disaster-recovery` | Backup Engineer | DR plans and restores. |
| `dns` | Network Engineer | DNS records and routing. |
| `docker` | DevOps Agent | Containerize the app. |
| `git` | GitHub Agent | Version control. |
| `github` | GitHub Agent | Repos, actions, releases. |
| `incident-response` | Site Reliability Engineer | Handle outages and incidents. |
| `infrastructure` | DevOps Agent | Hosts, config, scaling. |
| `issues` | GitHub Agent | Track and manage issues. |
| `mlops` | MLOps Engineer | Model pipelines in production. |
| `model-serving` | MLOps Engineer | Serve models at scale. |
| `monitoring` | Monitoring Engineer | System and app monitoring. |
| `networking` | Network Engineer | Networks and load balancers. |
| `observability` | Monitoring Engineer | Metrics, logs, traces. |
| `on-call` | Site Reliability Engineer | Runbooks and escalation. |
| `pipelines` | CI Engineer | Build and test pipelines. |
| `pull-requests` | GitHub Agent | Open and review PRs. |
| `release` | Release Engineer | Release management. |
| `reliability` | Site Reliability Engineer | Uptime and resilience. |
| `rollback` | Deploy Engineer | Safe rollbacks. |
| `sre` | Site Reliability Engineer | Site reliability engineering. |
| `tls` | Network Engineer | Certificates and HTTPS. |
| `tracing` | Log Analyst | Distributed tracing. |
| `versioning` | Release Engineer | Version and tag strategy. |
| `zero-downtime` | Deploy Engineer | No-downtime deploys. |

### Education (15)
| Skill | Owner agent | What it does |
|---|---|---|
| `academic-writing` | Academic Writer | Papers and theses. |
| `curriculum-design` | Curriculum Designer | Course design. |
| `exam-prep` | Exam Coach | Exam readiness. |
| `experiments` | Lab Assistant | Experiment design. |
| `flashcards` | Flashcard Maker | Flashcard decks. |
| `formatting` | Academic Writer | Citations and styles. |
| `grading` | Grader | Grade work fairly. |
| `homework` | Homework Helper | Homework help. |
| `labs` | Lab Assistant | Lab work. |
| `practice-problems` | Homework Helper | Practice sets. |
| `research-mentoring` | Research Mentor | Mentor research. |
| `rubrics` | Grader | Scoring rubrics. |
| `spaced-repetition` | Flashcard Maker | Review scheduling. |
| `standards` | Curriculum Designer | Learning standards. |
| `test-prep` | Exam Coach | Test strategy. |

### Engineering (40)
| Skill | Owner agent | What it does |
|---|---|---|
| `android` | Android Engineer | Native Android development. |
| `api-design` | API Engineer | Endpoint and contract design. |
| `aws` | Cloud Engineer | AWS services. |
| `azure` | Cloud Engineer | Microsoft Azure services. |
| `backups` | Backup Engineer | Backup and recovery planning. |
| `cli` | DevTools Engineer | Command-line tools. |
| `cloud` | Cloud Engineer | Cloud platforms and services. |
| `containers` | Kubernetes Engineer | Docker and container runtimes. |
| `database` | Database Ops | Database design and ops. |
| `embedded` | Electrical Engineer | Embedded software, firmware, and microcontroller systems. |
| `embeddings` | ML Engineer | Vector representations and search. |
| `evaluation` | Data Scientist | Benchmarks and quality metrics. |
| `fine-tuning` | ML Engineer | Adapt pretrained models. |
| `flutter` | Mobile Engineer | Flutter/Dart cross-platform apps. |
| `game-dev` | Game Developer | Game design and engine work. |
| `gcp` | Cloud Engineer | Google Cloud services. |
| `graphics` | Game Developer | Rendering, shaders, animation. |
| `graphql` | API Engineer | GraphQL APIs. |
| `hardware` | Electrical Engineer | PCB, firmware, electronics, and embedded systems design. |
| `helm` | Kubernetes Engineer | Kubernetes packaging. |
| `iac` | Terraform Engineer | Infrastructure automation. |
| `ios` | iOS Engineer | Native iPhone/iPad development. |
| `iot` | Electrical Engineer | Internet of Things: sensors, connectivity, edge devices, and device clouds. |
| `kotlin` | Android Engineer | Kotlin and Jetpack Compose. |
| `kubernetes` | Kubernetes Engineer | Container orchestration. |
| `ml` | ML Engineer | Model design and training. |
| `mobile` | Mobile Engineer | Cross-platform mobile development. |
| `model-training` | ML Engineer | Train and validate models. |
| `modeling` | Data Scientist | Statistical and ML modeling. |
| `oauth` | Auth Engineer | OAuth flows and tokens. |
| `openapi` | API Engineer | OpenAPI specs and tooling. |
| `postgres` | Database Ops | PostgreSQL administration. |
| `react-native` | React Native Engineer | React Native cross-platform apps. |
| `redis` | Database Ops | Redis caching and state. |
| `rest` | API Engineer | RESTful APIs. |
| `sdk` | DevTools Engineer | Developer SDKs. |
| `swift` | iOS Engineer | Swift and SwiftUI. |
| `terraform` | Terraform Engineer | Infrastructure as code. |
| `unity` | Game Developer | Unity engine and C#. |
| `unreal` | Game Developer | Unreal Engine and Blueprints. |

### Knowledge (3)
| Skill | Owner agent | What it does |
|---|---|---|
| `chunking` | Document Analyst | Split documents into retrievable chunks. |
| `document-rag` | Document Analyst | Answer from uploaded documents with chunked retrieval. |
| `retrieval` | Document Analyst | Find the right passages fast. |

### Life (60)
| Skill | Owner agent | What it does |
|---|---|---|
| `beauty` | Beauty Advisor | Beauty routines. |
| `budgeting` | Finance Analyst | Money plans. |
| `career` | Career Coach | Growth and jobs. |
| `compliance` | Legal Guide | Rules and requirements. |
| `conflict` | Relationship Coach | Conflict resolution. |
| `context` | Historian | Why things happened. |
| `cooking` | Chef | Recipes and technique. |
| `counseling` | Counselor | Supportive listening. |
| `dating` | Dating Coach | Dating guidance. |
| `dating-profiles` | Dating Coach | Profile writing. |
| `decision-making` | Strategy Analyst | Options and tradeoffs. |
| `decluttering` | Home Organizer | Simplify spaces. |
| `drafting` | Negotiator | Offer and reply drafts. |
| `empathy` | Counselor | Understand feelings. |
| `events` | Event Planner | Event planning. |
| `fashion` | Fashion Stylist | Style guidance. |
| `feedback` | Interviewer | Constructive critique. |
| `fitness` | Fitness Trainer | Workout plans. |
| `gardening` | Gardener | Grow plants. |
| `guidance` | Parenting Guide | Practical advice. |
| `habits` | Health Coach | Build and keep routines. |
| `health` | Health Coach | Wellness guidance. |
| `history` | Historian | Timelines and context. |
| `interior-design` | Interior Designer | Room design. |
| `interview` | Career Coach | Interview prep. |
| `interviewing` | Interviewer | Practice interviews. |
| `itinerary` | Travel Planner | Day-by-day plans. |
| `legal` | Legal Guide | Plain-language law. |
| `listening` | Counselor | Active listening. |
| `logistics` | Event Planner | Event logistics. |
| `macros` | Nutritionist | Protein/carbs/fat. |
| `meals` | Nutritionist | Meal plans. |
| `meditation` | Meditation Coach | Meditation practice. |
| `mindfulness` | Meditation Coach | Present-moment focus. |
| `negotiation` | Negotiator | Deal strategy. |
| `nutrition` | Nutritionist | Food and macros. |
| `organization` | Home Organizer | Declutter and sort. |
| `parenting` | Parenting Guide | Family guidance. |
| `pet-training` | Pet Care Advisor | Train pets. |
| `pets` | Pet Care Advisor | Pet care. |
| `plain-language` | Legal Guide | Jargon-free explanation. |
| `plants` | Gardener | Plant care. |
| `practice` | Interviewer | Rehearsal rounds. |
| `progress` | Fitness Trainer | Track improvements. |
| `recipes` | Chef | Recipe development. |
| `relationships` | Relationship Coach | Partnership guidance. |
| `rest` | Sleep Coach | Recovery and rest. |
| `routines` | Parenting Guide | Daily structure. |
| `skincare` | Beauty Advisor | Skin routines. |
| `sleep` | Sleep Coach | Sleep routines. |
| `strategy` | Strategy Analyst | SWOT and planning. |
| `styling` | Interior Designer | Space styling. |
| `swot` | Strategy Analyst | Strengths/weaknesses/opps/threats. |
| `timelines` | Historian | Events in order. |
| `travel` | Travel Planner | Trip planning. |
| `vendors` | Wedding Planner | Vendor management. |
| `wardrobe` | Fashion Stylist | Wardrobe planning. |
| `weddings` | Wedding Planner | Wedding planning. |
| `wellness` | Health Coach | Balance and care. |
| `workouts` | Fitness Trainer | Exercises and sets. |

### Marketing (11)
| Skill | Owner agent | What it does |
|---|---|---|
| `community` | Community Manager | Community building. |
| `email-campaigns` | Lifecycle Marketer | Campaign sequences. |
| `funnels` | Growth Marketer | Conversion funnels. |
| `growth` | Growth Marketer | Growth loops. |
| `launches` | Product Marketer | Product launches. |
| `lifecycle` | Lifecycle Marketer | Customer lifecycle. |
| `messaging` | Product Marketer | Message hierarchy. |
| `moderation` | Community Manager | Moderate spaces. |
| `positioning` | Product Marketer | Market position. |
| `ranking-analytics` | SEO Specialist | Search analytics. |
| `seo-strategy` | SEO Specialist | Ranking strategy. |

### Math (9)
| Skill | Owner agent | What it does |
|---|---|---|
| `calculations` | Math Solver | Fast reliable numeric work. |
| `explanations` | Science Explainer | Clear scientific explanations. |
| `finance` | Finance Analyst | Budget, interest, returns, money math. |
| `latex` | Math Solver | Proper math typesetting in answers. |
| `math` | Math Solver | Arithmetic to calculus, solved precisely. |
| `science` | Science Explainer | Physics, chemistry, biology explanations. |
| `statistics` | Data Analyst | Mean, variance, regressions, significance. |
| `step-by-step` | Math Solver | Show every working step, not just the answer. |
| `visuals` | Science Explainer | Diagrams and visual aids. |

### Media (5)
| Skill | Owner agent | What it does |
|---|---|---|
| `frame-analysis` | Video Analyst | Inspect video frames for visual context. |
| `key-moments` | Video Analyst | Pinpoint pivotal timestamps. |
| `timestamped-captions` | Video Analyst | Captions with precise timecodes. |
| `video-transcript-analysis` | Video Analyst | Summarize and quote spoken content. |
| `visual-understanding` | Video Analyst | Describe what appears on screen. |

### Memory (11)
| Skill | Owner agent | What it does |
|---|---|---|
| `consolidation` | Memory Agent | Merge and prune old memories. |
| `context-compaction` | Context Manager | Compress old turns when context gets long. |
| `continuity` | Context Manager | Never lose the thread across turns. |
| `episodic-memory` | Archivist | Remember what happened in past sessions. |
| `facts` | Memory Agent | Durable facts about the user. |
| `forgetting-curve` | Archivist | Prune by importance × recency. |
| `memory` | Memory Agent | Store and recall user facts. |
| `memory-consolidation` | Archivist | Merge and summarize old memories. |
| `preferences` | Memory Agent | Learned "do it this way" rules. |
| `recall` | Memory Agent | Retrieve the right memories. |
| `rolling-summary` | Context Manager | Compact running summary of the whole conversation. |

### News (7)
| Skill | Owner agent | What it does |
|---|---|---|
| `briefing` | News Editor | Concise current-events summary. |
| `headlines` | News Scout | Top stories right now. |
| `news` | News Scout | Live headlines from free feeds. |
| `news-filtering` | News Filter | Keep relevant, recent stories. |
| `news-writing` | News Editor | Clean brief from headlines. |
| `relevance` | News Filter | Match stories to the request. |
| `rss` | News Scout | BBC/Google News style feeds. |

### Perception (10)
| Skill | Owner agent | What it does |
|---|---|---|
| `automation` | Navigator | Click, type, scroll programmatically. |
| `browser` | Navigator | Drive a real browser. |
| `browser-control` | Computer Use Agent | Numbered-element interactive control. |
| `click` | Computer Use Agent | Click elements by number. |
| `image-analysis` | Vision Agent | Describe photos and screenshots. |
| `navigation` | Navigator | Go to sites and pages. |
| `ocr` | Vision Agent | Read text from images. |
| `scrolling` | Computer Use Agent | Scroll through pages. |
| `typing` | Computer Use Agent | Type into inputs. |
| `vision` | Vision Agent | Understand images. |

### Platform (12)
| Skill | Owner agent | What it does |
|---|---|---|
| `chaos-injection` | Chaos Agent | Inject controlled failures to harden the system (test-only). |
| `local-llm-routing` | Offline Agent | Route to Ollama / llama.cpp when cloud providers are down. |
| `metrics-aggregation` | Observability Agent | Aggregate counters and gauges per task and provider. |
| `plugin-discovery` | Plugin Manager | Discover, validate and load external skill/tool packages. |
| `prompt-injection-detection` | Guardrail | Detect prompt injection, jailbreak and tool-abuse attempts. |
| `provider-health-scoring` | Observability Agent | Score provider availability from real call outcomes. |
| `safe-mode-enforcement` | Guardrail | Force read-only tools or abort a risky task with a clear reason. |
| `sandbox-lifecycle` | Sandbox Agent | Create, run, tear down and snapshot isolated workspaces. |
| `streaming-stt-tts` | Voice Orchestrator | Streaming speech-to-text, TTS selection, barge-in and wake-word. |
| `structured-tracing` | Observability Agent | OpenTelemetry-style trace spans with latency and status. |
| `workspace-isolation` | Concurrency Agent | Lock and isolate concurrent sessions so memory never bleeds. |
| `workspace-snapshot` | Sandbox Agent | Capture a workspace state for rollback or reuse. |

### Product (3)
| Skill | Owner agent | What it does |
|---|---|---|
| `acceptance-criteria` | Product Manager | Testable success checks. |
| `requirements` | Product Manager | What "done" means. |
| `scope` | Product Manager | What's in and out. |

### Productivity (14)
| Skill | Owner agent | What it does |
|---|---|---|
| `action-items` | Note Taker | Next steps. |
| `agendas` | Meeting Planner | Meeting plans. |
| `calendars` | Scheduler | Calendar blocks. |
| `email-triage` | Email Triage | Inbox zero. |
| `expenses` | Expense Tracker | Track spending. |
| `gtd` | Task Manager | Getting Things Done. |
| `inbox` | Email Triage | Inbox management. |
| `minutes` | Meeting Planner | Meeting notes. |
| `note-taking` | Note Taker | Capture ideas. |
| `priorities` | Task Manager | Priority sorting. |
| `receipts` | Expense Tracker | Receipt logging. |
| `scheduling` | Scheduler | Plan time. |
| `tasks` | Task Manager | Task lists. |
| `time-management` | Scheduler | Protect focus time. |

### Quality (3)
| Skill | Owner agent | What it does |
|---|---|---|
| `critical-review` | Critic | Strict critique of plans and outputs. |
| `output-quality` | Critic | Enforce readable, complete, correct output. |
| `self-consistency` | Critic | Cross-check the answer against itself. |

### Research (24)
| Skill | Owner agent | What it does |
|---|---|---|
| `aggregation` | Searcher | Merge results from many engines. |
| `anti-hallucination` | Fact Checker | Refuse to invent; say "not in sources". |
| `books` | Books Agent | Answer from the user's own books. |
| `citation` | Synthesizer | Attribute claims to sources. |
| `cleaning` | Extractor | Normalize extracted text. |
| `content-extraction` | Extractor | Strip ads and junk from pages. |
| `dedupe` | Re-ranker | Remove duplicate results. |
| `deep-research` | Researcher | Multi-pass study of a topic. |
| `fact-checking` | Fact Checker | Verify claims before they ship. |
| `fact-grounded` | Synthesizer | Answer only from gathered evidence. |
| `knowledge-base` | Researcher | Store and reuse studied knowledge. |
| `library-recall` | Books Agent | Search the saved knowledge library. |
| `multi-engine` | Searcher | Parallel SearXNG/DDG/Bing/Mojeek/arXiv. |
| `papers` | Scholar | Academic paper recall. |
| `query-expansion` | Query Analyzer | Turn a question into precise queries. |
| `quote` | Books Agent | Answer with exact passages. |
| `ranking` | Re-ranker | Sort results by quality. |
| `scraping` | Extractor | Pull readable content from pages. |
| `search-strategy` | Query Analyzer | Choose what to search and how. |
| `synthesis` | Synthesizer | Combine sources into one answer. |
| `topic-study` | Scholar | Turn a topic into saved notes. |
| `trusted-sources` | Re-ranker | Prefer .edu/.gov/wiki/arxiv/docs. |
| `verification` | Fact Checker | Confirm output against input. |
| `web-search` | Searcher | Multi-engine web search. |

### Safety (3)
| Skill | Owner agent | What it does |
|---|---|---|
| `guardrails` | Guardrail | Input/output safety checks. |
| `refusal` | Guardrail | Refuse with a reason, not a lecture. |
| `safety-checks` | Guardrail | Decline unsafe or destructive requests. |

### Security (24)
| Skill | Owner agent | What it does |
|---|---|---|
| `appsec` | Application Security Engineer | Application security. |
| `blue-team` | Blue Team Defender | Defense and detection. |
| `compliance` | Compliance Officer | Regulatory compliance. |
| `cryptography` | Cryptographer | Encryption and hashing. |
| `dast` | Application Security Engineer | Dynamic testing. |
| `data-protection` | Privacy Officer | Protect personal data. |
| `defense` | Blue Team Defender | Hardening and controls. |
| `encryption` | Cryptographer | Data at rest and in transit. |
| `evidence` | Forensic Analyst | Preserve and analyze evidence. |
| `exploitation` | Penetration Tester | Prove impact of a flaw. |
| `forensics` | Forensic Analyst | Digital forensics. |
| `gdpr` | Privacy Officer | GDPR compliance. |
| `hashing` | Cryptographer | Digests and passwords. |
| `iso` | Compliance Officer | ISO standards. |
| `mitigation` | Risk Analyst | Risk reduction plans. |
| `owasp` | Penetration Tester | OWASP Top 10 coverage. |
| `pentest` | Penetration Tester | Find exploitable weaknesses. |
| `privacy` | Privacy Officer | Data privacy practices. |
| `red-team` | Red Team Operator | Adversary simulation. |
| `sast` | Application Security Engineer | Static analysis. |
| `security-awareness` | Security Trainer | Training and policy. |
| `soc2` | Compliance Officer | SOC 2 readiness. |
| `social-engineering` | Red Team Operator | Human attack surfaces. |
| `threat-modeling` | Risk Analyst | Model attacker scenarios. |

### Teaching (13)
| Skill | Owner agent | What it does |
|---|---|---|
| `checking` | Tutor | Confirm the student got it. |
| `corrections` | Language Coach | Fix mistakes gently. |
| `curriculum` | Teacher | Learning paths. |
| `examples` | Coding Tutor | Worked examples. |
| `explanation` | Tutor | Clear analogies and examples. |
| `language-practice` | Language Coach | Conversation drills. |
| `learning-path` | Study Coach | Sequenced topics. |
| `lesson-planning` | Teacher | Structured lessons. |
| `notes` | Study Coach | Structured study notes. |
| `quizzes` | Teacher | Test understanding. |
| `study` | Study Coach | Study plans and notes. |
| `teaching` | Tutor | Explain so it sticks. |
| `vocabulary` | Language Coach | Word building. |

### Writing (45)
| Skill | Owner agent | What it does |
|---|---|---|
| `accuracy` | Technical Editor | Factual precision. |
| `adaptation` | Localization Specialist | Adapt content for audiences. |
| `ats` | Resume Writer | Applicant-system friendly. |
| `authority` | White Paper Writer | Expert credibility. |
| `blogs` | Blog Writer | Blog posts. |
| `captions` | Social Media Manager | Short punchy text. |
| `case-studies` | Case Study Writer | Customer proof. |
| `clarity` | Editor | Make it easy to read. |
| `compression` | Summarizer | Say more with less. |
| `consistency` | Proofreader | Same terms everywhere. |
| `content-calendar` | Social Media Manager | Plan posts ahead. |
| `copyediting` | Copyeditor | Line-level editing. |
| `copywriting` | Copywriter | Persuasive copy. |
| `cover-letter` | Resume Writer | Role-matched letters. |
| `culture` | Localization Specialist | Cultural context. |
| `documentation` | Technical Writer | READMEs and docs. |
| `editing` | Editor | Polish any text. |
| `email` | Email Composer | Compose effective emails. |
| `grammar` | Editor | Correct usage. |
| `handoff` | Shipper | Clean summary of finished work. |
| `headlines` | Copywriter | Grab attention fast. |
| `key-points` | Summarizer | Extract the essentials. |
| `localization` | Localization Specialist | Cultural adaptation. |
| `marketing` | Copywriter | Promotional language. |
| `microcopy` | UX Writer | Tiny UI text. |
| `objectivity` | Reporter | Neutral tone. |
| `outcomes` | Case Study Writer | Measured results. |
| `polish` | Proofreader | Final shine. |
| `posts` | Blog Writer | Web articles. |
| `professional-writing` | Email Composer | Work-appropriate tone. |
| `proofreading` | Proofreader | Typos and consistency. |
| `reflection-loop` | Translator | Draft → critique → revise. |
| `release-notes` | Shipper | What changed in a build. |
| `reporting` | Reporter | Who-what-when structure. |
| `resume` | Resume Writer | Resume tailoring. |
| `social-media` | Social Media Manager | Posts and captions. |
| `structure` | Reporter | Logical flow of sections. |
| `style-guides` | Copyeditor | Style compliance. |
| `summarization` | Summarizer | Condense without losing meaning. |
| `technical-editing` | Technical Editor | Edit technical text. |
| `technical-writing` | Technical Writer | Docs for technical products. |
| `translation` | Translator | Meaning-first translation. |
| `ui-text` | UX Writer | Interface language. |
| `white-papers` | White Paper Writer | Authority documents. |
| `writing` | Technical Writer | Clear, structured prose. |


## The 177 tools (grouped by type)

### Browser (6)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `browser-drive` | Computer Use Agent, Navigator | DesktopManager | Click, type, scroll, and interact with live numbered elements on a page. |
| `form-fill` | Computer Use Agent | DesktopManager | Fill inputs, pick options and submit forms on a page. |
| `link-open` | Navigator, Computer Use Agent | DesktopManager | Open a shared link in the real browser and summarize what it contains. |
| `page-text` | Computer Use Agent, Navigator | DesktopManager | Read all visible text on the current page. |
| `screenshot` | Vision Agent, Computer Use Agent | DesktopManager | Capture the current page or screen as an image. |
| `tab-manage` | Computer Use Agent, Navigator | DesktopManager | Open, switch and close browser tabs. |

### Business (10)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `business-plan-write` | Business Analyst, Startup Advisor, Financial Advisor | SkillChain | Write a full business plan with financials. |
| `crm-update` | CRM Specialist, Sales Representative | SkillChain | Structure leads and follow-up systems. |
| `grant-proposal` | Grant Writer, Business Analyst | SkillChain | Write grant applications and funding proposals. |
| `hire-pipeline` | Recruiter, HR Specialist | SkillChain | Design a hiring pipeline with screens. |
| `interview-guide` | Recruiter, Interviewer, HR Specialist | SkillChain | Build role-specific interview guides. |
| `onboarding-plan` | Customer Success Manager, HR Specialist | SkillChain | Design customer and employee onboarding. |
| `pitch-deck` | Startup Advisor, Product Marketer | SkillChain | Build investor pitch decks. |
| `pricing-model` | Pricing Strategist, Financial Advisor, Market Analyst | DataAgent | Build pricing tiers and revenue models. |
| `sales-outreach` | Sales Representative, Email Composer, CRM Specialist | SkillChain | Write outreach sequences that get replies. |
| `support-ticket` | Support Engineer, Customer Success Manager | SkillChain | Draft support replies and resolutions. |

### Chaos (1)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `inject_failure` | Chaos Agent | ChaosAgent | Inject a controlled failure (provider timeout, tool error) — only when the chaos flag is on. |

### Concurrency (3)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `acquire_lock` | Concurrency Agent, Memory Agent | ConcurrencyAgent | Take a named lock so concurrent sessions cannot write the same memory. |
| `get_workspace_id` | Concurrency Agent, Memory Agent | ConcurrencyAgent | Return the current session/workspace ID for isolation checks. |
| `release_lock` | Concurrency Agent, Memory Agent | ConcurrencyAgent | Release a previously acquired named lock. |

### Connectors (1)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `connector-call` | JEXI Core, GitHub Agent, Email Composer, Context Manager | Connectors | Send an outbound action or read inbound events through a registered connector (github, email) — send_email, create_github_issue, send_email, create_github_file. |

### Creative (6)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `essay-write` | Essayist, Academic Writer | SkillChain | Write argument-driven essays. |
| `image-generate` | Illustrator, Ad Copywriter | LLMClient | Generate or edit images from a description. |
| `lyrics-write` | Songwriter | SkillChain | Write song lyrics with structure and rhyme. |
| `poem-write` | Poet | SkillChain | Write poems in any style. |
| `script-write` | Screenwriter, Video Script Writer | SkillChain | Write screenplays and video scripts. |
| `speech-write` | Speech Writer, Ghostwriter | SkillChain | Write speeches with rhetoric that lands. |

### Data (17)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `api-call` | Web Scraper, Data Engineer | fetch | Call and parse an external JSON/REST API. |
| `chart-builder` | Data Visualizer, Data Analyst, Data Engineer | DataAgent | Turn numbers into clear charts and dashboards. |
| `data-clean` | Data Engineer, Data Quality Engineer | DataAgent | Clean messy data: missing values, dupes, types, outliers. |
| `data-crunch` | Data Analyst, Data Engineer, SQL Analyst, Math Solver | DataAgent | Compute real statistics, aggregates and numbers from data. |
| `data-load` | Data Engineer, Data Analyst | DataAgent | Load data from files, URLs or APIs into a workable shape. |
| `data-merge` | Data Engineer, Data Analyst | DataAgent | Join and merge datasets correctly. |
| `data-transform` | Data Engineer | DataAgent | Transform data between shapes and formats. |
| `db-query` | SQL Analyst, Database Ops, Database Administrator | DataAgent | Write and run database queries safely. |
| `db-schema` | Database Architect, Database Ops, Data Engineer | DataAgent | Design schemas, indexes and constraints. |
| `eval-run` | Data Scientist, ML Engineer | Runner | Run benchmarks and quality evaluations. |
| `kpi-track` | BI Analyst, Reporting Analyst, Market Analyst | DataAgent | Define and track KPIs over time. |
| `model-train` | ML Engineer, Data Scientist, MLOps Engineer | SkillChain | Train, fine-tune or evaluate a machine-learning model. |
| `redis-ops` | Database Ops, Memory Agent | MemoryManager | Manage Redis keys, caching and state. |
| `report-generate` | Reporting Analyst, BI Analyst, Data Visualizer | DataAgent | Turn data into a structured report with charts. |
| `schema-migrate` | Database Architect, Database Ops, Data Engineer | DataAgent | Plan and write safe migrations. |
| `stats-compute` | Data Analyst, Data Scientist, SQL Analyst | DataAgent | Compute statistics, correlations and significance. |
| `xlsx-write` | Data Analyst, BI Analyst, Finance Analyst | DataAgent | Create and analyze spreadsheets. |

### DevOps (7)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `backup-plan` | Backup Engineer, Site Reliability Engineer, Database Ops | SkillChain | Design backups and restore drills that actually work. |
| `ci-pipeline` | CI Engineer, DevOps Agent | DevOpsAgent | Write CI/CD pipelines that build, test and ship. |
| `cloud-cost` | Cloud Cost Optimizer, Financial Advisor | DataAgent | Estimate and optimize cloud spend. |
| `deploy-config` | DevOps Agent, Cloud Engineer, Terraform Engineer | DevOpsAgent | Generate deploy configs: render.yaml, vercel.json, nginx, systemd. |
| `dockerfile-write` | DevOps Agent, Kubernetes Engineer | DevOpsAgent | Write and optimize a Dockerfile for the project. |
| `incident-runbook` | Site Reliability Engineer, Incident Commander, Blue Team Defender | SkillChain | Write runbooks for known failure modes. |
| `infra-plan` | Terraform Engineer, Cloud Engineer, Site Reliability Engineer | DevOpsAgent | Design infrastructure-as-code: Terraform, cloud resources, networking. |

### DevTools (6)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `branch-manage` | GitHub Agent | GitHubAgent | Create, merge and clean up branches. |
| `git-status` | GitHub Agent | GitHubAgent | Inspect repo status, branches and diffs. |
| `github-cli` | GitHub Agent | GitHubAgent | Run the real gh/git CLI: commit, push, PRs and issues. |
| `issue-track` | GitHub Agent | GitHubAgent | Create, list and manage GitHub issues. |
| `pr-review` | GitHub Agent, Reviewer | GitHubAgent | Review an open pull request with a verdict and comments. |
| `preview-server` | DevOps Agent, GitHub Agent | Runner | Spin up a live preview of a built app. |

### Education (9)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `citation-format` | Academic Writer, Research Mentor | SkillChain | Format citations in any style. |
| `curriculum-build` | Curriculum Designer, Teacher | SkillChain | Design curricula aligned to standards. |
| `exam-prep-plan` | Exam Coach, Study Coach, Teacher | SkillChain | Build exam prep plans and drills. |
| `flashcard-generate` | Flashcard Maker, Teacher | SkillChain | Generate flashcard decks with spaced repetition. |
| `homework-solve` | Homework Helper, Tutor, Math Solver | SkillChain | Work through homework with explanations. |
| `lab-safety` | Lab Assistant, Science Explainer | SkillChain | Plan experiments with safety checks. |
| `quiz-generate` | Teacher, Exam Coach | SkillChain | Generate quizzes and practice tests. |
| `rubric-grade` | Grader, Teacher | SkillChain | Grade work against a rubric with feedback. |
| `thesis-support` | Research Mentor, Academic Writer, Scholar | SkillChain | Support thesis structure, research and writing. |

### Execution (3)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `code-fix` | Debugger, Coder | Architect.applyFix | Apply a fix to failing code and re-run until it is clean. |
| `code-run` | Runner, Debugger, Coder, QA Lead | Runner | Execute generated code and capture real stdout and errors. |
| `code-write` | Architect, Coder, Technical Writer, Shipper, Backend Engineer, Frontend Engineer | Architect | Generate and write project files into the workspace. |

### Guardrail (2)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `force_safe_mode` | Guardrail, Security Officer | GuardrailAgent | Restrict the task to read-only tools or abort with a clear explanation. |
| `scan_prompt_safety` | Guardrail, Security Officer | GuardrailAgent | Scan a prompt for injection, jailbreak or tool-abuse attempts. |

### Knowledge (7)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `book-fetch` | Books Agent, Scholar | TrustedLibrary | Fetch a free public-domain book or paper from the trusted library. |
| `book-library` | Books Agent, Scholar | BookLibrary | Answer strictly from the user's own uploaded books with citations and quotes. |
| `document-rag` | Document Analyst, Books Agent | MemoryManager/knowledge | Chunk uploaded documents and answer from the retrieved passages. |
| `knowledge-index` | Researcher, Document Analyst, Scholar | MemoryManager | Index studied material so recall is instant and complete. |
| `knowledge-load` | JEXI Core, Context Manager, Archivist, Coder, Engineer, Researcher | KnowledgeBase | Load a progressive project-knowledge folder (e.g. conventions, architecture) on demand — the always-on JEXI.md only carries pointers. |
| `knowledge-save` | Researcher, Study Coach, Scholar, Document Analyst | MemoryManager | Save studied topics and notes into the knowledge library. |
| `knowledge-search` | Books Agent, Scholar, Researcher, Document Analyst | MemoryManager | Search the saved knowledge library and studied topics. |

### Language (1)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `translate` | Translator, Localization Specialist | LLMClient | Translate text with a draft → critique → revise reflection loop. |

### Life (15)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `counseling-session` | Counselor | SkillChain | Empathetic guided conversation and reflection. |
| `dating-profile` | Dating Coach | SkillChain | Write dating profiles that stand out. |
| `event-plan` | Event Planner, Wedding Planner, Travel Planner | SkillChain | Plan events with budgets and logistics. |
| `garden-plan` | Gardener | SkillChain | Plan gardens and plant care. |
| `home-org-plan` | Home Organizer, Interior Designer | SkillChain | Declutter and organize spaces. |
| `meal-plan` | Nutritionist, Chef, Health Coach | SkillChain | Build meal plans from preferences and goals. |
| `meditation-guide` | Meditation Coach | SkillChain | Guide meditation and breathing sessions. |
| `pet-care-guide` | Pet Care Advisor | SkillChain | Care and training plans for pets. |
| `relationship-advice` | Relationship Coach, Counselor | SkillChain | Advice for communication and conflict. |
| `room-design` | Interior Designer, Fashion Stylist | SkillChain | Design room layouts and styling. |
| `skincare-routine` | Beauty Advisor | SkillChain | Build skincare and beauty routines. |
| `sleep-plan` | Sleep Coach, Health Coach | SkillChain | Design sleep routines and wind-downs. |
| `wardrobe-plan` | Fashion Stylist | SkillChain | Plan a wardrobe and personal style. |
| `wedding-plan` | Wedding Planner, Event Planner | SkillChain | Plan weddings with vendors and timelines. |
| `workout-plan` | Fitness Trainer, Health Coach, Nutritionist | SkillChain | Build workout plans and progress tracking. |

### Marketing (4)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `ad-copy-generate` | Ad Copywriter, Copywriter | SkillChain | Write ad variations that convert. |
| `caption-write` | Social Media Manager, Ad Copywriter | SkillChain | Write punchy captions and hashtags. |
| `seo-optimize` | SEO Specialist, SEO Writer, Blog Writer | SkillChain | Optimize content to rank and convert. |
| `social-schedule` | Social Media Manager, Community Manager | SkillChain | Plan and schedule social posts. |

### MCP (1)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `mcp-call` | JEXI Core, Context Manager, Memory Agent | MCPServer | Call an external MCP tool (ask_jexi, memory_lookup, knowledge_search, list_books, get_health) with schema-validated args. |

### Media (3)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `video-analyze` | Video Analyst | VideoAnalyzer | Watch any video link frame-by-frame: timestamped captions, sampled frames, key moments. |
| `video-frames` | Video Analyst, Vision Agent | VideoAnalyzer | Sample visual frames across a video timeline for vision analysis. |
| `video-transcript` | Video Analyst | VideoAnalyzer | Pull the full timestamped transcript of a YouTube/TikTok/Instagram video. |

### Memory (11)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `episode-recall` | Archivist, Context Manager, Memory Agent | MemoryManager | Remember what happened in past sessions, not just the last few turns. |
| `episode-save` | Archivist, Memory Agent | MemoryManager | Save the current session as an episode for future recall. |
| `memory-clear` | Memory Agent | MemoryManager | Wipe all or selected parts of the memory core. |
| `memory-recall` | Memory Agent, JEXI Core, Context Manager, Archivist | MemoryManager | Retrieve facts, preferences, learned answers and prior research from the memory core. |
| `memory-write` | Memory Agent, Archivist | MemoryManager | Store durable facts, preferences and learned answers. |
| `preference-learn` | Memory Agent, Context Manager | PreferenceLearner | Extract and store "do it this way" preferences from an exchange. |
| `profile-read` | Memory Agent, JEXI Core | MemoryManager | Read the stored user profile: name, facts, preferences. |
| `rolling-summary` | Context Manager, JEXI Core, Archivist | MemoryManager | Keep a compact running summary of the whole conversation so nothing is forgotten. |
| `semantic-search` | Memory Agent, Document Analyst, Researcher | MemoryManager | Hybrid vector + keyword search across all memories. |
| `study-notes` | Study Coach, Researcher, Teacher | MemoryManager | Create structured study notes saved to the knowledge library. |
| `vector-embed` | Memory Agent, Document Analyst | LLMClient | Embed a memory so semantic recall can find it. |

### Observability (3)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `emit_metric` | Observability Agent | ObservabilityAgent | Record a counter or gauge (latency, tokens, gate results) into the metrics store. |
| `end_trace` | Observability Agent | ObservabilityAgent | Close a trace span, recording duration and success/failure. |
| `start_trace` | Observability Agent | ObservabilityAgent | Open an OpenTelemetry-style trace span for a task with latency and status tracking. |

### Offline (3)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `list_local_models` | Offline Agent | OfflineAgent | List models available on the local LLM backend. |
| `query_local_llm` | Offline Agent | OfflineAgent | Ask a local LLM backend (Ollama / llama.cpp) for an answer. |
| `warmup_model` | Offline Agent | OfflineAgent | Pre-load a local model so later queries are fast. |

### Perception (3)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `audio-transcribe` | Podcaster, Reporter, Document Analyst | LLMClient | Transcribe spoken audio to text. |
| `ocr-read` | Vision Agent | Gemini vision | Extract text from an image or screenshot. |
| `vision-analyze` | Vision Agent | Gemini/Groq vision | Analyze images: describe, OCR text, and solve what is shown. |

### Plugin (3)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `list_plugins` | Plugin Manager | PluginAgent | List loaded plugins with their versions and capabilities. |
| `load_plugin` | Plugin Manager | PluginAgent | Validate and load an external skill/tool plugin package. |
| `unload_plugin` | Plugin Manager | PluginAgent | Unload a plugin and remove its tools from the registry. |

### Productivity (6)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `expense-log` | Expense Tracker, Finance Analyst | DataAgent | Track expenses and budgets. |
| `inbox-triage` | Email Triage, Email Composer | SkillChain | Triage email and draft replies. |
| `meeting-minutes` | Meeting Planner, Note Taker, Reporter | SkillChain | Write agendas and minutes with action items. |
| `notes-organize` | Note Taker, Study Coach | MemoryManager | Organize notes and action items. |
| `schedule-plan` | Scheduler, Task Manager, Executive Assistant | SkillChain | Plan days, weeks and calendars. |
| `task-board` | Task Manager, Scheduler | SkillChain | Build task lists and priority boards. |

### Quality (8)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `build-check` | Runner, QA Lead, Coder | Runner | Build the project and verify it compiles cleanly. |
| `code-review` | Reviewer, Critic, Security Officer | SkillChain | Review the code with APPROVED / CHANGES-REQUESTED verdict. |
| `dependency-audit` | Security Officer, Reviewer | SkillChain | Audit dependencies for known vulnerabilities and drift. |
| `fact-check` | Fact Checker, Critic | VerificationLoop | Audit an answer against its sources and revise invented or unsupported claims. |
| `lint-check` | Coder, Reviewer | Runner | Run linters and static checks and fix what they flag. |
| `security-scan` | Security Officer, Guardrail | SkillChain | OWASP-class vulnerability review with CLEARED / BLOCKED verdict. |
| `self-consistency` | Critic, Reasoner | VerificationLoop | Cross-check the answer against itself and the task before it ships. |
| `test-automation` | QA Lead, Reviewer | Runner | Generate and run automated tests (unit, integration, E2E) for the code. |

### Research (9)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `arxiv-search` | Scholar, Researcher | SearchEngine | Search academic papers on arXiv. |
| `competitor-scan` | Market Analyst, SEO Specialist | SearchEngine | Analyze competitors: positioning, pricing, strengths, gaps. |
| `deep-read` | Extractor, Scholar, Researcher | Extractor | Open a URL server-side and extract its real content (strip ads, keep the text). |
| `market-research` | Market Analyst, Researcher | SearchEngine | Size a market, estimate demand and map the landscape. |
| `news-feed` | News Scout, News Filter | NewsAgent | Fetch live headlines from free RSS feeds (Google News, BBC) and dedupe them. |
| `pdf-extract` | Document Analyst, Extractor, Scholar | Extractor | Parse a PDF and extract its text for reading or indexing. |
| `trend-scan` | News Filter, Market Analyst, Researcher | NewsAgent | Detect rising topics and trending themes from feeds and searches. |
| `trusted-library` | Scholar, Researcher, News Scout | TrustedLibrary | Read free, trusted books, papers and overviews (Wikipedia, Gutenberg, arXiv, Open Library). |
| `wikipedia-lookup` | Scholar, Searcher, Researcher | SearchEngine | Pull the trusted overview for any topic. |

### Sandbox (4)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `create_sandbox` | Sandbox Agent, Runner | SandboxAgent | Create an isolated execution workspace with CPU/memory/timeout limits. |
| `destroy_sandbox` | Sandbox Agent, Runner | SandboxAgent | Tear down a sandbox workspace and release its resources. |
| `run_in_sandbox` | Sandbox Agent, Runner | SandboxAgent | Execute a command inside an isolated workspace with strict limits. |
| `snapshot_workspace` | Sandbox Agent | SandboxAgent | Capture a workspace state for rollback or reuse. |

### Search (1)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `web-search` | Searcher, Query Analyzer, Researcher, News Scout, Fact Checker | SearchEngine | Search multiple engines (SearXNG, DDG, Bing, Mojeek, Wikipedia, arXiv) and rank trusted sources. |

### Security (8)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `auth-audit` | Auth Engineer, Application Security Engineer | SkillChain | Audit auth flows: sessions, tokens, permissions. |
| `code-sast` | Application Security Engineer | SkillChain | Run static analysis for security defects. |
| `compliance-check` | Compliance Officer, Privacy Officer, Legal Guide | SkillChain | Check against standards: GDPR, ISO, SOC 2. |
| `crypt-check` | Cryptographer, Application Security Engineer | SkillChain | Review encryption and hashing choices. |
| `privacy-review` | Privacy Officer, Legal Guide | SkillChain | Review data flows and privacy posture. |
| `secrets-scan` | Application Security Engineer, Guardrail | SkillChain | Scan for leaked keys, tokens and credentials. |
| `threat-model` | Risk Analyst, Penetration Tester | SkillChain | Model attack surfaces and rank risks. |
| `vuln-scan` | Application Security Engineer, Penetration Tester | SkillChain | Scan an app or repo for exploitable vulnerabilities. |

### System (2)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `self-diagnose` | Self-Diagnose | SelfMonitor | Read own health, memory, errors and source code to report root causes. |
| `settings` | JEXI Core, Context Manager | SettingsManager | Read and update JEXI's settings and provider keys. |

### Voice (4)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `listen` | Voice Orchestrator | VoiceAgent | Capture the next utterance and transcribe it. |
| `speak` | Voice Orchestrator | VoiceAgent | Synthesize and play TTS audio for a message. |
| `start_voice_stream` | Voice Orchestrator | VoiceAgent | Begin a streaming speech-to-text session with barge-in enabled. |
| `stop_voice_stream` | Voice Orchestrator | VoiceAgent | End the active speech stream cleanly. |

### Writing (10)
| Tool | Allowed agents | Engine | What it does |
|---|---|---|---|
| `blog-write` | Blog Writer, Technical Writer | SkillChain | Write blog posts and articles. |
| `case-study-write` | Case Study Writer, Customer Success Manager | SkillChain | Write customer stories with outcomes. |
| `changelog-write` | Release Engineer, Technical Writer | WriterAgent | Write release notes and changelogs from git history. |
| `docx-write` | Technical Writer, Document Analyst | SkillChain | Create and edit Word documents. |
| `email-draft` | Email Composer, Sales Representative, Support Engineer | SkillChain | Draft effective emails for any audience. |
| `newsletter-compose` | Newsletter Writer, Product Marketer | SkillChain | Compose newsletters people open. |
| `pptx-write` | Technical Writer, Product Marketer | SkillChain | Create presentation decks. |
| `proofread-text` | Proofreader, Editor, Copyeditor | SkillChain | Fix typos, grammar and consistency. |
| `summarize-doc` | Summarizer, Editor, Reporter | Summarizer | Compress long content into precise summaries. |
| `white-paper-write` | White Paper Writer, Researcher | SkillChain | Write long-form authority documents. |


---
## Compound-task phases (research/news first, then build)

- **The user wants something built from fresh news — the News Team gathers first, then the Coding Team builds on that context.** — phases: News Team (News Scout, News Filter, News Editor, Reasoner) → Coding Team (Product, Designer, Engineer, Coder, Runner, Debugger, QA Lead, Reviewer, Security Officer, Shipper, Reflector)
- **The user wants an app whose content needs research first — Research gathers facts, then the Coding Team builds on them.** — phases: Research Team (Query Analyzer, Searcher, Re-ranker, Extractor, Synthesizer) → Coding Team (Product, Designer, Engineer, Coder, Runner, Debugger, QA Lead, Reviewer, Security Officer, Shipper, Reflector)
- **The user wants RESEARCH first, then the findings APPLIED/built on top — the Research Team gathers, then the Coding Team applies it.** — phases: Research Team (Query Analyzer, Searcher, Re-ranker, Extractor, Synthesizer) → Coding Team (Product, Designer, Engineer, Coder, Runner, Debugger, QA Lead, Reviewer, Security Officer, Shipper, Reflector)
