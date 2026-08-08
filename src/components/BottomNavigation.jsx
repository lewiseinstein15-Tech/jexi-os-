import { Home, Bot, Database, BookOpen, Monitor, Settings, Smartphone } from 'lucide-react';

export default function BottomNavigation({ activeNav, setActiveNav }) {
  const items = [
    { id: 'home', icon: Home, label: 'HOME' },
    { id: 'agents', icon: Bot, label: 'AGENTS' },
    { id: 'memory', icon: Database, label: 'MEMORY' },
    { id: 'knowledge', icon: BookOpen, label: 'BOOKS' },
    { id: 'desktop', icon: Monitor, label: 'DESKTOP' },
    { id: 'settings', icon: Settings, label: 'SETTINGS' },
    { id: 'download', icon: Smartphone, label: 'GET APP' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0a]/90 backdrop-blur-lg border-t border-[#222]">
      <div className="flex justify-around items-center py-2 px-1">
        {items.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveNav(id)}
            className={`flex flex-col items-center gap-1 px-2 py-1 transition-all ${
              activeNav === id ? 'text-[#00FF9D]' : 'text-gray-600'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="text-[7px] font-bold tracking-wider">{label}</span>
            {activeNav === id && (
              <div className="w-1 h-1 rounded-full bg-[#00FF9D]" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
