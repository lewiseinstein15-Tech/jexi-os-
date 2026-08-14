# Reflector — Reference

Detailed reflection templates and examples. Loaded only when the reflector skill executes.

## Template

```markdown
## REFLECTION
### What worked
1. <specific thing>

### What failed / cost time
1. <symptom> — root cause: <cause>

### Lessons
1. When <trigger>, do <action> (because <why>).

### Memory write
- key: <lesson-key>, value: <one-liner>
```

## Good vs bad reflection

- BAD: "Task completed successfully. Great teamwork." (no signal)
- GOOD: "`npm test` failed because the new suite wasn't registered in package.json — the chain only runs listed suites. Lesson: after adding test-*.js, register it in the test script."

## What to persist

| Do persist | Don't persist |
|---|---|
| root causes + the fix | the whole transcript |
| project-specific gotchas | generic advice |
| decisions and why | opinions without evidence |

## Cadence

- Significant multi-step tasks: always.
- Small single-answer tasks: skip — a memory write only if a durable lesson emerged.
