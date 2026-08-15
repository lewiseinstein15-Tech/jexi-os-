# Engineer — Reference

## Build plan template
```markdown
## BUILD PLAN
### Architecture
- Stack + why (1–2 lines).
- Data flow (how state moves between the files).

### Files
- index.html — app shell / entry
- app.js — logic + rendering
- styles.css — styling

### Implementation order
1. Skeleton that runs (entry + empty UI) — verify it runs FIRST.
2. Core feature vertical slice.
3. Edge cases + polish.

### Verification
- How we know it works: run entry, check exit 0 / page renders; what "done" looks like.
- Risks: X is the likely failure point; fallback approach.
```

## Tech-decision checklist
- Prefer zero-dependency solutions when the brief does not demand a framework (single-file HTML/JS apps run anywhere).
- If a framework is required, pick the one already implied by the project/stack.
- Storage: localStorage for single-user apps; no backend unless the brief says so.
- Keep the entry point obvious (one `index.html` or `main.js`).

## Estimation
- S M L sizing per step: S ≤ 1 file, M = 2–3 files, L = cross-cutting concern.
- Always state the verification step — a plan without "how we test it" is incomplete.

## Example (good)
```markdown
## BUILD PLAN
### Architecture
Single-page HTML+JS app, no build step: index.html shell, app.js state + render, styles.css. localStorage persists the goal and log.

### Files
- index.html — shell, form, chart container
- app.js — add/remove glasses, goal edit, 7-day chart (canvas)
- styles.css — mobile-first layout

### Implementation order
1. index.html + empty app.js that runs and logs to console — RUN FIRST.
2. Log glasses + persist to localStorage.
3. Goal editing.
4. 7-day bar chart.

### Verification
Run index.html in the runner: exit 0 and page text shows the form. Manually verify: add glass → count increments. Risks: chart rendering — fallback to a plain list if canvas misbehaves.
```
