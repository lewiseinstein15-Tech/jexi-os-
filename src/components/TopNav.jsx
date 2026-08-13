import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Bell } from 'lucide-react';
import NavList, { navLabel } from './NavList';

export default function TopNav({ activeNav, running, onNavigate, contextOverride }) {
  const [open, setOpen] = useState(false);

  const navigate = (id) => {
    setOpen(false);
    onNavigate(id);
  };

  const context = contextOverride || navLabel(activeNav);

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-30 bg-void/85 backdrop-blur-xl border-b border-hairline"
      >
        <div className="flex items-center h-[52px] px-3 md:px-5 gap-2">
          {/* Left: hamburger + wordmark (always present on mobile) */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.04] border border-transparent hover:border-hairline transition-all active:scale-95 md:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 select-none">
              <span className="relative flex w-2.5 h-2.5">
                <span className={`absolute inline-flex w-full h-full rounded-full bg-brand opacity-60 ${running ? 'animate-ping' : ''}`} />
                <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-brand" />
              </span>
              <h1 className="text-[15px] font-bold tracking-tight text-text-primary leading-none">
                JEXI <span className="text-brand">OS</span>
              </h1>
            </div>
          </div>

          {/* Center: current workspace / context */}
          <div className="hidden sm:flex items-center gap-1.5 min-w-0 mx-auto">
            <span className="w-1 h-1 rounded-full bg-text-tertiary" />
            <span className="text-[9px] font-bold tracking-[0.18em] uppercase text-text-tertiary truncate">{context}</span>
          </div>

          {/* Right: notifications + status */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              aria-label="Notifications"
              className="relative w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.04] border border-transparent hover:border-hairline transition-all active:scale-95"
            >
              <Bell className="w-4 h-4" />
              {running && (
                <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              )}
            </button>
            <div className="flex items-center gap-1.5 bg-brand-dim border border-brand-line rounded-full px-2.5 py-1.5">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex w-full h-full rounded-full bg-brand opacity-60 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-brand" />
              </span>
              <span className="text-[8px] text-brand font-bold tracking-wider">{running ? 'WORKING' : 'ONLINE'}</span>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-y-0 left-0 w-[290px] max-w-[85vw] bg-surface-1 border-r border-hairline-strong flex flex-col shadow-[8px_0_40px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between px-4 h-[52px] border-b border-hairline flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand" />
                  <span className="text-[12px] font-bold tracking-tight text-text-primary">JEXI <span className="text-brand">OS</span></span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 px-3 py-4 overflow-y-auto">
                <NavList activeNav={activeNav} onNavigate={navigate} />
              </div>
              <div className="px-4 py-3 border-t border-hairline flex-shrink-0">
                <p className="text-[8px] font-bold tracking-wider text-text-tertiary font-mono">
                  v1.1 · 106 specialists · 328 skills
                </p>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
