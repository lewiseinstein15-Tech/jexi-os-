import { motion } from 'framer-motion';
import { Home, Bot, Database, BookOpen, Settings, Smartphone } from 'lucide-react';

export default function BottomNavigation({ activeNav, setActiveNav }) {
  const items = [
    { id: 'home', icon: Home, label: 'HOME' },
    { id: 'agents', icon: Bot, label: 'AGENTS' },
    { id: 'memory', icon: Database, label: 'MEMORY' },
    { id: 'knowledge', icon: BookOpen, label: 'BOOKS' },
    { id: 'settings', icon: Settings, label: 'SETTINGS' },
    { id: 'download', icon: Smartphone, label: 'APP' },
  ];

  return (
    <motion.div
      initial={{ y: 40 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="fixed bottom-0 left-0 right-0 bg-[#0a0a0c]/85 backdrop-blur-xl border-t border-white/[0.06]"
      style={{ boxShadow: '0 -10px 34px rgba(0,0,0,0.55)' }}
    >
      <div className="flex justify-around items-center py-2 px-1">
        {items.map(({ id, icon: Icon, label }) => {
          const active = activeNav === id;
          return (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={`relative flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-xl transition-all duration-200 active:scale-90 ${
                active ? 'text-[#00FF9D]' : 'text-gray-600 hover:text-gray-400'
              }`}
              aria-label={label}
            >
              {active && (
                <motion.div
                  layoutId="nav-glow"
                  className="absolute inset-0 rounded-xl bg-[#00FF9D]/10 border border-[#00FF9D]/25 shadow-[0_0_16px_rgba(0,255,157,0.15)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative flex items-center justify-center w-6 h-6">
                <Icon className="w-4 h-4" />
              </span>
              <span className="relative text-[7px] font-bold tracking-wider">{label}</span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
