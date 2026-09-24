import { useState } from 'react';
import useLive from '../../../services/useLive';

/* AgentsView — the brain's REAL workforce contracts (/api/agents/definitions
   + /api/agents/coverage). Ten professional agent contracts with their true
   missions, tools and isolation posture — plus live role coverage math. */
export default function AgentsView() {
  const { data, loading, error } = useLive('/api/agents/definitions', { label: 'Agents' });
  const { data: cov } = useLive('/api/agents/coverage', { label: 'Coverage' });
  const [q, setQ] = useState('');

  const agents = (data && data.agents) || [];
  const filtered = q.trim()
    ? agents.filter((a) => `${a.slug} ${a.mission} ${(a.tools || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    : agents;
  const c = cov || {};

  return (
    <div className="pad">
      <div className="ph">
        <h3>Agent Fleet</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live contracts…'
            : error ? `unreachable · ${error}`
              : `${data.count} contracts · ${c.covered ?? '—'}/${c.coverable ?? '—'} roles covered · ${c.deployedRoles ?? '—'} deployed`}
        </span>
      </div>
      <div className="toolbar">
        <div className="searchbox">
          Filter by name, capability or mission…
          <input value={q} onChange={(e) => setQ(e.target.value)} spellCheck="false" style={{ background: 'transparent', border: 'none', color: 'var(--jcx-ink-1)', outline: 'none', marginLeft: 6, flex: 1 }} />
        </div>
        <span className="fchip on">All</span>
        <span className="fchip">{agents.length ? 'live contracts' : '—'}</span>
      </div>

      {loading && <div className="empty">reading /api/agents/definitions…</div>}
      {!loading && error && <div className="empty">Could not reach /api/agents/definitions · {error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="empty">no contract matches “{q}”</div>}

      <div className="card">
        {filtered.map((a) => (
          <div className="rowline" key={a.slug}>
            <span className="avatar f3" style={{ width: 24, height: 24, fontSize: 9 }}>{a.slug.slice(0, 2).toUpperCase()}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>{a.slug}</span>
                <span style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{a.isolated ? 'isolated workspace' : 'shared workspace'}</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>
                {a.mission && a.mission.length > 150 ? `${a.mission.slice(0, 150)}…` : a.mission}
              </div>
            </div>
            <div>
              {(a.tools || []).slice(0, 3).map((t) => <span className="grantchip" key={t}>{t}</span>)}
              {(a.tools || []).length > 3 && <span className="grantchip">+{a.tools.length - 3}</span>}
            </div>
            <span className={`pill ${a.model === 'default' ? 'idle' : 'ok'}`}><span className="dot" />{a.model === 'default' ? 'default model' : a.model}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
