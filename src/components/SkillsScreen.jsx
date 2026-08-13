import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Boxes, X, Play, User, Zap } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

// Same category accent system as the roster panel (live categories, stable hash).
const CATEGORY_ACCENTS = {
  Core: '#00FF9D', Math: '#A78BFA', Science: '#22D3EE', Research: '#22D3EE',
  Coding: '#A78BFA', Data: '#22D3EE', Memory: '#F472B6', Writing: '#FBBF24',
  Teaching: '#FBBF24', Life: '#FB7185', Agent: '#A1A1AA', Product: '#FBBF24',
  Design: '#F472B6', Medicine: '#FB7185', Quant: '#FBBF24', Engineering: '#A78BFA',
  AI: '#00FF9D', Knowledge: '#34D399', Quality: '#FB7185', Safety: '#FBBF24',
  Security: '#A78BFA', Creative: '#F472B6', Media: '#FBBF24', Business: '#34D399',
  Education: '#22D3EE', Marketing: '#FBBF24', Productivity: '#00FF9D',
  Platform: '#A1A1AA', News: '#34D399', Perception: '#F472B6', DevOps: '#22D3EE',
};
const ACCENT_PALETTE = ['#00FF9D', '#22D3EE', '#34D399', '#F472B6', '#A78BFA', '#FBBF24', '#FB7185', '#A1A1AA'];
const catAccent = (c) => CATEGORY_ACCENTS[c] || ACCENT_PALETTE[(c || '').length % ACCENT_PALETTE.length];

export default function SkillsScreen({ onUseSkill }) {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [selected, setSelected] = useState(null); // skill detail
  const [invoking, setInvoking] = useState(null); // skill being invoked (plan preview)
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/skills`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        console.error('Skills fetch failed', e);
      }
      setLoading(false);
    })();
  }, []);

  const groups = data?.byCategory || [];
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => !cat || g.category === cat)
      .map((g) => ({
        ...g,
        skills: q ? g.skills.filter((s) => `${s.name} ${s.desc} ${s.slug}`.toLowerCase().includes(q)) : g.skills,
      }))
      .filter((g) => g.skills.length > 0);
  }, [groups, search, cat]);

  const runSkill = async (skill) => {
    setInvoking(skill);
    setPlan(null);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/skills/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: skill.slug }),
      });
      const json = await res.json();
      setPlan(json);
    } catch (e) {
      setPlan({ success: false, error: (e && e.message) || String(e) });
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search + count */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-surface-2 border border-hairline rounded-md px-2.5 py-2 focus-within:border-brand-line">
          <Search className="w-3.5 h-3.5 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary text-xs focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 text-text-tertiary text-[9px] font-bold tracking-wider">
          <Boxes className="w-3 h-3" /> {data?.total || 0} / {data?.catalogSize || 0}
        </div>
      </div>

      {/* Category chips — live from the registry */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <Chip active={cat === ''} onClick={() => setCat('')}>ALL · {data?.catalogSize || 0}</Chip>
        {groups.map((g) => (
          <Chip key={g.category} active={cat === g.category} onClick={() => setCat(cat === g.category ? '' : g.category)}>
            {g.category.toUpperCase()} · {g.count}
          </Chip>
        ))}
      </div>

      {/* Grouped skills */}
      {filteredGroups.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-text-tertiary text-xs">No skills match.</p>
        </div>
      )}
      {filteredGroups.map((g) => (
        <div key={g.category}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: catAccent(g.category) }} />
            <p className="text-[9px] font-bold tracking-[0.14em] text-text-secondary">{g.category.toUpperCase()}</p>
            <span className="text-[8px] text-text-tertiary">{g.skills.length}</span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
          <div className="space-y-1.5">
            {g.skills.map((s) => (
              <motion.button
                key={s.slug}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelected(s)}
                className="w-full flex items-center gap-3 surface-card p-2.5 text-left hover:border-hairline-strong"
              >
                <span
                  className="flex-shrink-0 w-8 h-8 rounded-md border flex items-center justify-center text-[11px] font-bold"
                  style={{ background: `${catAccent(g.category)}14`, borderColor: `${catAccent(g.category)}33`, color: catAccent(g.category) }}
                >
                  {s.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-text-primary truncate">{s.name}</p>
                  <p className="text-[10px] text-text-tertiary leading-snug line-clamp-1">{s.desc}</p>
                </div>
                {s.agent && (
                  <span className="flex-shrink-0 flex items-center gap-1 text-[8px] font-bold tracking-wider text-text-tertiary">
                    <User className="w-2.5 h-2.5" /> {s.agent.toUpperCase()}
                  </span>
                )}
              </motion.button>
            ))}
          </div>
        </div>
      ))}

      {/* Skill detail bottom sheet */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
            onClick={() => { setSelected(null); setPlan(null); }}
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
                <span
                  className="flex-shrink-0 w-11 h-11 rounded-lg border flex items-center justify-center text-lg font-bold"
                  style={{ background: `${catAccent(selected.category)}14`, borderColor: `${catAccent(selected.category)}33`, color: catAccent(selected.category) }}
                >
                  {selected.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-text-primary">{selected.name}</h3>
                  <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">{selected.desc}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="bg-surface-2 border border-hairline text-text-secondary rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider">
                      {selected.category.toUpperCase()}
                    </span>
                    {selected.agent && (
                      <span className="flex items-center gap-1 bg-surface-2 border border-hairline text-text-secondary rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider">
                        <User className="w-2.5 h-2.5" /> {selected.agent.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => { setSelected(null); setPlan(null); }} className="p-1 text-text-tertiary hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Invoke flow */}
              <button
                type="button"
                onClick={() => runSkill(selected)}
                disabled={!!invoking}
                className="mt-4 w-full flex items-center justify-center gap-2 bg-brand text-[#04140D] rounded-lg py-2.5 text-[11px] font-bold tracking-wide hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
              >
                {invoking ? (
                  <span className="flex items-center gap-2"><Zap className="w-3.5 h-3.5 animate-pulse" /> PLANNING…</span>
                ) : (
                  <span className="flex items-center gap-2"><Play className="w-3.5 h-3.5" /> USE THIS SKILL</span>
                )}
              </button>

              {plan && (
                <div className="mt-3 rounded-lg border border-hairline bg-surface-2 p-3">
                  {plan.success ? (
                    <>
                      <p className="text-[9px] font-bold tracking-[0.14em] text-brand mb-1.5">PLAN READY — THIS WILL RUN</p>
                      <p className="text-[10px] text-text-secondary leading-snug">{plan.plan?.steps?.join(' → ') || 'Pipeline assembled.'}</p>
                      {plan.plan?.tools?.length > 0 && (
                        <p className="mt-1 text-[9px] text-text-tertiary">🛠 {plan.plan.tools.length} auto-selected tools</p>
                      )}
                      <button
                        type="button"
                        onClick={() => { onUseSkill && onUseSkill(plan.query); setSelected(null); setPlan(null); setInvoking(null); }}
                        className="mt-2 w-full bg-brand-dim text-brand border border-brand-line rounded-lg py-2 text-[10px] font-bold tracking-wide hover:brightness-110"
                      >
                        RUN IN COMMAND CENTER
                      </button>
                    </>
                  ) : (
                    <p className="text-[10px] text-status-error">{(plan.error) || 'Invocation failed.'}</p>
                  )}
                </div>
              )}
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
