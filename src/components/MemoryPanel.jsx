import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, User, Globe, MessageSquare, HardDrive, Code, ChevronDown, Sparkles } from 'lucide-react';

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

export default function MemoryPanel({ memory }) {
  if (!memory) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Database className="w-8 h-8 text-brand animate-pulse mx-auto mb-2" />
          <p className="text-text-tertiary text-xs">Accessing Memory Core...</p>
        </div>
      </div>
    );
  }

  const userCount = Object.values(memory.userProfile || {}).filter(v => v && v.length > 0).length;
  const internetCount = (memory.internetKnowledge || []).length;
  const codingCount = (memory.codingKnowledge || []).length;
  const chatCount = (memory.chatHistory || []).length;
  const facts = (memory.facts || []).filter(Boolean).slice(-8).reverse();
  const prefs = (memory.preferences || []).filter(Boolean).slice(-8).reverse();

  const statTiles = [
    { label: 'USER', value: userCount, color: '#A78BFA' },
    { label: 'INTERNET', value: internetCount, color: '#22D3EE' },
    { label: 'CODING', value: codingCount, color: '#00FF9D' },
    { label: 'CHAT', value: chatCount, color: '#FBBF24' },
  ];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-brand" />
          <h2 className="text-[10px] font-bold text-brand tracking-wider">MEMORY CORE</h2>
        </div>
        <span className="text-[8px] font-mono text-text-tertiary">
          UPDATED {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </span>
      </div>

      {/* 4-up stat tiles (spec §3C) — the one place four accents coexist (pure data) */}
      <div className="grid grid-cols-4 gap-2">
        {statTiles.map((t) => (
          <div key={t.label} className="surface-card p-3 text-center">
            <p className="text-[20px] font-semibold leading-none" style={{ color: t.color }}>{t.value}</p>
            <p className="text-[8px] font-bold tracking-wider text-text-tertiary mt-1.5">{t.label}</p>
          </div>
        ))}
      </div>

      {/* User profile — expanded by default */}
      <Accordion icon={User} title="USER PROFILE" count={userCount} color="#A78BFA" defaultOpen>
        <div className="space-y-1 text-[10px]">
          <div className="bg-surface-2 rounded-md px-2.5 py-2 flex items-center justify-between">
            <span className="text-text-tertiary">Name</span>
            <span className="text-text-primary font-medium">{memory.userProfile?.name || '—'}</span>
          </div>
          <div className="bg-surface-2 rounded-md px-2.5 py-2 flex items-center justify-between">
            <span className="text-text-tertiary">Location</span>
            <span className="text-text-primary font-medium">{memory.userProfile?.location || '—'}</span>
          </div>
        </div>
      </Accordion>

      {/* Learned preferences (Mem0-style) */}
      <Accordion icon={Sparkles} title="LEARNED PREFERENCES" count={prefs.length} color="#F472B6">
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {prefs.length === 0 && <p className="text-[9px] text-text-tertiary italic">No preferences learned yet — JEXI picks these up from your conversations.</p>}
          {prefs.map((p, i) => (
            <div key={i} className="text-[9px] bg-surface-2 p-2 rounded-md border-l-2" style={{ borderLeftColor: '#F472B6' }}>
              <p className="text-text-primary">{typeof p === 'string' ? p : p.text || p}</p>
            </div>
          ))}
        </div>
      </Accordion>

      {/* Internet knowledge */}
      <Accordion icon={Globe} title="INTERNET KNOWLEDGE" count={internetCount} color="#22D3EE">
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {(memory.internetKnowledge || []).slice(-5).reverse().map((item, i) => (
            <div key={i} className="text-[9px] bg-surface-2 p-2 rounded-md border-l-2" style={{ borderLeftColor: '#22D3EE' }}>
              <p className="text-text-primary truncate font-medium">{item.topic}</p>
              <p className="text-text-tertiary text-[8px] font-mono">{timeAgo(item.date)}</p>
            </div>
          ))}
          {internetCount === 0 && <p className="text-[9px] text-text-tertiary italic">No internet research saved yet.</p>}
        </div>
      </Accordion>

      {/* Coding knowledge */}
      <Accordion icon={Code} title="CODING KNOWLEDGE" count={codingCount} color="#00FF9D">
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {(memory.codingKnowledge || []).slice(-5).reverse().map((item, i) => (
            <div key={i} className="text-[9px] bg-surface-2 p-2 rounded-md border-l-2" style={{ borderLeftColor: '#00FF9D' }}>
              <p className="text-text-primary truncate font-medium">{item.topic}</p>
              <p className="text-text-tertiary text-[8px] font-mono">{item.language} • {timeAgo(item.date)}</p>
            </div>
          ))}
          {codingCount === 0 && <p className="text-[9px] text-text-tertiary italic">No coding solutions saved yet.</p>}
        </div>
      </Accordion>

      {/* Facts */}
      {facts.length > 0 && (
        <Accordion icon={Database} title="KNOWN FACTS" count={facts.length} color="#A78BFA">
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {facts.map((f, i) => (
              <div key={i} className="text-[9px] bg-surface-2 p-2 rounded-md border-l-2" style={{ borderLeftColor: '#A78BFA' }}>
                <p className="text-text-primary">{typeof f === 'string' ? f : f.text || f}</p>
              </div>
            ))}
          </div>
        </Accordion>
      )}

      {/* Chat history */}
      <Accordion icon={MessageSquare} title="CHAT HISTORY" count={chatCount} color="#FBBF24">
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {(memory.chatHistory || []).slice(-8).reverse().map((item, i) => (
            <div key={i} className="text-[9px] bg-surface-2 p-2 rounded-md border-l-2" style={{ borderLeftColor: '#FBBF24' }}>
              <span className={item.role === 'user' ? 'text-brand font-bold' : 'text-cyan-400 font-bold'}>
                {item.role === 'user' ? 'You: ' : 'JEXI: '}
              </span>
              <span className="text-text-secondary">{item.text.replace(/[#*`]/g, '').substring(0, 80)}</span>
            </div>
          ))}
          {chatCount === 0 && <p className="text-[9px] text-text-tertiary italic">No chat history yet.</p>}
        </div>
      </Accordion>

      {/* Status footer */}
      <div className="surface-card p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="w-3 h-3 text-brand" />
          <h3 className="text-[10px] font-bold text-brand tracking-wider">MEMORY STATUS</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
          <span className="text-[10px] text-brand font-bold">100% HEALTHY</span>
        </div>
      </div>
    </div>
  );
}
