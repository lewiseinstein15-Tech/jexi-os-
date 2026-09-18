/**
 * JEXI OS — CROSS-HARNESS ADAPTER — Claude Code (Phase 7 H).
 *
 * claude-code: .md agent files → ~/.claude/agents/ (front-matter: name,
 * description). Also supports rules (CLAUDE.md), hooks (settings.json),
 * commands (~/.claude/commands/*.md) and mcp (.mcp.json).
 */

import { makeAgentAdapter } from './_base.adapter.js';

export default makeAgentAdapter({
  id: 'claude-code',
  displayName: 'Claude Code',
  root: 'home',
  configDir: '~/.claude/agents',
  format: 'markdown',
  agentsDir: 'agents',
  rulesFile: 'CLAUDE.md',
  commandsDir: 'commands',
  hooksFile: 'settings.json',
  mcpFile: '.mcp.json',
  supports: { agents: true, rules: true, skills: false, hooks: true, commands: true, mcp: true },
});
