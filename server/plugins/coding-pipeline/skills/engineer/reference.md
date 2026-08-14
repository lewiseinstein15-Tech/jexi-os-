# Engineer — Reference

Detailed architecture patterns, templates and checklists. Loaded only when the engineer skill executes.

## Template: BUILD PLAN

```markdown
## BUILD PLAN

### Architecture
- <component> → <component> → <component>
- <data flow note>

### Stack
- <runtime/language>
- <framework> (already in the project — do not add new ones)
- <state/persistence>

### Data model
- <entity>: <fields>

### Steps
1. <step> (file: <path>)
2. <step>
…

### Risks
- <risk> → <mitigation>
```

## Stack decision rules

| If the project uses | Default to |
|---|---|
| React + Vite + Convex | keep them; no new backend |
| Express server | keep Express; same port/routing style |
| Bun | bun for installs/scripts |

Never introduce a second copy of React, a second backend, or a second build tool.

## Fix/debug plan template

```markdown
## BUILD PLAN
### Diagnosis
- <symptom> ← <root cause>
### Change
1. <file>: <exact change>
### Verification
- <command or test that proves it fixed>
### Rollback
- <how to undo if it regresses>
```

## Estimations (rough)

- Pure frontend change: 1 step.
- New feature with state: 2–3 steps.
- New backend surface: 4–6 steps.

## Handoff checklist

- [ ] Every acceptance criterion from the brief maps to a step.
- [ ] No new dependencies beyond what the project already has (flag exceptions as risks).
- [ ] Verification is named per step (a command or test), not left implicit.
