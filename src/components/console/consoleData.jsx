/* Console nav skeleton — the ONLY thing left in this file. Every mock
   dataset (HUD, fleet, sessions, memory, skills, zettels, connectors,
   plugins, mcp, cron, chat transcript, ticker) was deleted in v0.9:
   the views now read the brain's real endpoints instead. `countKey`
   points at a live number computed in <Sidebar /> from the fleet
   snapshot; '…' shows until that endpoint answers. */

export const NAV = [
  {
    group: 'Executive',
    items: [
      { id: 'missions', label: 'Missions', icon: 'missions', countKey: 'missions' },
      { id: 'chat', label: 'Chat', icon: 'chat', isNew: true },
      { id: 'workgraph', label: 'Work Graph', icon: 'workgraph' },
      { id: 'agents', label: 'Agents', icon: 'agents', countKey: 'agents' },
      { id: 'sessions', label: 'Sessions', icon: 'sessions', countKey: 'sessions' },
    ],
  },
  {
    group: 'Resources',
    items: [
      { id: 'memory', label: 'Memory', icon: 'memory' },
      { id: 'skills', label: 'Skills', icon: 'skills', countKey: 'skills' },
      { id: 'knowledge', label: 'Knowledge', icon: 'knowledge' },
      { id: 'connectors', label: 'Connectors', icon: 'connectors' },
    ],
  },
  {
    group: 'Extensions',
    items: [
      { id: 'plugins', label: 'Plugins', icon: 'plugins', countKey: 'plugins' },
      { id: 'mcp', label: 'MCP Servers', icon: 'mcp', countKey: 'mcp' },
      { id: 'scheduler', label: 'Scheduler', icon: 'scheduler', countKey: 'scheduler' },
    ],
  },
];
