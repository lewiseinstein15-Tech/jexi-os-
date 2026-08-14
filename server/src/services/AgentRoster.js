/**
 * JEXI OS — Agent Roster & Skill Registry.
 *
 * The full specialist catalog (60+) and skill library (100+) JEXI can draw
 * from. Mirrors the architecture used by Atomic Agents (role catalog + context
 * providers), CrewAI (role-based crews) and MetaGPT (SOP teams): the catalog
 * is LARGE but the Planner composes only the small subset a task needs — that
 * is how pro systems run 60+ agents "without sweating". None of these run all
 * at once; composeTeam() picks the right specialists per intent.
 *
 * Roster entries route to real, implemented JEXI services (Reasoner,
 * SearchAgent, SkillChain, …) — each specialist is a focused mandate with its
 * own prompt, and several specialists can share one engine with different
 * instructions (the Atomic Agents "atomic" pattern).
 */

import { TEAM_PLAN } from './Planner.js'; // single team map — composeTeam delegates to it (B49 P1/P3)

/** Agent roster: slug → mandate + the skills that specialist masters. */
export const AGENT_ROSTER = [
  // ── Core brain ──────────────────────────────────────────────
  { slug: 'planner', name: 'Planner', role: 'Classifies every request and composes the right team before anything runs.', skills: ['intent-detection', 'team-composition', 'task-decomposition'] },
  { slug: 'orchestrator', name: 'Orchestrator', role: 'Runs the chosen specialists one-by-one, enforcing strict handoffs and gates.', skills: ['pipeline-execution', 'gates', 'handoff'] },
  { slug: 'jexi', name: 'JEXI Core', role: 'Identity, conversation, and the system prompt every agent inherits.', skills: ['conversation', 'identity', 'system-prompt'] },
  { slug: 'reasoner', name: 'Reasoner', role: 'Structured reasoning, math solving, and final-answer synthesis.', skills: ['reasoning', 'math', 'latex', 'synthesis'] },
  { slug: 'reflector', name: 'Reflector', role: 'Retrospective after each mission — what worked, what to remember.', skills: ['reflection', 'retrospective'] },

  // ── Product & design team ───────────────────────────────────
  { slug: 'product', name: 'Product Manager', role: 'Requirements, scope modes, success criteria, user stories.', skills: ['requirements', 'scope', 'acceptance-criteria'] },
  { slug: 'designer', name: 'Designer', role: 'UI/UX design system, layouts, visual spec.', skills: ['ui-design', 'ux', 'design-system', 'layout'] },
  { slug: 'ux-researcher', name: 'UX Researcher', role: 'User research, personas, journey maps, usability insight.', skills: ['user-research', 'personas', 'journey-mapping'] },
  { slug: 'brand', name: 'Brand Strategist', role: 'Naming, voice, tone, visual identity guidelines.', skills: ['branding', 'voice-tone', 'identity'] },
  { slug: 'accessibility', name: 'Accessibility Auditor', role: 'WCAG review, contrast, keyboard nav, screen-reader passes.', skills: ['a11y', 'wcag', 'contrast'] },

  // ── Engineering team ────────────────────────────────────────
  { slug: 'engineer', name: 'Engineer', role: 'Architecture, build plan, technical approach.', skills: ['architecture', 'tech-design', 'estimation'] },
  { slug: 'architect', name: 'Architect', role: 'Generates project structure and code from the plan.', skills: ['code-generation', 'project-structure'] },
  { slug: 'coder', name: 'Coder', role: 'Writes actual code, fixes debug loops.', skills: ['coding', 'debugging', 'refactoring'] },
  { slug: 'runner', name: 'Runner', role: 'Executes the code, captures real output and errors.', skills: ['execution', 'sandbox', 'output-capture'] },
  { slug: 'debugger', name: 'Debugger', role: 'Reads errors and applies fixes until it runs clean.', skills: ['error-analysis', 'fix-loop', 'root-cause'] },
  { slug: 'qa', name: 'QA Lead', role: 'Runs the app, verifies against spec, PASS/FAIL gate.', skills: ['testing', 'verification', 'qa-gate'] },
  { slug: 'reviewer', name: 'Reviewer', role: 'Code review with APPROVED / CHANGES-REQUESTED gate.', skills: ['code-review', 'best-practices', 'review-gate'] },
  { slug: 'security', name: 'Security Officer', role: 'Security review with CLEARED / FLAGGED gate.', skills: ['security', 'vulnerability-scan', 'security-gate'] },
  { slug: 'shipper', name: 'Shipper', role: 'Release notes, handoff summary, final report.', skills: ['release-notes', 'handoff', 'documentation'] },
  { slug: 'perf', name: 'Performance Engineer', role: 'Measures and fixes speed, memory, and bundle issues.', skills: ['performance', 'profiling', 'optimization'] },
  { slug: 'devops', name: 'DevOps Agent', role: 'Deploy config, Dockerfile, CI/CD, infrastructure.', skills: ['deployment', 'docker', 'ci-cd', 'infrastructure'] },
  { slug: 'github', name: 'GitHub Agent', role: 'Commit, push, PRs, issues — real gh/git CLI.', skills: ['git', 'github', 'pull-requests', 'issues'] },
  { slug: 'data', name: 'Data Analyst', role: 'Data analysis, statistics, charts, insight.', skills: ['data-analysis', 'statistics', 'charting', 'insights'] },
  { slug: 'database', name: 'Database Architect', role: 'Schema design, queries, migrations, indexing.', skills: ['sql', 'schema', 'migrations', 'indexing'] },
  { slug: 'frontend', name: 'Frontend Engineer', role: 'Component builds, responsive layout, styling.', skills: ['frontend', 'react', 'css', 'responsive'] },
  { slug: 'backend', name: 'Backend Engineer', role: 'APIs, routes, middleware, auth, server logic.', skills: ['backend', 'api', 'auth', 'server'] },

  // ── Research & knowledge team ───────────────────────────────
  { slug: 'query-analyzer', name: 'Query Analyzer', role: 'Splits a research question into precise search queries.', skills: ['query-expansion', 'search-strategy'] },
  { slug: 'searcher', name: 'Searcher', role: 'Aggregates results from SearXNG, DDG, Bing, Mojeek, Wikipedia, arXiv.', skills: ['web-search', 'multi-engine', 'aggregation'] },
  { slug: 'reranker', name: 'Re-ranker', role: 'Trusted-source ranking, spam filtering, dedupe.', skills: ['ranking', 'trusted-sources', 'dedupe'] },
  { slug: 'extractor', name: 'Extractor', role: 'Deep-reads pages and pulls out the real content.', skills: ['scraping', 'content-extraction', 'cleaning'] },
  { slug: 'synthesizer', name: 'Synthesizer', role: 'Combines sources into a grounded answer with citations.', skills: ['synthesis', 'citation', 'fact-grounded'] },
  { slug: 'researcher', name: 'Researcher', role: 'Deep study of a topic into the knowledge library.', skills: ['deep-research', 'knowledge-base', 'topic-study'] },
  { slug: 'scholar', name: 'Scholar', role: 'Trusted books, papers and knowledge-library recall.', skills: ['books', 'papers', 'library-recall'] },
  { slug: 'fact-checker', name: 'Fact Checker', role: 'Verifies claims against sources before an answer ships.', skills: ['fact-checking', 'verification', 'anti-hallucination'] },
  { slug: 'news-scout', name: 'News Scout', role: 'Fetches live headlines from free feeds.', skills: ['news', 'rss', 'headlines'] },
  { slug: 'news-filter', name: 'News Filter', role: 'Dedupe and rank stories by relevance and recency.', skills: ['news-filtering', 'dedupe', 'relevance'] },
  { slug: 'news-editor', name: 'News Editor', role: 'Writes the final brief from verified headlines.', skills: ['news-writing', 'briefing', 'summarization'] },

  // ── Memory team ─────────────────────────────────────────────
  { slug: 'memory', name: 'Memory Agent', role: 'Long-term memory: facts, preferences, tf-idf scoring, consolidation.', skills: ['memory', 'facts', 'preferences', 'consolidation', 'recall'] },
  { slug: 'books', name: 'Books Agent', role: 'Answers strictly from the user\'s own books and library with citations.', skills: ['books', 'citation', 'quote'] },

  // ── Perception team ─────────────────────────────────────────
  { slug: 'vision', name: 'Vision Agent', role: 'Image analysis — describe, read text, solve from photos.', skills: ['vision', 'ocr', 'image-analysis'] },
  { slug: 'navigator', name: 'Navigator', role: 'Drives the browser — navigate, click, type, scroll.', skills: ['browser', 'navigation', 'automation'] },
  { slug: 'computer-use', name: 'Computer Use Agent', role: 'Interactive browser control with numbered elements.', skills: ['browser-control', 'click', 'typing', 'scrolling'] },

  // ── Writing & language team ─────────────────────────────────
  { slug: 'writer', name: 'Technical Writer', role: 'Long-form writing: READMEs, docs, guides, reports.', skills: ['writing', 'documentation', 'technical-writing'] },
  { slug: 'translator', name: 'Translator', role: 'Meaning-first translation with a reflection loop.', skills: ['translation', 'localization', 'reflection-loop'] },
  { slug: 'copywriter', name: 'Copywriter', role: 'Marketing copy, headlines, product descriptions.', skills: ['copywriting', 'marketing', 'headlines'] },
  { slug: 'editor', name: 'Editor', role: 'Clarity, grammar, tone, and structure pass over any text.', skills: ['editing', 'grammar', 'clarity'] },
  { slug: 'summarizer', name: 'Summarizer', role: 'Compresses long content into precise summaries.', skills: ['summarization', 'compression', 'key-points'] },
  { slug: 'reporter', name: 'Reporter', role: 'Structured news/report style writing with who-what-when.', skills: ['reporting', 'structure', 'objectivity'] },

  // ── Specialist ops ──────────────────────────────────────────
  { slug: 'self-diagnose', name: 'Self-Diagnose', role: 'Reads own health, memory, errors, and source to report root causes.', skills: ['self-check', 'diagnostics', 'root-cause'] },
  { slug: 'math', name: 'Math Solver', role: 'LaTeX-structured math solving with given/formula/working/final.', skills: ['math', 'latex', 'step-by-step'] },
  { slug: 'study', name: 'Study Coach', role: 'Turns topics into structured, saved study notes.', skills: ['study', 'notes', 'learning-path'] },
  { slug: 'tutor', name: 'Tutor', role: 'Explains concepts simply, checks understanding, adapts.', skills: ['teaching', 'explanation', 'checking'] },
  { slug: 'strategist', name: 'Strategy Analyst', role: 'Frameworks, SWOT, decision analysis, planning.', skills: ['strategy', 'swot', 'decision-making'] },
  { slug: 'finance', name: 'Finance Analyst', role: 'Budgeting, financial calculations, money questions.', skills: ['finance', 'budgeting', 'calculations'] },
  { slug: 'health', name: 'Health Coach', role: 'Wellness, habits, trackers, routines.', skills: ['health', 'habits', 'wellness'] },
  { slug: 'career', name: 'Career Coach', role: 'Resumes, interviews, job search, growth plans.', skills: ['career', 'resume', 'interview'] },
  { slug: 'teacher', name: 'Teacher', role: 'Lesson plans, quizzes, curriculum building.', skills: ['lesson-planning', 'quizzes', 'curriculum'] },
  { slug: 'resume', name: 'Resume Writer', role: 'Tailors resumes and cover letters to roles.', skills: ['resume', 'cover-letter', 'ats'] },
  { slug: 'social', name: 'Social Media Manager', role: 'Post ideas, captions, hashtags, content calendar.', skills: ['social-media', 'captions', 'content-calendar'] },
  { slug: 'email', name: 'Email Composer', role: 'Professional, warm, or persuasive emails.', skills: ['email', 'professional-writing'] },
  { slug: 'legal', name: 'Legal Guide', role: 'Plain-language legal explanations and document checks.', skills: ['legal', 'compliance', 'plain-language'] },
  { slug: 'travel', name: 'Travel Planner', role: 'Itineraries, budgets, must-see lists.', skills: ['travel', 'itinerary', 'budgeting'] },
  { slug: 'fitness', name: 'Fitness Trainer', role: 'Workout plans, form guidance, progress tracking.', skills: ['fitness', 'workouts', 'progress'] },
  { slug: 'nutrition', name: 'Nutritionist', role: 'Meal plans, macros, dietary advice.', skills: ['nutrition', 'meals', 'macros'] },
  { slug: 'languages', name: 'Language Coach', role: 'Practice, drills, vocabulary, corrections.', skills: ['language-practice', 'vocabulary', 'corrections'] },
  { slug: 'parenting', name: 'Parenting Guide', role: 'Family advice, routines, age-appropriate guidance.', skills: ['parenting', 'routines', 'guidance'] },
  { slug: 'history', name: 'Historian', role: 'Timelines, context, primary-source awareness.', skills: ['history', 'timelines', 'context'] },
  { slug: 'science', name: 'Science Explainer', role: 'Physics, chemistry, biology — accurate, visual explanations.', skills: ['science', 'explanations', 'visuals'] },
  { slug: 'coding-tutor', name: 'Coding Tutor', role: 'Teaches programming step-by-step with examples.', skills: ['coding', 'teaching', 'examples'] },
  { slug: 'interviewer', name: 'Interviewer', role: 'Conducts practice interviews and gives feedback.', skills: ['interviewing', 'feedback', 'practice'] },
  { slug: 'negotiator', name: 'Negotiator', role: 'Drafting offers, replies, and negotiation strategy.', skills: ['negotiation', 'drafting', 'strategy'] },
  { slug: 'proofreader', name: 'Proofreader', role: 'Typos, punctuation, consistency checks.', skills: ['proofreading', 'consistency', 'polish'] },
  { slug: 'translator-v2', name: 'Localization Specialist', role: 'Adapts content for regions and cultures, not just words.', skills: ['localization', 'culture', 'adaptation'] },
  { slug: 'data-viz', name: 'Data Visualizer', role: 'Turns numbers into clear charts and dashboards.', skills: ['data-viz', 'charts', 'dashboards'] },
  { slug: 'scraper', name: 'Web Scraper', role: 'Pulls structured data from pages and APIs.', skills: ['scraping', 'structured-data', 'apis'] },
  { slug: 'regex', name: 'Regex Specialist', role: 'Patterns, parsing, text transformations.', skills: ['regex', 'parsing', 'transformation'] },
  { slug: 'sql', name: 'SQL Analyst', role: 'Queries, joins, aggregations, data questions.', skills: ['sql', 'queries', 'aggregations'] },
  { slug: 'prompt', name: 'Prompt Engineer', role: 'Designs system prompts and instructions for other AIs.', skills: ['prompting', 'instruction-design', 'few-shot'] },
  { slug: 'agent-builder', name: 'Agent Builder', role: 'Designs new specialist agents and their skills.', skills: ['agent-design', 'skills', 'catalog'] },

  // ── Round 3 — MetaGPT / CrewAI / DeepAgents / Mem0-informed specialists ──
  { slug: 'critic', name: 'Critic', role: 'MetaGPT-style strict critique of plans and outputs — the quality gate before anything ships.', skills: ['critical-review', 'output-quality', 'self-consistency'] },
  { slug: 'tool-router', name: 'Tool Router', role: 'Auto-selects the exact tool set for every task — no manual tool instruction ever needed.', skills: ['tool-selection', 'function-calling', 'auto-routing'] },
  { slug: 'toolsmith', name: 'Toolsmith', role: 'Designs new reusable tools and wires external APIs into the tool registry.', skills: ['tool-building', 'api-integration', 'orchestration'] },
  { slug: 'context-manager', name: 'Context Manager', role: 'Keeps the conversation coherent: rolling summaries, compaction, and continuity across turns.', skills: ['rolling-summary', 'context-compaction', 'continuity'] },
  { slug: 'archivist', name: 'Archivist', role: 'Episodic memory: remembers past sessions and consolidates them with a forgetting curve.', skills: ['episodic-memory', 'forgetting-curve', 'memory-consolidation'] },
  { slug: 'document-analyst', name: 'Document Analyst', role: 'Chunks uploaded documents and answers from the retrieved passages (RAG).', skills: ['document-rag', 'chunking', 'retrieval'] },
  { slug: 'data-engineer', name: 'Data Engineer', role: 'Builds data pipelines: extract, transform, load and cleanse messy datasets.', skills: ['data-pipelines', 'etl', 'cleansing'] },
  { slug: 'guardrail', name: 'Guardrail', role: 'Input/output safety: declines unsafe or destructive requests with a clear reason.', skills: ['guardrails', 'safety-checks', 'refusal'] },

  // ── Round 4 — platform/stack depth (VoltAgent/TestMu/Composio-informed) ──
  { slug: 'mobile-engineer', name: 'Mobile Engineer', role: 'Cross-platform mobile apps — React Native, Flutter, Capacitor — tested on real devices.', skills: ['mobile', 'flutter', 'react-native', 'performance', 'testing'] },
  { slug: 'ios-engineer', name: 'iOS Engineer', role: 'Native iOS apps with Swift/SwiftUI, App Store packaging.', skills: ['ios', 'swift', 'mobile', 'testing'] },
  { slug: 'android-engineer', name: 'Android Engineer', role: 'Native Android apps with Kotlin/Jetpack Compose, APK builds.', skills: ['android', 'kotlin', 'mobile', 'testing'] },
  { slug: 'react-native-engineer', name: 'React Native Engineer', role: 'React Native apps with native modules and perf tuning.', skills: ['react-native', 'mobile', 'performance', 'debugging'] },
  { slug: 'game-developer', name: 'Game Developer', role: 'Games with Unity/Unreal — mechanics, graphics, playtesting.', skills: ['game-dev', 'unity', 'unreal', 'graphics', 'coding'] },
  { slug: 'ml-engineer', name: 'ML Engineer', role: 'Trains, fine-tunes and serves machine-learning models.', skills: ['ml', 'model-training', 'fine-tuning', 'embeddings', 'evaluation'] },
  { slug: 'data-scientist', name: 'Data Scientist', role: 'Modeling, experiments and evaluation on real datasets.', skills: ['ml', 'modeling', 'statistics', 'evaluation', 'data-analysis'] },
  { slug: 'devtools-engineer', name: 'DevTools Engineer', role: 'CLIs, SDKs and developer tooling.', skills: ['cli', 'sdk', 'api-design', 'tool-building'] },
  { slug: 'cloud-engineer', name: 'Cloud Engineer', role: 'AWS/GCP/Azure architecture, services and security.', skills: ['cloud', 'aws', 'gcp', 'azure', 'infrastructure'] },
  { slug: 'kubernetes-engineer', name: 'Kubernetes Engineer', role: 'Clusters, Helm charts and container orchestration.', skills: ['kubernetes', 'containers', 'helm', 'deployment'] },
  { slug: 'terraform-engineer', name: 'Terraform Engineer', role: 'Infrastructure as code with Terraform/OpenTofu.', skills: ['terraform', 'iac', 'infrastructure', 'cloud'] },
  { slug: 'api-engineer', name: 'API Engineer', role: 'REST/GraphQL API design, OpenAPI specs, versioning.', skills: ['api-design', 'rest', 'graphql', 'openapi', 'api'] },
  { slug: 'auth-engineer', name: 'Auth Engineer', role: 'OAuth, JWT, session security and identity flows.', skills: ['oauth', 'auth', 'security', 'api-design'] },
  { slug: 'database-ops', name: 'Database Ops', role: 'Postgres/Redis administration, backups, failover.', skills: ['database', 'postgres', 'redis', 'backups', 'tuning'] },
  { slug: 'network-engineer', name: 'Network Engineer', role: 'DNS, TLS, load balancers and network security.', skills: ['networking', 'dns', 'tls', 'infrastructure'] },
  { slug: 'sre', name: 'Site Reliability Engineer', role: 'Uptime, SLIs/SLOs, incident response and runbooks.', skills: ['sre', 'reliability', 'incident-response', 'on-call', 'monitoring'] },
  { slug: 'monitoring-engineer', name: 'Monitoring Engineer', role: 'Metrics, dashboards and alerting that actually fires.', skills: ['monitoring', 'observability', 'alerting', 'dashboards'] },
  { slug: 'log-analyst', name: 'Log Analyst', role: 'Reads logs and traces, correlates events to root causes.', skills: ['tracing', 'correlation', 'data-analysis', 'root-cause'] },
  { slug: 'cost-optimizer', name: 'Cloud Cost Optimizer', role: 'Finds wasted spend and right-sizes infrastructure.', skills: ['cost', 'billing', 'optimization', 'finance'] },
  { slug: 'release-engineer', name: 'Release Engineer', role: 'Versioning, tags, changelogs and safe releases.', skills: ['release', 'versioning', 'ci-cd', 'documentation'] },
  { slug: 'ci-engineer', name: 'CI Engineer', role: 'Build pipelines that catch bugs before they ship.', skills: ['pipelines', 'ci-cd', 'testing', 'automation'] },
  { slug: 'backup-engineer', name: 'Backup Engineer', role: 'Backup and disaster-recovery plans that actually restore.', skills: ['backups', 'disaster-recovery', 'database', 'infrastructure'] },
  { slug: 'deploy-engineer', name: 'Deploy Engineer', role: 'Zero-downtime deploys and instant rollbacks.', skills: ['rollback', 'zero-downtime', 'deployment', 'monitoring'] },
  { slug: 'infra-auditor', name: 'Infra Auditor', role: 'Audits infrastructure for drift, waste and risk.', skills: ['audit', 'infrastructure', 'security', 'compliance'] },
  { slug: 'ml-ops', name: 'MLOps Engineer', role: 'Puts models in production: serving, drift, pipelines.', skills: ['mlops', 'model-serving', 'pipelines', 'deployment'] },

  // ── Security depth ───────────────────────────────────────────
  { slug: 'pentester', name: 'Penetration Tester', role: 'Finds and proves exploitable weaknesses before attackers do.', skills: ['pentest', 'exploitation', 'owasp', 'security'] },
  { slug: 'red-team', name: 'Red Team Operator', role: 'Simulates real adversaries end-to-end.', skills: ['red-team', 'social-engineering', 'pentest', 'threat-modeling'] },
  { slug: 'blue-team', name: 'Blue Team Defender', role: 'Defends: detection, hardening, incident containment.', skills: ['blue-team', 'defense', 'monitoring', 'incident-response'] },
  { slug: 'appsec', name: 'Application Security Engineer', role: 'SAST/DAST, secure code review, OWASP coverage.', skills: ['appsec', 'sast', 'dast', 'vulnerability-scan'] },
  { slug: 'cryptographer', name: 'Cryptographer', role: 'Encryption, hashing and secure key management.', skills: ['cryptography', 'encryption', 'hashing', 'security'] },
  { slug: 'privacy-officer', name: 'Privacy Officer', role: 'GDPR and data-protection reviews.', skills: ['privacy', 'gdpr', 'data-protection', 'compliance'] },
  { slug: 'compliance-officer', name: 'Compliance Officer', role: 'ISO 27001 / SOC 2 readiness and audit trails.', skills: ['compliance', 'iso', 'soc2', 'audit'] },
  { slug: 'forensic-analyst', name: 'Forensic Analyst', role: 'Preserves evidence and reconstructs incidents.', skills: ['forensics', 'evidence', 'incident-response', 'diagnostics'] },
  { slug: 'risk-analyst', name: 'Risk Analyst', role: 'Threat modeling and risk mitigation plans.', skills: ['threat-modeling', 'mitigation', 'strategy', 'security'] },
  { slug: 'security-trainer', name: 'Security Trainer', role: 'Awareness training and security policy writing.', skills: ['security-awareness', 'teaching', 'compliance', 'documentation'] },

  // ── Data depth ───────────────────────────────────────────────
  { slug: 'bi-analyst', name: 'BI Analyst', role: 'Dashboards and KPIs that tell the business story.', skills: ['bi', 'kpi', 'dashboards', 'insights'] },
  { slug: 'reporting-analyst', name: 'Reporting Analyst', role: 'Structured reports from raw numbers.', skills: ['reporting', 'metrics', 'data-analysis', 'charting'] },
  { slug: 'database-admin', name: 'Database Administrator', role: 'Tuning, backups and day-to-day database care.', skills: ['dba', 'tuning', 'backups', 'sql'] },
  { slug: 'data-quality', name: 'Data Quality Engineer', role: 'Validation, governance and clean pipelines.', skills: ['data-quality', 'validation', 'governance', 'cleansing'] },

  // ── Creative ─────────────────────────────────────────────────
  { slug: 'novelist', name: 'Novelist', role: 'Fiction — plot, characters, world-building.', skills: ['fiction', 'storytelling', 'world-building', 'writing'] },
  { slug: 'screenwriter', name: 'Screenwriter', role: 'Screenplays and TV scripts with real dialogue.', skills: ['screenwriting', 'screenplay', 'dialogue', 'storytelling'] },
  { slug: 'poet', name: 'Poet', role: 'Poems and verse with rhythm and image.', skills: ['poetry', 'verse', 'writing'] },
  { slug: 'songwriter', name: 'Songwriter', role: 'Songs — hooks, lyrics, structure.', skills: ['songwriting', 'lyrics', 'poetry'] },
  { slug: 'illustrator', name: 'Illustrator', role: 'Visual concepts, sketches and art direction.', skills: ['illustration', 'art-direction', 'visuals', 'design-system'] },
  { slug: 'video-script-writer', name: 'Video Script Writer', role: 'YouTube/TikTok scripts with hooks and retention.', skills: ['video-scripts', 'hooks', 'storytelling', 'writing'] },
  { slug: 'video-analyst', name: 'Video Analyst', role: 'Watches videos frame-by-frame — timestamped captions, sampled visual frames, key moments (YouTube, TikTok, Instagram, direct files).', skills: ['timestamped-captions', 'frame-analysis', 'visual-understanding', 'video-transcript-analysis', 'key-moments'] },
  { slug: 'podcaster', name: 'Podcaster', role: 'Podcast episodes — topics, structure, interviews.', skills: ['podcasting', 'audio', 'interviewing', 'storytelling'] },
  { slug: 'speech-writer', name: 'Speech Writer', role: 'Speeches with rhetoric that lands.', skills: ['rhetoric', 'persuasion', 'writing', 'structure'] },
  { slug: 'essayist', name: 'Essayist', role: 'Argument-driven essays and opinion pieces.', skills: ['essays', 'thesis', 'writing', 'structure'] },
  { slug: 'grant-writer', name: 'Grant Writer', role: 'Grant applications and funding proposals.', skills: ['grants', 'proposals', 'writing', 'persuasion'] },
  { slug: 'newsletter-writer', name: 'Newsletter Writer', role: 'Newsletters people actually open.', skills: ['newsletters', 'cadence', 'email', 'writing'] },
  { slug: 'seo-writer', name: 'SEO Writer', role: 'Content that ranks and reads well.', skills: ['seo', 'keywords', 'writing', 'blogs'] },
  { slug: 'ad-copywriter', name: 'Ad Copywriter', role: 'Ads and landing copy that convert.', skills: ['ad-copy', 'conversion', 'a-b-testing', 'copywriting'] },
  { slug: 'ghostwriter', name: 'Ghostwriter', role: 'Writes in the client\'s voice, invisibly.', skills: ['ghostwriting', 'voice-matching', 'writing', 'storytelling'] },
  { slug: 'content-strategist', name: 'Content Strategist', role: 'Content calendars and pillar content plans.', skills: ['content-calendar', 'blogs', 'seo-strategy', 'branding'] },
  { slug: 'motion-designer', name: 'Motion Designer', role: 'Animation and motion for interfaces and video.', skills: ['visuals', 'design-system', 'ui-design', 'graphics'] },
  { slug: 'sound-designer', name: 'Sound Designer', role: 'Audio direction for video and podcasts.', skills: ['audio', 'podcasting', 'storytelling', 'graphics'] },

  // ── Business ─────────────────────────────────────────────────
  { slug: 'business-analyst', name: 'Business Analyst', role: 'Requirements, processes and business cases.', skills: ['business-analysis', 'process', 'requirements', 'strategy'] },
  { slug: 'market-analyst', name: 'Market Analyst', role: 'Market sizing, demand and competitive analysis.', skills: ['market-research', 'competitive', 'tamo', 'insights'] },
  { slug: 'startup-advisor', name: 'Startup Advisor', role: 'MVP scoping, product-market fit, fundraising.', skills: ['startups', 'mvp', 'product-market-fit', 'strategy'] },
  { slug: 'financial-advisor', name: 'Financial Advisor', role: 'Financial planning, retirement, net worth.', skills: ['financial-planning', 'retirement', 'budgeting', 'finance'] },
  { slug: 'investor', name: 'Investment Analyst', role: 'Portfolios, stocks and risk-adjusted returns.', skills: ['investing', 'portfolio', 'stocks', 'finance'] },
  { slug: 'tax-advisor', name: 'Tax Advisor', role: 'Taxes, deductions and filing strategy.', skills: ['tax', 'deductions', 'compliance', 'finance'] },
  { slug: 'sales-rep', name: 'Sales Representative', role: 'Outreach, pipelines and closing deals.', skills: ['sales', 'outreach', 'negotiation', 'email'] },
  { slug: 'crm-specialist', name: 'CRM Specialist', role: 'Leads, records and follow-up systems.', skills: ['crm', 'leads', 'sales', 'data-analysis'] },
  { slug: 'customer-success', name: 'Customer Success Manager', role: 'Onboarding, retention and expansion.', skills: ['retention', 'onboarding', 'support', 'feedback'] },
  { slug: 'support-engineer', name: 'Support Engineer', role: 'Diagnoses and resolves user issues fast.', skills: ['support', 'troubleshooting', 'escalation', 'debugging'] },
  { slug: 'hr-specialist', name: 'HR Specialist', role: 'Hiring, onboarding and people ops.', skills: ['hr', 'hiring', 'onboarding', 'compliance'] },
  { slug: 'recruiter', name: 'Recruiter', role: 'Sourcing, screening and hiring pipelines.', skills: ['recruiting', 'sourcing', 'interviewing', 'hiring'] },
  { slug: 'pricing-strategist', name: 'Pricing Strategist', role: 'Pricing tiers and monetization models.', skills: ['pricing', 'monetization', 'market-research', 'strategy'] },
  { slug: 'operations-manager', name: 'Operations Manager', role: 'Workflows, processes and execution cadence.', skills: ['ops', 'workflow', 'process', 'strategy'] },
  { slug: 'executive-assistant', name: 'Executive Assistant', role: 'Schedules, inbox, tasks and meeting prep.', skills: ['scheduling', 'email-triage', 'tasks', 'drafting'] },

  // ── Life & coaching ──────────────────────────────────────────
  { slug: 'counselor', name: 'Counselor', role: 'Empathetic listening and grounded support.', skills: ['counseling', 'empathy', 'listening', 'guidance'] },
  { slug: 'relationship-coach', name: 'Relationship Coach', role: 'Communication and conflict in relationships.', skills: ['relationships', 'conflict', 'counseling', 'listening'] },
  { slug: 'sleep-coach', name: 'Sleep Coach', role: 'Sleep routines and recovery.', skills: ['sleep', 'rest', 'habits', 'wellness'] },
  { slug: 'meditation-coach', name: 'Meditation Coach', role: 'Meditation and mindfulness practice.', skills: ['meditation', 'mindfulness', 'habits', 'wellness'] },
  { slug: 'pet-care', name: 'Pet Care Advisor', role: 'Pet care, training and routines.', skills: ['pets', 'pet-training', 'guidance', 'routines'] },
  { slug: 'gardener', name: 'Gardener', role: 'Gardens and plants — indoor and outdoor.', skills: ['gardening', 'plants', 'science', 'guidance'] },
  { slug: 'home-org', name: 'Home Organizer', role: 'Decluttering and organized spaces.', skills: ['organization', 'decluttering', 'routines', 'guidance'] },
  { slug: 'interior-designer', name: 'Interior Designer', role: 'Room layouts, styling and design systems for spaces.', skills: ['interior-design', 'styling', 'design-system', 'layout'] },
  { slug: 'fashion-stylist', name: 'Fashion Stylist', role: 'Style, wardrobe and personal image.', skills: ['fashion', 'wardrobe', 'styling', 'branding'] },
  { slug: 'beauty-advisor', name: 'Beauty Advisor', role: 'Skincare and beauty routines.', skills: ['skincare', 'beauty', 'wellness', 'routines'] },
  { slug: 'wedding-planner', name: 'Wedding Planner', role: 'Weddings — vendors, budgets, timelines.', skills: ['weddings', 'vendors', 'events', 'budgeting'] },
  { slug: 'event-planner', name: 'Event Planner', role: 'Events — logistics, budgets, coordination.', skills: ['events', 'logistics', 'budgeting', 'itinerary'] },
  { slug: 'dating-coach', name: 'Dating Coach', role: 'Dating profiles and first-date confidence.', skills: ['dating', 'dating-profiles', 'relationships', 'feedback'] },
  { slug: 'chef', name: 'Chef', role: 'Recipes, techniques and meal ideas.', skills: ['cooking', 'recipes', 'nutrition', 'meals'] },

  // ── Education ────────────────────────────────────────────────
  { slug: 'homework-helper', name: 'Homework Helper', role: 'Homework help with worked explanations.', skills: ['homework', 'practice-problems', 'math', 'explanations'] },
  { slug: 'exam-coach', name: 'Exam Coach', role: 'Exam prep plans and test strategy.', skills: ['exam-prep', 'test-prep', 'study', 'quizzes'] },
  { slug: 'flashcard-maker', name: 'Flashcard Maker', role: 'Flashcard decks with spaced repetition.', skills: ['flashcards', 'spaced-repetition', 'study', 'notes'] },
  { slug: 'grader', name: 'Grader', role: 'Fair grading with clear rubrics.', skills: ['grading', 'rubrics', 'feedback', 'checking'] },
  { slug: 'curriculum-designer', name: 'Curriculum Designer', role: 'Courses and curricula aligned to standards.', skills: ['curriculum-design', 'standards', 'lesson-planning', 'curriculum'] },
  { slug: 'lab-assistant', name: 'Lab Assistant', role: 'Experiments, lab safety and write-ups.', skills: ['labs', 'experiments', 'science', 'safety-checks'] },
  { slug: 'research-mentor', name: 'Research Mentor', role: 'Mentors research projects and papers.', skills: ['research-mentoring', 'papers', 'thesis', 'library-recall'] },
  { slug: 'academic-writer', name: 'Academic Writer', role: 'Papers and theses with proper citations.', skills: ['academic-writing', 'formatting', 'citation', 'thesis'] },

  // ── Marketing & product growth ───────────────────────────────
  { slug: 'growth-marketer', name: 'Growth Marketer', role: 'Funnels, loops and experiments that grow.', skills: ['growth', 'funnels', 'conversion', 'marketing'] },
  { slug: 'seo-specialist', name: 'SEO Specialist', role: 'Ranking strategy and search analytics.', skills: ['seo-strategy', 'ranking-analytics', 'seo', 'keywords'] },
  { slug: 'product-marketer', name: 'Product Marketer', role: 'Positioning, messaging and launches.', skills: ['positioning', 'messaging', 'launches', 'marketing'] },
  { slug: 'lifecycle-marketer', name: 'Lifecycle Marketer', role: 'Email campaigns and retention sequences.', skills: ['lifecycle', 'email-campaigns', 'email', 'retention'] },
  { slug: 'community-manager', name: 'Community Manager', role: 'Communities, moderation and engagement.', skills: ['community', 'moderation', 'social-media', 'feedback'] },
  { slug: 'devrel-engineer', name: 'DevRel Engineer', role: 'Docs, tutorials and developer communities.', skills: ['community', 'technical-writing', 'api', 'teaching'] },

  // ── Writing depth ────────────────────────────────────────────
  { slug: 'technical-editor', name: 'Technical Editor', role: 'Fact-checks and sharpens technical writing.', skills: ['technical-editing', 'accuracy', 'technical-writing', 'editing'] },
  { slug: 'ux-writer', name: 'UX Writer', role: 'Microcopy and interface language.', skills: ['microcopy', 'ui-text', 'ux', 'clarity'] },
  { slug: 'copyeditor', name: 'Copyeditor', role: 'Line-level edits against style guides.', skills: ['copyediting', 'style-guides', 'consistency', 'grammar'] },
  { slug: 'blog-writer', name: 'Blog Writer', role: 'Blog posts and web articles.', skills: ['blogs', 'posts', 'seo', 'writing'] },
  { slug: 'white-paper-writer', name: 'White Paper Writer', role: 'Long-form authority documents.', skills: ['white-papers', 'authority', 'technical-writing', 'deep-research'] },
  { slug: 'case-study-writer', name: 'Case Study Writer', role: 'Customer stories with measurable outcomes.', skills: ['case-studies', 'outcomes', 'storytelling', 'reporting'] },
  { slug: 'api-docs-writer', name: 'API Docs Writer', role: 'Reference docs and guides for developers.', skills: ['technical-writing', 'api', 'documentation', 'openapi'] },

  // ── Productivity & system ────────────────────────────────────
  { slug: 'scheduler', name: 'Scheduler', role: 'Calendars, time-blocking and agendas.', skills: ['scheduling', 'calendars', 'time-management', 'tasks'] },
  { slug: 'note-taker', name: 'Note Taker', role: 'Captures notes and action items.', skills: ['note-taking', 'action-items', 'summarization', 'organization'] },
  { slug: 'meeting-planner', name: 'Meeting Planner', role: 'Agendas and minutes that move things forward.', skills: ['agendas', 'minutes', 'scheduling', 'reporting'] },
  { slug: 'expense-tracker', name: 'Expense Tracker', role: 'Tracks spending and receipts.', skills: ['expenses', 'receipts', 'budgeting', 'finance'] },
  { slug: 'task-manager', name: 'Task Manager', role: 'Tasks, priorities and follow-ups.', skills: ['tasks', 'priorities', 'gtd', 'scheduling'] },
  { slug: 'email-triage', name: 'Email Triage', role: 'Inbox zero and draft replies.', skills: ['email-triage', 'inbox', 'email', 'organization'] },
  { slug: 'legal-drafter', name: 'Legal Drafter', role: 'Drafts contracts and legal documents.', skills: ['legal', 'drafting', 'compliance', 'negotiation'] },
  { slug: 'incident-commander', name: 'Incident Commander', role: 'Runs incident response and postmortems.', skills: ['incident-response', 'on-call', 'reporting', 'monitoring'] },
  { slug: 'brand-designer', name: 'Brand Designer', role: 'Logos, identity and visual systems.', skills: ['branding', 'identity', 'design-system', 'illustration'] },
  { slug: 'ui-developer', name: 'UI Developer', role: 'Builds pixel-perfect interfaces fast.', skills: ['frontend', 'react', 'ui-design', 'responsive'] },
  { slug: 'landing-page-builder', name: 'Landing Page Builder', role: 'Conversion-focused landing pages.', skills: ['frontend', 'react', 'conversion', 'ui-design'] },
  { slug: 'email-developer', name: 'Email Developer', role: 'HTML emails that render everywhere.', skills: ['email', 'frontend', 'api', 'testing'] },
];

/**
 * B49 P3 — explicit execution tier, attached to every roster entry so
 * `getAgent(slug).tier` is a queryable fact (no ad-hoc grep needed):
 *
 *   core     = the always-present brain agents (run on every request)
 *   pipeline = agents that execute as their OWN graph node with an
 *              independent pass and an observable verdict/output
 *   team     = composed into a team for an intent; may be bundled into a
 *              composite reasoning pass (see AGENT-CATALOG.md execution model)
 *
 * Reachability (zero orphans) is enforced by server/scripts/audit-roster.js
 * via server/src/services/Reachability.js — every entry must appear in a
 * team, a compound phase, or an execution-layer pass.
 */
const TIER = {
  core: ['planner', 'orchestrator', 'jexi', 'reasoner', 'reflector'],
  pipeline: [
    // graph-node primary agents (Orchestrator nodes with independent execution)
    'architect', 'coder', 'runner', 'debugger', 'qa', 'reviewer', 'critic',
    'security', 'shipper', 'math', 'self-diagnose', 'vision', 'navigator',
    'computer-use', 'video-analyst', 'translator', 'data', 'devops', 'writer',
    'perf', 'github', 'memory', 'news-scout', 'news-filter', 'news-editor',
    'query-analyzer', 'searcher', 'reranker', 'extractor', 'synthesizer',
    'researcher', 'scholar', 'fact-checker', 'books', 'document-analyst',
  ],
};
const TIER_OF = new Map();
for (const [tier, slugs] of Object.entries(TIER)) for (const s of slugs) TIER_OF.set(s, tier);
for (const a of AGENT_ROSTER) a.tier = TIER_OF.get(a.slug) || 'team';

/** Skill registry: slug → name, category, what it does, who masters it. */
export const SKILL_REGISTRY = [
  // Brain & planning
  { slug: 'intent-detection', name: 'Intent Detection', category: 'Core', desc: 'Classify what a request actually asks for.', agent: 'planner' },
  { slug: 'team-composition', name: 'Team Composition', category: 'Core', desc: 'Pick the right specialists for a task.', agent: 'planner' },
  { slug: 'task-decomposition', name: 'Task Decomposition', category: 'Core', desc: 'Split big asks into ordered subtasks.', agent: 'planner' },
  { slug: 'pipeline-execution', name: 'Pipeline Execution', category: 'Core', desc: 'Run specialists in order with handoffs.', agent: 'orchestrator' },
  { slug: 'gates', name: 'Gate Enforcement', category: 'Core', desc: 'PASS/FAIL and CLEARED/BLOCKED gates in code.', agent: 'orchestrator' },
  { slug: 'handoff', name: 'Strict Handoff', category: 'Core', desc: 'Pass only the prior agent\'s output forward.', agent: 'orchestrator' },
  { slug: 'conversation', name: 'Conversation', category: 'Core', desc: 'Natural multi-turn dialogue.', agent: 'jexi' },
  { slug: 'identity', name: 'Identity', category: 'Core', desc: 'Knows name, creator, and origin always.', agent: 'jexi' },
  { slug: 'system-prompt', name: 'System Prompt', category: 'Core', desc: 'The inherited instruction set for every agent.', agent: 'jexi' },
  { slug: 'reasoning', name: 'Reasoning', category: 'Core', desc: 'Structured step-by-step thinking.', agent: 'reasoner' },
  { slug: 'reflection', name: 'Reflection', category: 'Core', desc: 'Critique own output and improve it.', agent: 'reflector' },
  { slug: 'retrospective', name: 'Retrospective', category: 'Core', desc: 'Post-task review of what worked.', agent: 'reflector' },

  // Math & science
  { slug: 'math', name: 'Math', category: 'Math', desc: 'Arithmetic to calculus, solved precisely.', agent: 'math' },
  { slug: 'latex', name: 'LaTeX', category: 'Math', desc: 'Proper math typesetting in answers.', agent: 'math' },
  { slug: 'step-by-step', name: 'Step-by-Step', category: 'Math', desc: 'Show every working step, not just the answer.', agent: 'math' },
  { slug: 'explanations', name: 'Explanations', category: 'Math', desc: 'Clear scientific explanations.', agent: 'science' },
  { slug: 'visuals', name: 'Visuals', category: 'Math', desc: 'Diagrams and visual aids.', agent: 'science' },
  { slug: 'science', name: 'Science', category: 'Math', desc: 'Physics, chemistry, biology explanations.', agent: 'science' },
  { slug: 'statistics', name: 'Statistics', category: 'Math', desc: 'Mean, variance, regressions, significance.', agent: 'data' },
  { slug: 'finance', name: 'Finance', category: 'Math', desc: 'Budget, interest, returns, money math.', agent: 'finance' },
  { slug: 'calculations', name: 'Calculations', category: 'Math', desc: 'Fast reliable numeric work.', agent: 'math' },

  // Search & research
  { slug: 'web-search', name: 'Web Search', category: 'Research', desc: 'Multi-engine web search.', agent: 'searcher' },
  { slug: 'multi-engine', name: 'Multi-Engine', category: 'Research', desc: 'Parallel SearXNG/DDG/Bing/Mojeek/arXiv.', agent: 'searcher' },
  { slug: 'aggregation', name: 'Aggregation', category: 'Research', desc: 'Merge results from many engines.', agent: 'searcher' },
  { slug: 'query-expansion', name: 'Query Expansion', category: 'Research', desc: 'Turn a question into precise queries.', agent: 'query-analyzer' },
  { slug: 'search-strategy', name: 'Search Strategy', category: 'Research', desc: 'Choose what to search and how.', agent: 'query-analyzer' },
  { slug: 'ranking', name: 'Ranking', category: 'Research', desc: 'Sort results by quality.', agent: 'reranker' },
  { slug: 'trusted-sources', name: 'Trusted Sources', category: 'Research', desc: 'Prefer .edu/.gov/wiki/arxiv/docs.', agent: 'reranker' },
  { slug: 'dedupe', name: 'Dedupe', category: 'Research', desc: 'Remove duplicate results.', agent: 'reranker' },
  { slug: 'scraping', name: 'Scraping', category: 'Research', desc: 'Pull readable content from pages.', agent: 'extractor' },
  { slug: 'content-extraction', name: 'Content Extraction', category: 'Research', desc: 'Strip ads and junk from pages.', agent: 'extractor' },
  { slug: 'cleaning', name: 'Cleaning', category: 'Research', desc: 'Normalize extracted text.', agent: 'extractor' },
  { slug: 'synthesis', name: 'Synthesis', category: 'Research', desc: 'Combine sources into one answer.', agent: 'synthesizer' },
  { slug: 'citation', name: 'Citation', category: 'Research', desc: 'Attribute claims to sources.', agent: 'synthesizer' },
  { slug: 'fact-grounded', name: 'Fact Grounding', category: 'Research', desc: 'Answer only from gathered evidence.', agent: 'synthesizer' },
  { slug: 'fact-checking', name: 'Fact Checking', category: 'Research', desc: 'Verify claims before they ship.', agent: 'fact-checker' },
  { slug: 'verification', name: 'Verification', category: 'Research', desc: 'Confirm output against input.', agent: 'fact-checker' },
  { slug: 'anti-hallucination', name: 'Anti-Hallucination', category: 'Research', desc: 'Refuse to invent; say "not in sources".', agent: 'fact-checker' },
  { slug: 'deep-research', name: 'Deep Research', category: 'Research', desc: 'Multi-pass study of a topic.', agent: 'researcher' },
  { slug: 'knowledge-base', name: 'Knowledge Base', category: 'Research', desc: 'Store and reuse studied knowledge.', agent: 'researcher' },
  { slug: 'topic-study', name: 'Topic Study', category: 'Research', desc: 'Turn a topic into saved notes.', agent: 'scholar' },
  { slug: 'books', name: 'Books', category: 'Research', desc: 'Answer from the user\'s own books.', agent: 'books' },
  { slug: 'papers', name: 'Papers', category: 'Research', desc: 'Academic paper recall.', agent: 'scholar' },
  { slug: 'library-recall', name: 'Library Recall', category: 'Research', desc: 'Search the saved knowledge library.', agent: 'books' },
  { slug: 'quote', name: 'Quote', category: 'Research', desc: 'Answer with exact passages.', agent: 'books' },

  // News
  { slug: 'news', name: 'News', category: 'News', desc: 'Live headlines from free feeds.', agent: 'news-scout' },
  { slug: 'rss', name: 'RSS', category: 'News', desc: 'BBC/Google News style feeds.', agent: 'news-scout' },
  { slug: 'headlines', name: 'Headlines', category: 'News', desc: 'Top stories right now.', agent: 'news-scout' },
  { slug: 'news-filtering', name: 'News Filtering', category: 'News', desc: 'Keep relevant, recent stories.', agent: 'news-filter' },
  { slug: 'relevance', name: 'Relevance', category: 'News', desc: 'Match stories to the request.', agent: 'news-filter' },
  { slug: 'news-writing', name: 'News Writing', category: 'News', desc: 'Clean brief from headlines.', agent: 'news-editor' },
  { slug: 'briefing', name: 'Briefing', category: 'News', desc: 'Concise current-events summary.', agent: 'news-editor' },

  // Memory
  { slug: 'memory', name: 'Memory', category: 'Memory', desc: 'Store and recall user facts.', agent: 'memory' },
  { slug: 'facts', name: 'Facts', category: 'Memory', desc: 'Durable facts about the user.', agent: 'memory' },
  { slug: 'preferences', name: 'Preferences', category: 'Memory', desc: 'Learned "do it this way" rules.', agent: 'memory' },
  { slug: 'consolidation', name: 'Consolidation', category: 'Memory', desc: 'Merge and prune old memories.', agent: 'memory' },
  { slug: 'recall', name: 'Recall', category: 'Memory', desc: 'Retrieve the right memories.', agent: 'memory' },

  // Vision & browser
  { slug: 'vision', name: 'Vision', category: 'Perception', desc: 'Understand images.', agent: 'vision' },
  { slug: 'ocr', name: 'OCR', category: 'Perception', desc: 'Read text from images.', agent: 'vision' },
  { slug: 'image-analysis', name: 'Image Analysis', category: 'Perception', desc: 'Describe photos and screenshots.', agent: 'vision' },
  { slug: 'browser', name: 'Browser', category: 'Perception', desc: 'Drive a real browser.', agent: 'navigator' },
  { slug: 'navigation', name: 'Navigation', category: 'Perception', desc: 'Go to sites and pages.', agent: 'navigator' },
  { slug: 'automation', name: 'Automation', category: 'Perception', desc: 'Click, type, scroll programmatically.', agent: 'navigator' },
  { slug: 'browser-control', name: 'Browser Control', category: 'Perception', desc: 'Numbered-element interactive control.', agent: 'computer-use' },
  { slug: 'click', name: 'Click', category: 'Perception', desc: 'Click elements by number.', agent: 'computer-use' },
  { slug: 'typing', name: 'Typing', category: 'Perception', desc: 'Type into inputs.', agent: 'computer-use' },
  { slug: 'scrolling', name: 'Scrolling', category: 'Perception', desc: 'Scroll through pages.', agent: 'computer-use' },

  // Coding
  { slug: 'coding', name: 'Coding', category: 'Coding', desc: 'Write working code.', agent: 'coder' },
  { slug: 'debugging', name: 'Debugging', category: 'Coding', desc: 'Find and fix bugs.', agent: 'debugger' },
  { slug: 'refactoring', name: 'Refactoring', category: 'Coding', desc: 'Improve code without changing behavior.', agent: 'coder' },
  { slug: 'error-analysis', name: 'Error Analysis', category: 'Coding', desc: 'Read tracebacks and root-cause them.', agent: 'debugger' },
  { slug: 'fix-loop', name: 'Fix Loop', category: 'Coding', desc: 'Run → fix → re-run until clean.', agent: 'debugger' },
  { slug: 'root-cause', name: 'Root Cause', category: 'Coding', desc: 'Find the real cause, not the symptom.', agent: 'debugger' },
  { slug: 'code-generation', name: 'Code Generation', category: 'Coding', desc: 'Generate whole project files.', agent: 'architect' },
  { slug: 'project-structure', name: 'Project Structure', category: 'Coding', desc: 'Sensible file layout.', agent: 'architect' },
  { slug: 'architecture', name: 'Architecture', category: 'Coding', desc: 'Design the technical approach.', agent: 'engineer' },
  { slug: 'tech-design', name: 'Tech Design', category: 'Coding', desc: 'Concrete implementation plan.', agent: 'engineer' },
  { slug: 'estimation', name: 'Estimation', category: 'Coding', desc: 'Scope and effort sizing.', agent: 'engineer' },
  { slug: 'execution', name: 'Execution', category: 'Coding', desc: 'Run code in a sandbox.', agent: 'runner' },
  { slug: 'sandbox', name: 'Sandbox', category: 'Coding', desc: 'Isolated safe execution.', agent: 'runner' },
  { slug: 'output-capture', name: 'Output Capture', category: 'Coding', desc: 'Capture stdout and errors.', agent: 'runner' },
  { slug: 'testing', name: 'Testing', category: 'Coding', desc: 'Verify against the spec.', agent: 'qa' },
  { slug: 'qa-gate', name: 'QA Gate', category: 'Coding', desc: 'PASS or NEEDS FIX verdict.', agent: 'qa' },
  { slug: 'code-review', name: 'Code Review', category: 'Coding', desc: 'Review for quality and bugs.', agent: 'reviewer' },
  { slug: 'best-practices', name: 'Best Practices', category: 'Coding', desc: 'Enforce solid conventions.', agent: 'reviewer' },
  { slug: 'review-gate', name: 'Review Gate', category: 'Coding', desc: 'APPROVED or CHANGES-REQUESTED.', agent: 'reviewer' },
  { slug: 'security', name: 'Security', category: 'Coding', desc: 'Find vulnerabilities.', agent: 'security' },
  { slug: 'vulnerability-scan', name: 'Vulnerability Scan', category: 'Coding', desc: 'Check for OWASP-class issues.', agent: 'security' },
  { slug: 'security-gate', name: 'Security Gate', category: 'Coding', desc: 'CLEARED or BLOCKED verdict.', agent: 'security' },
  { slug: 'performance', name: 'Performance', category: 'Coding', desc: 'Speed and memory optimization.', agent: 'perf' },
  { slug: 'profiling', name: 'Profiling', category: 'Coding', desc: 'Find the slow parts.', agent: 'perf' },
  { slug: 'optimization', name: 'Optimization', category: 'Coding', desc: 'Make it measurably faster.', agent: 'perf' },
  { slug: 'frontend', name: 'Frontend', category: 'Coding', desc: 'UI implementation.', agent: 'frontend' },
  { slug: 'react', name: 'React', category: 'Coding', desc: 'Component-based UI.', agent: 'frontend' },
  { slug: 'css', name: 'CSS', category: 'Coding', desc: 'Styling and layout.', agent: 'frontend' },
  { slug: 'responsive', name: 'Responsive', category: 'Coding', desc: 'Works on any screen.', agent: 'frontend' },
  { slug: 'backend', name: 'Backend', category: 'Coding', desc: 'Server-side logic.', agent: 'backend' },
  { slug: 'api', name: 'API', category: 'Coding', desc: 'Endpoints and contracts.', agent: 'backend' },
  { slug: 'auth', name: 'Auth', category: 'Coding', desc: 'Login and permissions.', agent: 'backend' },
  { slug: 'server', name: 'Server', category: 'Coding', desc: 'Middleware and routing.', agent: 'backend' },
  { slug: 'sql', name: 'SQL', category: 'Coding', desc: 'Queries and schema.', agent: 'sql' },
  { slug: 'schema', name: 'Schema', category: 'Coding', desc: 'Data model design.', agent: 'database' },
  { slug: 'migrations', name: 'Migrations', category: 'Coding', desc: 'Safe data changes.', agent: 'database' },
  { slug: 'indexing', name: 'Indexing', category: 'Coding', desc: 'Query performance.', agent: 'database' },
  { slug: 'regex', name: 'Regex', category: 'Coding', desc: 'Pattern matching.', agent: 'regex' },
  { slug: 'parsing', name: 'Parsing', category: 'Coding', desc: 'Extract structure from text.', agent: 'regex' },
  { slug: 'transformation', name: 'Transformation', category: 'Coding', desc: 'Rewrite text programmatically.', agent: 'regex' },

  // Deploy & infra
  { slug: 'deployment', name: 'Deployment', category: 'DevOps', desc: 'Ship it somewhere real.', agent: 'devops' },
  { slug: 'docker', name: 'Docker', category: 'DevOps', desc: 'Containerize the app.', agent: 'devops' },
  { slug: 'ci-cd', name: 'CI/CD', category: 'DevOps', desc: 'Automated build and release.', agent: 'devops' },
  { slug: 'infrastructure', name: 'Infrastructure', category: 'DevOps', desc: 'Hosts, config, scaling.', agent: 'devops' },
  { slug: 'git', name: 'Git', category: 'DevOps', desc: 'Version control.', agent: 'github' },
  { slug: 'github', name: 'GitHub', category: 'DevOps', desc: 'Repos, actions, releases.', agent: 'github' },
  { slug: 'pull-requests', name: 'Pull Requests', category: 'DevOps', desc: 'Open and review PRs.', agent: 'github' },
  { slug: 'issues', name: 'Issues', category: 'DevOps', desc: 'Track and manage issues.', agent: 'github' },

  // Data
  { slug: 'data-analysis', name: 'Data Analysis', category: 'Data', desc: 'Analyze datasets.', agent: 'data' },
  { slug: 'charting', name: 'Charting', category: 'Data', desc: 'Visualize the numbers.', agent: 'data' },
  { slug: 'insights', name: 'Insights', category: 'Data', desc: 'What the data actually says.', agent: 'data' },
  { slug: 'data-viz', name: 'Data Viz', category: 'Data', desc: 'Clear chart design.', agent: 'data-viz' },
  { slug: 'charts', name: 'Charts', category: 'Data', desc: 'Bar, line, pie, scatter.', agent: 'data-viz' },
  { slug: 'dashboards', name: 'Dashboards', category: 'Data', desc: 'Everything on one screen.', agent: 'data-viz' },
  { slug: 'queries', name: 'Queries', category: 'Data', desc: 'Ask data questions.', agent: 'sql' },
  { slug: 'aggregations', name: 'Aggregations', category: 'Data', desc: 'Group and summarize.', agent: 'sql' },
  { slug: 'structured-data', name: 'Structured Data', category: 'Data', desc: 'Extract fields, not prose.', agent: 'scraper' },
  { slug: 'apis', name: 'APIs', category: 'Data', desc: 'Call and parse external APIs.', agent: 'scraper' },

  // Writing & language
  { slug: 'writing', name: 'Writing', category: 'Writing', desc: 'Clear, structured prose.', agent: 'writer' },
  { slug: 'documentation', name: 'Documentation', category: 'Writing', desc: 'READMEs and docs.', agent: 'writer' },
  { slug: 'technical-writing', name: 'Technical Writing', category: 'Writing', desc: 'Docs for technical products.', agent: 'writer' },
  { slug: 'translation', name: 'Translation', category: 'Writing', desc: 'Meaning-first translation.', agent: 'translator' },
  { slug: 'localization', name: 'Localization', category: 'Writing', desc: 'Cultural adaptation.', agent: 'translator-v2' },
  { slug: 'reflection-loop', name: 'Reflection Loop', category: 'Writing', desc: 'Draft → critique → revise.', agent: 'translator' },
  { slug: 'culture', name: 'Culture', category: 'Writing', desc: 'Cultural context.', agent: 'translator-v2' },
  { slug: 'adaptation', name: 'Adaptation', category: 'Writing', desc: 'Adapt content for audiences.', agent: 'translator-v2' },
  { slug: 'summarization', name: 'Summarization', category: 'Writing', desc: 'Condense without losing meaning.', agent: 'summarizer' },
  { slug: 'compression', name: 'Compression', category: 'Writing', desc: 'Say more with less.', agent: 'summarizer' },
  { slug: 'key-points', name: 'Key Points', category: 'Writing', desc: 'Extract the essentials.', agent: 'summarizer' },
  { slug: 'editing', name: 'Editing', category: 'Writing', desc: 'Polish any text.', agent: 'editor' },
  { slug: 'grammar', name: 'Grammar', category: 'Writing', desc: 'Correct usage.', agent: 'editor' },
  { slug: 'clarity', name: 'Clarity', category: 'Writing', desc: 'Make it easy to read.', agent: 'editor' },
  { slug: 'copywriting', name: 'Copywriting', category: 'Writing', desc: 'Persuasive copy.', agent: 'copywriter' },
  { slug: 'marketing', name: 'Marketing', category: 'Writing', desc: 'Promotional language.', agent: 'copywriter' },
  { slug: 'headlines', name: 'Headlines', category: 'Writing', desc: 'Grab attention fast.', agent: 'copywriter' },
  { slug: 'proofreading', name: 'Proofreading', category: 'Writing', desc: 'Typos and consistency.', agent: 'proofreader' },
  { slug: 'consistency', name: 'Consistency', category: 'Writing', desc: 'Same terms everywhere.', agent: 'proofreader' },
  { slug: 'polish', name: 'Polish', category: 'Writing', desc: 'Final shine.', agent: 'proofreader' },
  { slug: 'reporting', name: 'Reporting', category: 'Writing', desc: 'Who-what-when structure.', agent: 'reporter' },
  { slug: 'objectivity', name: 'Objectivity', category: 'Writing', desc: 'Neutral tone.', agent: 'reporter' },
  { slug: 'structure', name: 'Structure', category: 'Writing', desc: 'Logical flow of sections.', agent: 'reporter' },
  { slug: 'email', name: 'Email', category: 'Writing', desc: 'Compose effective emails.', agent: 'email' },
  { slug: 'professional-writing', name: 'Professional Writing', category: 'Writing', desc: 'Work-appropriate tone.', agent: 'email' },
  { slug: 'social-media', name: 'Social Media', category: 'Writing', desc: 'Posts and captions.', agent: 'social' },
  { slug: 'captions', name: 'Captions', category: 'Writing', desc: 'Short punchy text.', agent: 'social' },
  { slug: 'content-calendar', name: 'Content Calendar', category: 'Writing', desc: 'Plan posts ahead.', agent: 'social' },
  { slug: 'resume', name: 'Resume', category: 'Writing', desc: 'Resume tailoring.', agent: 'resume' },
  { slug: 'cover-letter', name: 'Cover Letter', category: 'Writing', desc: 'Role-matched letters.', agent: 'resume' },
  { slug: 'ats', name: 'ATS', category: 'Writing', desc: 'Applicant-system friendly.', agent: 'resume' },
  { slug: 'release-notes', name: 'Release Notes', category: 'Writing', desc: 'What changed in a build.', agent: 'shipper' },
  { slug: 'handoff', name: 'Handoff', category: 'Writing', desc: 'Clean summary of finished work.', agent: 'shipper' },
  { slug: 'lesson-planning', name: 'Lesson Planning', category: 'Teaching', desc: 'Structured lessons.', agent: 'teacher' },
  { slug: 'quizzes', name: 'Quizzes', category: 'Teaching', desc: 'Test understanding.', agent: 'teacher' },
  { slug: 'curriculum', name: 'Curriculum', category: 'Teaching', desc: 'Learning paths.', agent: 'teacher' },
  { slug: 'teaching', name: 'Teaching', category: 'Teaching', desc: 'Explain so it sticks.', agent: 'tutor' },
  { slug: 'explanation', name: 'Explanation', category: 'Teaching', desc: 'Clear analogies and examples.', agent: 'tutor' },
  { slug: 'checking', name: 'Checking', category: 'Teaching', desc: 'Confirm the student got it.', agent: 'tutor' },
  { slug: 'study', name: 'Study', category: 'Teaching', desc: 'Study plans and notes.', agent: 'study' },
  { slug: 'notes', name: 'Notes', category: 'Teaching', desc: 'Structured study notes.', agent: 'study' },
  { slug: 'learning-path', name: 'Learning Path', category: 'Teaching', desc: 'Sequenced topics.', agent: 'study' },
  { slug: 'language-practice', name: 'Language Practice', category: 'Teaching', desc: 'Conversation drills.', agent: 'languages' },
  { slug: 'vocabulary', name: 'Vocabulary', category: 'Teaching', desc: 'Word building.', agent: 'languages' },
  { slug: 'corrections', name: 'Corrections', category: 'Teaching', desc: 'Fix mistakes gently.', agent: 'languages' },
  { slug: 'examples', name: 'Examples', category: 'Teaching', desc: 'Worked examples.', agent: 'coding-tutor' },

  // Coaching & life
  { slug: 'strategy', name: 'Strategy', category: 'Life', desc: 'SWOT and planning.', agent: 'strategist' },
  { slug: 'swot', name: 'SWOT', category: 'Life', desc: 'Strengths/weaknesses/opps/threats.', agent: 'strategist' },
  { slug: 'decision-making', name: 'Decision Making', category: 'Life', desc: 'Options and tradeoffs.', agent: 'strategist' },
  { slug: 'budgeting', name: 'Budgeting', category: 'Life', desc: 'Money plans.', agent: 'finance' },
  { slug: 'health', name: 'Health', category: 'Life', desc: 'Wellness guidance.', agent: 'health' },
  { slug: 'habits', name: 'Habits', category: 'Life', desc: 'Build and keep routines.', agent: 'health' },
  { slug: 'wellness', name: 'Wellness', category: 'Life', desc: 'Balance and care.', agent: 'health' },
  { slug: 'fitness', name: 'Fitness', category: 'Life', desc: 'Workout plans.', agent: 'fitness' },
  { slug: 'workouts', name: 'Workouts', category: 'Life', desc: 'Exercises and sets.', agent: 'fitness' },
  { slug: 'progress', name: 'Progress', category: 'Life', desc: 'Track improvements.', agent: 'fitness' },
  { slug: 'nutrition', name: 'Nutrition', category: 'Life', desc: 'Food and macros.', agent: 'nutrition' },
  { slug: 'meals', name: 'Meals', category: 'Life', desc: 'Meal plans.', agent: 'nutrition' },
  { slug: 'macros', name: 'Macros', category: 'Life', desc: 'Protein/carbs/fat.', agent: 'nutrition' },
  { slug: 'career', name: 'Career', category: 'Life', desc: 'Growth and jobs.', agent: 'career' },
  { slug: 'interview', name: 'Interview', category: 'Life', desc: 'Interview prep.', agent: 'career' },
  { slug: 'interviewing', name: 'Interviewing', category: 'Life', desc: 'Practice interviews.', agent: 'interviewer' },
  { slug: 'feedback', name: 'Feedback', category: 'Life', desc: 'Constructive critique.', agent: 'interviewer' },
  { slug: 'practice', name: 'Practice', category: 'Life', desc: 'Rehearsal rounds.', agent: 'interviewer' },
  { slug: 'negotiation', name: 'Negotiation', category: 'Life', desc: 'Deal strategy.', agent: 'negotiator' },
  { slug: 'drafting', name: 'Drafting', category: 'Life', desc: 'Offer and reply drafts.', agent: 'negotiator' },
  { slug: 'travel', name: 'Travel', category: 'Life', desc: 'Trip planning.', agent: 'travel' },
  { slug: 'itinerary', name: 'Itinerary', category: 'Life', desc: 'Day-by-day plans.', agent: 'travel' },
  { slug: 'parenting', name: 'Parenting', category: 'Life', desc: 'Family guidance.', agent: 'parenting' },
  { slug: 'routines', name: 'Routines', category: 'Life', desc: 'Daily structure.', agent: 'parenting' },
  { slug: 'guidance', name: 'Guidance', category: 'Life', desc: 'Practical advice.', agent: 'parenting' },
  { slug: 'history', name: 'History', category: 'Life', desc: 'Timelines and context.', agent: 'history' },
  { slug: 'timelines', name: 'Timelines', category: 'Life', desc: 'Events in order.', agent: 'history' },
  { slug: 'context', name: 'Context', category: 'Life', desc: 'Why things happened.', agent: 'history' },
  { slug: 'legal', name: 'Legal', category: 'Life', desc: 'Plain-language law.', agent: 'legal' },
  { slug: 'compliance', name: 'Compliance', category: 'Life', desc: 'Rules and requirements.', agent: 'legal' },
  { slug: 'plain-language', name: 'Plain Language', category: 'Life', desc: 'Jargon-free explanation.', agent: 'legal' },

  // Agent craft
  { slug: 'prompting', name: 'Prompting', category: 'Agent', desc: 'Design instructions for AIs.', agent: 'prompt' },
  { slug: 'instruction-design', name: 'Instruction Design', category: 'Agent', desc: 'Clear, testable instructions.', agent: 'prompt' },
  { slug: 'few-shot', name: 'Few-Shot', category: 'Agent', desc: 'Teach with examples.', agent: 'prompt' },
  { slug: 'agent-design', name: 'Agent Design', category: 'Agent', desc: 'Build new specialists.', agent: 'agent-builder' },
  { slug: 'skills', name: 'Skills', category: 'Agent', desc: 'Add capabilities to the catalog.', agent: 'agent-builder' },
  { slug: 'catalog', name: 'Catalog', category: 'Agent', desc: 'Maintain the roster.', agent: 'agent-builder' },
  { slug: 'self-check', name: 'Self-Check', category: 'Agent', desc: 'Diagnose own health.', agent: 'self-diagnose' },
  { slug: 'diagnostics', name: 'Diagnostics', category: 'Agent', desc: 'Read logs, memory, errors.', agent: 'self-diagnose' },
  { slug: 'requirements', name: 'Requirements', category: 'Product', desc: 'What "done" means.', agent: 'product' },
  { slug: 'scope', name: 'Scope', category: 'Product', desc: 'What\'s in and out.', agent: 'product' },
  { slug: 'acceptance-criteria', name: 'Acceptance Criteria', category: 'Product', desc: 'Testable success checks.', agent: 'product' },
  { slug: 'ui-design', name: 'UI Design', category: 'Design', desc: 'Interface design.', agent: 'designer' },
  { slug: 'ux', name: 'UX', category: 'Design', desc: 'Usability and flow.', agent: 'designer' },
  { slug: 'design-system', name: 'Design System', category: 'Design', desc: 'Consistent components.', agent: 'designer' },
  { slug: 'layout', name: 'Layout', category: 'Design', desc: 'Space and hierarchy.', agent: 'designer' },
  { slug: 'user-research', name: 'User Research', category: 'Design', desc: 'Understand users.', agent: 'ux-researcher' },
  { slug: 'personas', name: 'Personas', category: 'Design', desc: 'User archetypes.', agent: 'ux-researcher' },
  { slug: 'journey-mapping', name: 'Journey Mapping', category: 'Design', desc: 'User flows.', agent: 'ux-researcher' },
  { slug: 'branding', name: 'Branding', category: 'Design', desc: 'Identity and voice.', agent: 'brand' },
  { slug: 'voice-tone', name: 'Voice & Tone', category: 'Design', desc: 'How JEXI sounds.', agent: 'brand' },
  { slug: 'identity', name: 'Identity', category: 'Design', desc: 'Visual identity.', agent: 'brand' },
  { slug: 'a11y', name: 'Accessibility', category: 'Design', desc: 'Usable by everyone.', agent: 'accessibility' },
  { slug: 'wcag', name: 'WCAG', category: 'Design', desc: 'Accessibility standards.', agent: 'accessibility' },
  { slug: 'contrast', name: 'Contrast', category: 'Design', desc: 'Readable colors.', agent: 'accessibility' },

  // Round 3 — auto tools, memory, quality & safety (MetaGPT/CrewAI/DeepAgents/Mem0)
  { slug: 'tool-selection', name: 'Tool Selection', category: 'Agent', desc: 'Auto-pick the right tools for the task.', agent: 'tool-router' },
  { slug: 'function-calling', name: 'Function Calling', category: 'Agent', desc: 'Call tools with correct arguments.', agent: 'tool-router' },
  { slug: 'auto-routing', name: 'Auto Routing', category: 'Agent', desc: 'Route every task to the agents + tools it needs — no manual instruction.', agent: 'tool-router' },
  { slug: 'tool-building', name: 'Tool Building', category: 'Agent', desc: 'Design new reusable tools.', agent: 'toolsmith' },
  { slug: 'api-integration', name: 'API Integration', category: 'Agent', desc: 'Wire external APIs as tools.', agent: 'toolsmith' },
  { slug: 'orchestration', name: 'Orchestration', category: 'Agent', desc: 'Sequence tools and agents safely.', agent: 'toolsmith' },
  { slug: 'rolling-summary', name: 'Rolling Summary', category: 'Memory', desc: 'Compact running summary of the whole conversation.', agent: 'context-manager' },
  { slug: 'context-compaction', name: 'Context Compaction', category: 'Memory', desc: 'Compress old turns when context gets long.', agent: 'context-manager' },
  { slug: 'continuity', name: 'Continuity', category: 'Memory', desc: 'Never lose the thread across turns.', agent: 'context-manager' },
  { slug: 'episodic-memory', name: 'Episodic Memory', category: 'Memory', desc: 'Remember what happened in past sessions.', agent: 'archivist' },
  { slug: 'forgetting-curve', name: 'Forgetting Curve', category: 'Memory', desc: 'Prune by importance × recency.', agent: 'archivist' },
  { slug: 'memory-consolidation', name: 'Memory Consolidation', category: 'Memory', desc: 'Merge and summarize old memories.', agent: 'archivist' },
  { slug: 'document-rag', name: 'Document RAG', category: 'Knowledge', desc: 'Answer from uploaded documents with chunked retrieval.', agent: 'document-analyst' },
  { slug: 'chunking', name: 'Chunking', category: 'Knowledge', desc: 'Split documents into retrievable chunks.', agent: 'document-analyst' },
  { slug: 'retrieval', name: 'Retrieval', category: 'Knowledge', desc: 'Find the right passages fast.', agent: 'document-analyst' },
  { slug: 'data-pipelines', name: 'Data Pipelines', category: 'Data', desc: 'Move and transform data.', agent: 'data-engineer' },
  { slug: 'etl', name: 'ETL', category: 'Data', desc: 'Extract, transform, load.', agent: 'data-engineer' },
  { slug: 'cleansing', name: 'Cleansing', category: 'Data', desc: 'Clean messy datasets.', agent: 'data-engineer' },
  { slug: 'critical-review', name: 'Critical Review', category: 'Quality', desc: 'Strict critique of plans and outputs.', agent: 'critic' },
  { slug: 'output-quality', name: 'Output Quality', category: 'Quality', desc: 'Enforce readable, complete, correct output.', agent: 'critic' },
  { slug: 'self-consistency', name: 'Self-Consistency', category: 'Quality', desc: 'Cross-check the answer against itself.', agent: 'critic' },
  { slug: 'guardrails', name: 'Guardrails', category: 'Safety', desc: 'Input/output safety checks.', agent: 'guardrail' },
  { slug: 'safety-checks', name: 'Safety Checks', category: 'Safety', desc: 'Decline unsafe or destructive requests.', agent: 'guardrail' },
  { slug: 'refusal', name: 'Refusal', category: 'Safety', desc: 'Refuse with a reason, not a lecture.', agent: 'guardrail' },

  // Round 4 — platform/stack depth (the VoltAgent/TestMu/Composio skill catalogs:
  // real dev teams ship skills for every platform, stack and workflow)
  { slug: 'mobile', name: 'Mobile', category: 'Engineering', desc: 'Cross-platform mobile development.', agent: 'mobile-engineer' },
  { slug: 'ios', name: 'iOS', category: 'Engineering', desc: 'Native iPhone/iPad development.', agent: 'ios-engineer' },
  { slug: 'android', name: 'Android', category: 'Engineering', desc: 'Native Android development.', agent: 'android-engineer' },
  { slug: 'react-native', name: 'React Native', category: 'Engineering', desc: 'React Native cross-platform apps.', agent: 'react-native-engineer' },
  { slug: 'flutter', name: 'Flutter', category: 'Engineering', desc: 'Flutter/Dart cross-platform apps.', agent: 'mobile-engineer' },
  { slug: 'swift', name: 'Swift', category: 'Engineering', desc: 'Swift and SwiftUI.', agent: 'ios-engineer' },
  { slug: 'kotlin', name: 'Kotlin', category: 'Engineering', desc: 'Kotlin and Jetpack Compose.', agent: 'android-engineer' },
  { slug: 'game-dev', name: 'Game Development', category: 'Engineering', desc: 'Game design and engine work.', agent: 'game-developer' },
  { slug: 'unity', name: 'Unity', category: 'Engineering', desc: 'Unity engine and C#.', agent: 'game-developer' },
  { slug: 'unreal', name: 'Unreal', category: 'Engineering', desc: 'Unreal Engine and Blueprints.', agent: 'game-developer' },
  { slug: 'graphics', name: 'Graphics', category: 'Engineering', desc: 'Rendering, shaders, animation.', agent: 'game-developer' },
  { slug: 'ml', name: 'Machine Learning', category: 'Engineering', desc: 'Model design and training.', agent: 'ml-engineer' },
  { slug: 'model-training', name: 'Model Training', category: 'Engineering', desc: 'Train and validate models.', agent: 'ml-engineer' },
  { slug: 'fine-tuning', name: 'Fine-Tuning', category: 'Engineering', desc: 'Adapt pretrained models.', agent: 'ml-engineer' },
  { slug: 'embeddings', name: 'Embeddings', category: 'Engineering', desc: 'Vector representations and search.', agent: 'ml-engineer' },
  { slug: 'modeling', name: 'Modeling', category: 'Engineering', desc: 'Statistical and ML modeling.', agent: 'data-scientist' },
  { slug: 'evaluation', name: 'Evaluation', category: 'Engineering', desc: 'Benchmarks and quality metrics.', agent: 'data-scientist' },
  { slug: 'cli', name: 'CLI', category: 'Engineering', desc: 'Command-line tools.', agent: 'devtools-engineer' },
  { slug: 'sdk', name: 'SDK', category: 'Engineering', desc: 'Developer SDKs.', agent: 'devtools-engineer' },
  { slug: 'cloud', name: 'Cloud', category: 'Engineering', desc: 'Cloud platforms and services.', agent: 'cloud-engineer' },
  { slug: 'aws', name: 'AWS', category: 'Engineering', desc: 'AWS services.', agent: 'cloud-engineer' },
  { slug: 'gcp', name: 'GCP', category: 'Engineering', desc: 'Google Cloud services.', agent: 'cloud-engineer' },
  { slug: 'azure', name: 'Azure', category: 'Engineering', desc: 'Microsoft Azure services.', agent: 'cloud-engineer' },
  { slug: 'kubernetes', name: 'Kubernetes', category: 'Engineering', desc: 'Container orchestration.', agent: 'kubernetes-engineer' },
  { slug: 'containers', name: 'Containers', category: 'Engineering', desc: 'Docker and container runtimes.', agent: 'kubernetes-engineer' },
  { slug: 'helm', name: 'Helm', category: 'Engineering', desc: 'Kubernetes packaging.', agent: 'kubernetes-engineer' },
  { slug: 'terraform', name: 'Terraform', category: 'Engineering', desc: 'Infrastructure as code.', agent: 'terraform-engineer' },
  { slug: 'iac', name: 'IaC', category: 'Engineering', desc: 'Infrastructure automation.', agent: 'terraform-engineer' },
  { slug: 'api-design', name: 'API Design', category: 'Engineering', desc: 'Endpoint and contract design.', agent: 'api-engineer' },
  { slug: 'rest', name: 'REST', category: 'Engineering', desc: 'RESTful APIs.', agent: 'api-engineer' },
  { slug: 'graphql', name: 'GraphQL', category: 'Engineering', desc: 'GraphQL APIs.', agent: 'api-engineer' },
  { slug: 'openapi', name: 'OpenAPI', category: 'Engineering', desc: 'OpenAPI specs and tooling.', agent: 'api-engineer' },
  { slug: 'oauth', name: 'OAuth', category: 'Engineering', desc: 'OAuth flows and tokens.', agent: 'auth-engineer' },
  { slug: 'database', name: 'Database', category: 'Engineering', desc: 'Database design and ops.', agent: 'database-ops' },
  { slug: 'postgres', name: 'Postgres', category: 'Engineering', desc: 'PostgreSQL administration.', agent: 'database-ops' },
  { slug: 'redis', name: 'Redis', category: 'Engineering', desc: 'Redis caching and state.', agent: 'database-ops' },
  { slug: 'backups', name: 'Backups', category: 'Engineering', desc: 'Backup and recovery planning.', agent: 'backup-engineer' },
  { slug: 'sre', name: 'SRE', category: 'DevOps', desc: 'Site reliability engineering.', agent: 'sre' },
  { slug: 'reliability', name: 'Reliability', category: 'DevOps', desc: 'Uptime and resilience.', agent: 'sre' },
  { slug: 'incident-response', name: 'Incident Response', category: 'DevOps', desc: 'Handle outages and incidents.', agent: 'sre' },
  { slug: 'on-call', name: 'On-Call', category: 'DevOps', desc: 'Runbooks and escalation.', agent: 'sre' },
  { slug: 'monitoring', name: 'Monitoring', category: 'DevOps', desc: 'System and app monitoring.', agent: 'monitoring-engineer' },
  { slug: 'observability', name: 'Observability', category: 'DevOps', desc: 'Metrics, logs, traces.', agent: 'monitoring-engineer' },
  { slug: 'alerting', name: 'Alerting', category: 'DevOps', desc: 'Alert rules and paging.', agent: 'monitoring-engineer' },
  { slug: 'tracing', name: 'Tracing', category: 'DevOps', desc: 'Distributed tracing.', agent: 'log-analyst' },
  { slug: 'correlation', name: 'Correlation', category: 'DevOps', desc: 'Connect logs and events.', agent: 'log-analyst' },
  { slug: 'cost', name: 'Cost', category: 'DevOps', desc: 'Cost analysis and savings.', agent: 'cost-optimizer' },
  { slug: 'billing', name: 'Billing', category: 'DevOps', desc: 'Usage and billing data.', agent: 'cost-optimizer' },
  { slug: 'release', name: 'Release', category: 'DevOps', desc: 'Release management.', agent: 'release-engineer' },
  { slug: 'versioning', name: 'Versioning', category: 'DevOps', desc: 'Version and tag strategy.', agent: 'release-engineer' },
  { slug: 'pipelines', name: 'Pipelines', category: 'DevOps', desc: 'Build and test pipelines.', agent: 'ci-engineer' },
  { slug: 'networking', name: 'Networking', category: 'DevOps', desc: 'Networks and load balancers.', agent: 'network-engineer' },
  { slug: 'dns', name: 'DNS', category: 'DevOps', desc: 'DNS records and routing.', agent: 'network-engineer' },
  { slug: 'tls', name: 'TLS', category: 'DevOps', desc: 'Certificates and HTTPS.', agent: 'network-engineer' },
  { slug: 'disaster-recovery', name: 'Disaster Recovery', category: 'DevOps', desc: 'DR plans and restores.', agent: 'backup-engineer' },
  { slug: 'rollback', name: 'Rollback', category: 'DevOps', desc: 'Safe rollbacks.', agent: 'deploy-engineer' },
  { slug: 'zero-downtime', name: 'Zero Downtime', category: 'DevOps', desc: 'No-downtime deploys.', agent: 'deploy-engineer' },
  { slug: 'audit', name: 'Audit', category: 'DevOps', desc: 'Infrastructure audits.', agent: 'infra-auditor' },
  { slug: 'mlops', name: 'MLOps', category: 'DevOps', desc: 'Model pipelines in production.', agent: 'ml-ops' },
  { slug: 'model-serving', name: 'Model Serving', category: 'DevOps', desc: 'Serve models at scale.', agent: 'ml-ops' },

  // Security depth
  { slug: 'pentest', name: 'Penetration Testing', category: 'Security', desc: 'Find exploitable weaknesses.', agent: 'pentester' },
  { slug: 'exploitation', name: 'Exploitation', category: 'Security', desc: 'Prove impact of a flaw.', agent: 'pentester' },
  { slug: 'owasp', name: 'OWASP', category: 'Security', desc: 'OWASP Top 10 coverage.', agent: 'pentester' },
  { slug: 'red-team', name: 'Red Team', category: 'Security', desc: 'Adversary simulation.', agent: 'red-team' },
  { slug: 'social-engineering', name: 'Social Engineering', category: 'Security', desc: 'Human attack surfaces.', agent: 'red-team' },
  { slug: 'blue-team', name: 'Blue Team', category: 'Security', desc: 'Defense and detection.', agent: 'blue-team' },
  { slug: 'defense', name: 'Defense', category: 'Security', desc: 'Hardening and controls.', agent: 'blue-team' },
  { slug: 'appsec', name: 'AppSec', category: 'Security', desc: 'Application security.', agent: 'appsec' },
  { slug: 'sast', name: 'SAST', category: 'Security', desc: 'Static analysis.', agent: 'appsec' },
  { slug: 'dast', name: 'DAST', category: 'Security', desc: 'Dynamic testing.', agent: 'appsec' },
  { slug: 'cryptography', name: 'Cryptography', category: 'Security', desc: 'Encryption and hashing.', agent: 'cryptographer' },
  { slug: 'encryption', name: 'Encryption', category: 'Security', desc: 'Data at rest and in transit.', agent: 'cryptographer' },
  { slug: 'hashing', name: 'Hashing', category: 'Security', desc: 'Digests and passwords.', agent: 'cryptographer' },
  { slug: 'privacy', name: 'Privacy', category: 'Security', desc: 'Data privacy practices.', agent: 'privacy-officer' },
  { slug: 'gdpr', name: 'GDPR', category: 'Security', desc: 'GDPR compliance.', agent: 'privacy-officer' },
  { slug: 'data-protection', name: 'Data Protection', category: 'Security', desc: 'Protect personal data.', agent: 'privacy-officer' },
  { slug: 'compliance', name: 'Compliance', category: 'Security', desc: 'Regulatory compliance.', agent: 'compliance-officer' },
  { slug: 'iso', name: 'ISO 27001', category: 'Security', desc: 'ISO standards.', agent: 'compliance-officer' },
  { slug: 'soc2', name: 'SOC 2', category: 'Security', desc: 'SOC 2 readiness.', agent: 'compliance-officer' },
  { slug: 'forensics', name: 'Forensics', category: 'Security', desc: 'Digital forensics.', agent: 'forensic-analyst' },
  { slug: 'evidence', name: 'Evidence', category: 'Security', desc: 'Preserve and analyze evidence.', agent: 'forensic-analyst' },
  { slug: 'threat-modeling', name: 'Threat Modeling', category: 'Security', desc: 'Model attacker scenarios.', agent: 'risk-analyst' },
  { slug: 'mitigation', name: 'Mitigation', category: 'Security', desc: 'Risk reduction plans.', agent: 'risk-analyst' },
  { slug: 'security-awareness', name: 'Security Awareness', category: 'Security', desc: 'Training and policy.', agent: 'security-trainer' },

  // Data depth
  { slug: 'bi', name: 'Business Intelligence', category: 'Data', desc: 'Dashboards and KPIs.', agent: 'bi-analyst' },
  { slug: 'kpi', name: 'KPIs', category: 'Data', desc: 'Track the right metrics.', agent: 'bi-analyst' },
  { slug: 'reporting', name: 'Reporting', category: 'Data', desc: 'Structured reports.', agent: 'reporting-analyst' },
  { slug: 'metrics', name: 'Metrics', category: 'Data', desc: 'Measure outcomes.', agent: 'reporting-analyst' },
  { slug: 'dba', name: 'DBA', category: 'Data', desc: 'Database administration.', agent: 'database-admin' },
  { slug: 'tuning', name: 'Tuning', category: 'Data', desc: 'Query and index tuning.', agent: 'database-admin' },
  { slug: 'data-quality', name: 'Data Quality', category: 'Data', desc: 'Clean, valid data.', agent: 'data-quality' },
  { slug: 'validation', name: 'Validation', category: 'Data', desc: 'Schema and constraint checks.', agent: 'data-quality' },
  { slug: 'governance', name: 'Governance', category: 'Data', desc: 'Data ownership and policy.', agent: 'data-quality' },

  // Creative
  { slug: 'fiction', name: 'Fiction', category: 'Creative', desc: 'Novels and short stories.', agent: 'novelist' },
  { slug: 'storytelling', name: 'Storytelling', category: 'Creative', desc: 'Narrative craft.', agent: 'novelist' },
  { slug: 'world-building', name: 'World Building', category: 'Creative', desc: 'Believable settings.', agent: 'novelist' },
  { slug: 'screenwriting', name: 'Screenwriting', category: 'Creative', desc: 'Scripts for film and TV.', agent: 'screenwriter' },
  { slug: 'screenplay', name: 'Screenplay', category: 'Creative', desc: 'Format and structure.', agent: 'screenwriter' },
  { slug: 'dialogue', name: 'Dialogue', category: 'Creative', desc: 'Natural character voices.', agent: 'screenwriter' },
  { slug: 'poetry', name: 'Poetry', category: 'Creative', desc: 'Poems and verse.', agent: 'poet' },
  { slug: 'verse', name: 'Verse', category: 'Creative', desc: 'Meter and rhyme.', agent: 'poet' },
  { slug: 'songwriting', name: 'Songwriting', category: 'Creative', desc: 'Songs and hooks.', agent: 'songwriter' },
  { slug: 'lyrics', name: 'Lyrics', category: 'Creative', desc: 'Lyrics that sing.', agent: 'songwriter' },
  { slug: 'illustration', name: 'Illustration', category: 'Creative', desc: 'Drawings and visuals.', agent: 'illustrator' },
  { slug: 'art-direction', name: 'Art Direction', category: 'Creative', desc: 'Visual concept direction.', agent: 'illustrator' },
  { slug: 'video-scripts', name: 'Video Scripts', category: 'Creative', desc: 'Scripts for video.', agent: 'video-script-writer' },
  { slug: 'hooks', name: 'Hooks', category: 'Creative', desc: 'Openings that grab.', agent: 'video-script-writer' },
  { slug: 'timestamped-captions', name: 'Timestamped Captions', category: 'Media', desc: 'Captions with precise timecodes.', agent: 'video-analyst' },
  { slug: 'frame-analysis', name: 'Frame Analysis', category: 'Media', desc: 'Inspect video frames for visual context.', agent: 'video-analyst' },
  { slug: 'visual-understanding', name: 'Visual Understanding', category: 'Media', desc: 'Describe what appears on screen.', agent: 'video-analyst' },
  { slug: 'video-transcript-analysis', name: 'Video Transcript Analysis', category: 'Media', desc: 'Summarize and quote spoken content.', agent: 'video-analyst' },
  { slug: 'key-moments', name: 'Key Moments', category: 'Media', desc: 'Pinpoint pivotal timestamps.', agent: 'video-analyst' },
  { slug: 'podcasting', name: 'Podcasting', category: 'Creative', desc: 'Podcast episodes.', agent: 'podcaster' },
  { slug: 'audio', name: 'Audio', category: 'Creative', desc: 'Audio production.', agent: 'podcaster' },
  { slug: 'rhetoric', name: 'Rhetoric', category: 'Creative', desc: 'Persuasive structure.', agent: 'speech-writer' },
  { slug: 'persuasion', name: 'Persuasion', category: 'Creative', desc: 'Convincing arguments.', agent: 'speech-writer' },
  { slug: 'essays', name: 'Essays', category: 'Creative', desc: 'Argument-driven essays.', agent: 'essayist' },
  { slug: 'thesis', name: 'Thesis', category: 'Creative', desc: 'Central argument craft.', agent: 'essayist' },
  { slug: 'grants', name: 'Grants', category: 'Creative', desc: 'Grant applications.', agent: 'grant-writer' },
  { slug: 'proposals', name: 'Proposals', category: 'Creative', desc: 'Persuasive proposals.', agent: 'grant-writer' },
  { slug: 'newsletters', name: 'Newsletters', category: 'Creative', desc: 'Email newsletters.', agent: 'newsletter-writer' },
  { slug: 'cadence', name: 'Cadence', category: 'Creative', desc: 'Publishing rhythm.', agent: 'newsletter-writer' },
  { slug: 'seo', name: 'SEO', category: 'Creative', desc: 'Search-optimized content.', agent: 'seo-writer' },
  { slug: 'keywords', name: 'Keywords', category: 'Creative', desc: 'Keyword targeting.', agent: 'seo-writer' },
  { slug: 'ad-copy', name: 'Ad Copy', category: 'Creative', desc: 'Ads that convert.', agent: 'ad-copywriter' },
  { slug: 'conversion', name: 'Conversion', category: 'Creative', desc: 'Call-to-action craft.', agent: 'ad-copywriter' },
  { slug: 'a-b-testing', name: 'A/B Testing', category: 'Creative', desc: 'Test copy variations.', agent: 'ad-copywriter' },
  { slug: 'ghostwriting', name: 'Ghostwriting', category: 'Creative', desc: 'Write in another voice.', agent: 'ghostwriter' },
  { slug: 'voice-matching', name: 'Voice Matching', category: 'Creative', desc: 'Match tone and style.', agent: 'ghostwriter' },

  // Business
  { slug: 'business-analysis', name: 'Business Analysis', category: 'Business', desc: 'Requirements and process.', agent: 'business-analyst' },
  { slug: 'process', name: 'Process', category: 'Business', desc: 'Workflow design.', agent: 'business-analyst' },
  { slug: 'market-research', name: 'Market Research', category: 'Business', desc: 'Market sizing and demand.', agent: 'market-analyst' },
  { slug: 'competitive', name: 'Competitive', category: 'Business', desc: 'Competitor analysis.', agent: 'market-analyst' },
  { slug: 'tamo', name: 'TAM/SAM/SOM', category: 'Business', desc: 'Market math.', agent: 'market-analyst' },
  { slug: 'startups', name: 'Startups', category: 'Business', desc: 'Early-stage strategy.', agent: 'startup-advisor' },
  { slug: 'mvp', name: 'MVP', category: 'Business', desc: 'Minimum viable product.', agent: 'startup-advisor' },
  { slug: 'product-market-fit', name: 'Product-Market Fit', category: 'Business', desc: 'Fit and traction.', agent: 'startup-advisor' },
  { slug: 'financial-planning', name: 'Financial Planning', category: 'Business', desc: 'Long-term money plans.', agent: 'financial-advisor' },
  { slug: 'retirement', name: 'Retirement', category: 'Business', desc: 'Retirement planning.', agent: 'financial-advisor' },
  { slug: 'investing', name: 'Investing', category: 'Business', desc: 'Investment strategy.', agent: 'investor' },
  { slug: 'portfolio', name: 'Portfolio', category: 'Business', desc: 'Portfolio allocation.', agent: 'investor' },
  { slug: 'stocks', name: 'Stocks', category: 'Business', desc: 'Equities and markets.', agent: 'investor' },
  { slug: 'tax', name: 'Tax', category: 'Business', desc: 'Taxes and deductions.', agent: 'tax-advisor' },
  { slug: 'deductions', name: 'Deductions', category: 'Business', desc: 'Legitimate deductions.', agent: 'tax-advisor' },
  { slug: 'sales', name: 'Sales', category: 'Business', desc: 'Sales pipeline.', agent: 'sales-rep' },
  { slug: 'outreach', name: 'Outreach', category: 'Business', desc: 'Prospecting messages.', agent: 'sales-rep' },
  { slug: 'crm', name: 'CRM', category: 'Business', desc: 'Customer records.', agent: 'crm-specialist' },
  { slug: 'leads', name: 'Leads', category: 'Business', desc: 'Lead tracking.', agent: 'crm-specialist' },
  { slug: 'retention', name: 'Retention', category: 'Business', desc: 'Keep customers.', agent: 'customer-success' },
  { slug: 'onboarding', name: 'Onboarding', category: 'Business', desc: 'First-week success.', agent: 'customer-success' },
  { slug: 'support', name: 'Support', category: 'Business', desc: 'Customer support.', agent: 'support-engineer' },
  { slug: 'troubleshooting', name: 'Troubleshooting', category: 'Business', desc: 'Diagnose issues.', agent: 'support-engineer' },
  { slug: 'escalation', name: 'Escalation', category: 'Business', desc: 'Route hard cases.', agent: 'support-engineer' },
  { slug: 'hr', name: 'HR', category: 'Business', desc: 'People operations.', agent: 'hr-specialist' },
  { slug: 'hiring', name: 'Hiring', category: 'Business', desc: 'Hiring process.', agent: 'hr-specialist' },
  { slug: 'recruiting', name: 'Recruiting', category: 'Business', desc: 'Talent sourcing.', agent: 'recruiter' },
  { slug: 'sourcing', name: 'Sourcing', category: 'Business', desc: 'Candidate search.', agent: 'recruiter' },
  { slug: 'pricing', name: 'Pricing', category: 'Business', desc: 'Price strategy.', agent: 'pricing-strategist' },
  { slug: 'monetization', name: 'Monetization', category: 'Business', desc: 'Revenue models.', agent: 'pricing-strategist' },
  { slug: 'ops', name: 'Operations', category: 'Business', desc: 'Run the business.', agent: 'operations-manager' },
  { slug: 'workflow', name: 'Workflow', category: 'Business', desc: 'Process automation.', agent: 'operations-manager' },

  // Life & coaching
  { slug: 'counseling', name: 'Counseling', category: 'Life', desc: 'Supportive listening.', agent: 'counselor' },
  { slug: 'empathy', name: 'Empathy', category: 'Life', desc: 'Understand feelings.', agent: 'counselor' },
  { slug: 'listening', name: 'Listening', category: 'Life', desc: 'Active listening.', agent: 'counselor' },
  { slug: 'relationships', name: 'Relationships', category: 'Life', desc: 'Partnership guidance.', agent: 'relationship-coach' },
  { slug: 'conflict', name: 'Conflict', category: 'Life', desc: 'Conflict resolution.', agent: 'relationship-coach' },
  { slug: 'sleep', name: 'Sleep', category: 'Life', desc: 'Sleep routines.', agent: 'sleep-coach' },
  { slug: 'rest', name: 'Rest', category: 'Life', desc: 'Recovery and rest.', agent: 'sleep-coach' },
  { slug: 'meditation', name: 'Meditation', category: 'Life', desc: 'Meditation practice.', agent: 'meditation-coach' },
  { slug: 'mindfulness', name: 'Mindfulness', category: 'Life', desc: 'Present-moment focus.', agent: 'meditation-coach' },
  { slug: 'pets', name: 'Pets', category: 'Life', desc: 'Pet care.', agent: 'pet-care' },
  { slug: 'pet-training', name: 'Pet Training', category: 'Life', desc: 'Train pets.', agent: 'pet-care' },
  { slug: 'gardening', name: 'Gardening', category: 'Life', desc: 'Grow plants.', agent: 'gardener' },
  { slug: 'plants', name: 'Plants', category: 'Life', desc: 'Plant care.', agent: 'gardener' },
  { slug: 'organization', name: 'Organization', category: 'Life', desc: 'Declutter and sort.', agent: 'home-org' },
  { slug: 'decluttering', name: 'Decluttering', category: 'Life', desc: 'Simplify spaces.', agent: 'home-org' },
  { slug: 'interior-design', name: 'Interior Design', category: 'Life', desc: 'Room design.', agent: 'interior-designer' },
  { slug: 'styling', name: 'Styling', category: 'Life', desc: 'Space styling.', agent: 'interior-designer' },
  { slug: 'fashion', name: 'Fashion', category: 'Life', desc: 'Style guidance.', agent: 'fashion-stylist' },
  { slug: 'wardrobe', name: 'Wardrobe', category: 'Life', desc: 'Wardrobe planning.', agent: 'fashion-stylist' },
  { slug: 'skincare', name: 'Skincare', category: 'Life', desc: 'Skin routines.', agent: 'beauty-advisor' },
  { slug: 'beauty', name: 'Beauty', category: 'Life', desc: 'Beauty routines.', agent: 'beauty-advisor' },
  { slug: 'weddings', name: 'Weddings', category: 'Life', desc: 'Wedding planning.', agent: 'wedding-planner' },
  { slug: 'vendors', name: 'Vendors', category: 'Life', desc: 'Vendor management.', agent: 'wedding-planner' },
  { slug: 'events', name: 'Events', category: 'Life', desc: 'Event planning.', agent: 'event-planner' },
  { slug: 'logistics', name: 'Logistics', category: 'Life', desc: 'Event logistics.', agent: 'event-planner' },
  { slug: 'dating', name: 'Dating', category: 'Life', desc: 'Dating guidance.', agent: 'dating-coach' },
  { slug: 'dating-profiles', name: 'Dating Profiles', category: 'Life', desc: 'Profile writing.', agent: 'dating-coach' },
  { slug: 'cooking', name: 'Cooking', category: 'Life', desc: 'Recipes and technique.', agent: 'chef' },
  { slug: 'recipes', name: 'Recipes', category: 'Life', desc: 'Recipe development.', agent: 'chef' },

  // Education
  { slug: 'homework', name: 'Homework', category: 'Education', desc: 'Homework help.', agent: 'homework-helper' },
  { slug: 'practice-problems', name: 'Practice Problems', category: 'Education', desc: 'Practice sets.', agent: 'homework-helper' },
  { slug: 'exam-prep', name: 'Exam Prep', category: 'Education', desc: 'Exam readiness.', agent: 'exam-coach' },
  { slug: 'test-prep', name: 'Test Prep', category: 'Education', desc: 'Test strategy.', agent: 'exam-coach' },
  { slug: 'flashcards', name: 'Flashcards', category: 'Education', desc: 'Flashcard decks.', agent: 'flashcard-maker' },
  { slug: 'spaced-repetition', name: 'Spaced Repetition', category: 'Education', desc: 'Review scheduling.', agent: 'flashcard-maker' },
  { slug: 'grading', name: 'Grading', category: 'Education', desc: 'Grade work fairly.', agent: 'grader' },
  { slug: 'rubrics', name: 'Rubrics', category: 'Education', desc: 'Scoring rubrics.', agent: 'grader' },
  { slug: 'curriculum-design', name: 'Curriculum Design', category: 'Education', desc: 'Course design.', agent: 'curriculum-designer' },
  { slug: 'standards', name: 'Standards', category: 'Education', desc: 'Learning standards.', agent: 'curriculum-designer' },
  { slug: 'labs', name: 'Labs', category: 'Education', desc: 'Lab work.', agent: 'lab-assistant' },
  { slug: 'experiments', name: 'Experiments', category: 'Education', desc: 'Experiment design.', agent: 'lab-assistant' },
  { slug: 'research-mentoring', name: 'Research Mentoring', category: 'Education', desc: 'Mentor research.', agent: 'research-mentor' },
  { slug: 'academic-writing', name: 'Academic Writing', category: 'Education', desc: 'Papers and theses.', agent: 'academic-writer' },
  { slug: 'formatting', name: 'Formatting', category: 'Education', desc: 'Citations and styles.', agent: 'academic-writer' },

  // Marketing & product
  { slug: 'growth', name: 'Growth', category: 'Marketing', desc: 'Growth loops.', agent: 'growth-marketer' },
  { slug: 'funnels', name: 'Funnels', category: 'Marketing', desc: 'Conversion funnels.', agent: 'growth-marketer' },
  { slug: 'seo-strategy', name: 'SEO Strategy', category: 'Marketing', desc: 'Ranking strategy.', agent: 'seo-specialist' },
  { slug: 'ranking-analytics', name: 'Ranking Analytics', category: 'Marketing', desc: 'Search analytics.', agent: 'seo-specialist' },
  { slug: 'positioning', name: 'Positioning', category: 'Marketing', desc: 'Market position.', agent: 'product-marketer' },
  { slug: 'messaging', name: 'Messaging', category: 'Marketing', desc: 'Message hierarchy.', agent: 'product-marketer' },
  { slug: 'launches', name: 'Launches', category: 'Marketing', desc: 'Product launches.', agent: 'product-marketer' },
  { slug: 'lifecycle', name: 'Lifecycle', category: 'Marketing', desc: 'Customer lifecycle.', agent: 'lifecycle-marketer' },
  { slug: 'email-campaigns', name: 'Email Campaigns', category: 'Marketing', desc: 'Campaign sequences.', agent: 'lifecycle-marketer' },
  { slug: 'community', name: 'Community', category: 'Marketing', desc: 'Community building.', agent: 'community-manager' },
  { slug: 'moderation', name: 'Moderation', category: 'Marketing', desc: 'Moderate spaces.', agent: 'community-manager' },

  // Writing depth
  { slug: 'technical-editing', name: 'Technical Editing', category: 'Writing', desc: 'Edit technical text.', agent: 'technical-editor' },
  { slug: 'accuracy', name: 'Accuracy', category: 'Writing', desc: 'Factual precision.', agent: 'technical-editor' },
  { slug: 'microcopy', name: 'Microcopy', category: 'Writing', desc: 'Tiny UI text.', agent: 'ux-writer' },
  { slug: 'ui-text', name: 'UI Text', category: 'Writing', desc: 'Interface language.', agent: 'ux-writer' },
  { slug: 'copyediting', name: 'Copyediting', category: 'Writing', desc: 'Line-level editing.', agent: 'copyeditor' },
  { slug: 'style-guides', name: 'Style Guides', category: 'Writing', desc: 'Style compliance.', agent: 'copyeditor' },
  { slug: 'blogs', name: 'Blogs', category: 'Writing', desc: 'Blog posts.', agent: 'blog-writer' },
  { slug: 'posts', name: 'Posts', category: 'Writing', desc: 'Web articles.', agent: 'blog-writer' },
  { slug: 'white-papers', name: 'White Papers', category: 'Writing', desc: 'Authority documents.', agent: 'white-paper-writer' },
  { slug: 'authority', name: 'Authority', category: 'Writing', desc: 'Expert credibility.', agent: 'white-paper-writer' },
  { slug: 'case-studies', name: 'Case Studies', category: 'Writing', desc: 'Customer proof.', agent: 'case-study-writer' },
  { slug: 'outcomes', name: 'Outcomes', category: 'Writing', desc: 'Measured results.', agent: 'case-study-writer' },

  // Productivity & system
  { slug: 'scheduling', name: 'Scheduling', category: 'Productivity', desc: 'Plan time.', agent: 'scheduler' },
  { slug: 'calendars', name: 'Calendars', category: 'Productivity', desc: 'Calendar blocks.', agent: 'scheduler' },
  { slug: 'time-management', name: 'Time Management', category: 'Productivity', desc: 'Protect focus time.', agent: 'scheduler' },
  { slug: 'note-taking', name: 'Note Taking', category: 'Productivity', desc: 'Capture ideas.', agent: 'note-taker' },
  { slug: 'action-items', name: 'Action Items', category: 'Productivity', desc: 'Next steps.', agent: 'note-taker' },
  { slug: 'agendas', name: 'Agendas', category: 'Productivity', desc: 'Meeting plans.', agent: 'meeting-planner' },
  { slug: 'minutes', name: 'Minutes', category: 'Productivity', desc: 'Meeting notes.', agent: 'meeting-planner' },
  { slug: 'expenses', name: 'Expenses', category: 'Productivity', desc: 'Track spending.', agent: 'expense-tracker' },
  { slug: 'receipts', name: 'Receipts', category: 'Productivity', desc: 'Receipt logging.', agent: 'expense-tracker' },
  { slug: 'tasks', name: 'Tasks', category: 'Productivity', desc: 'Task lists.', agent: 'task-manager' },
  { slug: 'priorities', name: 'Priorities', category: 'Productivity', desc: 'Priority sorting.', agent: 'task-manager' },
  { slug: 'gtd', name: 'GTD', category: 'Productivity', desc: 'Getting Things Done.', agent: 'task-manager' },
  { slug: 'email-triage', name: 'Email Triage', category: 'Productivity', desc: 'Inbox zero.', agent: 'email-triage' },
  { slug: 'inbox', name: 'Inbox', category: 'Productivity', desc: 'Inbox management.', agent: 'email-triage' },
];

/** Counts for the "60+ agents, 100+ skills" claim — computed, never hardcoded. */
export const ROSTER_COUNT = AGENT_ROSTER.length;
export const SKILL_COUNT = SKILL_REGISTRY.length;

const rosterBySlug = new Map(AGENT_ROSTER.map((a) => [a.slug, a]));
const skillBySlug = new Map(SKILL_REGISTRY.map((s) => [s.slug, s]));

/** Look up one specialist. */
export function getAgent(slug) {
  return rosterBySlug.get(slug) || null;
}

/** Look up one skill. */
export function getSkill(slug) {
  return skillBySlug.get(slug) || null;
}

/** The skill slugs a specialist masters. */
export function agentSkills(slug) {
  const agent = getAgent(slug);
  return (agent?.skills || []).map((s) => getSkill(s)).filter(Boolean);
}

/** Compose the roster of specialists for an intent (a small, focused subset —
 *  that is the whole trick: catalog big, team small, per task). Delegates to
 *  TEAM_PLAN (Planner.js) — the single team map — so the plan UI helpers and
 *  the planner use the exact same composition and can never drift. Every roster
 *  entry must be reachable via a TEAM_PLAN value, a COMPOUND_DETECT phase, or a
 *  SkillChain runSkill pass; scripts/audit-roster.js enforces zero orphans. */
export function composeTeam(intent, extra = {}) {
  const slugs = intent === 'compound_task'
    ? (extra.steps || []).flatMap((s) => {
        const agent = getAgent(String(s).toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-'));
        return agent ? [agent.slug] : [];
      })
    : TEAM_PLAN[intent] || [];
  const seen = new Set();
  const team = [];
  for (const slug of slugs) {
    const agent = getAgent(slug);
    if (agent && !seen.has(slug)) {
      seen.add(slug);
      team.push(agent);
    }
  }
  return team;
}

/** Expand a team of agents into every skill they collectively master. */
export function skillsForTeam(team) {
  const seen = new Set();
  const out = [];
  for (const agent of team) {
    for (const slug of agent.skills || []) {
      const skill = getSkill(slug);
      if (skill && !seen.has(slug)) {
        seen.add(slug);
        out.push(skill);
      }
    }
  }
  return out;
}

/** Pretty one-line summary: "12 specialists · 34 skills". */
export function rosterSummary(intent, extra = {}) {
  const team = composeTeam(intent, extra);
  const skills = skillsForTeam(team);
  return `${team.length} specialists · ${skills.length} skills`;
}

/** Names of the specialists composed for an intent (for the plan UI). */
export function rosterFor(intent, extra = {}) {
  return composeTeam(intent, extra).map((a) => a.name);
}

/** Skill IDs the composed team collectively masters (for the plan UI). */
export function skillsFor(intent, extra = {}) {
  return skillsForTeam(composeTeam(intent, extra)).map((s) => s.slug);
}

/** Human-readable skills line for the pipeline stream. */
export function skillsLine(intent, extra = {}) {
  const names = skillsForTeam(composeTeam(intent, extra)).map((s) => s.name);
  return names.length ? names.slice(0, 12).join(' · ') : '';
}

/** Catalog sizes for stats displays ("60+ agents · 100+ skills"). */
export function rosterStats() {
  return { agents: ROSTER_COUNT, skills: SKILL_COUNT };
}
