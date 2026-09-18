/**
 * JEXI OS — CROSS-HARNESS ADAPTER — OpenClaw (Phase 7 H).
 *
 * openclaw: SOUL.md + AGENTS.md → ~/.openclaw/. SOUL.md is the identity
 * document (synthesized from the roster's own self-descriptions); AGENTS.md
 * carries the merged rules.
 */

import { makeAgentAdapter, mergeRulesMarkdown } from './_base.adapter.js';

/** SOUL.md — identity synthesized from agent names + descriptions. */
function soulFile(input) {
  const lines = ['# SOUL', '', 'JEXI OS coworker roster, rendered as one identity document.', ''];
  for (const ag of input.agents) {
    lines.push(`## ${ag.name}`, '', ag.description || '(no description)', '');
    if (ag.body) lines.push(ag.body.split('\n').slice(0, 6).join('\n').replace(/\s+$/, ''), '');
  }
  return { kind: 'soul', path: 'SOUL.md', content: lines.join('\n') };
}

export default makeAgentAdapter({
  id: 'openclaw',
  displayName: 'OpenClaw',
  root: 'home',
  configDir: '~/.openclaw',
  format: 'markdown',
  agentsDir: 'agents',
  // rules:false here — AGENTS.md is emitted by extraFiles below (openclaw's
  // merged rules doc lives at the openclaw base, not in a rules leaf).
  supports: { agents: true, rules: false, skills: false, hooks: false, commands: false, mcp: false },
  extraFiles(input) {
    const files = [soulFile(input)];
    if (input.rules.length) {
      files.push({ kind: 'rules', path: 'AGENTS.md', content: mergeRulesMarkdown(input.rules, { title: 'OpenClaw — JEXI OS rules' }) });
    }
    return files;
  },
});
