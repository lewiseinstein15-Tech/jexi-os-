/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Hermes (Phase 7 H).
 *
 * hermes: .md agents → ~/.hermes/agents/. Agents-only harness.
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'hermes',
  displayName: 'Hermes',
  root: 'home',
  configDir: '~/.hermes/agents',
  format: 'markdown',
  agentsDir: 'agents',
  supports: { agents: true, rules: false, skills: false, hooks: false, commands: false, mcp: false },
});
