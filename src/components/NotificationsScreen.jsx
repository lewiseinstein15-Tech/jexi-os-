import { useState, useEffect, useCallback } from 'react';
import {
  Bell, CheckCheck, Trash2, CheckCircle2, AlertTriangle, Clock, Sparkles,
  ChevronRight, Loader2, BellRing,
} from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import PanelHeader from './PanelHeader';

/**
 * NOTIFICATIONS — the beautiful full-screen notification center (B88).
 * Groups by day, icons per kind, unread styling, tap-to-open the linked
 * destination (goal stream / tasks), mark-all-read + clear. Polls every 8s.
 */

const KIND_META = {
  success: { Icon: CheckCircle2, text: 'text-brand', bg: 'bg-brand/10', border: 'border-brand/25', label: 'DONE' },
  error: { Icon: AlertTriangle, text: 'text-status-error', bg: 'bg-status-error/10', border: 'border-status-error/30', label: 'FAILED' },
  warn: { Icon: Clock, text: 'text-acc-automation', bg: 'bg-acc-automation/10', border: 'border-acc-automation/25', label: 'ATTENTION' },
  info: { Icon: Sparkles, text: 'text-acc-research', bg: 'bg-acc-research/10', border: 'border-acc-research/25', label: 'INFO' },
};

const timeAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const dayKey = (t) => {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function NotificationsScreen() {
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/notifications?limit=60`);
      const data = await res.json();
      setNotifs(data.notifications || []);
      setUnread(data.unread || 0);
    } catch (e) { /* backend down */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const markAll = async () => {
    setBusy(true);
    try { await jexiFetch(`${getBackendUrl()}/api/notifications/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) {}
    await refresh();
    setBusy(false);
  };

  const clearAll = async () => {
    setBusy(true);
    try { await jexiFetch(`${getBackendUrl()}/api/notifications/clear`, { method: 'POST' }); } catch (e) {}
    await refresh();
    setBusy(false);
  };

  const markOne = async (id) => {
    try { await jexiFetch(`${getBackendUrl()}/api/notifications/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); } catch (e) {}
    refresh();
  };

  // Group by day, newest first
  const groups = [];
  for (const n of notifs) {
    const k = dayKey(n.time);
    const g = groups.find((x) => x.day === k);
    if (g) g.items.push(n);
    else groups.push({ day: k, items: [n] });
  }

  return (
    <div className="px-3 pt-4 pb-8 space-y-3 max-w-[720px] mx-auto">
      <PanelHeader icon={Bell} title="NOTIFICATIONS" subtitle="Everything JEXI wants to tell you — goals, tasks, scheduled missions." />

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
          {unread > 0 ? (
            <span className="flex items-center gap-1.5 text-brand font-semibold">
              <BellRing className="w-3.5 h-3.5 animate-pulse" /> {unread} unread
            </span>
          ) : (
            <span className="flex items-center gap-1.5"><CheckCheck className="w-3.5 h-3.5" /> All caught up</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={markAll}
            disabled={busy || unread === 0}
            className="px-3 py-1.5 rounded-md text-[9px] font-bold tracking-wider text-text-secondary border border-hairline hover:border-brand-line hover:text-brand disabled:opacity-30 flex items-center gap-1.5"
          >
            <CheckCheck className="w-3 h-3" /> MARK ALL READ
          </button>
          <button
            onClick={clearAll}
            disabled={busy || notifs.length === 0}
            className="px-3 py-1.5 rounded-md text-[9px] font-bold tracking-wider text-text-secondary border border-hairline hover:border-status-error/40 hover:text-status-error disabled:opacity-30 flex items-center gap-1.5"
          >
            <Trash2 className="w-3 h-3" /> CLEAR
          </button>
        </div>
      </div>

      {/* Groups */}
      {loading && <div className="text-center text-text-tertiary text-xs py-10"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>}
      {!loading && notifs.length === 0 && (
        <div className="text-center py-14 border border-dashed border-hairline rounded-xl">
          <Bell className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-xs text-text-tertiary">Nothing yet.</p>
          <p className="text-[10px] text-text-tertiary/70 mt-1">Goals, tasks and scheduled missions post here when they finish.</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.day}>
          <p className="text-[9px] font-bold tracking-[0.16em] text-text-tertiary px-1 mb-1.5">{g.day.toUpperCase()}</p>
          <div className="space-y-1.5">
            {g.items.map((n) => {
              const meta = KIND_META[n.kind] || KIND_META.info;
              const Icon = meta.Icon;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.read) markOne(n.id);
                    if (n.link) {
                      // open goal stream / tasks link if it's an internal path
                      const base = getBackendUrl();
                      if (n.link.startsWith('/api/')) window.open(`${base}${n.link}`, '_blank');
                    }
                  }}
                  className={`group flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all hover:border-hairline-strong hover:bg-surface-1/60 ${n.read ? 'border-hairline bg-surface-2/50' : 'border-brand-line bg-surface-2 shadow-[0_2px_16px_rgba(0,255,157,0.06)]'}`}
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg} ${meta.text} border ${meta.border}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-black tracking-wider ${meta.text}`}>{meta.label}</span>
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />}
                      <span className="ml-auto text-[8px] font-mono text-text-tertiary flex-shrink-0">{timeAgo(n.time)}</span>
                    </div>
                    <p className={`text-[11px] font-semibold mt-0.5 leading-snug ${n.read ? 'text-text-secondary' : 'text-text-primary'}`}>{n.title}</p>
                    {n.body && <p className="text-[9px] text-text-tertiary mt-1 leading-relaxed line-clamp-2">{n.body}</p>}
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-text-tertiary/50 mt-2 flex-shrink-0 group-hover:text-text-tertiary" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
