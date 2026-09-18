/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Windsurf (Phase 7 H).
 *
 * windsurf: .md rules → .windsurf/rules/ (activation modes in-file).
 * Project-scoped, rules-only.
 */

import { makeRuleAdapter } from './_base.adapter.js';

export default makeRuleAdapter({
  id: 'windsurf',
  displayName: 'Windsurf',
  root: 'project',
  configDir: '.windsurf/rules',
  format: 'markdown',
  ext: 'md',
  rulesDir: 'rules',
  supports: { agents: false, rules: true, skills: false, hooks: false, commands: false, mcp: false },
});
