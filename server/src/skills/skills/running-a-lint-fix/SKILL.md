---
name: running-a-lint-fix
description: Run the linter against a file and show the real diagnostics
whenToUse: code needs lint verification or lint errors were reported
allowedTools: [lsp_diagnostics, fs_read]
---

# Running a lint fix

## Steps

- step: run real linter diagnostics (ESLint) against the target file
  tool: lsp_diagnostics
  args: { "file": "$args.file" }

- step: read the linted file so the diagnostics can be mapped to lines
  tool: fs_read
  args: { "path": "$args.file" }