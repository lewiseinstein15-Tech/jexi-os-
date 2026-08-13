import { motion } from 'framer-motion';
import { Sparkles, Home, Bot, Database, BookOpen, Settings, Smartphone } from 'lucide-react';
import JexiCore from './JexiCore';

const NAV_ITEMS = [
  { id: 'home', icon: Home, label: 'HOME' },
  { id: 'agents', icon: Bot, label: 'AGENTS' },
  { id: 'memory', icon: Database, label: 'MEMORY' },
  { id: 'knowledge', icon: BookOpen, label: 'BOOKS' },
  { id: 'settings', icon: Settings, label: 'SETTINGS' },
  { id: 'download', icon: Smartphone, label: 'APP' },
];

// Visible build label (bump per release). Pushing a change to src/ also
// triggers the APK CI workflow, which stamps its own apk-build-<run> number.
const APP_BUILD = '47';

export default function Header({ plan = null, logs = [], running = false, activeNav = 'home', setActiveNav = () => {} }) {
  // The active agent is the last one that logged — the Core lights its segment.
  let activeAgent = null;
  let roster = (plan?.roster) || [];
  if (logs.length > 0) activeAgent = logs[logs.length - 1].agent;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 pt-4 pb-3 relative z-10"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* The Core — a live visualization of what JEXI is doing (spec §6) */}
          <JexiCore size={32} roster={roster} activeAgent={activeAgent} running={running} done={!running && roster.length > 0} />

          <div>
            <h1 className="text-xl font-black text-white tracking-tight leading-none">
              JEXI <span className="text-gradient">OS</span>
            </h1>
            <p className="text-[8px] text-text-tertiary font-semibold tracking-[0.22em] mt-1.5 uppercase">
              Multi-agent AI · By Lewis Einstein
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-white/[0.04] border border-hairline rounded-full px-2.5 py-1.5">
            <span className="text-[8px] text-text-secondary font-bold tracking-wider">BUILD {APP_BUILD}</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 bg-white/[0.04] border border-hairline rounded-full px-2.5 py-1.5">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span className="text-[8px] text-cyan-300 font-bold tracking-wider">
              {plan?.rosterCatalogSize || 79} AGENTS
            </span>
          </div>
          <div
            className="flex items-center gap-1.5 bg-brand-dim border border-brand-line rounded-full px-2.5 py-1.5"
            style={{ animation: 'pulseGlow 2.6s ease-in-out infinite' }}
          >
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-brand opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-brand" />
            </span>
            <span className="text-[8px] text-brand font-bold tracking-wider">ONLINE</span>
          </div>
        </div>
      </div>

      {/* §7 desktop: persistent tab bar in the header instead of bottom nav */}
      <nav className="hidden md:flex items-center gap-1 mt-4 border-t border-hairline pt-3">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const active = activeNav === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveNav(id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all duration-200 active:scale-95 ${
                active ? 'text-brand' : 'text-text-tertiary hover:text-text-secondary'
              }`}
              aria-label={label}
            >
              {active && (
                <motion.div
                  layoutId="header-tab-glow"
                  className="absolute inset-0 rounded-lg bg-brand-dim border border-brand-line"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative flex items-center justify-center w-5 h-5">
                <Icon className="w-4 h-4" />
              </span>
              <span className="relative text-[9px] font-bold tracking-wider">{label}</span>
            </button>
          );
        })}
      </nav>
    </motion.div>
  );
}
