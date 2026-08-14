# Coder — Reference

Detailed coding patterns, templates and the fix loop. Loaded only when the coder skill executes.

## Template: code output

```markdown
## CODE — src/lib/helper.js
```js
export function add(a, b) { return a + b; }
```

## RUN CHECK
`node --check src/lib/helper.js` → exit 0

## NOTES
- No dependencies added.
```
```

## The fix loop (always)

1. Write the change.
2. Run the check: `node --check <file>` or the project typecheck (`bun tsc -b --noEmit` / `tsc --noEmit`).
3. Run the app-level test if one exists for the area.
4. If any step fails: read the EXACT error text, fix that one thing, re-run.
5. Stop after 6 failed attempts and report the last error verbatim.

## Project conventions to respect

| Signal | Convention |
|---|---|
| package.json type | `"type": "module"` → ESM imports |
| React + Vite | hooks imported from `react` only; no shadowing |
| Convex | backend via convex functions, not a second server |
| Styling | Tailwind classes + existing CSS tokens; no new UI kit |
| Tests | `cd server && npm test`; suites are `test-*.js` files |

## Common failure classes and fixes

| Error | Likely fix |
|---|---|
| `Cannot read properties of null` | hook called conditionally / before data loaded |
| blank preview | missing global CSS import or provider removal |
| module not found | wrong relative path; case-sensitive import |
| duplicate identifier | two imports of the same name — alias one |

## Handoff checklist

- [ ] Every plan step has a corresponding `## CODE` section.
- [ ] Every file passes a syntax/type check that I actually ran (output recorded).
- [ ] NOTES names any deviation from the plan.
