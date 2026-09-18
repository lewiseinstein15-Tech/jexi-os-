/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Cursor (Phase 7 H).
 *
 * cursor: .mdc rule files → .cursor/rules/ (front-matter: description,
 * globs, alwaysApply). Project-scoped, not home-scoped.
 */

import { makeRuleAdapter } from './_base.adapter.js';

export default makeRuleAdapter({
  id: 'cursor',
  displayName: 'Cursor',
  root: 'project',
  configDir: '.cursor/rules',
  format: 'mdc',
  ext: 'mdc',
  rulesDir: 'rules',
  supports: { agents: false, rules: true, skills: false, hooks: false, commands: false, mcp: false },
});
