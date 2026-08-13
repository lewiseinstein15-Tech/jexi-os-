import { Home, LayoutGrid, Bot, ListTodo, FolderOpen, Globe, FileText, Database, Brain, Boxes, Puzzle, BookOpen, Settings, Smartphone, Terminal, Plug } from 'lucide-react';

/** Every destination in the OS — `page` marks ones with real screens; the rest
 *  are roadmap stages (rendered as honest "planned" placeholders, never faked). */
export const NAV_SECTIONS = [
  {
    label: 'CORE',
    items: [
      { id: 'home', icon: Home, label: 'Home', page: true },
      { id: 'command', icon: LayoutGrid, label: 'Command Center', page: true },
      { id: 'agents', icon: Bot, label: 'Agents', page: true },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'tasks', icon: ListTodo, label: 'Tasks', page: true },
      { id: 'workspace', icon: FolderOpen, label: 'Workspace', page: true },
      { id: 'terminal', icon: Terminal, label: 'Terminal', page: true },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { id: 'research', icon: Globe, label: 'Research', stage: 5 },
      { id: 'memory', icon: Database, label: 'Memory', page: true },
      { id: 'models', icon: Brain, label: 'Models', page: true },
      { id: 'skills', icon: Boxes, label: 'Skills', page: true },
      { id: 'mcp', icon: Plug, label: 'MCP', page: true },
    ],
  },
  {
    label: 'EXTENSIONS',
    items: [
      { id: 'plugins', icon: Puzzle, label: 'Plugins', page: true },
      { id: 'knowledge', icon: BookOpen, label: 'Knowledge', page: true },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'download', icon: Smartphone, label: 'App', page: true },
      { id: 'settings', icon: Settings, label: 'Settings', page: true },
    ],
  },
];

export const NAV_FLAT = NAV_SECTIONS.flatMap((s) => s.items);

export const navLabel = (id) => NAV_FLAT.find((i) => i.id === id)?.label || id.toUpperCase();

export default function NavList({ activeNav, onNavigate }) {
  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-1.5 text-[8px] font-bold tracking-[0.18em] text-text-tertiary">{section.label}</p>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 active:scale-[0.98] ${
                    active
                      ? 'bg-brand-dim border border-brand-line text-brand'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03] border border-transparent'
                  }`}
                >
                  <span className="flex items-center justify-center w-4 h-4">
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                  </span>
                  <span className="text-[11px] font-semibold tracking-wide">{item.label}</span>
                  {item.stage && (
                    <span className="ml-auto text-[7px] font-bold tracking-wider text-text-tertiary border border-hairline rounded-full px-1.5 py-0.5">
                      STAGE {item.stage}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
