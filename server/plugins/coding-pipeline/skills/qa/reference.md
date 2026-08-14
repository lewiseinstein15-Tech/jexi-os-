# QA — Reference

Detailed test checklists and report templates. Loaded only when the QA skill executes.

## Template: QA REPORT

```markdown
## QA REPORT
### What was tested
- `npm test` → 12 passed, 0 failed
- Browser: page loads, button "Calculate" clicked, result "42" rendered

### Acceptance criteria
- ✅ PASS — submitting valid input shows the result
- ❌ FAIL — empty input does not show an inline error

### Found issues
1. Empty input: no inline error (app shows result `0` instead)

### Verdict
NEEDS FIX — issue 1: validate empty input before computing.
```

## Web app checklist

- [ ] App loads without console errors.
- [ ] Primary interaction works (form submit / button / nav).
- [ ] Edge input handled (empty, malformed, extreme values).
- [ ] Responsive on mobile width.
- [ ] No dead links / broken routes.

## Script / backend checklist

- [ ] Runs to completion (exit 0).
- [ ] Handles empty input.
- [ ] Handles malformed input gracefully.
- [ ] No secrets printed to logs.

## Verdict grammar

| Verdict | Meaning |
|---|---|
| PASS | all criteria met; ship |
| NEEDS FIX | at least one criterion fails; name THE one fix |

## Honesty rule

If the artifact could not be executed, the report MUST say "code-level only" —
a verdict without execution evidence is not a QA verdict.
