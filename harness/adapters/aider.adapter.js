/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Aider (Phase 7 H).
 *
 * aider: CONVENTIONS.md → repo root (aider reads conventions with
 * --read CONVENTIONS.md). Rules-only harness. Detection: aider binary on
 * PATH or an aider config file.
 */

import os from 'os';
import path from 'path';
import { makeRuleAdapter, detectPath, onPath } from './_base.adapter.js';

export default makeRuleAdapter({
  id: 'aider',
  displayName: 'Aider',
  root: 'project',
  configDir: '.',
  format: 'markdown',
  mergedFile: 'CONVENTIONS.md',
  detectPath: '.aider.conf.yml',
  detectExtra() {
    return detectPath(path.join(os.homedir(), '.aider.conf.yml')) || onPath('aider');
  },
  supports: { agents: false, rules: true, skills: false, hooks: false, commands: false, mcp: false },
});
