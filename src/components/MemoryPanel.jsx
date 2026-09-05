import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, User, ChevronDown, Sparkles, Search, Trash2, Download, BookOpen, X } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const timeAgo = (dateStr) => {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Accordion({ icon: Icon, title, count, color, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="surface-card p-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 py-1">
        <Icon className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-[10px] font-bold tracking-wider" style={{ color }}>{title}</span>
        {count > 0 && <span className="text-[8px] font-black text-text-tertiary bg-surface-2 border border-hairline rounded-full px-1.5 py-0.5">{count}</span>}
        <ChevronDown
          className={`ml-auto w-3.5 h-3.5 text-text-tertiary transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const entryText = (item) => {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.fact || item.topic || item.question || item.text || item.ask || '';
};

export default function MemoryPanel({ memory }) {
  const [mem, setMem] = useState(memory);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  // Keep the local copy in sync with the polled prop (App re-fetches every 3s).
  useEffect(() => { if (memory) setMem(memory); }, [memory]);

  const refresh = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/memory`);
      const data = await res.json();
      if (data && data.chatHistory) setMem(data);
    } catch (e) { console.error('Memory refresh failed', e); }
  }, []);

  const deleteEntry = async (kind, index) => {
    try {
      await jexiFetch(`${getBackendUrl()}/api/memory/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, index }),
      });
      refresh();
    } catch (e) { console.error('Memory delete failed', e); }
  };

  const doSearch = async (text) => {
    setQ(text);
    if (!text.trim()) { setResults(null); return; }
    setSearching(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/memory/search?q=${encodeURIComponent(text.trim())}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) { setResults([]); }
    setSearching(false);
  };

  const exportMemory = () => {
    const url = `${getBackendUrl()}/api/memory/export`;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jexi-memory.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!mem) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Database className="w-8 h-8 text-brand animate-pulse mx-auto mb-2" />
          <p className="text-text-tertiary text-xs">Accessing Memory Core...</p>
        </div>
      </div>
    );
  }

  const userCount = Object.values(mem.userProfile || {}).filter(v => v && v.length > 0).length;
  const facts = (mem.userFacts || []).filter(Boolean).slice(-12).reverse();
  const prefs = (mem.preferences || []).filter(Boolean).slice(-12).reverse();
  const learned = (mem.learnedAnswers || []).filter(Boolean).slice(-12).reverse();
  const episodes = (mem.episodes || []).filter(Boolean).slice(-8).reverse();


  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-brand" />
          <h2 className="text-[10px] font-bold text-brand tracking-wider">MEMORY CORE</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={exportMemory}
            className="flex items-center gap-1.5 bg-surface-2 border border-hairline hover:border-brand-line text-text-secondary hover:text-brand rounded-md px-2 py-1.5 text-[8px] font-bold tracking-wider transition-colors"
          >
            <Download className="w-3 h-3" /> EXPORT
          </button>
          <span className="text-[8px] font-mono text-text-tertiary">LIVE</span>
        </div>
      </div>

      {/* Search — semantic recall across everything JEXI remembers */}
      <div className="flex items-center gap-2 bg-surface-2 border border-hairline rounded-md px-2.5 py-2 focus-within:border-brand-line">
        <Search className="w-3.5 h-3.5 text-text-tertiary" />
        <input
          value={q}
          onChange={(e) => doSearch(e.target.value)}
          placeholder="Search all memories (semantic recall)…"
          className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary text-xs focus:outline-none"
        />
        {q && (
          <button type="button" onClick={() => doSearch('')} className="p-0.5 text-text-tertiary hover:text-text-primary">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {q.trim() ? (
        /* Search results */
        <div className="space-y-1.5">
          <p className="eyebrow">{searching ? 'SEARCHING…' : `${(results || []).length} RESULT(S) FOR "${q.trim().toUpperCase()}"`}</p>
          {(results || []).length === 0 && !searching && (
            <div className="py-8 text-center"><p className="text-text-tertiary text-xs">Nothing found in memory for that.</p></div>
          )}
          {(results || []).map((r, i) => (
            <div key={i} className="surface-card p-3">
              {r.label && <p className="text-[8px] font-bold tracking-wider text-acc-research mb-1">{r.label.toUpperCase()}</p>}
              <p className="text-[10px] text-text-primary leading-snug">{String(r.text || '').slice(0, 240)}</p>
              {r.score != null && <p className="text-[8px] font-mono text-text-tertiary mt-1">score {r.score.toFixed(2)}</p>}
            </div>
          ))}
        </div>
      ) : (
        <>

          {/* User profile */}
          <Accordion icon={User} title="USER PROFILE" count={userCount} color="#A78BFA" defaultOpen>
            <div className="space-y-1 text-[10px]">
              <div className="bg-surface-2 rounded-md px-2.5 py-2 flex items-center justify-between">
                <span className="text-text-tertiary">Name</span>
                <span className="text-text-primary font-medium">{mem.userProfile?.name || '—'}</span>
              </div>
              <div className="bg-surface-2 rounded-md px-2.5 py-2 flex items-center justify-between">
                <span className="text-text-tertiary">Location</span>
                <span className="text-text-primary font-medium">{mem.userProfile?.location || '—'}</span>
              </div>
              <p className="text-[8px] text-text-tertiary pt-1">Edit your profile in Settings → System, or just tell JEXI — she learns it.</p>
            </div>
          </Accordion>

          {/* Learned preferences */}
          <Accordion icon={Sparkles} title="LEARNED PREFERENCES" count={prefs.length} color="#F472B6">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {prefs.length === 0 && <p className="text-[9px] text-text-tertiary italic">No preferences learned yet — JEXI picks these up from your conversations.</p>}
              {prefs.map((p, i) => (
                <EntryRow key={`p-${i}`} text={typeof p === 'string' ? p : p.text || p} color="#F472B6" index={i} kind="preferences" onDelete={deleteEntry} />
              ))}
            </div>
          </Accordion>

          {/* Known facts */}
          <Accordion icon={Database} title="KNOWN FACTS" count={facts.length} color="#A78BFA">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {facts.length === 0 && <p className="text-[9px] text-text-tertiary italic">No facts stored yet.</p>}
              {facts.map((f, i) => (
                <EntryRow key={`f-${i}`} text={typeof f === 'string' ? f : f.fact || f.text} color="#A78BFA" index={(mem.userFacts || []).length - 1 - i} kind="userFacts" onDelete={deleteEntry} />
              ))}
            </div>
          </Accordion>



          {/* Learned answers */}
          {learned.length > 0 && (
            <Accordion icon={BookOpen} title="LEARNED ANSWERS" count={learned.length} color="#34D399">
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {learned.map((item, i) => (
                  <EntryRow key={`l-${i}`} text={item.question || item.text} color="#34D399" index={(mem.learnedAnswers || []).length - 1 - i} kind="learnedAnswers" onDelete={deleteEntry} meta={timeAgo(item.date)} />
                ))}
              </div>
            </Accordion>
          )}

          {/* Episodes */}
          {episodes.length > 0 && (
            <Accordion icon={Sparkles} title="PAST SESSIONS (EPISODES)" count={episodes.length} color="#F472B6">
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {episodes.map((item, i) => (
                  <EntryRow key={`e-${i}`} text={`${item.ask || ''} → ${item.reply || ''}`} color="#F472B6" index={(mem.episodes || []).length - 1 - i} kind="episodes" onDelete={deleteEntry} meta={timeAgo(item.time)} />
                ))}
              </div>
            </Accordion>
          )}
        </>
      )}
    </div>
  );
}

function EntryRow({ text, color, meta, index, kind, onDelete }) {
  return (
    <div className="flex items-start gap-2 text-[9px] bg-surface-2 p-2 rounded-md border-l-2" style={{ borderLeftColor: color }}>
      <div className="min-w-0 flex-1">
        <p className="text-text-primary leading-snug break-words">{String(text || '').slice(0, 140)}</p>
        {meta && <p className="text-text-tertiary text-[8px] font-mono mt-0.5">{meta}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDelete(kind, index)}
        className="flex-shrink-0 p-1 text-text-tertiary hover:text-status-error"
        title="Delete entry"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}
