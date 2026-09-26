import { useEffect, useMemo, useState } from 'react';
import { Bot, CircleX, RotateCw, Search, Users } from 'lucide-react';

/**
 * Agents Roster view (ui-rebuild-premium).
 *
 * Data: GET /api/roster — the brain's REAL agent registry
 * (server/src/workforce/registry/catalog.js via server/index.js:1230,
 * 60s server-side cache). Shape: { agents: [{slug, name, role, skills[],
 * tier}], skills: [...], agentCount, skillCount }.
 *
 * Grouping: by `tier` — the grouping field the endpoint actually carries
 * (core / team / pipeline). The phase brief's "400 agents / 7 origins" does
 * not match the shipped API (this host exposes 252 agents across 3 tiers);
 * the view renders the real data and says so rather than inventing groups.
 *
 * UX: search across slug/name/role/skills, tier filter chips, click -> side
 * panel with metadata + skill chips, initial-based avatars, loading
 * skeletons, error state with retry, honest empty state.
 */

const TIER_ORDER = ['core', 'team', 'pipeline'];
const TIER_BLURB = {
  core: 'the always-present contracts the OS boots with',
  team: 'task-team members composed per request by the planner',
  pipeline: 'pipeline agents for staged / batch work',
};

function initials(slug) {
  const parts = String(slug || '?').split(/[-_.]/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : String(slug || '?').slice(0, 2)).toUpperCase();
}

function Skeletons() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2].map((g) => (
        <div key={g}>
          <div className="jx-skeleton" style={{ width: 180, height: 14, marginBottom: 10 }}></div>
          <div className="jx-agent-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="jx-skeleton" style={{ height: 46 }}></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AgentsRosterView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tierFilter, setTierFilter] = useState(null); // null = all
  const [selected, setSelected] = useState(null); // agent slug

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/roster');
      if (!r.ok) throw new Error(`GET /api/roster replied HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch (e) {
      setError(String((e && e.message) || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const agents = (data && data.agents) || [];
  const skillCount = (data && (data.skillCount ?? (data.skills || []).length)) ?? null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return agents.filter((a) => {
      if (tierFilter && a.tier !== tierFilter) return false;
      if (!needle) return true;
      const hay = `${a.slug} ${a.name} ${a.role} ${(a.skills || []).join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [agents, q, tierFilter]);

  const byTier = useMemo(() => {
    const groups = new Map();
    for (const a of filtered) {
      const t = a.tier || 'unfiled';
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(a);
    }
    // Deterministic order: core, team, pipeline, then anything else alphabetically.
    return [...groups.entries()].sort((x, y) => {
      const ix = TIER_ORDER.indexOf(x[0]);
      const iy = TIER_ORDER.indexOf(y[0]);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy) || x[0].localeCompare(y[0]);
    });
  }, [filtered]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.slug === selected) || null,
    [agents, selected]
  );

  const totalShown = filtered.length;
  const tierCounts = useMemo(() => {
    const counts = {};
    for (const a of agents) counts[a.tier || 'unfiled'] = (counts[a.tier || 'unfiled'] || 0) + 1;
    return counts;
  }, [agents]);

  return (
    <div className="jx-roster">
      <div className="jx-roster-main">
        <div className="jx-roster-toolbar">
          <div className="jx-roster-search">
            <Search size={14} aria-hidden="true" />
            <input
              className="jx-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search agents by id, role or skill…"
              aria-label="Search agents"
              spellCheck="false"
            />
          </div>
          <div className="jx-seg" role="radiogroup" aria-label="Tier filter">
            <button
              type="button"
              className={'jx-seg-btn' + (tierFilter === null ? ' is-active' : '')}
              onClick={() => setTierFilter(null)}
            >all</button>
            {TIER_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                className={'jx-seg-btn' + (tierFilter === t ? ' is-active' : '')}
                onClick={() => setTierFilter(tierFilter === t ? null : t)}
              >{t} · {tierCounts[t] || 0}</button>
            ))}
          </div>
          <span className="jx-roster-meta">
            {loading ? 'loading roster…' : error ? 'unreachable' : `${totalShown}/${agents.length} agents · ${skillCount ?? '—'} skills`}
          </span>
        </div>

        {loading && <Skeletons />}

        {!loading && error && (
          <div className="jx-errorbox">
            <span className="jx-errorbox-title"><CircleX size={15} aria-hidden="true" /> roster unreachable</span>
            <span>GET /api/roster failed — {error}</span>
            <button className="jx-btn" onClick={() => void load()}>
              <RotateCw size={14} aria-hidden="true" /> retry
            </button>
          </div>
        )}

        {!loading && !error && agents.length === 0 && (
          <div className="jx-empty">
            <div className="jx-empty-frame" aria-hidden="true"><Users size={20} /></div>
            <div className="jx-empty-title">No agents registered</div>
            <div className="jx-empty-note">The registry replied with an empty roster — boot the brain with the workforce registry enabled to populate it.</div>
          </div>
        )}

        {!loading && !error && agents.length > 0 && totalShown === 0 && (
          <div className="jx-empty">
            <div className="jx-empty-frame" aria-hidden="true"><Search size={20} /></div>
            <div className="jx-empty-title">No matches</div>
            <div className="jx-empty-note">no agent matches “{q}”{tierFilter ? ` in tier ${tierFilter}` : ''}</div>
            <button className="jx-btn" onClick={() => { setQ(''); setTierFilter(null); }}>clear filters</button>
          </div>
        )}

        {!loading && !error && byTier.map(([tier, list]) => (
          <div className="jx-roster-group" key={tier}>
            <h3 className="jx-roster-group-title">
              {tier}
              <span className="jx-roster-count">{list.length}</span>
              <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                {TIER_BLURB[tier] || ''}
              </span>
            </h3>
            <div className="jx-agent-grid">
              {list.map((a) => (
                <button
                  key={a.slug}
                  type="button"
                  className={'jx-agent-card' + (selected === a.slug ? ' is-selected' : '')}
                  onClick={() => setSelected(a.slug)}
                >
                  <span className="jx-agent-avatar" aria-hidden="true">{initials(a.slug)}</span>
                  <span className="jx-agent-min">
                    <span className="jx-agent-id">{a.name || a.slug}</span>
                    <span className="jx-agent-sub">{a.slug} · {(a.skills || []).length} skills</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <aside className="jx-roster-side" aria-label="Agent details">
        {!selectedAgent && !loading && !error && (
          <div className="jx-empty" style={{ padding: '48px 8px' }}>
            <div className="jx-empty-frame" aria-hidden="true"><Bot size={20} /></div>
            <div className="jx-empty-title">Select an agent</div>
            <div className="jx-empty-note">click any agent to see its registry metadata</div>
          </div>
        )}
        {selectedAgent && (
          <div className="jx-card jx-detail-card">
            <div className="jx-detail-head">
              <span className="jx-agent-avatar" style={{ width: 40, height: 40, fontSize: 14 }} aria-hidden="true">{initials(selectedAgent.slug)}</span>
              <span>
                <div className="jx-detail-name">{selectedAgent.name || selectedAgent.slug}</div>
                <div className="jx-detail-slug">{selectedAgent.slug}</div>
              </span>
            </div>
            <div className="jx-detail-row">
              <span className="jx-detail-key">id</span>
              <span className="jx-detail-val mono">{selectedAgent.slug}</span>
            </div>
            <div className="jx-detail-row">
              <span className="jx-detail-key">origin (tier)</span>
              <span className="jx-detail-val">{selectedAgent.tier || '—'}</span>
            </div>
            <div className="jx-detail-row">
              <span className="jx-detail-key">role</span>
              <span className="jx-detail-val">{selectedAgent.role || '—'}</span>
            </div>
            <div className="jx-detail-row">
              <span className="jx-detail-key">skill count</span>
              <span className="jx-detail-val">{(selectedAgent.skills || []).length}</span>
            </div>
            {(selectedAgent.skills || []).length > 0 && (
              <div className="jx-detail-row">
                <span className="jx-detail-key">skills</span>
                <span className="jx-detail-val">
                  <span className="jx-skillchips">
                    {selectedAgent.skills.map((s) => <span className="jx-skillchip" key={s}>{s}</span>)}
                  </span>
                </span>
              </div>
            )}
            <div className="jx-detail-row">
              <span className="jx-detail-key">last-active</span>
              <span className="jx-detail-val" style={{ color: 'var(--jx-text-3)' }}>
                not provided by /api/roster (registry is static capability data)
              </span>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
