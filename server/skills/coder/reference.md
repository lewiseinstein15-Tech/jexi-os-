# Coder — Reference

## Debugging recipe (run → observe → fix → re-run)
1. Run the entry point and capture stdout + stderr exactly.
2. Classify the failure: syntax error / runtime exception / wrong output / missing file.
3. Read the FIRST error line and the traceback's last frame — that is the root cause, not the message in the middle.
4. Apply the smallest fix that addresses the root cause.
5. Re-run. Repeat. Stop when: exit code 0 AND no error pattern (traceback/exception/reference error/etc.).

## Machine-checkable success predicate
A run is clean when BOTH hold:
- the runner reports `success: true`, AND
- the output contains no error pattern: `traceback|exception|syntaxerror|errno|no such file|modulenotfound|nameerror|importerror|attributeerror|typeerror|referenceerror|cannot find module|is not defined|command not found|failed`.

## Common failure map
| Symptom | Likely cause | Fix |
|---|---|---|
| `is not defined` / `ReferenceError` | use before declaration / typo | check variable names + order |
| `Cannot read properties of undefined` | element/state missing at that moment | guard the access or init earlier |
| blank page, exit 0 | render target missing | confirm the DOM id matches the JS selector |
| `Cannot find module` | wrong path / missing file | check the import path and file list |

## Checklist before returning
- [ ] Every file from the plan exists on disk.
- [ ] The entry point ran and the output is included.
- [ ] No error pattern remains in the output.
- [ ] The fix addresses the root cause (not a symptom).

## Example (good)
```markdown
### TESTING
$ node main.js
added 2 + 3 = 5   ← after fix #2 (was: "add is not defined" — renamed function call)
```
