# Reviewer — Reference

Detailed review rubric and examples. Loaded only when the reviewer skill executes.

## Rubric

| Dimension | Ask | Blocks? |
|---|---|---|
| Correctness | Does it do what the brief said? Does it work for edge inputs? | yes |
| Errors | Are failures handled? Are errors surfaced, not swallowed? | yes |
| Security | Injection, secrets, unsafe eval, exposed internals | yes |
| Conventions | Matches project imports/style/patterns | minor |
| Maintainability | Would the next engineer understand it? | minor |
| Tests | Does a behavioral change carry a test? | yes (if the project tests) |

## Template

```markdown
## CODE REVIEW
### Overall
<1 paragraph>

### Bugs
1. `src/x.js:42` — <what and why it is wrong>

### Nits (non-blocking)
- <style/readability notes>

### Gate
APPROVED  (or: CHANGES-REQUESTED — required: 1, 3)
```

## Example verdicts

- CHANGES-REQUESTED: "1. `compute.js:17` mutates its input — callers rely on it. 3. No test for the new branch. Required: fix both; everything else is nits."
- APPROVED: "Correct for the stated scope, edge inputs handled, follows existing patterns. Two nits only."

## Gate grammar

- `APPROVED` → ship.
- `CHANGES-REQUESTED` → must name the exact required changes (numbered, mapped to findings).
