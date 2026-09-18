/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Codex (Phase 7 H).
 *
 * codex: .md agent files → ~/.codex/agents/. Rules merge into AGENTS.md
 * (the Codex convention for repo guidance).
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'codex',
  displayName: 'Codex',
  root: 'home',
  configDir: '~/.codex/agents',
  format: 'markdown',
  agentsDir: 'agents',
  rulesFile: 'AGENTS.md',
  supports: { agents: true, rules: true, skills: false, hooks: false, commands: false, mcp: false },
});
