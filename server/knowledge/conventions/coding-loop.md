# The coding loop (run → observe → fix → re-run)

Load this folder when the task is writing, debugging or fixing code.

## The loop
1. Write the files (entry point first).
2. Run the entry point; capture stdout + stderr exactly.
3. Classify the failure: syntax error / runtime exception / wrong output / missing file.
4. Read the FIRST error line and the last traceback frame — that is the root cause.
5. Apply the smallest root-cause fix. Re-run. Repeat.
6. Stop ONLY when the machine-checkable success predicate passes, or the hard limit (6 iterations) is hit.

## Machine-checkable success predicate
A run is clean when BOTH hold:
- the runner reports `success: true`, AND
- output contains none of: `traceback|exception|syntaxerror|errno|no such file|modulenotfound|nameerror|importerror|attributeerror|typeerror|referenceerror|cannot find module|is not defined|command not found|failed`.

## Evidence to report
Always record the number of fix attempts and the real output of the final run. Never say "it works" without the predicate evidence.
