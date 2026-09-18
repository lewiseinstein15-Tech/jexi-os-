/**
 * JEXI OS — CROSS-HARNESS ADAPTER — GitHub Copilot (Phase 7 H).
 *
 * copilot: .md instructions → .github/copilot/ (repo-scoped custom
 * instructions). Detection: a .github directory in the project.
 */

import { makeRuleAdapter } from './_base.adapter.js';

export default makeRuleAdapter({
  id: 'copilot',
  displayName: 'GitHub Copilot',
  root: 'project',
  configDir: '.github/copilot',
  format: 'markdown',
  mergedFile: 'instructions.md',
  detectPath: '.github',
  supports: { agents: false, rules: true, skills: false, hooks: false, commands: false, mcp: true },
});
