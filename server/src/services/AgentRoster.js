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
  { slug: 'memory', name: 'Memory Agent', role: 'Long-term memory: facts, preferences, tf-idf scoring, consolidation.', skills: ['memory', 'facts', 'preferences', 'consolidation'] },
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
];

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
 *  that is the whole trick: catalog big, team small, per task). */
export function composeTeam(intent, extra = {}) {
  const map = {
    image_recognition: ['vision', 'reasoner', 'memory'],
    clear_memory: ['memory'],
    link_analysis: ['navigator', 'extractor', 'reasoner', 'memory'],
    math_solve: ['math', 'reasoner', 'memory'],
    self_check: ['self-diagnose', 'reasoner', 'memory'],
    code_task: ['product', 'designer', 'engineer', 'architect', 'coder', 'runner', 'debugger', 'qa', 'reviewer', 'security', 'shipper', 'reflector'],
    computer_use: ['navigator', 'vision', 'reasoner', 'memory'],
    study_topic: ['scholar', 'researcher', 'memory'],
    conversation: ['jexi'],
    memory_query: ['memory'],
    knowledge_recall: ['books', 'reasoner', 'memory'],
    news_latest: ['news-scout', 'news-filter', 'news-editor', 'reasoner', 'memory'],
    research: ['query-analyzer', 'searcher', 'reranker', 'extractor', 'synthesizer', 'fact-checker', 'memory'],
    learning_research: ['researcher', 'reasoner', 'memory'],
    explain_team: ['planner'],
    github: ['github', 'shipper'],
    translate: ['translator', 'reviewer'],
    data: ['data', 'reasoner'],
    devops: ['devops', 'shipper'],
    docs: ['writer', 'reviewer'],
    perf: ['perf', 'coder', 'reviewer'],
    compound_task: (extra.steps || []).flatMap((s) => {
      const agent = getAgent(String(s).toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-'));
      return agent ? [agent.slug] : [];
    }),
  };
  const slugs = map[intent] || [];
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
