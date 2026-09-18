/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Gemini CLI (Phase 7 H).
 *
 * gemini: .md agents → ~/.gemini/agents/. Rules merge into GEMINI.md.
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'gemini',
  displayName: 'Gemini CLI',
  root: 'home',
  configDir: '~/.gemini/agents',
  format: 'markdown',
  agentsDir: 'agents',
  rulesFile: 'GEMINI.md',
  supports: { agents: true, rules: true, skills: false, hooks: false, commands: false, mcp: true },
});
