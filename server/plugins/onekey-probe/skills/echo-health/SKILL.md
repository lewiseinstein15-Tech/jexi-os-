---
name: echo-health
description: Probe skill — verify the plugin skill seam end to end
whenToUse: when the system probe needs to prove plugin skills execute
allowedTools: [term_execute, fs_read]
---

# Echo health probe

## Steps

- step: run a real command through the terminal tool
  tool: term_execute
  args: { "command": "echo PLUGIN_SKILL_EXECUTED" }

- step: read this project's package.json through the filesystem tool
  tool: fs_read
  args: { "path": "package.json" }
