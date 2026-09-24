import { useEffect, useState, useCallback } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startToday - startDay) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const timeOf = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function HistoryView({ onOpen }) {
  const [convs, setConvs] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/conversations`);
      if (res.ok) {
        const data = await res.json();
        setConvs(data.conversations || []);
      }
    } catch (e) { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openConv = async (conv) => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/session-query/${encodeURIComponent(conv.id)}?limit=500`);
      let events = [];
      if (res.ok) {
        const data = await res.json();
        events = data.events || [];
      }
      onOpen(conv.id, events);
    } catch (e) {
      onOpen(conv.id, []);
    }
  };

  const filtered = convs.filter((c) => {
    if (!q.trim()) return true;
    const hay = `${c.title || ''} ${c.firstMessage || ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const groups = {};
  for (const c of filtered) {
    const label = dayLabel(c.lastActive || Date.now());
    if (!groups[label]) groups[label] = [];
    groups[label].push(c);
  }

  return (
    <div className="jx-scroll">
      <div className="jx-view-inner">
        <div className="jx-vtitle">Chat history</div>
        <div className="jx-vsub">Every conversation, searchable. Nothing is lost — open one and keep going.</div>
        <div className="jx-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {loading && <div className="jx-vsub">loading…</div>}
        {!loading && filtered.length === 0 && <div className="jx-vsub">No conversations yet — say hi in Chat.</div>}
        {Object.entries(groups).map(([label, list]) => (
          <div key={label}>
            <div className="jx-grp">{label}</div>
            {list.map((c) => (
              <button key={c.id} type="button" className="jx-row" onClick={() => openConv(c)}>
                <div>
                  <div className="t">{c.title || '(untitled)'}</div>
                  <div className="d">{String(c.firstMessage || '').replace(/\s+/g, ' ').slice(0, 70) || `${c.messageCount || 0} messages`}</div>
                </div>
                <div className="meta">
                  {timeOf(c.lastActive || Date.now())}<br />
                  {c.messageCount || 0} msgs
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
