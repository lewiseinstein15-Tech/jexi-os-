---
id: common/agents
loads: always
---

# Agents — Common

[JEXI-RULE common/agents AG-1] One agent, one mission. If the description needs the word "and", split the agent.

[JEXI-RULE common/agents AG-2] Canonical agent file format: YAML frontmatter (name, description, color, emoji, vibe, tools, services) plus a body ordered Identity & Memory → Core Mission → Critical Rules → Technical Deliverables → Prompt Defense Baseline.

[JEXI-RULE common/agents AG-3] Every agent file carries the Prompt Defense Baseline. No exceptions, no "trusted" agents.

[JEXI-RULE common/agents AG-4] Agents resolve through the workforce registry. Never hardcode an agent list in pipeline code.

[JEXI-RULE common/agents AG-5] Agent instructions are markdown — loadable, lintable, diffable. Prose is interface.

[JEXI-RULE common/agents AG-6] Agents specialize on top of the system rules; they never contradict the core prompt.

[JEXI-RULE common/agents AG-7] Retired agents are deleted from the registry, not commented out or left dangling.
