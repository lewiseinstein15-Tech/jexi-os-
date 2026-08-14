# Conventions — progressive knowledge (loaded on demand)

Deeper project conventions for when you are editing code in this repo.

## Code style

- ESM everywhere in `server/` — use `import`/`export`, never `require`.
- Errors: throw early with a message that names the file/field; never swallow
  errors silently — log the real cause.
- Naming: kebab-case file names, camelCase functions/variables, UPPER_SNAKE for
  constants. Slugs (agents/skills/tools) are kebab-case.
- Comments: explain *why*, not *what*. Keep them short.

## Common failure classes and fixes

| Error | Likely fix |
|---|---|
| `Cannot read properties of null (reading 'useMemo')` | hook called conditionally / provider removed |
| blank preview | global CSS import or app providers removed |
| `does not provide an export named X` | wrong name / file not exporting it |
| duplicate identifier | two imports of the same name — alias one |

## Adding to the catalog (agents/skills/tools)

1. **Agent** → `server/src/services/AgentRoster.js` (AGENT_ROSTER) — must list
   skills that exist in SKILL_REGISTRY.
2. **Skill** → SKILL_REGISTRY entry + optional `server/skills/<slug>/` folder.
3. **Tool** → `server/src/services/ToolRegistry.js` — must list ≥1 real,
   reachable roster agent.
4. **Team wiring** → `server/src/services/Planner.js` TEAM_PLAN (or a
   COMPOUND_DETECT phase). The audit (`node scripts/audit-roster.js --check`,
   part of `npm test`) fails on any orphan, so wire it or remove it.

## Testing

- One file per area: `server/test-<area>.js`, plain node script with a
  `check(name, ok)` helper; exit non-zero on any failure.
- After adding a suite, append it to the `test` script in `server/package.json`.
