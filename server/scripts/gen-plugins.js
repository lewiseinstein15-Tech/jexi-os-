/**
 * Generates the JEXI plugin pack: 43 knowledge/capability plugins (plus the 7
 * existing = 50). Each plugin is a package with a manifest + real skill content
 * JEXI loads through SkillChain. All free, offline, no keys.
 * Run from server/: node scripts/gen-plugins.js  (idempotent — overwrites its own)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'plugins');

const pack = [
  ['regex-toolkit', 'Regex Toolkit', 'Regular expression patterns, pitfalls and recipes for text extraction, validation and cleanup.', [
    ['regex-patterns', 'Regex patterns and pitfalls', `# Regex patterns and pitfalls

## When to use
Matching, extracting, validating or cleaning text — names, emails, dates, log lines, code tokens.

## Core guidance
- Anchor what you know: ^ start, $ end; use \\b word boundaries around tokens.
- Prefer lazy quantifiers (.*?) inside larger matches; greedy .* eats too much.
- Validate with a small positive AND negative example before trusting a pattern.
- Capture groups: ( ) to extract; (?: ) to group without capturing; (?<name> ) named.
- Common recipes:
  - email-ish: /[\\w.+-]+@[\\w-]+\\.[\\w.]+/ (full RFC validation is a trap — don't)
  - ISO date: /(\\d{4})-(\\d{2})-(\\d{2})/
  - URL host: /https?:\\/\\/([^\\/]+)/
  - strip markdown: /[#*_\`>]+/g
  - duplicated words: /\\b(\\w+)\\s+\\1\\b/gi
- Flags: g all matches, i case-insensitive, m ^$ per line, s . matches newlines.
- Never parse HTML or JSON with regex — use a parser.

## Pitfalls
- Catastrophic backtracking: nested quantifiers like (a+)+ on long strings — keep patterns flat.
- . does not match newlines without the s flag.
- Escaping: in JSON/JS strings, double the backslashes.

## Quick reference
Test order: exact string → character class → quantifier → anchor → group.`],
  ]],
  ['git-mastery', 'Git Mastery', 'Everyday git workflows plus recovery: undo, rebase, detached heads, lost commits.', [
    ['git-recovery', 'Git rescue and recovery', `# Git rescue and recovery

## When to use
Wrong commit, wrong branch, "deleted" work, messy history.

## Core guidance
- Nothing is lost until garbage-collected: git reflog shows every HEAD move.
- Undo last commit, keep changes: git reset --soft HEAD~1
- Undo last commit, discard: git reset --hard HEAD~1 (LAST resort)
- Unstage: git restore --staged <file>; discard file: git restore <file>
- Recover any commit: git checkout -b rescue <sha-from-reflog>
- Move commits to the right branch: git cherry-pick <sha>
- Safe history rewrite on a shared branch: NEVER rebase pushed main; rebase feature branches onto main instead.
- Conflict resolution: keep both with git checkout --merge, or stage resolved files then git rebase --continue.
- Stash workflow: git stash push -m "why", git stash list, git stash pop.

## Pitfalls
- git reset --hard discards untracked-file changes silently — check git status first.
- Force-push protection: use --force-with-lease, never plain --force on shared branches.`],
    ['git-daily-flow', 'Daily git flow', `# Daily git flow

## Branching
- main = always deployable. Work on feature/<name> or fix/<name> branches.
- Update: git switch main && git pull && git switch - && git rebase main
- Ship: push branch, open PR, squash-merge with a one-line "what + why" message.

## Commits
- Small and atomic; message = imperative mood ("add retry", not "added retry").
- Before committing: git diff --staged to review exactly what ships.`],
  ]],
  ['sql-essentials', 'SQL Essentials', 'Query patterns: joins, aggregation, window functions, and how to reason about query shape.', [
    ['sql-patterns', 'SQL query patterns', `# SQL query patterns

## When to use
Any structured data question: filtering, joining, aggregating, ranking, time series.

## Core guidance
- Read a query inside-out: FROM+JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY.
- Joins: INNER keep matches; LEFT keep all left rows; avoid RIGHT (rewrite as LEFT).
- Aggregation: every SELECT column is either grouped or aggregated.
- Window functions rank WITHOUT collapsing rows:
  ROW_NUMBER() OVER (PARTITION BY user ORDER BY created_at DESC) → latest-per-group.
- Deduplicate: GROUP BY all columns, or ROW_NUMBER() = 1.
- Nulls: NULL = NULL is never true; use IS NULL / IS NOT NULL; COALESCE(x, 0).
- Dates: GROUP BY date(truncated to day/week); compare with range predicates (>= start AND < end+1).
- Run EXPLAIN before optimizing; add indexes on join keys and range-filtered columns.

## Pitfalls
- SELECT * with GROUP BY errors on strict engines.
- COUNT(col) skips NULLs; COUNT(*) counts rows.
- N+1 in app code: fetch aggregates in one query instead of looping.`],
  ]],
  ['api-design', 'API Design', 'REST and endpoint design principles: resources, verbs, status codes, versioning.', [
    ['rest-design', 'REST endpoint design', `# REST endpoint design

## When to use
Designing or reviewing an HTTP API.

## Core guidance
- Nouns for resources, verbs stay in HTTP: GET /orders/42, not /getOrder?id=42.
- Methods: GET safe+cacheable; POST create; PUT full replace (idempotent); PATCH partial; DELETE idempotent.
- Status codes that matter: 200/201+Location/204, 400 bad input, 401 unauthenticated, 403 unauthorized, 404 missing, 409 conflict, 422 semantic error, 429 rate limit, 5xx our fault.
- Pagination: cursor-based (?after=...) beats page numbers at scale.
- Errors: one shape everywhere — { error: { code, message, details? } }.
- Version in the path (/v1/) — simplest and explicit.
- Idempotency keys on POSTs that create payments/orders.

## Pitfalls
- Returning 200 with { error } — status codes are the contract.
- Chatty designs (GET per field) and fat designs (GET returns 40 fields); aim for the use case.`],
  ]],
  ['python-pro', 'Python Pro', 'Python idioms, stdlib gems, and writing code that reads like the language.', [
    ['python-idioms', 'Python idioms', `# Python idioms

## When to use
Writing or reviewing Python.

## Core guidance
- Comprehensions over loops: squares = [x*x for x in xs if x > 0]; dict/SET versions too.
- unpack: first, *rest = items; for k, v in d.items():
- f-strings for formatting: f"{name} scored {score:.1f}"
- Truthiness: if not seq: instead of if len(seq) == 0
- pathlib over string paths: Path("a") / "b" .read_text()
- dataclasses for records; Enum for closed sets; typing for signatures.
- context managers for resources: with open(...) as f: — always.
- Errors: catch the narrowest exception; never bare except:.
- stdlib gems: collections (Counter, defaultdict, deque), itertools (groupby, chain), functools (lru_cache), json, csv, argparse, statistics, datetime.

## Pitfalls
- Mutable default args (def f(x=[])) — use None sentinel.
- is vs ==: is only for None/identity.
- Shadowing stdlib names (json.py, random.py as your own module names).`],
  ]],
  ['javascript-patterns', 'JavaScript Patterns', 'Modern JS: destructuring, async patterns, array methods, modules.', [
    ['js-core-patterns', 'Modern JavaScript patterns', `# Modern JavaScript patterns

## When to use
Writing or reviewing JS/Node.

## Core guidance
- Destructure: const { id, name = 'anon' } = user; const [first, ...rest] = list;
- Array toolkit: map transform, filter select, reduce aggregate, find/ some/ every predicates, flat().
- Optional chaining + nullish: user?.address?.city ?? 'unknown'
- Async: async/await over raw promises; run independent awaits with Promise.all([...]); sequential only when dependent.
- Modules: export named by default; one default export only for the main thing.
- Template literals for strings; spread for copies: [...arr], { ...obj, override }.
- Prefer const; let only when reassigning; var never.

## Pitfalls
- await inside loops when calls are independent — batch with Promise.all.
- Floating promises (missing await/catch) — handle or explicitly ignore with a comment.
- == coercion: use === (except == null as a null+undefined check).`],
  ]],
  ['css-layout', 'CSS Layout', 'Flexbox and grid recipes that cover 95% of layouts.', [
    ['flex-grid-recipes', 'Flexbox and grid recipes', `# Flexbox and grid recipes

## When to use
Any layout, alignment, or responsive structure.

## Core guidance
- One-dimensional (row OR column) → flexbox; two-dimensional (rows AND columns) → grid.
- Center anything: display:flex; align-items:center; justify-content:center;
- Nav bar: flex + gap; spacer: margin-left:auto on the last item.
- Card grid: grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem;
- Sticky footer: body = min-height:100vh; display:flex; flex-direction:column; footer margin-top:auto.
- Responsive without media queries: auto-fill/minmax (above) + clamp() for type: font-size: clamp(0.9rem, 2vw, 1.25rem).
- Spacing scale: stick to a 4/8px rhythm; use gap, not margins between siblings.

## Pitfalls
- flex children with min-width:auto won't shrink — add min-width:0.
- Percent padding is relative to WIDTH for both axes; use aspect-ratio for boxes.`],
  ]],
  ['react-recipes', 'React Recipes', 'Hooks patterns, rendering rules, and performance that actually matters.', [
    ['react-hooks-patterns', 'React hooks patterns', `# React hooks patterns

## When to use
Building React components.

## Core guidance
- Component = function of state → UI. Derive, don't duplicate: const total = items.reduce(...) in render, not in state.
- useState for local UI state; lift up only when shared.
- useEffect ONLY for syncing with outside systems (fetch, subscriptions, DOM) — not for transforming data.
- Effect cleanup: return the unsubscribe/abort; AbortController for fetches.
- Lists: stable key={id} (never array index if items reorder).
- Forms: controlled inputs (value + onChange) until perf says otherwise.
- Perf: React.memo only after measuring; the wins are usually fewer re-renders via better state placement.
- Custom hooks to reuse stateful logic (useLocalStorage, useDebounce).

## Pitfalls
- Stale closures: effects capture the state at setup; add deps or use functional updates setX(x => x+1).
- Deriving state with useEffect causes an extra render — compute inline instead.`],
  ]],
  ['node-production', 'Node in Production', 'Running Node services: processes, errors, logs, graceful shutdown.', [
    ['node-production-practices', 'Node production practices', `# Node production practices

## When to use
Node services that must stay up.

## Core guidance
- Errors: handle at the edge (one error middleware / top-level catch); log stack + context; crash on programmer errors (TypeError), retry/flag operational ones (network).
- Timeouts on EVERY outbound call (fetch, db) — default is forever.
- Graceful shutdown: SIGTERM → stop accepting, finish in-flight, close db, exit; a healthcheck endpoint for the orchestrator.
- Env config: read once at boot, fail fast if required; 12-factor style.
- Logs: structured JSON (level, msg, requestId); never log secrets.
- Concurrency: stream large responses; queue heavy work; keep the event loop free (no sync fs/crypto on hot paths).
- One process per container; let the platform restart.

## Pitfalls
- Unhandled promise rejections — they crash modern Node; catch them.
- setInterval drift and leaked timers — clear on shutdown.`],
  ]],
  ['testing-guide', 'Testing Guide', 'What to test, how, and when to stop: unit → integration → end-to-end.', [
    ['testing-strategy', 'Testing strategy', `# Testing strategy

## When to use
Deciding what to test and at which level.

## Core guidance
- Test pyramid: many fast unit tests, some integration tests around real seams (db, http), few end-to-end flows.
- Unit test BEHAVIOR via the public API, not internals; one logical assertion per test.
- Name tests after the behavior: "rejects expired tokens", not "test4".
- Fixtures: minimal and explicit; factories when objects are big.
- Integration tests hit a REAL database (throwaway container) — mocks of queries lie.
- E2E: only money/critical paths (login, checkout, deploy).
- Coverage: use as a smoke detector (what was never run), not a target. 100% enforced = bad tests written to game it.
- Flaky test = bug in the test or real race: fix immediately or quarantine loudly.

## Pitfalls
- Mocking what you don't own (third-party SDKs) — wrap them once, mock the wrapper.
- Testing implementation details — every refactor then breaks tests without breaking behavior.`],
  ]],
  ['debugging-method', 'Debugging Method', 'A repeatable method for finding root causes instead of patching symptoms.', [
    ['systematic-debugging', 'Systematic debugging', `# Systematic debugging

## When to use
Anything broken: crash, wrong value, slow path, "it worked yesterday".

## Core guidance
1. Reproduce reliably — the exact input/state; intermittent = race/cache/env.
2. Read the actual error + stack — bottom frame in YOUR code first.
3. Form ONE hypothesis; instrument for it (log, breakpoint, bisect).
4. Change one thing, re-run, observe. Git bisect for "when did this break".
5. Fix the ROOT cause, then add the regression test that would have caught it.
- Divide and conquer: comment out halves; binary-search the input space.
- When stuck: explain the bug aloud line by line (rubber duck); wrong assumptions hide in the retelling.
- Check the boring causes first: wrong env, stale build, wrong branch, cache, timezone, trailing space.

## Pitfalls
- Shotgun debugging (change 5 things) — you learn nothing and usually add bugs.
- Fixing the symptom — the bug resurfaces with interest.`],
  ]],
  ['code-review', 'Code Review', 'A checklist that catches real problems without bikeshedding.', [
    ['review-checklist', 'Code review checklist', `# Code review checklist

## When to use
Reviewing a PR/diff.

## Order of questions
1. Correctness: does it do what it says? Edge cases (empty, one, many, huge, null, unicode)?
2. Safety: input validation at boundaries, auth checks, injection, secrets in code/logs?
3. Failure: timeouts, retries, what happens when the dependency is down?
4. Clarity: would a new teammate follow it? Names that say what it does?
5. Tests: would the suite catch this being broken again?
6. Only then style — and prefer automated formatters over review comments.

## Tone
- Ask questions instead of commands ("what happens if this is null?" beats "handle null").
- Praise genuinely good solutions — reviews teach, not just gate.
- Distinguish blocking (correctness/safety) from nits (prefix with "nit:").`],
  ]],
  ['security-basics', 'Security Basics', 'Practical defense: validation, secrets, authz, and the mistakes that get exploited.', [
    ['practical-security', 'Practical security', `# Practical security

## When to use
Any code that touches user input, auth, or data.

## Core guidance
- Validate at the boundary: type, length, format, allowlist > denylist.
- Injection: never build SQL/HTML/shell by string concatenation — parameterized queries, escaping, argv arrays.
- Secrets: env vars (never committed), rotate on exposure, different keys per environment.
- AuthN/AuthZ: hash passwords with bcrypt/argon2; session tokens random ≥128-bit; check ownership on EVERY resource request (IDOR is the #1 API bug).
- XSS: escape by default; dangerouslySetInnerHTML/innerHTML only with sanitization.
- SSRF: block fetches to internal IPs/hostnames from user-supplied URLs.
- Dependencies: lockfiles, minimal set, update for CVEs.
- Logs: never secrets/tokens/PII; sanitize errors shown to users.

## Pitfalls
- "Nobody would ever do that" — they will, automatically, within hours of launch.
- Client-side validation is UX only; the server re-validates everything.`],
  ]],
  ['performance', 'Performance', 'Measure first: profiling, hot paths, and the fixes that usually matter.', [
    ['perf-method', 'Performance method', `# Performance method

## When to use
Anything slow — but only after you MEASURED it.

## Core guidance
- Order: define the target (p95 < 300ms?) → profile → fix the top item → re-measure.
- Profile before optimizing: console.time, --prof, flamegraphs, EXPLAIN ANALYZE, chrome devtools performance tab.
- Usual suspects, in order of payoff:
  1. N+1 queries → batch/join
  2. Missing index → add, verify with EXPLAIN
  3. Payload size → paginate, select columns, compress
  4. Sequential awaits → Promise.all
  5. Reacting too often → memoize/move state down
  6. Real CPU work → cache (with TTL), precompute, move off the request path
- Caching: correct first (staleness bounds), then fast. Name cache keys after the invalidation trigger.

## Pitfalls
- Optimizing cold paths nobody hits.
- Premature complexity (custom LRU + pubsub) where a Map + TTL would do.`],
  ]],
  ['architecture', 'Architecture', 'Structuring code: boundaries, dependencies, and when a pattern earns its cost.', [
    ['architecture-basics', 'Architecture basics', `# Architecture basics

## When to use
Starting a service or untangling a big one.

## Core guidance
- Separate by rate of change and by ownership: UI / domain logic / IO (db, http, email).
- Dependency rule: domain logic imports nothing external; adapters implement interfaces it defines.
- Modules: high cohesion (one reason to change), low coupling (talk through small interfaces).
- Boring is a feature: boring stack, explicit wiring, no magic globals.
- Extract a service only when team boundaries or scaling force it — modular monolith first.
- Every queue/cache/abstraction has a cost: it must buy back complexity it removes.
- Data model first: entities + relationships + invariants; code follows the data.

## Pitfalls
- Abstracting before the third concrete case (speculative generality).
- Shared "utils" dumping ground that everything depends on.`],
  ]],
  ['docker-basics', 'Docker Basics', 'Containers that stay small, start fast, and run as one process.', [
    ['docker-practical', 'Docker practical', `# Docker practical

## When to use
Packaging anything for deploy.

## Core guidance
- One process per container; logs to stdout/stderr; config via env.
- Multi-stage build: build stage has toolchains, final stage copies artifacts only.
- Order layers for cache: package manifests + install FIRST, source code LAST.
- Healthcheck endpoint; container gets SIGTERM and exits within the grace period.
- Pin base image versions (node:20.11-slim, not latest).
- .dockerignore: node_modules, .git, data — keeps builds and images lean.
- Compose for local multi-service dev (app + db + redis) with one command.

## Pitfalls
- Running as root inside the container — add a USER.
- Baking secrets into layers (they persist in history) — build args are visible too; use runtime env/mounts.`],
  ]],
  ['ci-cd', 'CI/CD', 'Pipelines that run the important checks and deploy without drama.', [
    ['pipeline-design', 'Pipeline design', `# Pipeline design

## When to use
Setting up or fixing CI/CD.

## Core guidance
- Stages: install (cached) → lint/typecheck → unit → build → integration → deploy.
- Fail fast: cheapest checks first; run stages in parallel when independent.
- Cache dependencies by lockfile hash; cache the build if inputs unchanged.
- Artifacts: build ONCE, promote the same artifact through environments (never rebuild for prod).
- Deploy: small batches, rollback = redeploy previous artifact tag, smoke test after deploy.
- Secrets in the CI secret store, masked in logs; PRs from forks never see them.
- Keep main green: feature branches + short-lived PRs; revert-first policy for broken main.

## Pitfalls
- Flaky tests in CI poison trust — quarantine and fix immediately.
- Deploy step that depends on a human's machine instead of the pipeline.`],
  ]],
  ['documentation', 'Documentation', 'READMEs, inline docs, and ADRs that people actually read.', [
    ['writing-docs', 'Writing docs', `# Writing docs

## When to use
README, API docs, decision records.

## Core guidance
- README, top to bottom: what it is (1 line) → quickstart (≤5 commands) → configure → develop → troubleshoot.
- Quickstart MUST work on a clean machine — test it by running the commands fresh.
- Document WHY in comments; the code already says what.
- ADR (architecture decision record): context → options → decision → consequences, one page.
- CHANGELOG for humans: Added/Changed/Fixed per release.
- Examples beat prose: one runnable snippet per feature.

## Pitfalls
- Docs that drift: tie updates into the same PR as the code change.
- Documenting the happy path only — the troubleshooting section is the most-read page.`],
  ]],
  ['data-analysis', 'Data Analysis', 'From raw data to an answer: clean → describe → question → check.', [
    ['analysis-workflow', 'Data analysis workflow', `# Data analysis workflow

## When to use
Any dataset question ("are sales up?", "what drives churn?").

## Core guidance
1. Look at the data FIRST: rows, columns, types, 5 random rows, value counts.
2. Clean explicitly: nulls (how many, why), duplicates, units, one row = one entity.
3. Describe before modeling: counts, means, distributions, top categories.
4. One clear question → one metric + one comparison group.
5. Check the boring explanations: seasonality, missing data, definition changes, survivorship.
6. Chart what matters: time series for trends, bar for comparisons, scatter for relationships; label axes with units.
7. Report uncertainty: sample size, range, and "we don't know" where true.

## Pitfalls
- Averages on skewed data (income, latencies) — show medians/percentiles.
- Correlation sold as cause; % on tiny denominators.`],
  ]],
  ['visualization', 'Visualization', 'Charts that tell the truth quickly: pick, simplify, label.', [
    ['chart-design', 'Chart design', `# Chart design

## When to use
Any chart for a report or dashboard.

## Core guidance
- Pick by question: trend over time → line; compare categories → sorted bar; part-of-whole (≤5 parts) → bar or 100% bar; relationship → scatter; distribution → histogram.
- Start the y-axis at 0 for bar charts (bars encode length); lines may zoom with a clear axis note.
- One message per chart; title states the takeaway ("Churn doubled in Q3"), not the topic.
- Label directly on the data when possible; legend order = data order.
- Color: one highlight color for the story, grays for the rest; colorblind-safe pairs; never encode in color alone.
- Remove gridline clutter, borders, 3D, dual axes.

## Pitfalls
- Pie charts with >5 slices or near-equal slices — nobody can read them.
- Truncated axes + dramatic zoom = the classic misleading chart.`],
  ]],
  ['excel-formulas', 'Spreadsheet Formulas', 'The formulas that cover real work: lookups, sums with conditions, dates, cleanup.', [
    ['spreadsheet-formulas', 'Spreadsheet formulas', `# Spreadsheet formulas

## When to use
Any spreadsheet task: budgets, trackers, data cleanup.

## Core guidance
- Conditional math: SUMIFS/COUNTIFS/AVERAGEIFS(range, criteria_range, criteria, ...)
- Lookup: XLOOKUP(value, lookup_range, return_range, "not found") — replaces VLOOKUP everywhere it exists.
- Errors: IFERROR(x, 0) to wrap lookups.
- Dates: date math is number math (TODAY()-A2 = days since); EDATE for months; TEXT(A2,"YYYY-MM") to group by month.
- Text cleanup: TRIM, UPPER/LOWER/PROPER, SUBSTITUTE, TEXTSPLIT, VALUE() to un-text numbers.
- Table logic: IF(AND(a,b), x, y); IFS for ladders.
- Referencing: $A$1 absolute (lock when filling); structured refs (Table[Column]) auto-expand.

## Pitfalls
- Merged cells break sorting/filling — don't.
- Numbers stored as text (LEFT-aligned is the tell): VALUE or ×1 to fix.`],
  ]],
  ['writing-clear', 'Clear Writing', 'Plain-language writing: short sentences, strong verbs, structure first.', [
    ['plain-writing', 'Plain language writing', `# Plain language writing

## When to use
Emails, docs, posts, anything people should actually read.

## Core guidance
- One idea per sentence; average ≤20 words; cut every word that survives deletion.
- Verbs do the work: "decide" not "make a decision"; active voice by default.
- Front-load: conclusion in the first line, support after.
- Paragraphs ≤4 sentences; headings every few paragraphs; lists for parallel items.
- Replace jargon with the plain word unless the jargon IS the term of art.
- Read it aloud — where you stumble, the reader stops.

## Structure template
1. What this is (1 sentence) 2. Why it matters to the reader 3. The detail 4. What to do next.`],
  ]],
  ['email-craft', 'Email Craft', 'Emails that get replies: subject, ask, brevity.', [
    ['effective-email', 'Effective email', `# Effective email

## When to use
Any email where you want action.

## Core guidance
- Subject = the ask: "Approval needed: Q3 budget by Fri" beats "quick question".
- First line states the request; second gives the deadline; rest is context.
- One ask per email; two asks = two emails.
- Give the easy out ("if I don't hear by Friday I'll proceed with option A").
- Reply within 24h even if just "received, answer tomorrow".
- Bad news: acknowledge, state it plainly, next step. No burying.

## Pitfalls
- Reply-all threads — move to a doc/issue when >5 messages.
- "As per my last email" — resend the ask with new info instead.`],
  ]],
  ['resume-interview', 'Resume & Interview', 'Resumes that pass the 6-second scan; interviews that show impact.', [
    ['resume-basics', 'Resume basics', `# Resume basics

## When to use
Applying for jobs.

## Core guidance
- Every bullet: strong verb + what you did + measurable result ("Cut page load 40% by batching API calls").
- Tailor to the posting: mirror its 3-5 key terms honestly; cut what's irrelevant.
- One page <10y experience; two max after.
- Order: contact → experience (reverse-chron) → projects → education → skills as keywords.
- Link real things: repo, live project, portfolio.
- No photo, no "references available", no skill bars.

## Interview answers
- STAR: Situation (1 line) → Task → Action (what YOU did) → Result (number if possible).
- Prepare 5 stories: a ship, a conflict, a failure+fix, a leadership moment, a hard problem.`],
  ]],
  ['presentations', 'Presentations', 'Structure slides so the talk carries, not the deck.', [
    ['slide-craft', 'Slide craft', `# Slide craft

## When to use
Any talk or demo.

## Core guidance
- Structure: problem → why now → your solution (3 parts max) → proof → ask.
- One idea per slide; ≤6 bullets; ≤6 words per bullet; the details go in your mouth, not the slide.
- Type ≥24pt — forces brevity and keeps it readable.
- Show, don't bullet: demos, screenshots with ONE highlighted region, charts with a takeaway title.
- Rehearse the open and the close verbatim; improvise the middle.
- Demo insurance: record a backup video of the live demo.

## Pitfalls
- Reading slides aloud; slide decks as leave-behinds (make two artifacts: talk deck + doc).`],
  ]],
  ['study-method', 'Study Method', 'Learning that sticks: active recall, spacing, interleaving.', [
    ['learning-science', 'Learning science', `# Learning science

## When to use
Learning any new skill or subject.

## Core guidance
- Active recall beats rereading: close the book, write what you remember, check gaps.
- Spaced repetition: revisit at day 1 → 3 → 7 → 21; flashcards (Anki) for facts.
- Interleave related topics; blocked practice feels better but transfers worse.
- Feynman technique: explain it in simple words as if teaching; the stuck points are the gaps.
- Study in 25-50min blocks with real breaks; sleep after studying consolidates.
- Projects > courses: build one small real thing per topic; the docs are the textbook.

## Pitfalls
- Highlighting and rereading = fluency illusion ("it looks familiar" ≠ known).
- Watching tutorials end-to-end without building = tutorial hell.`],
  ]],
  ['productivity', 'Productivity', 'Deep work, prioritization, and saying no with a system that survives busy weeks.', [
    ['deep-work', 'Deep work system', `# Deep work system

## When to use
Too much to do, too little finished.

## Core guidance
- Capture everything in ONE inbox (app or notebook); an open loop in your head burns focus.
- Daily: pick 1-3 outcomes (not tasks) that would make the day a win; schedule them as calendar blocks.
- Protect one 90+ minute deep block daily: notifications off, phone in another room, one tab rule.
- Batch the shallow (email, messages, errands) into 2 fixed windows.
- Weekly review 20min: empty inboxes, check the wins, plan next week's 3 big rocks.
- Say no by default to new commitments; "not now" with a date is a yes you can keep.

## Pitfalls
- Productivity-system-building as procrastination — pick one tool, use it 2 weeks.
- Context switching tax: 20min to re-enter deep focus after an interruption.`],
  ]],
  ['decision-making', 'Decision Making', 'Frameworks for choices under uncertainty, from lunch to architecture.', [
    ['decision-frameworks', 'Decision frameworks', `# Decision frameworks

## When to use
Any real decision with tradeoffs.

## Core guidance
- Reversible + cheap → decide fast, learn, adjust. Irreversible + expensive → slow down.
- Write the decision: options, criteria, weights, scores — the table surfaces what you're actually valuing.
- Inversion: ask "what would guarantee failure?" then avoid exactly that.
- 10/10/10: how will I feel in 10 minutes / 10 months / 10 years?
- Pre-mortem: "it's a year later and this failed — why?" Fix the top 3 reasons now.
- Two-way doors framing kills analysis paralysis: most decisions are two-way.
- Disagree and commit: voice the concern once, then align; record the disagreement.

## Pitfalls
- Deciding by whoever argues longest.
- Sunk cost: "we've already spent..." — only future costs/benefits count.`],
  ]],
  ['negotiation', 'Negotiation', 'Prepare, anchor, trade — getting to yes without wrecking the relationship.', [
    ['negotiation-basics', 'Negotiation basics', `# Negotiation basics

## When to use
Salary, prices, scope, terms — any negotiation.

## Core guidance
- Prepare your BATNA (best alternative if you walk) — your real power source.
- Anchor first with a defensible number when you know the range; let them anchor when you don't.
- Never negotiate one variable: trade across issues (price ↔ timeline ↔ scope ↔ payment terms).
- Label emotions and ask calibrated questions: "how am I supposed to accept X?" > "no".
- Silence after their offer — the next concession often fills it.
- Get agreements in writing the same day, while goodwill is warm.

## Pitfalls
- Splitting the difference as a reflex.
- Accepting the first offer instantly (signals the range was wrong) — explore once.`],
  ]],
  ['personal-finance', 'Personal Finance', 'Budget, emergency fund, debt — the boring 90% of money.', [
    ['money-basics', 'Money basics', `# Money basics

## When to use
Getting finances in order.

## Core guidance
- Track spend for one month before making a budget — data beats guesses.
- Budget: 50% needs / 30% wants / 20% save-invest, adjusted to reality; pay the savings first.
- Emergency fund: 1 month of expenses, then kill high-interest debt (>10%), then grow to 3-6 months.
- Debt order: highest interest rate first (mathematically optimal); smallest balance first if you need momentum wins.
- Automate everything: transfers on payday, auto-pay full card balance.
- Big three wins: housing, transport, food — optimizing coffee doesn't move the needle.
- Insure catastrophes (health, disability), not inconveniences (phone screen plans).

## Pitfalls
- Minimum card payments — that's the debt machine working as designed.
- Lifestyle creep: raise savings rate with every raise.`],
  ]],
  ['investing-basics', 'Investing Basics', 'Long-term investing in plain terms: risk, diversification, costs.', [
    ['investing-plain', 'Investing in plain terms', `# Investing in plain terms

## When to use
Long-term wealth building (5+ year horizons).

## Core guidance
- The engine is time + regular contributions + compounding; cleverness adds little.
- Diversify: broad index funds (whole-market/SP500-style) beat stock picking for almost everyone.
- Costs compound too: expense ratios <0.2%, no-load funds; fees are the only guaranteed number.
- Asset allocation by horizon: longer horizon can carry more equities; bonds/cash buffer the years you need money soon.
- Rebalance yearly; automate monthly buys (dollar-cost averaging) and never stop during crashes.
- Tax wrappers first (retirement/pension accounts), then regular accounts.

## Pitfalls
- Panic selling in drawdowns — the plan exists for exactly that day.
- Anything promising guaranteed high returns; leverage; products you can't explain in one sentence.
- Not advice: individual situations differ; the math above is the universal part.`],
  ]],
  ['fitness-basics', 'Fitness Basics', 'Training principles: consistency, progressive overload, recovery.', [
    ['training-principles', 'Training principles', `# Training principles

## When to use
Starting or fixing an exercise routine.

## Core guidance
- Consistency beats intensity: 3 sessions/week you keep > 6 you abandon.
- Progressive overload: add a little (2-5%) weekly — weight, reps, or time; progress is the stimulus.
- Cover the bases: strength (full-body, 2-3×/wk: squat/hinge/push/pull/carry) + cardio (150min moderate or 75min hard/wk) + mobility.
- Form first: film yourself; ego weight builds injuries.
- Recovery is training: sleep 7-9h, 1-2 rest days, protein ~1.6g/kg/day, don't add volume when beat up.
- 6-week rule: pick a program, change nothing, assess after 6 weeks.

## Pitfalls
- Program hopping; skipping warm-ups; adding exercises instead of weight.
- "No pain no gain" — sharp pain stops the set; soreness is information, not the goal.
- Medical disclaimer: new to exercise or health conditions — clear it with a doctor first.`],
  ]],
  ['nutrition-basics', 'Nutrition Basics', 'Eating that supports energy and health without dogma.', [
    ['eating-basics', 'Eating basics', `# Eating basics

## When to use
Making everyday food choices.

## Core guidance
- The pattern that keeps showing up in evidence: mostly whole foods — vegetables, fruit, legumes, whole grains, nuts, lean protein; water as default drink.
- Protein at each meal (palm-size) keeps you full and supports muscle.
- Cook at home more; restaurant/packaged food hides most of the salt, sugar and fat.
- Hydration: pale-yellow urine is the check; thirst is a late signal.
- Sleep and stress drive overeating more than willpower does — fix those first.
- Sustainable > perfect: 80% good, forever, beats 100% for three weeks.
- Watch liquid calories (sodas, juices, "coffee" drinks) — they don't register as food.

## Pitfalls
- Superfoods and detoxes; cutting whole macronutrient groups without a reason.
- Not medical advice — conditions (diabetes, kidney, pregnancy) change the rules; see a professional.`],
  ]],
  ['sleep-science', 'Sleep Science', 'The levers that actually move sleep quality.', [
    ['better-sleep', 'Better sleep', `# Better sleep

## When to use
Tired despite "enough" hours, or sleep that's broken.

## Core guidance
- Fixed wake time, every day (weekends included) — the strongest lever; bedtime follows.
- Light: bright light within an hour of waking; dim/halve lights 2h before bed; screens aren't magic but the content wakes you up.
- Caffeine has a ~5-6h half-life: none after early afternoon.
- Alcohol sedates then fragments sleep; a nightcap costs more than it gives.
- Bedroom: cool (18-19°C), dark, quiet; bed = sleep only (read elsewhere).
- Can't sleep >20min? Get up, dim light, boring activity, return sleepy.
- Naps: ≤20min before 3pm.

## Pitfalls
- Sleeping in to "catch up" — it resets the clock; keep the wake time and go to bed earlier.
- Pills/melatonin as first resort; basics first. Persistent snoring/gasping → doctor (sleep apnea).`],
  ]],
  ['mental-health', 'Mental Health', 'Stress management and mental fitness basics — with real limits stated.', [
    ['stress-basics', 'Stress basics', `# Stress basics

## When to use
Stress load above sustainable, motivation gone, mood dipping.

## Core guidance
- Basics first — they are treatment-grade: sleep, movement (even walks), food, sunlight, social contact.
- Name it specifically: "I'm overwhelmed by X deadline" is solvable; "everything" isn't.
- Control split: list what you control / influence / neither; act on column 1, plan for 2, release 3.
- Breath: physiological sigh (double inhale, long exhale) ×3 for acute spikes; box breathing for steadying.
- 10-minute rule on avoidance: start the avoided task for 10 minutes; momentum usually follows.
- Schedule worry: a 15min daily slot for the looping thoughts; postpone them there.
- Social: one real conversation a day; isolation amplifies everything.

## Limits — when to get professional help
Two+ weeks of low mood/anhedonia, sleep/appetite changes, panic attacks, or any thought of self-harm: doctor/therapist/crisis line — that's strength, not weakness.`],
  ]],
  ['travel-planning', 'Travel Planning', 'Itineraries, packing, money, and the parts people get wrong.', [
    ['trip-planning', 'Trip planning', `# Trip planning

## When to use
Any trip beyond a weekend.

## Core guidance
- Anchor first: dates, flights, first + last nights; leave the middle loose.
- Rule of thirds: 1-2 anchor activities/day max; unscheduled time is where trips live.
- Book refundable where the price gap is small; travel insurance for expensive/nonrefundable trips.
- Money: no-foreign-fee card + a bit of local cash; tell your bank you're traveling.
- Documents: passport 6+ months validity, visa rules checked on the OFFICIAL government site (not blogs), copies in cloud + paper.
- Packing: half the clothes, double the money; one carry-on if trip <10 days; chargers/adapters + power bank.
- Learn 10 local words (hello, thanks, sorry, check please) — it changes interactions.
- Health: check vaccination requirements early (some need lead time).

## Pitfalls
- Over-scheduled day-by-day spreadsheets — one delay breaks everything.
- Airport-transit-blind bookings: check how you GET from the airport before booking the hotel.`],
  ]],
  ['cooking-basics', 'Cooking Basics', 'Techniques, substitutions, and dinner without a recipe.', [
    ['kitchen-fundamentals', 'Kitchen fundamentals', `# Kitchen fundamentals

## When to use
Cooking without drowning in recipes.

## Core guidance
- Heat control is the skill: preheat the pan; meat sizzles on contact or the pan's too cold; burnt butter = start over.
- Season in layers, taste as you go; salt early in cooking, acid (lemon/vinegar) at the end to brighten.
- Mise en place for anything with <5min windows; chop everything first.
- The formula: protein + vegetable + starch + sauce. Sauce = pan drippings + splash of liquid (broth/wine) + butter.
- Don't crowd the pan — browning needs space; pat protein dry.
- Substitutions: buttermilk = milk + lemon juice 5min; 1 egg ≈ 1/4 cup applesauce in baking; herbs: dried = 1/3 the fresh amount.
- Rice: rinse, 1:1.5 rice:water, low heat covered 12min, off heat 10min, don't peek.
- Rest cooked meat 5-10min before cutting.

## Pitfalls
- Nonstick pans on high heat; flipping food constantly; opening the oven "to check".`],
  ]],
  ['home-repair', 'Home Repair', 'The fixes that are safe to DIY, and the line where you call a pro.', [
    ['diy-home', 'DIY home basics', `# DIY home basics

## When to use
Everyday home fixes.

## Safe DIY
- Clogged sink: plunger first (block the overflow), then baking soda + vinegar + hot water flush; remove the P-trap for hair clogs.
- Running toilet: usually the flapper (cheap, 10min swap); water line to tank off first.
- Squeaky doors/hinges: graphite or a drop of oil on the pin.
- Holes in drywall: self-adhesive patch + joint compound, two thin coats beat one thick.
- Caulk gaps (tub, sinks): remove old, dry surface, smooth bead with a wet finger.
- Locate studs (knock + 16/24in spacing from a corner/outlet) before mounting anything heavy.

## Call a pro / don't touch
- Anything inside the electrical panel; gas smells (leave + call); main water line; roof work you'd need a ladder-and-courage for; structural changes. When in doubt: photograph it and ask — it's cheap insurance.`],
  ]],
  ['first-aid', 'First Aid Basics', 'Immediate response basics — with the clear limit: professionals for anything serious.', [
    ['first-aid-basics', 'First aid basics', `# First aid basics

## When to use
Immediate response to common injuries. Emergency number FIRST for anything serious.

## Core guidance
- Bleeding: press hard on the wound with clean cloth, don't peek, add layers on top; raise the limb. Uncontrolled/spurting → emergency services NOW.
- Burns: cool running water 10-20min; never ice, butter, or toothpaste; skip home remedies.
- Choking (adult, can't cough/speak): 5 back blows between shoulder blades, 5 abdominal thrusts, repeat.
- Sprain/strain: rest, ice 15min/hour, compression, elevate, in the first 48h.
- Nosebleed: lean FORWARD, pinch soft part 10min uninterrupted.
- Fainting: lay them down, raise legs, loosen tight clothing.
- Suspected fracture/head injury with confusion/vomiting/loss of consciousness: don't move them, call emergency services.

## The limit
This is immediate-response knowledge, not treatment. When in doubt, call emergency services — the call is free; the delay isn't.`],
  ]],
  ['language-learning', 'Language Learning', 'How to actually acquire a language: input, speaking early, spaced words.', [
    ['language-method', 'Language learning method', `# Language learning method

## When to use
Learning any new language.

## Core guidance
- First 100 words carry most conversation: greetings, numbers, question words, pronouns, survival verbs. Flashcards with spaced repetition for these.
- Comprehensible input daily: content where you get ~80% — graded readers, kids' shows, beginner podcasts; difficulty you can't understand teaches nothing.
- Speak from week 1, badly: tutors/speaking partners; mistakes are the mechanism, not the failure.
- Sentence mining > single words: learn "a cup of coffee, please" as one chunk.
- Frequency lists beat textbooks for vocab; grammar looked up WHEN confused by real sentences, not before.
- 20 focused minutes daily beats 3 hours weekly.
- Shadowing: repeat audio aloud immediately — trains mouth and ear together.

## Pitfalls
- App streaks as the goal (streak ≠ speaking ability).
- Waiting to be "ready" to talk — you become ready by talking.`],
  ]],
  ['math-refresher', 'Math Refresher', 'Percentages, ratios, and the stats intuition people actually need.', [
    ['everyday-math', 'Everyday math', `# Everyday math

## When to use
Percentages, rates, comparisons, quick sanity checks.

## Core guidance
- Percent change: (new-old)/old ×100. Doubled = +100%, halved = -50%.
- Of vs off: "20% of 50" = 10; "20% off 50" = 40.
- Reverse percentages: price after 20% discount = P×0.8, so original = paid/0.8.
- Compounding: rule of 72 — money doubling time ≈ 72/interest%. Works for growth and decay (viral, debt, inflation).
- Ratios: scale recipes by multiply-everything; unit price = price/size to compare.
- Averages lie on skewed data: use median for income/house prices/load times.
- Probability: "1 in 100" twice independently ≠ 2 in 100 — it's 1-(0.99×0.99) ≈ 2 in 1000... no wait, ≈ 1.99 in 100. Independent events multiply; that's the intuition.
- Sanity-check orders of magnitude before trusting any number you compute.

## Pitfalls
- Adding percentages (10% then 10% more = 21%, not 20%).
- Percentages of small numbers: "300% increase of 2 cases" = 6 cases.`],
  ]],
  ['science-explainers', 'Science Intuition', 'Physics, chemistry, biology intuition for everyday explanations.', [
    ['science-intuition', 'Science intuition', `# Science intuition

## When to use
Explaining how things work, or sanity-checking science claims.

## Core guidance
- Energy is conserved: every "free energy" claim fails here; friction/heat eat the rest.
- Entropy: disorder tends to increase unless energy is spent organizing (life, cleaning rooms).
- Evolution: variation + inheritance + selection pressure; no goal, no ladder — just fit-to-current-environment.
- Electricity: voltage = pressure, current = flow, resistance = narrowing. Power = V×I.
- Heat vs temperature: heat = total energy (bathtub), temperature = average speed (cup).
- Germ theory: most contagion is contact + droplets; hands and ventilation are the boring, winning defenses.
- Radiation: dose matters — banana vs flight vs X-ray vs CT differ by orders of magnitude.
- Falsifiability: a claim that can't be tested ("works in mysterious ways") isn't science, whatever its merits.

## Pitfalls
- "Chemicals" as a boomerang word — water is a chemical; dose makes the poison.
- Correlation headlines on single studies; replication is where trust lives.`],
  ]],
  ['world-geography', 'World Geography', 'Countries, capitals and quick facts for orientation.', [
    ['geo-orientation', 'Geographic orientation', `# Geographic orientation

## When to use
Placing countries, cities, and regions in context.

## Core guidance
- Africa: 54 countries; Nairobi (Kenya, East Africa — JEXI's home turf: Kericho is in the Rift Valley highlands, tea country).
- Continents by population: Asia > Africa > Europe > N. America > S. America > Oceania.
- Largest countries by area: Russia, Canada, USA/China, Brazil, Australia.
- Key chokepoints: Suez (Europe-Asia shipping), Hormuz (oil), Malacca (Asia shipping), Panama (Atlantic-Pacific).
- Hemispheres: most land and ~90% of people in the Northern; Africa straddles the equator — both tropics, huge climate range.
- Time: Nairobi = UTC+3, no DST. Handy anchors: London 0, Nairobi +3, New York -5, Beijing +8.

## Pitfalls
- Treating Africa as a country; single-story views of regions; trusting pre-split maps (Sudan 2011, USSR 1991).`],
  ]],
  ['prompt-craft', 'Prompt Craft', 'Getting what you want from AI: context, examples, constraints, iteration.', [
    ['prompting-well', 'Prompting well', `# Prompting well

## When to use
Working with any AI model.

## Core guidance
- Give context like to a new colleague: goal, audience, constraints, what "good" looks like.
- Show, don't just tell: one input→output example beats three paragraphs of description.
- Decompose: ask for the plan first, approve, then the execution; catches misunderstanding early.
- Be explicit about format ("a table with columns X/Y", "≤100 words", "JSON only") — models follow format instructions well.
- Iterate: first output is a draft; redirect with specifics ("shorter", "more technical", "keep the intro").
- Role + task + constraints + example + format = the reliable skeleton.
- For reasoning: "think step by step" and "list your assumptions" measurably help.
- Give the model an out: "if information is missing, ask" — prevents confident invention.

## Pitfalls
- Burying the actual request in paragraph 4.
- Asking 5 unrelated things in one prompt — split them.`],
  ]],
];

let made = 0;
for (const [id, name, description, skills] of pack) {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
    id, name, version: '1.0.0', description,
    enabledByDefault: true,
    contributes: { skills: skills.map(([slug]) => slug), skillsDir: 'skills' },
  }, null, 2) + '\n');
  for (const [slug, content] of skills) {
    const sdir = path.join(dir, 'skills', slug);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, 'SKILL.md'), content);
  }
  made++;
}
console.log(`generated ${made} plugins into server/plugins/`);
