import { useState } from 'react';
import useLive from '../../../services/useLive';
import { brainGet, emitEvent } from '../../../services/brain';

/* SkillsView — the brain's REAL skill surface: per-plugin contributed/live
   skill counts from /api/plugins, plus live skill recall per agent
   (/api/skills/:agent). Counts on screen are the brain's own numbers. */
export default function SkillsView() {
  const { data, loading, error } = useLive('/api/plugins', { label: 'Skills' });
  const [agent, setAgent] = useState('orchestrator');
  const [rows, setRows] = useState(null);
  const [searching, setSearching] = useState(false);

  const plugins = (data && data.plugins) || [];
  const totalLive = plugins.reduce((a, p) => a + ((p.live && p.live.skills) || 0), 0);

  const recall = async () => {
    if (searching) return;
    setSearching(true);
    setRows(null);
    emitEvent({ chip: 'TOOL', who: 'Skills', msg: `skill recall for ${agent}`, tone: 'var(--jcx-ember)' });
    try {
      const r = await brainGet(`/api/skills/${agent}`, 15000);
      setRows(r.skills || []);
      emitEvent({ chip: 'OK', who: 'Skills', msg: `recall complete · ${(r.skills || []).length} skills for ${agent}`, tone: 'var(--jcx-up)' });
    } catch (e) {
      setRows([]);
      emitEvent({ chip: 'WARN', who: 'Skills', msg: `recall failed · ${(e && e.message) || 'error'}`, tone: 'var(--jcx-down)' });
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="pad">
      <div className="ph">
        <h3>Skill Catalog</h3>
        <div className="rule" />
        <span className="meta">
          {loading ? 'loading live catalog…'
            : error ? `unreachable · ${error}`
              : `${totalLive} live skills across ${plugins.length} plugins · per-agent recall below`}
        </span>
      </div>

      <div className="toolbar">
        <div className="searchbox" style={{ flex: 1 }}>
          <input
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') recall(); }}
            placeholder="agent slug to recall skills for (orchestrator, researcher, jexi…)"
            spellCheck="false"
            style={{ background: 'transparent', border: 'none', color: 'var(--jcx-ink-1)', outline: 'none', flex: 1, fontFamily: 'inherit' }}
          />
        </div>
        <button type="button" className="fchip on" onClick={recall} disabled={searching || !agent.trim()} style={{ cursor: 'pointer' }}>
          {searching ? 'recalling…' : 'Recall'}
        </button>
      </div>

      {rows !== null && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="tierhead"><h4>Recall — {agent}</h4><span className="cnt">{rows.length} skill{rows.length === 1 ? '' : 's'}</span></div>
          {rows.length === 0 && <div className="empty">no skills registered for “{agent}” — the store answered, it is simply empty</div>}
          {rows.map((s, i) => (
            <div className="rowline" key={s.slug || s.id || i}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {s.slug || s.name || s.id}
                  {s.version ? <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}> v{s.version}</span> : null}
                </div>
                {s.desc && <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{s.desc}</div>}
              </div>
              <span className="pill ok"><span className="dot" />Registered</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="tierhead"><h4>Plugin-contributed skills</h4><span className="cnt">/api/plugins · live counts</span></div>
        {loading && <div className="empty">reading /api/plugins…</div>}
        {!loading && error && <div className="empty">Could not reach /api/plugins · {error}</div>}
        {plugins.map((p) => {
          const live = (p.live && p.live.skills) || 0;
          const pct = totalLive ? Math.round((live / totalLive) * 100) : 0;
          return (
            <div className="rowline" key={p.id}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {p.name} <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>v{p.version}{p.builtin ? ' · builtin' : ''}</span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{p.desc}</div>
              </div>
              <span className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-3)' }}>{live} live skills</span>
              <div style={{ width: 90 }}><div className="rbar"><i style={{ width: `${pct}%` }} /></div></div>
              <span className={`pill ${p.enabled ? 'ok' : 'idle'}`}><span className="dot" />{p.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
