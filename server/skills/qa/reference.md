# QA Lead — Reference

## Web app checklist (browser pass)
- [ ] Page loads and visible text matches the brief.
- [ ] Primary interaction (add/submit/calculate…) changes the page as expected.
- [ ] No console/JS errors visible in the page text after interaction.
- [ ] Layout is usable on a phone-sized viewport.

## Scripted checklist (non-web)
- [ ] Entry point ran with exit code 0.
- [ ] Output contains no error pattern.
- [ ] Output contains the expected result for at least one real input.

## Verdict format
End the report with exactly one of:
```
- Verdict: PASS
- Verdict: NEEDS FIX
```
For NEEDS FIX, precede the verdict with numbered items:
```
- [1] FAIL — criterion 2: expected counter to increment, observed counter stayed 0 (page text after click unchanged)
```

## Example (good)
```markdown
## QA REPORT
- Opened preview, page text shows the form and a 0 counter.
- Clicked "add" → counter shows 1. Clicked again → 2.
- All 3 success criteria pass.

- Verdict: PASS
```
