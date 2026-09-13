---
name: testing-code-changes
description: Write and run tests for a code change
whenToUse: a code change needs test coverage or verification
allowedTools: [read, edit, terminal.execute, testing.run]
---
# Procedure

1. Identify the behavior change and its public surface.
2. Write the smallest test that locks the new behavior.
3. Run the focused test file first, then the surrounding module.
4. Cover the failure path too — not just the happy path.
5. Confirm the full suite stays green before finishing.