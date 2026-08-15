# Product Manager — Reference

## Brief template
```markdown
## PRODUCT BRIEF
### Goal
One sentence: build/do X so that Y.

### Scope
IN:
- ...
OUT:
- ...

### Success criteria
1. When the user does A, the app does B.
2. ...

### Constraints / notes
- Platform, stack hints, preferences (only if the user said them).
```

## Scope modes
- **MVP** — smallest slice that proves the core loop. List the one critical path.
- **Full** — everything implied, explicitly enumerated.
- **Strict** — exact deliverable, nothing extra.

## Acceptance-criteria checklist
- Each criterion is testable (observable action → observable result).
- No criteria reference implementation details unless the user demanded them.
- Criteria are ordered by importance.

## Example (good)
```markdown
## PRODUCT BRIEF
### Goal
Build a water-intake tracker app the user opens once a day, logs glasses, and sees a weekly trend.

### Scope
IN: log glasses, daily goal, 7-day bar chart, local persistence.
OUT: auth, cloud sync, notifications, social.

### Success criteria
1. Adding a glass increments today's count and updates the chart immediately.
2. The daily goal is editable and persisted across reloads.
3. The app renders correctly on a phone-sized viewport.
```

## Anti-patterns
- Inventing features ("let's add gamification") — never.
- Writing the plan/architecture — that is the Engineer's job.
- Vague criteria ("works well", "looks nice") — always quantify.
