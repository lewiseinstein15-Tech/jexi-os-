/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Osaurus (Phase 7 H).
 *
 * osaurus: .md agents → ~/.osaurus/agents/. Agents-only harness.
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'osaurus',
  displayName: 'Osaurus',
  root: 'home',
  configDir: '~/.osaurus/agents',
  format: 'markdown',
  agentsDir: 'agents',
  supports: { agents: true, rules: false, skills: false, hooks: false, commands: false, mcp: false },
});
