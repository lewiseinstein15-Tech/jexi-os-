/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Mistral Vibe (Phase 7 H).
 *
 * mistral-vibe: .md agents → ~/.mistral/agents/. Agents-only harness.
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'mistral-vibe',
  displayName: 'Mistral Vibe',
  root: 'home',
  configDir: '~/.mistral/agents',
  format: 'markdown',
  agentsDir: 'agents',
  supports: { agents: true, rules: false, skills: false, hooks: false, commands: false, mcp: false },
});
