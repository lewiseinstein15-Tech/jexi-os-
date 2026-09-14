---
name: debugging-failing-tests
description: Debug failing tests after a code change
whenToUse: test output shows failures after a recent change
allowedTools: [test_run, fs_read]
---

# Debugging failing tests

Generic multi-step note: the failing test is named by the caller; the
executable procedure below runs the real suite, reads the failing file, and
re-runs it — every step through the tool registry.

## Steps

- step: run the test suite and capture the real pass/fail report
  tool: test_run
  args: {  }

- step: read the failing test file to see the assertion that broke
  tool: fs_read
  args: { "path": "$args.file" }

- step: re-run only that test file and capture its output
  tool: test_run
  args: { "file": "$args.file" }