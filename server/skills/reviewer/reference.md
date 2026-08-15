# Reviewer — Reference

## Review checklist
- [ ] Correctness: does the code actually satisfy each success criterion?
- [ ] Errors: is every user input path handled (empty state, bad input)?
- [ ] Maintainability: clear names, one responsibility per function, no copy-paste.
- [ ] Consistency: same patterns used throughout; matches the plan's structure.
- [ ] No dead code / commented-out leftovers.

## Severity levels
- **Blocker** — breaks a success criterion or a crash on a normal path → NEEDS WORK.
- **Major** — real bug on an edge path → NEEDS WORK.
- **Minor** — style/clarity → note it, verdict can still be APPROVED.

## Verdict format
```
## REVIEW NOTES
- [Blocker] index.html:20 — ...
- [Minor] app.js:4 — ...

Verdict: NEEDS WORK
```
or
```
## REVIEW NOTES
- Approach is sound; criteria 1–3 satisfied; one minor note on naming.

Verdict: APPROVED
```

## Example (good)
```markdown
## REVIEW NOTES
- [Blocker] app.js:12 — goal is read after it is used; empty goal renders NaN on first load (criteria 3 fails).
- [Minor] app.js:31 — inline styles should move to styles.css.

Verdict: NEEDS WORK
```
