/**
 * JEXI OS — CROSS-HARNESS ADAPTER — OpenCode (Phase 7 H).
 *
 * opencode: .md agents → ~/.opencode/agents/. Rules merge into AGENTS.md.
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'opencode',
  displayName: 'OpenCode',
  root: 'home',
  configDir: '~/.opencode/agents',
  format: 'markdown',
  agentsDir: 'agents',
  rulesFile: 'AGENTS.md',
  supports: { agents: true, rules: true, skills: false, hooks: false, commands: true, mcp: false },
});
