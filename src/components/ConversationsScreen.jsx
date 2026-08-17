import { useState, useEffect, useCallback } from 'react';
import {
  MessagesSquare, Plus, Trash2, GitFork, Search, Clock, Loader2, MessageCircle, Bot, ChevronRight,
} from 'lucide-react';
import { getBackendUrl, jexiFetch, getSessionId, setSessionId } from '../utils/helpers';
import PanelHeader from './PanelHeader';

/**
 * CONVERSATIONS (B96) — DeepSeek-Harness-style session model in the UI.
 * JEXI keeps an append-only log of EVERY conversation. This screen lists
 * them (titled by the first message), opens any one to read its full log,
 * forks one into a new session (lineage preserved), and deletes.
 */

const timeAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function ConversationsScreen() {
  const [convs, setConvs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openConv, setOpenConv] = useState(null); // { id, events[] }
  const [searchQ, setSearchQ] = useState('');
  const [searchRes, setSearchRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/conversations`);
      const d = await res.json();
      setConvs(d.conversations || []);
    } catch (e) { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 8000); return () => clearInterval(id); }, [load]);

  const openConversation = async (id) => {
    setBusy(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/conversations/${id}`);
      const d = await res.json();
      setOpenConv({ id, events: d.events || [] });
    } catch (e) { /* noop */ }
    setBusy(false);
  };

  const forkIt = async (id) => {
    setBusy(true);
    try {
      await jexiFetch(`${getBackendUrl()}/api/conversations/${id}/fork`, { method: 'POST' });
      await load();
    } catch (e) { /* noop */ }
    setBusy(false);
  };

  const del = async (id) => {
    setBusy(true);
    try {
      await jexiFetch(`${getBackendUrl()}/api/conversations/${id}`, { method: 'DELETE' });
      if (openConv && openConv.id === id) setOpenConv(null);
      await load();
    } catch (e) { /* noop */ }
    setBusy(false);
  };

  const doSearch = async () => {
    const q = searchQ.trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/conversations/search?q=${encodeURIComponent(q)}`);
      setSearchRes(await res.json());
    } catch (e) { /* noop */ }
    setBusy(false);
  };

  return (
    <div className="px-3 pt-4 pb-8 space-y-3 max-w-[820px] mx-auto">
      <PanelHeader icon={MessagesSquare} title="CONVERSATIONS" subtitle="Every chat JEXI has ever had — browse, search, fork, resume. DeepSeek-Harness-style session memory." />

      {/* Search across all conversations */}
      <div className="flex gap-2">
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="Search ALL past conversations… (JEXI can do this herself via session-search)"
          className="flex-1 bg-surface-1 text-text-primary border border-hairline rounded-md px-3 py-2.5 text-xs focus:outline-none focus:border-brand-line"
        />
        <button onClick={doSearch} disabled={busy || !searchQ.trim()} className="px-3 py-2 rounded-md bg-brand text-black text-[10px] font-bold flex items-center gap-1.5 disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} SEARCH
        </button>
      </div>

      {searchRes && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold tracking-wider text-text-tertiary">SEARCH RESULTS</p>
          {searchRes.results && searchRes.results.length === 0 && <p className="text-[10px] text-text-tertiary">No matches.</p>}
          {searchRes.results && searchRes.results.map((r, i) => (
            <div key={i} className="bg-surface-2 border border-hairline rounded-md p-2.5">
              <p className="text-[10px] font-semibold text-brand">{r.conversation} <span className="text-text-tertiary font-mono text-[8px]">· {timeAgo(r.lastActive)}</span></p>
              {r.hits.map((h, j) => (
                <p key={j} className={`text-[9px] mt-1 ${h.role === 'user' ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                  <span className="font-bold">{h.role === 'user' ? 'YOU' : 'JEXI'}:</span> {h.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {loading && <div className="text-center text-text-tertiary text-xs py-10"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>}
      {!loading && convs.length === 0 && (
        <div className="text-center py-14 border border-dashed border-hairline rounded-xl">
          <MessagesSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-xs text-text-tertiary">No conversations yet — start chatting and they'll appear here.</p>
        </div>
      )}

      <div className="space-y-1.5">
        {convs.map((c) => (
          <div key={c.id} className="bg-surface-2 border border-hairline rounded-md overflow-hidden">
            <button onClick={() => openConversation(c.id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-1/60">
              <MessageCircle className="w-3.5 h-3.5 text-brand shrink-0" />
              <span className="text-xs font-semibold text-text-primary truncate flex-1">{c.title}</span>
              <span className="text-[8px] text-text-tertiary shrink-0">{c.messageCount} msgs · {timeAgo(c.lastActive)}</span>
              <ChevronRight className="w-3 h-3 text-text-tertiary shrink-0" />
            </button>
            {openConv && openConv.id === c.id && (
              <div className="border-t border-hairline px-3 py-2 space-y-1 max-h-56 overflow-y-auto">
                {openConv.events.map((e, i) => (
                  <p key={i} className={`text-[9px] leading-relaxed ${e.role === 'user' ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                    <span className="font-bold">{e.role === 'user' ? 'YOU' : 'JEXI'}:</span> {String(e.text || '').slice(0, 400)}
                  </p>
                ))}
                <div className="flex gap-1.5 pt-1.5">
                  <button onClick={() => { setSessionId(c.id); window.location.hash = '#home'; window.dispatchEvent(new Event('jexi:resume-conversation')); }} className="px-2 py-1 rounded text-[8px] font-bold border border-brand-line bg-brand-dim/40 text-brand flex items-center gap-1 hover:bg-brand-dim">
                    <MessageCircle className="w-2.5 h-2.5" /> RESUME IN CHAT
                  </button>
                  <button onClick={() => forkIt(c.id)} className="px-2 py-1 rounded text-[8px] font-bold border border-brand-line text-brand flex items-center gap-1 hover:bg-brand-dim/40">
                    <GitFork className="w-2.5 h-2.5" /> FORK
                  </button>
                  <button onClick={() => del(c.id)} className="px-2 py-1 rounded text-[8px] font-bold border border-status-error/40 text-status-error flex items-center gap-1 hover:bg-status-error/10">
                    <Trash2 className="w-2.5 h-2.5" /> DELETE
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
