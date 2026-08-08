import { Home, Bot, Database, BookOpen, Monitor, Settings, Smartphone } from 'lucide-react';

export default function BottomNavigation({ activeNav, setActiveNav }) {
  const items = [
    { id: 'home', icon: Home, label: 'HOME' },
    { id: 'agents', icon: Bot, label: 'AGENTS' },
    { id: 'memory', icon: Database, label: 'MEMORY' },
    { id: 'knowledge', icon: BookOpen, label: 'BOOKS' },
    { id: 'desktop', icon: Monitor, label: 'DESKTOP' },
    { id: 'settings', icon: Settings, label: 'SETTINGS' },
    { id: 'download', icon: Smartphone, label: 'APP' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0a]/90 backdrop-blur-lg border-t border-[#1a1a1a]">
      <div className="flex justify-around items-center py-2 px-1">
        {items.map(({ id, icon: Icon, label }) => {
          const active = activeNav === id;
          return (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={`flex flex-col items-center gap-1 px-1.5 py-1.5 rounded-xl transition-all ${
                active
                  ? 'text-[#00FF9D] bg-[#00FF9D]/10'
                  : 'text-gray-600 hover:text-gray-400 active:scale-95'
              }`}
              aria-label={label}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[7px] font-bold tracking-wider">{label}</span>
              <div className={`h-0.5 w-3 rounded-full transition-all ${active ? 'bg-[#00FF9D]' : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
