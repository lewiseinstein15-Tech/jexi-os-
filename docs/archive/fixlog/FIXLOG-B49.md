# JEXI OS — Build 49 Fix Log (Roster / Skills / Tools Honesty + Independent Gates)

Every numbered item from the Build 49 directive is implemented, tested, and
logged below. Ground rules followed: work top-to-bottom, `cd server && npm test`
run after each priority, every change logged with evidence, no silent deletions.

**Final numbers (verified by `server/scripts/audit-roster.js`, wired into
`npm test`):**

| Metric | Before (catalog claimed) | After (live registries) |
|---|---|---|
| Agents | 207 (32+ orphaned per investigation) | **206 — 100% reachable, 0 orphans** |
| Skills | 495 | **492 — 0 orphaned, 0 dangling owners** |
| Tools | 151 (catalog) / 152 (code) | **152 — 0 orphaned, 0 dangling agents** |
| Intents / teams | ~20 | **43** (incl. new `legal_task`) |
| Code-task gates | bundled into one composite call | **5 independent graph nodes** |

---

## Priority 1 — Resolve the orphaned agents: wire in or remove, logged

### Investigation scope

The directive named 34 slugs. A full union analysis (every roster slug vs. every
team/phase/pass, done in code — `server/src/services/Reachability.js` — not by
grep) confirmed 34 unreachable entries **plus 6 more** the final audit surfaced
after the first wiring pass: `frontend`, `email`, `history`, `science`,
`data-quality`, `parenting`. Every one is resolved below; zero silent middle
ground.

### Wired in (33 of the directive's 34, plus all 6 audit-found)

| Agent | Where it was wired | Why |
|---|---|---|
| `ux-researcher` | `code_task` team | User research / personas / journey maps are a real input to product+design. |
| `accessibility` | `code_task` team | WCAG/contrast/a11y review belongs in the build pipeline (the directive's suggested example). |
| `ui-developer` | `code_task` team | Pixel-perfect UI is a real build-team member. |
| `landing-page-builder` | `code_task` team | Conversion landing pages are code deliverables. |
| `email-developer` | `code_task` team | HTML emails are code deliverables. |
| `frontend` | `code_task` team | Frontend implementation (audit-found orphan). |
| `tool-router` | `self_check` team | Meta-agent: the directive's suggested home for reasoning about own tooling. |
| `toolsmith` | `self_check` team | Meta-agent: designs/wires tools. |
| `agent-builder` | `self_check` team | Meta-agent: designs new specialists. |
| `prompt` | `self_check` team | Meta-agent: prompt design for own configuration. |
| `guardrail` | `self_check` + `security_audit` | Input/output safety — a real gate. |
| `reporter` | `news_latest` team | Structured news writing is the news team's editor. |
| `translator-v2`, `editor`, `proofreader` | `translate` team | Localization + polish passes on translations. |
| `data-viz`, `scraper`, `sql`, `regex` | `data` team | Charting / structured extraction / queries / regex are data-team tools. |
| `summarizer` | `docs` + `creative_writing` | Summaries of long docs. |
| `business-analyst`, `startup-advisor`, `financial-advisor`, `market-analyst`, `strategist`, `sales-rep`, `crm-specialist`, `customer-success` | `business_plan` team | New deep-domain business team. |
| `growth-marketer`, `seo-specialist`, `copywriter`, `brand`, `product-marketer`, `lifecycle-marketer`, `community-manager`, `devrel-engineer`, `social`, `ad-copywriter`, `newsletter-writer`, `brand-designer`, `email` | `marketing_plan` team | Full go-to-market team (email = composer for campaigns). |
| `event-planner`, `wedding-planner`, `travel`, `finance` | `event_planning` team | Events team with logistics + budget. |
| `chef`, `nutrition`, `health` | `meal_plan` team | Meal planning. |
| `fitness`, `sleep-coach`, `meditation-coach` | `workout_plan` team | Fitness + recovery. |
| `investor`, `tax-advisor` | `investing_advice` team | Portfolio + tax. |
| `support-engineer` | `tech_support` team | Troubleshooting. |
| `pentester`, `appsec`, `risk-analyst`, `red-team`, `blue-team`, `cryptographer`, `privacy-officer`, `compliance-officer`, `forensic-analyst`, `security-trainer` | `security_audit` team | Full red/blue/audit security roster. |
| `content-strategist`, `blog-writer`, `seo-writer`, `video-script-writer`, `technical-editor`, `ux-writer`, `copyeditor`, `white-paper-writer`, `case-study-writer`, `api-docs-writer`, `podcaster`, `speech-writer`, `essayist`, `grant-writer`, `ghostwriter`, `illustrator`, `motion-designer`, `sound-designer` | `content_creation` team | Deep content/creative roster. |
| `exam-coach`, `study`, `teacher`, `flashcard-maker`, `homework-helper`, `grader`, `curriculum-designer`, `lab-assistant`, `research-mentor`, `academic-writer`, `coding-tutor`, `languages`, `tutor` | `study_exam` team | Education roster. |
| `history`, `science` | `study_topic` team | Deep-study specialists (audit-found orphans). |
| `career`, `recruiter`, `resume`, `interviewer`, `hr-specialist` | `career_plan` team | Careers. |
| `relationship-coach`, `counselor`, `dating-coach` | `relationship_advice` team | Relationships. |
| `pricing-strategist` | `startup_advice` team | Monetization. |
| `task-manager`, `scheduler`, `note-taker`, `email-triage`, `meeting-planner`, `expense-tracker`, `operations-manager`, `executive-assistant` | `productivity` team | Ops. |
| `data-scientist`, `ml-engineer`, `ml-ops`, `bi-analyst`, `reporting-analyst`, `database-admin`, `data-quality` | `data_ml` team | ML/data (data-quality = validation, audit-found). |
| `cloud-engineer`, `kubernetes-engineer`, `terraform-engineer`, `sre`, `network-engineer`, `log-analyst`, `monitoring-engineer`, `deploy-engineer`, `infra-auditor`, `database-ops`, `backup-engineer`, `release-engineer`, `ci-engineer`, `cost-optimizer`, `incident-commander` | `cloud_devops` team | Platform/infra roster (directive's suggested cloud_devops home). |
| `api-engineer`, `auth-engineer`, `backend`, `database`, `devtools-engineer` | `api_backend` team | API/auth backend. |
| `mobile-engineer`, `ios-engineer`, `android-engineer`, `react-native-engineer` | `mobile_app` team | Mobile. |
| `game-developer` | `game_dev` team | Games. |
| `home-org`, `interior-designer`, `gardener`, `fashion-stylist`, `beauty-advisor`, `pet-care`, `parenting` | `home_life` team | Home/family (parenting = audit-found). |
| `legal-drafter`, `negotiator`, `legal`, `privacy-officer`, `compliance-officer` | **new `legal_task` intent** | Directive's suggested new intent; regex + LLM classification route legal phrasings here. |
| `orchestrator` | `explain_team` team | The planner+orchestrator explanation team. |

### Removed (1)

| Agent | Reason |
|---|---|
| `embedded-engineer` | No coherent team exists and no realistic intent needs it today (no embedded/firmware deliverable in the current product). Removed with its 3 skills (`embedded`, `iot`, `hardware`) — logged here, not silently. |

### Proof

- `server/src/services/Reachability.js` — authoritative analysis (agents/skills/
  tools reachability + dangling refs in both directions).
- `server/test-b49.js` — asserts zero orphans, 100% reachable, the directive's
  34 slugs all resolved (33 reachable + 1 removed), `legal_task` composes and
  routes.
- Counts: **206 agents · 492 skills · 152 tools · 100% agents reachable**.

---

## Priority 2 — Composed-team execution: decided per team, documented

**Decision: code_task = Option A (real independent gates). Every other team =
Option B (honest bundling).**

### code_task — independent (Option A)

- The **QA / Reviewer / Security Officer / Critic / Shipper / Reflector** gates
  were one bundled `reviewAndShip` call inside a single `reviewShip` node. They
  are now five **independent graph nodes** — `codeReview → securityGate →
  criticGate → reflector → shipper` — each calling its own pass
  (`runReviewerPass`, `runSecurityPass`, `runCriticPass`, `runShipperPass`,
  `runReflectorPass` in `SkillChain.js`) with its own system prompt built from
  the agent's roster role and its own verdict (`APPROVED/NEEDS WORK`,
  `CLEARED/BLOCKED`, `SHIP/REVISE`). This is the highest-stakes case — these
  verdicts literally decide whether generated code ships — so it is no longer
  bundled.
- Product → Designer → Engineer were already three sequential calls
  (`planForBuild`); Architect/Coder/Debugger run codegen/fix calls; Runner does
  real sandbox execution. These stay as-is (already independent turns).
- **Cost/latency tradeoff (logged):** a full code run now makes more LLM calls
  than before (QA + Reviewer + Security + Critic + Shipper + Reflector each
  separate). The Provider Router's fallback chain and the bounded debug/QA
  cycles keep it sane; lower-stakes members (Reflector) use the same prompt
  budget as before — a cheap-model split is the documented future optimization.
- **Composed personas in code_task** (honestly tagged, not claimed as
  independent): `ux-researcher`, `accessibility`, `ui-developer`, `frontend`,
  `landing-page-builder`, `email-developer` — their expertise is injected into
  the team brief, they do not take an independent reasoning turn.

### Every other team — bundled (Option B, documented)

- Research/news/data/math/translate/… teams are each executed by their
  specialist node as one well-constructed composite pass with strict handoffs
  between steps. These roles are closely related and low-stakes to run
  independently; bundling is the right engineering call.
- **The catalog and UI now say so:** `AGENT-CATALOG.md`'s intent table has an
  "Execution" column (`N independent · M bundled`), a new "How execution
  actually works" section explains the model, the plan event carries
  `execution: { independent, bundled }` (server `index.js`), and the frontend
  PLAN view tags composed personas with a subtle "· composed" chip
  (`src/components/ActiveAgents.jsx`). No roster display claims an independent
  agent ran when one did not.

---

## Priority 3 — Tier metadata + skill/tool orphan sweep

- Every `AGENT_ROSTER` entry now carries an explicit `tier` field:
  `core` (5 brain agents) / `pipeline` (agents with their own graph-node pass) /
  `team` (composed into a team; possibly bundled). Queryable via
  `getAgent(slug).tier` — the reachability fact is in the data, not in a grep.
- **Skill sweep:** 495 → 492 (removed the 3 skills owned by the removed
  `embedded-engineer`). Zero orphaned skills remain (every skill is mastered by
  ≥1 agent) and zero dangling owner references (every skill's `agent:` resolves).
- **Tool sweep:** 152 tools, all reachable — every tool lists ≥1 real agent,
  and since 100% of agents are reachable, every tool is auto-selectable by some
  team. Zero dangling agent references.
- **Dangling-ref sweep (both directions):** zero team/phase slugs point at
  missing agents; zero agents list missing skills.

---

## Priority 4 — AGENT-CATALOG.md regenerated, execution model documented

- `AGENT-CATALOG.md` is now **generated** by `cd server && npm run audit-roster`
  from the live registries: reachability report, 43-row intent→team table with
  the Execution column, all 206 agents grouped by skill category with tier,
  all 492 skills by category, all 152 tools by type, and the compound-phase
  definitions. Header: **206 agents · 492 skills · 152 tools** (the old file
  claimed 207/495/151 — stale).
- The file is marked GENERATED with a banner; `npm test` runs
  `scripts/audit-roster.js --check`, which fails CI if the committed catalog's
  header drifts from the registries.
- `ARCHITECTURE.md` §9 documents the per-team execution decision and why.
- Frontend PLAN view (`ActiveAgents.jsx`) consumes the new `execution.bundled`
  field and tags composed members so the UI never overclaims.

---

## Priority 5 — Self-maintaining drift detection (the whole point)

- **`server/scripts/audit-roster.js`** does programmatically what the
  investigation did by hand: every roster slug reachable via TEAM_PLAN /
  COMPOUND_DETECT / runSkill passes; every skill mastered; every tool usable by
  a reachable agent; no dangling refs in either direction. It prints a
  plain-language summary, exits 1 on any finding, and regenerates the catalog.
- **Wired into `npm test`** (`node scripts/audit-roster.js --check`) and as
  `npm run audit-roster`. A future edit that creates an orphan, a typo'd slug,
  or a stale published count fails CI immediately — this class of drift never
  needs a manual investigation again.
- `server/src/services/Reachability.js` exports `analyze()`, `executionModel()`,
  `reachableAgentSlugs()` and `reachabilitySummary()` for tests and the audit.

---

## Before / after (plain language)

**Before:** the catalog published "207 agents · 495 skills · 151 tools" and a
PLAN view full of team members, but a grep-based investigation found ~32–84
entries that no code path ever invoked, and the coding team's QA/Review/Security
gates were a handful of bundled prompt calls folded into one node — so the
numbers and the UI implied a lot of independent reasoning that never happened.

**After:** the code can tell you its own truth. One command (`npm run
audit-roster`) verifies that every one of the 206 agents, 492 skills and 152
tools is reachable by a real path, regenerates the catalog from the live
registries, and fails CI if anything drifts. The gates that decide whether code
ships — QA, Reviewer, Security Officer, Critic, Shipper, Reflector — are now
independent graph nodes with their own calls and verdicts. The catalog, the
docs, and the PLAN view all state explicitly which agents reason independently
and which are composed personas, so nothing claims more than it does.
