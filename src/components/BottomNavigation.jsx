import { motion } from 'framer-motion';
import { Home, Hexagon, Brain, Settings } from 'lucide-react';

export default function BottomNavigation({ activeNav, setActiveNav }) {
  const items = [
    { id: 'home', label: 'HOME', icon: Home },
    { id: 'agents', label: 'AGENTS', icon: Hexagon, center: true },
    { id: 'memory', label: 'MEMORY', icon: Brain },
    { id: 'settings', label: 'SETTINGS', icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-[#00ff9d22]" style={{ paddingBottom: 'var(--safe-bottom)' }}>
      <div className="flex items-center justify-around px-2 py-2">
        {items.map(item => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <motion.button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className="flex flex-col items-center gap-1 relative w-16"
              whileTap={{ scale: 0.9 }}
            >
              {item.center ? (
                <motion.div 
                  className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#00FF9D] to-[#00cc7a] flex items-center justify-center text-black shadow-[0_0_20px_rgba(0,255,157,0.5)]"
                  animate={{ y: -8 }}
                >
                  <Icon className="w-6 h-6" />
                </motion.div>
              ) : (
                <Icon className={`w-5 h-5 ${isActive ? 'text-[#00FF9D]' : 'text-gray-500'}`} />
              )}
              <span className={`text-[8px] font-medium ${isActive ? 'text-[#00FF9D]' : 'text-gray-500'}`}>{item.label}</span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
