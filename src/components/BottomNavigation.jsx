import { motion } from 'framer-motion';
import { Home, Bot, LayoutGrid, ListTodo, Target, Settings } from 'lucide-react';

export default function BottomNavigation({ activeNav, setActiveNav }) {
  const items = [
    { id: 'home', icon: Home, label: 'HOME' },
    { id: 'agents', icon: Bot, label: 'AGENTS' },
    { id: 'command', icon: LayoutGrid, label: 'COMMAND' },
    { id: 'missions', icon: Target, label: 'MISSIONS' },
    { id: 'tasks', icon: ListTodo, label: 'TASKS' },
    { id: 'settings', icon: Settings, label: 'SETTINGS' },
  ];

  return (
    <motion.div
      initial={{ y: 40 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex-shrink-0 bg-surface-1/85 backdrop-blur-xl border-t border-hairline md:hidden"
      style={{ boxShadow: '0 -10px 34px rgba(0,0,0,0.55)', paddingBottom: 'var(--sab)' }}
    >
      <div className="flex justify-around items-center py-2 px-1">
        {items.map(({ id, icon: Icon, label }) => {
          const active = activeNav === id;
          return (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={`relative flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-xl transition-all duration-200 active:scale-90 ${
                active ? 'text-brand' : 'text-text-tertiary hover:text-text-secondary'
              }`}
              aria-label={label}
            >
              {active && (
                <motion.div
                  layoutId="nav-glow"
                  className="absolute inset-0 rounded-xl bg-brand-dim border border-brand-line shadow-[0_0_16px_rgba(0,255,157,0.15)]"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
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
