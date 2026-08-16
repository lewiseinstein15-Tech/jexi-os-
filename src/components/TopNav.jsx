import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, Bell, CheckCheck, Trash2 } from 'lucide-react';
import NavList, { navLabel } from './NavList';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const timeAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function NotificationBell() {
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/notifications?limit=20`);
      const data = await res.json();
      setNotifs(data.notifications || []);
      setUnread(data.unread || 0);
    } catch (e) { /* backend down */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const markRead = async () => {
    try { await jexiFetch(`${getBackendUrl()}/api/notifications/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) {}
    refresh();
  };

  const clearAll = async () => {
    try { await jexiFetch(`${getBackendUrl()}/api/notifications/clear`, { method: 'POST' }); } catch (e) {}
    refresh();
  };

  const kindColor = (k) => (k === 'success' ? 'text-brand' : k === 'warn' ? 'text-acc-automation' : k === 'error' ? 'text-status-error' : 'text-acc-research');
  const kindDot = (k) => (k === 'success' ? 'bg-brand' : k === 'warn' ? 'bg-acc-automation' : k === 'error' ? 'bg-status-error' : 'bg-acc-research');

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => { setOpen((v) => !v); if (!open) markRead(); }}
        className="relative w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.04] border border-transparent hover:border-hairline transition-all active:scale-95"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-brand text-black text-[8px] font-black flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-11 w-[320px] max-w-[calc(100vw-2rem)] surface-card rounded-xl border border-hairline-strong shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-hairline">
              <span className="text-[9px] font-bold tracking-[0.14em] text-text-primary">NOTIFICATIONS</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={markRead} title="Mark all read" className="p-1.5 text-text-tertiary hover:text-brand"><CheckCheck className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={clearAll} title="Clear all" className="p-1.5 text-text-tertiary hover:text-status-error"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {notifs.length === 0 && <p className="text-[10px] text-text-tertiary text-center py-8">Nothing yet — scheduled missions post here when they finish.</p>}
              {notifs.map((n) => (
                <div key={n.id} className={`px-3 py-2.5 border-b border-hairline/50 ${n.read ? 'opacity-60' : 'bg-brand-dim/20'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${kindDot(n.kind)}`} />
                    <span className={`text-[10px] font-semibold text-text-primary truncate flex-1 ${kindColor(n.kind)}`}>{n.title}</span>
                    <span className="text-[8px] font-mono text-text-tertiary flex-shrink-0">{timeAgo(n.time)}</span>
                  </div>
                  {n.body && <p className="text-[9px] text-text-secondary mt-1 leading-snug">{n.body}</p>}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
        className="flex-shrink-0 z-30 bg-void/85 backdrop-blur-xl border-b border-hairline"
        style={{ paddingTop: 'var(--sat)' }}
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
            <NotificationBell />
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
                  v1.2 · 251 specialists · 507 skills · FCM + goals + push
                </p>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
