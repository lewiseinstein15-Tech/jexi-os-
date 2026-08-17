/**
 * B107 — SKILLS MARKETPLACE.
 *
 * A curated catalog of ready-made skills (SKILL.md + optional reference.md)
 * the user can install with one tap. Installation writes to
 * DATA_DIR/skills/<name>/ (the user-dsh root, rank 400) so the B98
 * auto-discovery picks it up instantly — the skill is then loadable in chat
 * via skill-load and usable by the model. Uninstalling deletes the folder.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import { createUserSkill, invalidateSkillCache, SKILL_NAME_RE } from './SkillDiscovery.js';

const USER_SKILLS_DIR = path.join(DATA_DIR, 'skills');

/* ---------------- the curated catalog ---------------- */

const S = (name, description, whenToUse, body, reference = '') => ({ name, description, whenToUse, body, reference });

export const MARKETPLACE_SKILLS = [
  S(
    'meeting-notes',
    'Capture structured meeting notes with decisions, action owners and deadlines.',
    'any meeting recap, minutes, or follow-up summary request',
    `# Meeting Notes Skill

1. Capture: attendees, date, and the meeting purpose.
2. Decisions: list every decision made, verbatim where it matters.
3. Actions: for each action item give OWNER and DEADLINE — never "someone should".
4. Open questions: anything unresolved, with who owns it.
5. End with a 2-line summary someone who missed the meeting can read in 10 seconds.
6. If the user pasted a transcript, extract the structure from it; if they described the meeting, ask ONE clarifying question when owners/deadlines are missing.`,
    `## Template

## Attendees
## Decisions
## Action Items (owner · deadline)
## Open Questions
## Summary
`
  ),
  S(
    'code-review',
    'Peer code review checklist with a severity rubric and a clear verdict.',
    'any pull request, diff, or code snippet review request',
    `# Code Review Skill

Review the code and produce:
1. VERDICT: APPROVED / APPROVED-WITH-NITS / CHANGES-REQUESTED.
2. SEVERITY rubric: BLOCKER (must fix), MAJOR (should fix), MINOR (style/readability), NIT (optional).
3. For each finding: file:line, severity, one-sentence problem, concrete fix suggestion.
4. Check: correctness, error handling, security (injection, secrets, unsafe parsing), performance, test coverage of the changed path, naming/consistency with the surrounding code.
5. End with a 3-line summary: what the change does, its main risk, and your verdict.`,
    `## Rubric
- BLOCKER: crash, data loss, security hole, broken contract.
- MAJOR: wrong behavior in a real path, missing error handling, uncovered bug.
- MINOR: readability, duplication, naming.
- NIT: formatting preferences.
`
  ),
  S(
    'travel-planner',
    'Build a day-by-day itinerary from origin, dates, budget and interests.',
    'trip planning, itinerary requests, travel questions',
    `# Travel Planner Skill

1. Gather: origin, destination, dates, party size, budget, interests (food/culture/outdoors/art), pace preference.
2. Build a day-by-day itinerary: 2-4 anchor activities per day, realistic travel times, meal neighborhoods, rest time.
3. Budget table: transport, lodging, meals, activities — per person and total.
4. Contingencies: weather backup for outdoor days, booking notes (what to reserve ahead).
5. End with the top 3 must-not-miss items and one local tip.
6. If dates or budget are missing, ask ONE clarifying question before building.`,
    `## Template
## Day N — <city/area>
- Morning / Afternoon / Evening anchors
- Travel time between anchors
## Budget table
## Must-not-miss
`
  ),
  S(
    'research-synthesis',
    'Synthesize multiple sources into a balanced, cited overview.',
    'any research task, literature review, comparison of sources, or "what do sources say" question',
    `# Research Synthesis Skill

1. Read at least 3-5 independent sources; rank them by authority (primary > institutional > reputable press > blogs).
2. Extract per-source: main claim, evidence, limitations, stance.
3. Compare: where sources AGREE, where they DISAGREE, and why (methodology, date, bias).
4. Write the synthesis with ## Consensus, ## Points of Disagreement, ## Gaps in Evidence, ## Bottom Line.
5. Cite every claim inline ([source title]) and list sources at the end. Never cite a source you did not actually read.
6. Flag outdated or low-authority sources instead of silently using them.`,
    `## Template
## Consensus
## Points of Disagreement
## Gaps in Evidence
## Bottom Line
## Sources
`
  ),
  S(
    'study-guide',
    'Turn any topic into a structured study plan with objectives and self-checks.',
    'learning requests: "help me learn X", exam prep, study plans',
    `# Study Guide Skill

1. Scope: ask or infer the level (beginner/intermediate/advanced), the goal (exam, interview, project), and the time available.
2. Outline the topic into 4-8 modules with clear learning objectives per module ("you can explain X and do Y").
3. For each module: core concepts, a worked example, practice exercises, and a self-check quiz (3-5 questions with answers at the end).
4. Order modules by dependency, not difficulty.
5. Recommend one free resource per module (docs, video, interactive) — only resources you know exist.
6. End with a 7-day or 14-day schedule table.`,
    `## Template
## Module N — <name>
Objectives / Concepts / Worked example / Practice / Self-check
## Schedule (Day · Module · Deliverable)
`
  ),
  S(
    'email-draft',
    'Draft clear, professional emails from a short intent.',
    'any email writing request: reply, cold outreach, follow-up, apology, request',
    `# Email Draft Skill

1. Clarify: recipient, purpose (request/inform/persuade/follow-up/apology), tone (formal/warm), and key facts. If the purpose is unclear, ask ONE question.
2. Structure: greeting → context in one line → the ask or message (2-4 sentences) → next step or deadline → sign-off.
3. Rules: no jargon, no passive hedging ("I was wondering if maybe"), concrete dates, one ask per email.
4. Provide TWO variants when the user wants options: one direct, one softer.
5. Always end with a suggested subject line (≤ 8 words).`,
    `## Template
Subject: …
Greeting
Context
The ask
Next step
Sign-off
`
  ),
  S(
    'bug-report',
    'Turn a bug description into a structured, reproducible report.',
    'bug reports, crash descriptions, "it does not work" requests',
    `# Bug Report Skill

1. Elicit the essentials: what was expected, what actually happened, steps to reproduce, environment (device/OS/version), frequency.
2. If steps are missing, ask for the SHORTEST path that reproduces it — never guess the trigger.
3. Write the report as: ## Summary (one line), ## Repro Steps (numbered, exact), ## Expected vs Actual, ## Environment, ## Impact (who is affected, how bad), ## Suggested Next Step (log check, test case, likely area).
4. Distinguish facts from hypotheses — label guesses as "hypothesis".
5. Keep it under 30 lines.`,
    `## Template
## Summary
## Repro Steps
## Expected vs Actual
## Environment
## Impact
## Suggested Next Step
`
  ),
  S(
    'release-notes',
    'Write release notes from commit history, PR titles, or a feature list.',
    'release notes, changelog, "what changed in this version" requests',
    `# Release Notes Skill

1. Gather: the change list (commits/PRs/features), version number, release date, audience.
2. Group changes: ## New, ## Improved, ## Fixed, ## Removed, ## Known Issues. If a breaking change exists, put a ⚠ BREAKING banner at the top.
3. Write each item as a user-facing sentence: what the user can now do — never internal jargon (no "refactored services layer").
4. Attribute contributions when names are provided; otherwise keep it anonymous.
5. End with install/update instructions in one line.
6. For security fixes, include severity and CVE when known.`,
    `## Template
# vX.Y.Z — <date>
⚠ BREAKING
## New
## Improved
## Fixed
## Known Issues
Update: …
`
  ),
  S(
    'data-clean',
    'Audit and clean a dataset with documented, reversible steps.',
    'data cleaning, dataset QA, "clean this data" requests',
    `# Data Cleaning Skill

1. First pass — profile: shape, dtypes, missing rates, duplicates, outliers, unique counts for categoricals.
2. Report a PLAN before mutating anything: which columns, which rule (drop / fill / clip / recode), and why.
3. Execute with a log of every transformation: before → after counts.
4. Never silently drop rows: record every removed row's index and reason in a removals list.
5. Validate: after cleaning, re-run the profile and show the delta.
6. End with known remaining issues (e.g. "emails: 3 malformed values kept as-is").`,
    `## Template
## Profile (before)
## Cleaning plan
## Transformations log (rule · rows affected)
## Profile (after)
## Known remaining issues
`
  ),
  S(
    'api-design',
    'Design a REST API endpoint set with contracts, errors and examples.',
    'API design, endpoint planning, contract drafting',
    `# API Design Skill

1. Clarify: resource(s), actors, auth model, data volume, and one primary client use case.
2. Define resources and endpoints RESTfully: nouns, plural, nested only for true ownership.
3. For each endpoint: method, path, query/body schema, success response (200/201 shape), error responses (400/401/403/404/409/422 with error envelope {error:{code,message}}), and one request/response example.
4. Pagination: cursor or page+limit, with a stable default and max.
5. Idempotency notes for POSTs that create side effects (Idempotency-Key).
6. Versioning decision: URI (/v1) vs header — pick one and state why.
7. End with a validation checklist.`,
    `## Template
## Resource model
## Endpoints (method · path · summary)
## Contracts (request / response / errors / example)
## Pagination & idempotency
## Checklist
`
  ),
  S(
    'retro-notes',
    'Facilitate a team retrospective into concise, actionable notes.',
    'team retro, sprint retrospective, "what went well" requests',
    `# Retro Notes Skill

1. Structure: ## What Went Well, ## What Went Wrong, ## What Confused Us, ## Actions.
2. Convert every complaint into an ACTION with an owner — a retro with no actions is a venting session.
3. Group related items; de-duplicate without losing detail.
4. Keep the author's phrasing on sensitive items (paraphrase only when it risks blame).
5. Rank actions by effort vs impact (quick wins first).
6. End with the top 3 actions for the next sprint and who owns each.`,
    `## Template
## What Went Well
## What Went Wrong
## What Confused Us
## Actions (owner · effort · impact)
## Top 3 for next sprint
`
  ),
];

/* ---------------- install / uninstall ---------------- */

/** All catalog entries with their installed state. */
export function listMarketplace() {
  return MARKETPLACE_SKILLS.map((sk) => ({
    name: sk.name,
    description: sk.description,
    whenToUse: sk.whenToUse,
    tags: tagsFor(sk.name),
    hasReference: !!sk.reference,
    installed: isInstalled(sk.name),
  }));
}

function tagsFor(name) {
  const tags = {
    'meeting-notes': ['productivity', 'work'],
    'code-review': ['coding', 'quality'],
    'travel-planner': ['life', 'planning'],
    'research-synthesis': ['research', 'writing'],
    'study-guide': ['education', 'learning'],
    'email-draft': ['writing', 'work'],
    'bug-report': ['coding', 'quality'],
    'release-notes': ['coding', 'writing'],
    'data-clean': ['data', 'engineering'],
    'api-design': ['coding', 'engineering'],
    'retro-notes': ['work', 'team'],
  };
  return tags[name] || ['general'];
}

/** Is this marketplace skill currently installed (user root)? */
export function isInstalled(name) {
  try {
    return fs.existsSync(path.join(USER_SKILLS_DIR, name, 'SKILL.md'));
  } catch { return false; }
}

/** Install a marketplace skill → DATA_DIR/skills/<name>/ → auto-discovered. */
export function installSkill(name) {
  const sk = MARKETPLACE_SKILLS.find((s) => s.name === name);
  if (!sk) return { ok: false, error: `marketplace has no skill "${name}"` };
  if (!SKILL_NAME_RE.test(name)) return { ok: false, error: 'invalid skill name' };
  try {
    createUserSkill({
      name: sk.name,
      description: sk.description,
      whenToUse: sk.whenToUse,
      body: sk.body,
      reference: sk.reference,
    });
    invalidateSkillCache();
    return { ok: true, name: sk.name, installed: true };
  } catch (e) {
    return { ok: false, error: `install failed: ${(e && e.message) || e}` };
  }
}

/** Uninstall a marketplace skill (deletes only its user-root folder). */
export function uninstallSkill(name) {
  if (!SKILL_NAME_RE.test(name)) return { ok: false, error: 'invalid skill name' };
  const dir = path.join(USER_SKILLS_DIR, name);
  const root = path.resolve(USER_SKILLS_DIR);
  const abs = path.resolve(dir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: false, error: 'unsafe path' };
  try {
    if (!fs.existsSync(abs)) return { ok: false, error: `skill "${name}" is not installed` };
    fs.rmSync(abs, { recursive: true, force: true });
    invalidateSkillCache();
    return { ok: true, name, installed: false };
  } catch (e) {
    return { ok: false, error: `uninstall failed: ${(e && e.message) || e}` };
  }
}

/** Installed count + total for the UI badge. */
export function marketplaceStats() {
  const list = listMarketplace();
  return { total: list.length, installed: list.filter((s) => s.installed).length };
}

/** Sanity: every catalog skill passes discovery frontmatter validation. */
export function validateMarketplace() {
  const bad = MARKETPLACE_SKILLS.filter((sk) => {
    if (!SKILL_NAME_RE.test(sk.name)) return true;
    if (!sk.description || sk.description.length < 10) return true;
    if (!sk.body || sk.body.trim().length < 50) return true;
    return false;
  });
  return { valid: bad.length === 0, bad: bad.map((b) => b.name) };
}
