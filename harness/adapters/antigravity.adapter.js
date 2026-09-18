/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Antigravity (Phase 7 H).
 *
 * antigravity: .md agents → ~/.antigravity/agents/. Agents-only harness.
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'antigravity',
  displayName: 'Antigravity',
  root: 'home',
  configDir: '~/.antigravity/agents',
  format: 'markdown',
  agentsDir: 'agents',
  supports: { agents: true, rules: false, skills: false, hooks: false, commands: false, mcp: false },
});
