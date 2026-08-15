import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send, RefreshCw, ArrowLeft, CheckCheck, AlertTriangle } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const WA_CONNECTOR = 'whatsapp'; // templated so the API-surface test matches the server's param routes

const timeAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

const fmtTime = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function WhatsAppChats() {
  const [conversations, setConversations] = useState(null);
  const [openPartner, setOpenPartner] = useState(null);
  const [notice, setNotice] = useState(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [newNumber, setNewNumber] = useState('+254117977415'); // user's personal number (B62 default)
  const [newText, setNewText] = useState('');
  const listRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await jexiFetch(`${getBackendUrl()}/api/connectors/${WA_CONNECTOR}/conversations?limit=40`).then((x) => x.json());
      setConversations(r.conversations || []);
    } catch (e) { /* backend down — keep last state */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000); // live: new inbound + replies appear automatically
    return () => clearInterval(id);
  }, [load]);

  const flash = (text) => { setNotice(text); setTimeout(() => setNotice(null), 5000); };

  const sendTo = async (to, text) => {
    if (!to || !text.trim()) return false;
    setSending(true);
    try {
      const r = await jexiFetch(`${getBackendUrl()}/api/connectors/${WA_CONNECTOR}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'send', payload: { to, type: 'text', text: text.trim() } }),
      }).then((x) => x.json());
      if (r.ok) {
        flash(`✓ Sent to ${to}`);
        setDraft('');
        setNewText('');
        if (openPartner !== to) setOpenPartner(to);
        load();
        return true;
      }
      flash(`Send failed: ${(r.error || 'unknown error').slice(0, 120)}`);
    } catch (e) {
      flash(`Send failed: ${(e && e.message) || e}`);
    } finally {
      setSending(false);
    }
    return false;
  };

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [openPartner, conversations]);

  // ── thread view ────────────────────────────────────────────────
  if (openPartner) {
    const conv = (conversations || []).find((c) => c.partner === openPartner);
    const messages = (conv && conv.messages) || [];
    return (
      <div className="mx-auto w-full max-w-[640px] px-3 pt-4 pb-16 space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpenPartner(null)} className="w-9 h-9 flex items-center justify-center rounded-lg border border-hairline bg-surface-1 text-text-secondary hover:text-brand transition-colors" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">JEXI · WHATSAPP</p>
            <h1 className="text-[16px] font-bold tracking-tight text-text-primary truncate font-mono">{openPartner}</h1>
          </div>
          <button type="button" onClick={load} className="p-2 text-text-tertiary hover:text-brand transition-colors" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </div>

        <div ref={listRef} className="surface-card rounded-xl p-3 space-y-2 max-h-[52dvh] overflow-y-auto border border-hairline">
          {messages.length === 0 && <p className="text-[10px] text-text-tertiary text-center py-8">No messages yet in this thread.</p>}
          {messages.map((m, i) => {
            const out = m.direction === 'out';
            return (
              <div key={i} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl ${out ? 'bg-gradient-to-br from-brand to-[#00B55C] text-[#04140D] rounded-br-sm' : 'bg-surface-2 border border-hairline text-text-primary rounded-bl-sm'}`}>
                  <p className="text-[11px] leading-snug whitespace-pre-wrap break-words">{m.text || (m.error ? '⚠ delivery failed' : '')}</p>
                  <p className={`mt-1 flex items-center gap-1 text-[8px] font-mono ${out ? 'text-[#04140D]/60' : 'text-text-tertiary'}`}>
                    {fmtTime(m.at)}
                    {out && (m.ok ? <CheckCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />)}
                  </p>
                  {!out && m.media && <p className="text-[8px] font-mono text-text-tertiary mt-0.5">📎 {m.media.type || 'media'}</p>}
                </div>
              </div>
            );
          })}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); sendTo(openPartner, draft); }}
          className="surface-float flex items-center gap-2 rounded-xl p-2 pl-4 focus-within:border-brand-line"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Reply to ${openPartner}…`}
            className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary rounded-lg py-2.5 text-[13px] focus:outline-none"
          />
          <button type="submit" disabled={sending || !draft.trim()} className="w-10 h-10 flex items-center justify-center rounded-full bg-brand text-[#04140D] disabled:bg-surface-2 disabled:text-text-tertiary transition-all active:scale-95" aria-label="Send">
            <Send className="w-4 h-4" />
          </button>
        </form>
        {notice && <p className="text-[9px] font-bold text-brand break-all">{notice}</p>}
      </div>
    );
  }

  // ── conversation list ───────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-[640px] px-3 pt-4 pb-16 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-9 h-9 flex items-center justify-center rounded-lg border border-brand-line bg-brand-dim text-brand"><MessageCircle className="w-4 h-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">JEXI · WHATSAPP · BUSINESS</p>
          <h1 className="text-[16px] font-bold tracking-tight text-text-primary">Chats & replies</h1>
        </div>
        <button type="button" onClick={load} className="p-2 text-text-tertiary hover:text-brand transition-colors" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Message anyone — B62: compose straight from the app */}
      <div className="surface-card rounded-xl p-3 space-y-2">
        <p className="eyebrow">MESSAGE ANYONE</p>
        <div className="flex gap-2">
          <input
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            placeholder="+254… (E.164)"
            className="flex-1 min-w-0 bg-surface-2 text-text-primary border border-hairline rounded-md px-2.5 py-2 text-[10px] font-mono focus:outline-none focus:border-brand-line"
          />
          <button
            type="button"
            disabled={sending || !newNumber.trim() || !newText.trim()}
            onClick={() => sendTo(newNumber.trim(), newText)}
            className="bg-[#00FF9D]/15 border border-[#00FF9D]/30 text-[#00FF9D] rounded-md px-3 py-2 text-[9px] font-black tracking-wide disabled:opacity-40 flex items-center gap-1"
          >
            <Send className="w-3 h-3" /> SEND
          </button>
        </div>
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Message text…"
          className="w-full bg-surface-2 text-text-primary border border-hairline rounded-md px-2.5 py-2 text-[11px] focus:outline-none focus:border-brand-line"
        />
        {notice && <p className="text-[9px] font-bold text-brand break-all">{notice}</p>}
      </div>

      <p className="eyebrow">CONVERSATIONS · IN + OUT</p>
      {conversations === null && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
        </div>
      )}
      {conversations !== null && conversations.length === 0 && (
        <div className="surface-card rounded-xl p-8 text-center space-y-2">
          <MessageCircle className="w-6 h-6 text-text-tertiary mx-auto" />
          <p className="text-[11px] text-text-secondary">No conversations yet.</p>
          <p className="text-[9px] text-text-tertiary leading-snug">Message the business number <span className="font-mono text-brand">+1 555 659-4264</span> from any phone — JEXI replies automatically and every message lands here.</p>
        </div>
      )}
      <div className="space-y-2">
        {(conversations || []).map((c) => (
          <button
            key={c.partner}
            type="button"
            onClick={() => setOpenPartner(c.partner)}
            className="w-full surface-card rounded-xl p-3 text-left hover:border-brand-line transition-all active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <span className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-dim border border-brand-line text-brand flex items-center justify-center text-[11px] font-black">
                {String(c.partner || '?').replace(/^\+/, '').slice(-2)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-bold text-text-primary font-mono truncate">{c.partner}</p>
                  <span className="ml-auto text-[8px] font-mono text-text-tertiary flex-shrink-0">{timeAgo(c.lastAt)}</span>
                </div>
                <p className="text-[10px] text-text-secondary truncate mt-0.5">{c.lastText || '…'}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
