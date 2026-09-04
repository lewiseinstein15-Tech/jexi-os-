import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Users, Zap } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import { coreColor } from './JexiCore';

// Category accents — a fixed palette with a stable hash fallback for any new
// category (categories come from the live backend skill registry, never a
// hardcoded list, so new catalog categories always render).
const CATEGORY_ACCENTS = {
  Core: '#00D26A', Research: '#22D3EE', News: '#34D399', Memory: '#F472B6',
  Perception: '#F472B6', Coding: '#A78BFA', DevOps: '#22D3EE', Data: '#22D3EE',
  Writing: '#FBBF24', Teaching: '#FBBF24', Life: '#FB7185', Agent: '#A1A1AA',
  Product: '#FBBF24', Design: '#F472B6', Math: '#A78BFA', Science: '#22D3EE',
  Medicine: '#FB7185', Quant: '#FBBF24', Engineering: '#A78BFA', AI: '#00D26A',
  Knowledge: '#34D399', Quality: '#FB7185', Safety: '#FBBF24', Security: '#A78BFA',
  Creative: '#F472B6', Media: '#FBBF24', Business: '#34D399', Education: '#22D3EE',
  Marketing: '#FBBF24', Productivity: '#00D26A', Platform: '#A1A1AA',
};
const ACCENT_PALETTE = ['#00D26A', '#22D3EE', '#34D399', '#F472B6', '#A78BFA', '#FBBF24', '#FB7185', '#A1A1AA'];
const catAccent = (c) => CATEGORY_ACCENTS[c] || ACCENT_PALETTE[(c || '').length % ACCENT_PALETTE.length];

export default function RosterPanel() {
  const [agents, setAgents] = useState([]);
  const [skills, setSkills] = useState([]);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [selected, setSelected] = useState(null); // agent being inspected
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/roster`);
        const data = await res.json();
        setAgents(data.agents || []);
        setSkills(data.skills || []);
      } catch (e) {
        console.error('Roster fetch failed', e);
      }
      setLoading(false);
    })();
  }, []);

  const skillBySlug = useMemo(() => new Map(skills.map(s => [s.slug, s])), [skills]);

  // Real categories, derived from the backend skill registry (no hardcoded list).
  const categories = useMemo(() => {
    const counts = new Map();
    for (const s of skills) {
      if (!s.category) continue;
      counts.set(s.category, (counts.get(s.category) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [skills]);

  // An agent's category set = the categories of the skills it masters.
  const agentCategories = useMemo(() => {
    const map = new Map();
    for (const a of agents) {
      const cats = new Set();
      for (const slug of a.skills || []) {
        const s = skillBySlug.get(slug);
        if (s && s.category) cats.add(s.category);
      }
      map.set(a.slug, cats);
    }
    return map;
  }, [agents, skillBySlug]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter(a => {
      if (cat && !agentCategories.get(a.slug)?.has(cat)) return false;
      if (!q) return true;
      return (a.name || '').toLowerCase().includes(q) || (a.role || '').toLowerCase().includes(q);
    });
  }, [agents, search, cat, agentCategories]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  const selectedSkills = selected?.skills?.map(slug => skillBySlug.get(slug)).filter(Boolean) || [];

  return (
    <div className="space-y-3">
      {/* Search + count */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-surface-2 border border-hairline rounded-md px-2.5 py-2 focus-within:border-brand-line">
          <Search className="w-3.5 h-3.5 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search specialists…"
            className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary text-xs focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 text-text-tertiary text-[9px] font-bold tracking-wider">
          <Users className="w-3 h-3" /> {agents.length} AGENTS
        </div>
      </div>

      {/* Category filter chips — every real category from the live catalog */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <Chip active={cat === ''} onClick={() => setCat('')}>ALL · {agents.length}</Chip>
        {categories.map(({ name, count }) => (
          <Chip key={name} active={cat === name} onClick={() => setCat(cat === name ? '' : name)}>
            {name.toUpperCase()} · {count}
          </Chip>
        ))}
      </div>

      {/* Grid of agent cards */}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map((agent, i) => (
          <motion.button
            key={agent.slug}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.02, 0.3), duration: 0.2 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setSelected(agent)}
            className="surface-card p-3 text-left hover:border-hairline-strong active:scale-[0.98]"
          >
            <div className="flex items-start gap-2.5">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-md border flex items-center justify-center text-lg"
                style={{ background: `${coreColor(agent.name)}1A`, borderColor: `${coreColor(agent.name)}33`, color: coreColor(agent.name) }}
              >
                {agent.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-text-primary truncate">{agent.name}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5 leading-snug line-clamp-2">{agent.role}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[8px] font-bold tracking-wider text-text-tertiary">
                <Zap className="w-2.5 h-2.5" /> {agent.skills?.length || 0} SKILLS
              </span>
              {(() => {
                const cats = agentCategories.get(agent.slug);
                const primary = cats && [...cats][0];
                return primary ? (
                  <span className="text-[8px] font-bold tracking-wider truncate" style={{ color: catAccent(primary) }}>
                    {primary.toUpperCase()}
                  </span>
                ) : null;
              })()}
            </div>
          </motion.button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 py-8 text-center">
            <p className="text-text-tertiary text-xs">No specialists match.</p>
          </div>
        )}
      </div>

      {/* Bottom sheet — agent detail */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ y: 80 }}
              animate={{ y: 0 }}
              exit={{ y: 80 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full surface-card rounded-t-xl p-4 pb-8"
              style={{ boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' }}
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-4" />
              <div className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-lg border flex items-center justify-center text-xl"
                  style={{ background: `${coreColor(selected.name)}1A`, borderColor: `${coreColor(selected.name)}33`, color: coreColor(selected.name) }}
                >
                  {selected.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-text-primary">{selected.name}</h3>
                  <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">{selected.role}</p>
                </div>
                <button onClick={() => setSelected(null)} className="p-1 text-text-tertiary hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4">
                <p className="eyebrow mb-2">Mastered skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSkills.length > 0 ? selectedSkills.map((s) => (
                    <span key={s.slug} className="bg-surface-2 border border-hairline text-text-secondary rounded-full px-2 py-1 text-[9px]">
                      {s.name}
                    </span>
                  )) : (
                    <span className="text-text-tertiary text-[10px]">No skills listed.</span>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`tap-target flex-shrink-0 px-2.5 py-1.5 rounded-full text-[8px] font-bold tracking-wider transition-all duration-200 ${
        active ? 'bg-brand-dim text-brand border border-brand-line' : 'bg-surface-1 text-text-tertiary border border-hairline hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}
