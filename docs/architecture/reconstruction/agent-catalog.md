# Agent Catalog (Phase 7 I)

The canonical specialist pool: 68 agents across 18 divisions, each one a
single `agents/<division>/<id>.agent.md` file in the canonical Markdown
format (frontmatter + Identity & Memory + Core Mission + Critical Rules +
Technical Deliverables + Prompt Defense Baseline). The template lives at
`agents/meta/_template.md` — deliberately not `*.agent.md`, so the catalog,
lint and cross-harness conversion count exactly 68 real agents.

Resolution order: runtime roster (hot-path coworkers) wins; canonical files
supply the specialist pool (`workforce/registry` → `resolveTwoStage`).

## Divisions at a glance

| Division | Agents |
| --- | --- |
| engineering | 23 |
| security | 8 |
| research | 6 |
| data | 6 |
| design | 5 |
| product | 3 |
| testing | 4 |
| ops | 4 |
| learning | 1 |
| automation | 1 |
| integration | 1 |
| content | 1 |
| localization | 1 |
| business | 1 |
| legal | 1 |
| voice | 1 |
| visualization | 1 |
| meta (template only) | — |

## engineering (23)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| planner | Planner | 🗺️ | Trigger when a mission must be decomposed into a dependency-ordered, verifiable plan before any code moves. | `file.read, workgraph.plan, web.search, github` |
| architect | Architect | 🏛️ | Trigger when a system boundary, module split, or technology choice must be decided and documented before implementation scales. | `file.read, web.search, diagram.draw, github` |
| tdd-guide | TDD Guide | 🔁 | Trigger when a feature should be built test-first — red/green/refactor discipline over after-the-fact test writing. | `file.edit, test.run, terminal.execute, file.read` |
| code-reviewer | Code Reviewer | 🔍 | Trigger when a diff needs a general engineering review — correctness, tests, error handling, and scope — before merge. | `file.read, code.task, test.run, web.search, github` |
| build-error-resolver | Build Error Resolver | 🧯 | Trigger when a build or compile breaks — parse the first real error, fix the cause, not the symptom cascade. | `terminal.execute, file.edit, file.read, test.run` |
| refactor-cleaner | Refactor Cleaner | 🧹 | Trigger when code works but is dead-weighted — duplication, dead code, tangled names — and behavior must not change one bit. | `file.edit, test.run, file.read, github` |
| doc-updater | Doc Updater | 📄 | Trigger when shipped changes left docs, READMEs, or examples behind — the code moved and the words did not. | `file.edit, file.read, github, web.search` |
| spec-miner | Spec Miner | ⛏️ | Trigger when requirements live scattered in tickets, threads, and code comments and must be extracted into one testable specification. | `file.read, web.search, github, workgraph.plan` |
| loop-operator | Loop Operator | 🔄 | Trigger when a long autonomous build loop must run plan → execute → verify → checkpoint without drifting off-mission. | `workgraph.plan, terminal.execute, test.run, file.edit, workgraph.checkpoint` |
| harness-optimizer | Harness Optimizer | 🎛️ | Trigger when agent harness settings — prompts, tool grants, hooks, budgets — underperform and must be tuned against measured runs. | `file.edit, test.run, terminal.execute, workgraph.plan, web.search` |
| mcp-builder | MCP Builder | 🔌 | Trigger when an MCP server or tool surface must be designed, versioned, and hardened so agents can call it safely. | `file.edit, terminal.execute, test.run, web.search` |
| minimal-change-engineer | Minimal Change Engineer | 🔬 | Trigger when the fix must touch the fewest possible lines — hotfixes, frozen surfaces, and high-blast-radius systems. | `file.edit, test.run, file.read, github` |
| typescript-reviewer | TypeScript Reviewer | 🟦 | Trigger when TypeScript code needs review — correctness, idiom, and eslint-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| python-reviewer | Python Reviewer | 🐍 | Trigger when Python code needs review — correctness, idiom, and ruff check-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| golang-reviewer | Go Reviewer | 🐹 | Trigger when Go code needs review — correctness, idiom, and go vet-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| rust-reviewer | Rust Reviewer | 🦀 | Trigger when Rust code needs review — correctness, idiom, and clippy-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| react-reviewer | React Reviewer | ⚛️ | Trigger when React code needs review — correctness, idiom, and eslint --ext .jsx,.tsx-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| vue-reviewer | Vue Reviewer | 💚 | Trigger when Vue code needs review — correctness, idiom, and eslint --ext .vue-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| angular-reviewer | Angular Reviewer | 🅰️ | Trigger when Angular code needs review — correctness, idiom, and ng lint-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| swift-reviewer | Swift Reviewer | 🍎 | Trigger when Swift code needs review — correctness, idiom, and swiftlint-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| php-reviewer | PHP Reviewer | 🐘 | Trigger when PHP code needs review — correctness, idiom, and php -l && phpstan-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| ruby-reviewer | Ruby Reviewer | 💎 | Trigger when Ruby code needs review — correctness, idiom, and rubocop-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |
| react-native-reviewer | React Native Reviewer | 📱 | Trigger when React Native code needs review — correctness, idiom, and eslint --ext .tsx-level hygiene — before it merges. | `file.read, code.task, test.run, web.search, github` |

## security (8)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| security-reviewer | Security Reviewer | 🛡️ | Trigger when a diff touches auth, input handling, secrets, or any trust boundary and needs an adversarial read before merge. | `file.read, terminal.execute, web.search, github` |
| threat-modeler | Threat Modeler | 🎯 | Trigger when a new feature or system needs its attack surface enumerated and prioritized before design hardens. | `file.read, web.search, diagram.draw, workgraph.plan` |
| pentester | Pentester | 🗡️ | Trigger when a running target must be probed for exploitable flaws within an authorized scope and rules of engagement. | `terminal.execute, web.search, browser.open, file.edit` |
| incident-responder | Incident Responder | 🚨 | Trigger when production is actively compromised or breached — containment, evidence preservation, and recovery under a clock. | `terminal.execute, file.read, notify, github` |
| compliance-auditor | Compliance Auditor | 📋 | Trigger when a system must be checked against a stated control framework and the gaps turned into an owned remediation plan. | `file.read, terminal.execute, web.search, github` |
| crypto-specialist | Crypto Specialist | 🔐 | Trigger when cryptography is chosen, implemented, or migrated — algorithms, key management, and protocol correctness. | `file.read, terminal.execute, web.search, file.edit` |
| cloud-security | Cloud Security | ☁️ | Trigger when cloud infrastructure — IAM, network exposure, storage policy — changes and misconfiguration would mean exposure. | `file.read, terminal.execute, web.search, file.edit` |
| appsec-engineer | AppSec Engineer | 🏗️ | Trigger when application code needs security engineered in — validation, output encoding, auth flows — across the SDLC. | `file.edit, file.read, test.run, terminal.execute` |

## research (6)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| research-analyst | Research Analyst | 🔬 | Trigger when an open technical question needs sourced, current answers with the evidence trail preserved. | `web.search, file.read, file.edit, notify` |
| competitive-analyst | Competitive Analyst | ♟️ | Trigger when a competitor’s product move, pricing, or positioning must be understood and countered. | `web.search, file.read, file.edit, notify` |
| market-researcher | Market Researcher | 📊 | Trigger when a market, segment, or pricing question needs sizing, trends, and evidence before investment. | `web.search, file.edit, file.read, notify` |
| user-researcher | User Researcher | 🧭 | Trigger when product decisions need evidence about real user behavior, needs, and pain — not opinions. | `web.search, file.edit, file.read, diagram.draw` |
| technical-writer | Technical Writer | ✍️ | Trigger when complex system behavior must become accurate, task-oriented documentation for real audiences. | `file.edit, file.read, terminal.execute, github` |
| fact-checker | Fact Checker | ✅ | Trigger when a document, brief, or claim set must be verified against primary sources before it is trusted or published. | `web.search, file.read, file.edit, notify` |

## data (6)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| data-engineer | Data Engineer | 🏗️ | Trigger when pipelines must move data reliably — ingestion, transformation, contracts, and freshness guarantees. | `terminal.execute, file.edit, db.query, test.run` |
| database-reviewer | Database Reviewer | 🗄️ | Trigger when schema changes or slow queries need review — indexes, migrations, locking, and data integrity. | `db.query, file.read, terminal.execute, file.edit` |
| mle-reviewer | MLE Reviewer | 🤖 | Trigger when a model change — features, training, serving — needs review for leakage, drift, and honest evaluation. | `file.read, terminal.execute, db.query, test.run` |
| rag-reviewer | RAG Reviewer | 📚 | Trigger when retrieval-augmented generation quality must be reviewed — chunking, retrieval precision, grounding, and citation. | `file.read, terminal.execute, db.query, web.search` |
| analytics-engineer | Analytics Engineer | 🧮 | Trigger when business metrics must be defined once, modeled cleanly, and trusted by every dashboard that reads them. | `db.query, file.edit, terminal.execute, test.run` |
| data-scientist | Data Scientist | 🔭 | Trigger when a business question needs statistical analysis — experiments, causal reads, or model-backed insight. | `db.query, terminal.execute, file.edit, web.search` |

## design (5)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| ui-designer | UI Designer | 🎨 | Trigger when screens need visual design — layout, hierarchy, states — that developers can build without guessing. | `file.edit, diagram.draw, file.read, web.search` |
| ux-researcher | UX Researcher | 🧪 | Trigger when a UX decision needs usability evidence — task tests, flows, friction maps — before building the wrong thing. | `web.search, file.edit, diagram.draw, file.read` |
| brand-strategist | Brand Strategist | 🧬 | Trigger when product voice, naming, or visual identity must stay coherent across surfaces and decisions. | `file.edit, web.search, diagram.draw, file.read` |
| diagram-designer | Diagram Designer | 🔀 | Trigger when a system, flow, or decision must become a diagram that survives being read by someone new. | `diagram.draw, file.read, file.edit, web.search` |
| accessibility-reviewer | Accessibility Reviewer | ♿ | Trigger when an interface must be reviewed against WCAG — keyboard, screen reader, contrast, motion — before it ships. | `file.read, browser.open, terminal.execute, file.edit` |

## product (3)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| product-manager | Product Manager | 🧭 | Trigger when a feature needs a problem statement, scope cut, and acceptance criteria that survive engineering contact. | `file.edit, file.read, workgraph.plan, web.search` |
| technical-pm | Technical PM | ⚙️ | Trigger when the feature is deeply technical — APIs, migrations, infra — and scope must be negotiated in engineering terms. | `file.read, workgraph.plan, terminal.execute, github` |
| roadmap-planner | Roadmap Planner | 🛣️ | Trigger when quarterly or multi-quarter priorities must be sequenced against capacity, dependencies, and strategy. | `file.edit, workgraph.plan, web.search, file.read` |

## testing (4)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| test-engineer | Test Engineer | 🧪 | Trigger when test strategy or coverage must be designed — what to test, at which layer, and what to deliberately not. | `file.edit, test.run, terminal.execute, file.read` |
| e2e-runner | E2E Runner | 🚶 | Trigger when critical user journeys must be verified end to end — in a real browser, against a real build, repeatably. | `browser.open, terminal.execute, test.run, file.edit` |
| performance-tester | Performance Tester | 📈 | Trigger when latency, throughput, or resource ceilings must be measured under load and regressions caught before users do. | `terminal.execute, test.run, file.edit, db.query` |
| chaos-engineer | Chaos Engineer | 🌪️ | Trigger when system resilience must be proven by injecting failures — in a controlled blast radius, with a rollback in hand. | `terminal.execute, test.run, file.edit, notify` |

## ops (4)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| devops-engineer | DevOps Engineer | 🔧 | Trigger when build, deploy, or environment friction slows the loop — pipeline speed, reproducibility, and automation. | `terminal.execute, file.edit, deploy.render, github` |
| sre | SRE | 📟 | Trigger when reliability needs to be engineered — SLOs, error budgets, alert quality — instead of promised. | `terminal.execute, file.read, notify, db.query` |
| platform-engineer | Platform Engineer | 🛠️ | Trigger when product teams need paved roads — golden paths, shared runtimes, self-service infra — to move without waiting. | `terminal.execute, file.edit, github, web.search` |
| release-manager | Release Manager | 🚢 | Trigger when changes must ship safely — release trains, feature flags, staged rollout, and the rollback everyone hopes not to need. | `github, terminal.execute, deploy.render, notify` |

## learning (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| skill-curator | Skill Curator | 📚 | Trigger when repeated successful patterns must be captured as reusable skills and failed patterns recorded as instincts. | `file.edit, file.read, web.search, workgraph.plan` |

## automation (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| workflow-automator | Workflow Automator | ⚙️ | Trigger when a manual, repeated process must become an automated workflow with triggers, idempotency, and observability. | `file.edit, terminal.execute, github, test.run` |

## integration (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| api-designer | API Designer | 🔗 | Trigger when systems must talk — API contracts, versioning, pagination, errors — before either side is built. | `file.edit, file.read, web.search, test.run` |

## content (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| content-strategist | Content Strategist | ✒️ | Trigger when outward-facing content — posts, changelogs, release notes — must land with the right message for the right audience. | `file.edit, web.search, file.read, notify` |

## localization (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| i18n-specialist | i18n Specialist | 🌐 | Trigger when software must work across locales — string extraction, RTL, formats, plurals — beyond mere translation. | `file.edit, file.read, terminal.execute, web.search` |

## business (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| business-analyst | Business Analyst | 💼 | Trigger when a process or requirement must be mapped to business outcomes — cost, workflow, stakeholders — before building. | `file.edit, file.read, web.search, workgraph.plan` |

## legal (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| privacy-officer | Privacy Officer | 🕵️ | Trigger when personal data is collected, stored, or shared and the flow must satisfy privacy law and data minimization. | `file.read, file.edit, web.search, terminal.execute` |

## voice (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| conversation-designer | Conversation Designer | 🎙️ | Trigger when agent dialogue must be designed — intents, prompts, repair paths, and graceful failure in conversation. | `file.edit, file.read, web.search, test.run` |

## visualization (1)

| id | name | emoji | trigger condition | tools |
| --- | --- | --- | --- | --- |
| data-visualizer | Data Visualizer | 📉 | Trigger when numbers must become charts that reveal the truth — right form, honest axes, readable by the decision maker. | `file.edit, db.query, diagram.draw, web.search` |

