import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Boxes, X, Play, User, Zap, Plus, RefreshCw, Layers, FileText } from 'lucide-react';
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

// B98 — DSH-style source labels + rank colors for auto-discovered skills.
const SOURCE_META = {
  'project-dsh': { label: 'PROJECT', color: '#00FF9D', rank: 100 },
  'project-agents': { label: 'AGENTS', color: '#22D3EE', rank: 200 },
  custom: { label: 'PLUGIN', color: '#A78BFA', rank: 300 },
  'user-dsh': { label: 'USER', color: '#FBBF24', rank: 400 },
  bundled: { label: 'BUNDLED', color: '#A1A1AA', rank: 600 },
};
const sourceMeta = (s) => SOURCE_META[s] || { label: (s || 'SKILL').toUpperCase(), color: '#A1A1AA', rank: 999 };

const Chip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold tracking-wider border transition-colors ${
      active ? 'bg-brand text-[#04140D] border-brand' : 'bg-surface-2 text-text-secondary border-hairline hover:border-hairline-strong'
    }`}
  >
    {children}
  </button>
);

export default function SkillsScreen({ onUseSkill }) {
  const [tab, setTab] = useState('catalog');
  const [data, setData] = useState(null);
  const [disc, setDisc] = useState(null);       // discovery payload
  const [discBody, setDiscBody] = useState(null); // progressive full body
  const [loadingBody, setLoadingBody] = useState(null);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [src, setSrc] = useState('');
  const [selected, setSelected] = useState(null); // catalog skill detail
  const [discSelected, setDiscSelected] = useState(null); // discovered skill
  const [invoking, setInvoking] = useState(null);
  const [plan, setPlan] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', description: '', whenToUse: '', body: '', reference: '' });
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadDiscovery = async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/skills/discovery`);
      const json = await res.json();
      setDisc(json);
    } catch (e) {
      console.error('Discovery fetch failed', e);
    }
  };

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
    loadDiscovery();
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

  // B98 — discovered skills filtered by query + source.
  const discSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (disc?.skills || [])
      .filter((s) => !src || s.source === src)
      .filter((s) => !q || `${s.name} ${s.description} ${s.whenToUse || ''}`.toLowerCase().includes(q));
  }, [disc, search, src]);

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

  const openDisc = async (skill) => {
    setDiscSelected(skill);
    setDiscBody(null);
    setLoadingBody(skill.name);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/skills/discovery/${encodeURIComponent(skill.name)}`);
      if (!res.ok) throw new Error('not found');
      const json = await res.json();
      setDiscBody(json.skill);
    } catch (e) {
      setDiscBody({ error: (e && e.message) || String(e) });
    }
    setLoadingBody(null);
  };

  const refresh = async () => {
    try { await jexiFetch(`${getBackendUrl()}/api/skills/discovery/invalidate`, { method: 'POST' }); } catch { /* noop */ }
    await loadDiscovery();
  };

  const saveSkill = async () => {
    setSaving(true);
    setAddError('');
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/skills/discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'create failed');
      setAdding(false);
      setAddForm({ name: '', description: '', whenToUse: '', body: '', reference: '' });
      setTab('discovered');
      await loadDiscovery();
      setSearch('');
      setSrc('');
    } catch (e) {
      setAddError((e && e.message) || 'create failed');
    }
    setSaving(false);
  };

  const useDisc = (skill) => {
    const meta = sourceMeta(skill.source);
    onUseSkill && onUseSkill(`Follow the "${skill.name}" skill (${meta.label} source) instructions for this task.`);
    setDiscSelected(null);
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
      {/* B98 — tab switch: built-in catalog vs auto-discovered skills */}
      <div className="flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-2 p-1">
        <button
          type="button"
          onClick={() => setTab('catalog')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-[9px] font-bold tracking-[0.14em] transition-colors ${
            tab === 'catalog' ? 'bg-brand text-[#04140D]' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Boxes className="w-3 h-3" /> CATALOG · {data?.catalogSize || 0}
        </button>
        <button
          type="button"
          onClick={() => setTab('discovered')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-[9px] font-bold tracking-[0.14em] transition-colors ${
            tab === 'discovered' ? 'bg-brand text-[#04140D]' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Layers className="w-3 h-3" /> DISCOVERED · {disc?.total || 0}
        </button>
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-surface-2 border border-hairline rounded-md px-2.5 py-2 focus-within:border-brand-line">
          <Search className="w-3.5 h-3.5 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'discovered' ? 'Search discovered skills…' : 'Search skills…'}
            className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary text-xs focus:outline-none"
          />
        </div>
        {tab === 'discovered' && (
          <>
            <button
              type="button"
              onClick={refresh}
              className="flex items-center gap-1.5 bg-surface-2 border border-hairline rounded-md px-2.5 py-2 text-[9px] font-bold tracking-wider text-text-secondary hover:border-hairline-strong"
            >
              <RefreshCw className="w-3 h-3" /> RESCAN
            </button>
            <button
              type="button"
              onClick={() => { setAdding(true); setAddError(''); }}
              className="flex items-center gap-1.5 bg-brand text-[#04140D] rounded-md px-2.5 py-2 text-[9px] font-bold tracking-wider hover:brightness-110"
            >
              <Plus className="w-3 h-3" /> ADD SKILL
            </button>
          </>
        )}
        {tab === 'catalog' && (
          <div className="flex items-center gap-1 text-text-tertiary text-[9px] font-bold tracking-wider">
            <Boxes className="w-3 h-3" /> {data?.total || 0} / {data?.catalogSize || 0}
          </div>
        )}
      </div>

      {tab === 'catalog' && (
        <>
          {/* B50 P1 — progressive-disclosure pipeline skills */}
          {data?.progressiveSlugs?.length > 0 && (
            <div className="rounded-lg border border-brand-line/50 bg-brand-dim/40 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-brand" />
                <p className="text-[9px] font-bold tracking-[0.14em] text-brand">PROGRESSIVE SKILLS · {data.progressiveSlugs.length}</p>
              </div>
              <p className="text-[9px] text-text-secondary leading-snug mt-0.5">
                The pipeline skills ({data.progressiveSlugs.join(' · ')}) are disclosure folders — the planner sees only the description; full instructions + reference load when the skill actually runs.
              </p>
            </div>
          )}

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
                      <p className="text-[12px] font-semibold text-text-primary truncate flex items-center gap-1.5">
                        {s.name}
                        {data?.progressiveSlugs?.includes(s.slug) && (
                          <span className="text-[7px] font-bold text-brand bg-brand-dim border border-brand-line rounded-full px-1.5 py-0.5">PROGRESSIVE</span>
                        )}
                      </p>
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
        </>
      )}

      {tab === 'discovered' && (
        <>
          {/* B98 — source chips (DSH ranks): project 100 · agents 200 · plugin 300 · user 400 · bundled 600 */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            <Chip active={src === ''} onClick={() => setSrc('')}>ALL · {disc?.total || 0}</Chip>
            {Object.entries(disc?.bySource || {}).map(([source, count]) => {
              const m = sourceMeta(source);
              return (
                <button
                  key={source}
                  type="button"
                  onClick={() => setSrc(src === source ? '' : source)}
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold tracking-wider border transition-colors ${
                    src === source ? 'bg-surface-2' : 'bg-surface-2 border-hairline hover:border-hairline-strong'
                  }`}
                  style={src === source ? { borderColor: m.color, color: m.color } : { color: m.color }}
                >
                  {m.label} · {count}
                </button>
              );
            })}
          </div>

          {/* discovery explainer */}
          <div className="rounded-lg border border-hairline bg-surface-2/60 px-3 py-2">
            <p className="text-[9px] text-text-tertiary leading-snug">
              <span className="font-bold text-text-secondary">AUTO-DISCOVERED SKILLS</span> — scanned from ranked roots exactly like DeepSeek Harness: <span style={{ color: '#00FF9D' }}>project .jexi/skills (100)</span> · <span style={{ color: '#22D3EE' }}>.agents/skills (200)</span> · <span style={{ color: '#A78BFA' }}>plugins (300)</span> · <span style={{ color: '#FBBF24' }}>user (400)</span> · <span style={{ color: '#A1A1AA' }}>bundled (600)</span>. Catalog is metadata-only — the full body loads only when used (progressive disclosure). Watchers pick up new skills instantly.
            </p>
            {disc?.warnings?.length > 0 && (
              <p className="mt-1 text-[8px] text-status-warn leading-snug line-clamp-2">
                ⚠ {disc.warnings.length} file(s) ignored (invalid frontmatter) — {disc.warnings.slice(0, 2).join(' · ')}
              </p>
            )}
          </div>

          {discSkills.length === 0 && (
            <div className="py-10 text-center">
              <p className="text-text-tertiary text-xs">No discovered skills match.</p>
              <p className="text-text-tertiary/70 text-[10px] mt-1">Drop SKILL.md folders into the workspace (.jexi/skills) or use ADD SKILL.</p>
            </div>
          )}
          <div className="space-y-1.5">
            {discSkills.map((s) => {
              const m = sourceMeta(s.source);
              return (
                <motion.button
                  key={`${s.source}-${s.name}`}
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  onClick={() => openDisc(s)}
                  className="w-full flex items-center gap-3 surface-card p-2.5 text-left hover:border-hairline-strong"
                >
                  <span
                    className="flex-shrink-0 w-8 h-8 rounded-md border flex items-center justify-center text-[11px] font-bold"
                    style={{ background: `${m.color}14`, borderColor: `${m.color}33`, color: m.color }}
                  >
                    {s.name[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-text-primary truncate flex items-center gap-1.5">
                      {s.name}
                      <span
                        className="text-[7px] font-bold rounded-full px-1.5 py-0.5"
                        style={{ background: `${m.color}14`, border: `1px solid ${m.color}33`, color: m.color }}
                      >
                        {m.label}·{m.rank}
                      </span>
                      {s.hasReference && (
                        <span className="text-[7px] font-bold text-text-tertiary bg-surface-2 border border-hairline rounded-full px-1.5 py-0.5">📂+REF</span>
                      )}
                    </p>
                    <p className="text-[10px] text-text-tertiary leading-snug line-clamp-1">{s.description}</p>
                    {s.whenToUse && (
                      <p className="text-[8px] text-brand/70 leading-snug line-clamp-1 mt-0.5">when: {s.whenToUse}</p>
                    )}
                  </div>
                  {s.invocation?.modelInvocable === false && (
                    <span className="flex-shrink-0 text-[7px] font-bold text-text-tertiary bg-surface-2 border border-hairline rounded-full px-1.5 py-0.5">NO-MODEL</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </>
      )}

      {/* ==== CATALOG detail bottom sheet (existing) ==== */}
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
                  <h3 className="text-[15px] font-semibold text-text-primary flex items-center gap-2">
                    {selected.name}
                    {data?.progressiveSlugs?.includes(selected.slug) && (
                      <span className="text-[7px] font-bold text-brand bg-brand-dim border border-brand-line rounded-full px-1.5 py-0.5">PROGRESSIVE</span>
                    )}
                  </h3>
                  <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">{selected.desc}</p>
                  {data?.progressiveSlugs?.includes(selected.slug) && (
                    <p className="mt-1 text-[9px] text-brand/80 leading-snug">
                      📂 Disclosure folder — short description at planning time; full instructions + reference.md load on execution.
                    </p>
                  )}
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

      {/* ==== DISCOVERED detail bottom sheet (progressive body) ==== */}
      <AnimatePresence>
        {discSelected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
            onClick={() => { setDiscSelected(null); setDiscBody(null); }}
          >
            <motion.div
              initial={{ y: 80 }}
              animate={{ y: 0 }}
              exit={{ y: 80 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full surface-card rounded-t-xl p-4 pb-8 max-h-[85vh] flex flex-col"
              style={{ boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' }}
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-4 flex-shrink-0" />
              <div className="flex items-start gap-3 flex-shrink-0">
                <span
                  className="flex-shrink-0 w-11 h-11 rounded-lg border flex items-center justify-center text-lg font-bold"
                  style={{ background: `${sourceMeta(discSelected.source).color}14`, borderColor: `${sourceMeta(discSelected.source).color}33`, color: sourceMeta(discSelected.source).color }}
                >
                  {discSelected.name[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-text-primary flex items-center gap-2">
                    {discSelected.name}
                    <span
                      className="text-[7px] font-bold rounded-full px-1.5 py-0.5"
                      style={{ background: `${sourceMeta(discSelected.source).color}14`, border: `1px solid ${sourceMeta(discSelected.source).color}33`, color: sourceMeta(discSelected.source).color }}
                    >
                      {sourceMeta(discSelected.source).label}·{sourceMeta(discSelected.source).rank}
                    </span>
                  </h3>
                  <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">{discSelected.description}</p>
                  <p className="mt-1 text-[9px] text-brand/80 leading-snug">📂 Progressive — full body loaded on demand (metadata only in the catalog).</p>
                </div>
                <button onClick={() => { setDiscSelected(null); setDiscBody(null); }} className="p-1 text-text-tertiary hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Full body — fetched only when the sheet opens */}
              <div className="mt-3 flex-1 overflow-y-auto rounded-lg border border-hairline bg-surface-2 p-3 min-h-[140px]">
                {loadingBody === discSelected.name ? (
                  <div className="flex items-center justify-center h-24">
                    <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : discBody?.error ? (
                  <p className="text-[10px] text-status-error">{discBody.error}</p>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 mb-2">
                      <FileText className="w-3 h-3 text-brand" />
                      <p className="text-[8px] font-bold tracking-[0.14em] text-text-secondary">
                        FULL BODY {discBody?.reference ? '· SKILL.md + reference.md' : ''}
                      </p>
                    </div>
                    <pre className="text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap font-sans">
                      {discBody?.content}
                      {discBody?.reference ? `\n\n—— reference.md ——\n\n${discBody.reference}` : ''}
                    </pre>
                  </>
                )}
              </div>

              <div className="mt-3 flex gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { setDiscSelected(null); setDiscBody(null); }}
                  className="flex-1 bg-surface-2 border border-hairline text-text-secondary rounded-lg py-2.5 text-[10px] font-bold tracking-wide hover:border-hairline-strong"
                >
                  CLOSE
                </button>
                <button
                  type="button"
                  onClick={() => useDisc(discSelected)}
                  disabled={discSelected.invocation?.modelInvocable === false}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand text-[#04140D] rounded-lg py-2.5 text-[10px] font-bold tracking-wide hover:brightness-110 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" /> USE IN CHAT
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==== ADD SKILL sheet (author a user skill → auto-discovered) ==== */}
      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
            onClick={() => setAdding(false)}
          >
            <motion.div
              initial={{ y: 80 }}
              animate={{ y: 0 }}
              exit={{ y: 80 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full surface-card rounded-t-xl p-4 pb-8 max-h-[90vh] flex flex-col"
              style={{ boxShadow: '0 -8px 24px rgba(0,0,0,0.4)' }}
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-3 flex-shrink-0" />
              <div className="flex items-center justify-between flex-shrink-0">
                <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
                  <Plus className="w-4 h-4 text-brand" /> NEW SKILL
                </h3>
                <button onClick={() => setAdding(false)} className="p-1 text-text-tertiary hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[9px] text-text-tertiary mt-1 flex-shrink-0">
                Saved to the user root (rank 400) as <span className="text-brand">DATA_DIR/skills/&lt;name&gt;/SKILL.md</span> — auto-discovered instantly, loadable in chat with <span className="text-brand">skill-load</span>.
              </p>

              <div className="mt-3 flex-1 overflow-y-auto space-y-2.5 pr-1">
                <div>
                  <label className="text-[8px] font-bold tracking-[0.14em] text-text-secondary">NAME · kebab-case</label>
                  <input
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value.trim().toLowerCase() })}
                    placeholder="meeting-notes"
                    className="mt-1 w-full bg-surface-2 border border-hairline rounded-md px-2.5 py-2 text-[11px] text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand-line"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-bold tracking-[0.14em] text-text-secondary">DESCRIPTION · what it does</label>
                  <input
                    value={addForm.description}
                    onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                    placeholder="Structured meeting notes with owners and deadlines."
                    className="mt-1 w-full bg-surface-2 border border-hairline rounded-md px-2.5 py-2 text-[11px] text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand-line"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-bold tracking-[0.14em] text-text-secondary">WHEN TO USE · optional</label>
                  <input
                    value={addForm.whenToUse}
                    onChange={(e) => setAddForm({ ...addForm, whenToUse: e.target.value })}
                    placeholder="any meeting recap request"
                    className="mt-1 w-full bg-surface-2 border border-hairline rounded-md px-2.5 py-2 text-[11px] text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand-line"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-bold tracking-[0.14em] text-text-secondary">BODY · the instructions</label>
                  <textarea
                    value={addForm.body}
                    onChange={(e) => setAddForm({ ...addForm, body: e.target.value })}
                    rows={5}
                    placeholder={'# Meeting Notes Skill\n\n1. Capture attendees, decisions and action owners.\n2. …'}
                    className="mt-1 w-full bg-surface-2 border border-hairline rounded-md px-2.5 py-2 text-[11px] text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand-line resize-none"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-bold tracking-[0.14em] text-text-secondary">REFERENCE · optional (loaded with the body)</label>
                  <textarea
                    value={addForm.reference}
                    onChange={(e) => setAddForm({ ...addForm, reference: e.target.value })}
                    rows={3}
                    placeholder="## Template\n- Decisions\n- Actions"
                    className="mt-1 w-full bg-surface-2 border border-hairline rounded-md px-2.5 py-2 text-[11px] text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand-line resize-none"
                  />
                </div>
                {addError && (
                  <p className="text-[10px] text-status-error">{addError}</p>
                )}
              </div>

              <button
                type="button"
                onClick={saveSkill}
                disabled={saving}
                className="mt-3 flex-shrink-0 w-full flex items-center justify-center gap-2 bg-brand text-[#04140D] rounded-lg py-2.5 text-[11px] font-bold tracking-wide hover:brightness-110 disabled:opacity-60"
              >
                {saving ? <span className="w-4 h-4 border-2 border-[#04140D]/30 border-t-[#04140D] rounded-full animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {saving ? 'SAVING…' : 'CREATE SKILL'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
