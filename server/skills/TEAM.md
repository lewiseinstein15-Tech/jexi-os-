# 🏢 JEXI's Specialist Team

JEXI turns every coding request into a small virtual engineering team. Each
specialist is a portable Markdown file in this folder with YAML frontmatter
(`name`, `role`, `phase`, `mandate`). The SkillChain engine (`server/src/services/SkillChain.js`)
runs them in order and **enforces the gates** — QA and Security verdicts block
shipping programmatically, not just by suggestion.

## The sprint (Think → Plan → Build → Test → Review → Ship → Reflect)

| # | Skill | Role | Phase | Produces |
|---|-------|------|-------|----------|
| 01 | `product` | CEO & Product Lead | Think | `## PRODUCT BRIEF` |
| 02 | `designer` | Senior Designer | Plan | `## DESIGN SPEC` |
| 03 | `engineer` | Engineering Manager | Plan | `## BUILD PLAN` |
| 04 | `coder` | Staff Engineer | Build | `{ entryPoint, files[] }` (JSON) |
| 05 | `qa` | QA Lead | Test | `## QA REPORT` — verdict `PASS` / `NEEDS FIX` |
| 06 | `reviewer` | Senior Reviewer | Review | `## REVIEW NOTES` — verdict `APPROVED` / `NEEDS WORK` |
| 07 | `security-officer` | Security Officer | Review | `## SECURITY REVIEW` — verdict `CLEARED` / `BLOCKED` |
| 08 | `shipper` | Release Engineer | Ship | `## SHIPPED` |
| 09 | `reflector` | Reflector | Reflect | `## REFLECTION` (saved to memory) |

## Handoffs (strict)

Every skill outputs **one `## SECTION`** with a fixed contract. The engine
extracts only that section and hands it to the next specialist — roles never
see each other's working notes. Add or change a section title in a skill file
and update the matching `extractSection(...)` call in `SkillChain.js`.

## Gates (enforced in code)

- **QA gate** — verdict `NEEDS FIX` triggers the fix loop: coder fixes, runner
  re-runs, QA re-verifies. Only `PASS` proceeds.
- **Security gate** — verdict `BLOCKED` withholds shipping and the summary says
  so plainly. This gate is **never skipped**, for any size of task.

## Safety commands (Planner)

- `/careful` — read-only QA (no clicks/types in the browser)
- `/freeze` — plan only, nothing written to disk
- `/unfreeze` — back to normal
- `/guard <paths>` — careful + only write files matching the named paths
- `/team` — explicit: run the full team

## Adding a specialist later

1. Copy an existing skill file, e.g. `cp 06-reviewer.md 10-data-engineer.md`.
2. Edit the frontmatter (`name`, `role`, `phase`, `mandate`) — the engine
   shows these in the live pipeline.
3. Define `## INPUT` and one `## OUTPUT` section with a strict contract.
4. Add the slug to `SKILL_META` / `PHASE` in `SkillChain.js` and chain it in
   `planForBuild`, `qaWebApp` or `reviewAndShip` at the right point.
5. Run `node --check server/src/services/SkillChain.js` and re-test.
