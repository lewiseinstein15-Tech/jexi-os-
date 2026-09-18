/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Kimi (Phase 7 H).
 *
 * kimi: .md agents → ~/.kimi/agents/. Agents-only harness.
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'kimi',
  displayName: 'Kimi',
  root: 'home',
  configDir: '~/.kimi/agents',
  format: 'markdown',
  agentsDir: 'agents',
  supports: { agents: true, rules: false, skills: false, hooks: false, commands: false, mcp: false },
});
