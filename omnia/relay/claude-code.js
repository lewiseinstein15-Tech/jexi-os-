/**
 * JEXI OS — Phase 15 Scope B — Claude Code adapter.
 *
 * An adapter is a plain declaration: the relay core knows nothing
 * about agent names — it only trusts what adapters register via
 * relay.attach().
 */
export const claudeCode = {
  name: 'claude-code',
  kind: 'coding-agent',
  capabilities: ['edit', 'run', 'review'],
};
