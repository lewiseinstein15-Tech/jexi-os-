/**
 * ARENA ASTRA — MissionPanel: the desktop right mission/context rail.
 * (spec Parts 25/28: mission detail lives in the desktop side panel as
 * compact sections — the conversation itself stays clean and dominant.)
 *
 * 100% live data: /api/missions + /api/missions/:id + /api/reasoning/health.
 * Never fakes: offline → honest offline state; no mission → empty state.
 */
import { useState, useEffect, useCallback } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import { Crown } from './JexiBrand';

const ACTIVE = ['PLANNING', 'EXECUTING', 'VERIFYING', 'AWAITING_INPUT'];
const RESOLVED = new Set(['DONE', 'SKIPPED', 'SUPERSEDED']);

function statusIcon(s) {
  if (s === 'DONE') return <span className="jxmp-tick done">✓</span>;
  if (s === 'RUNNING') return <span className="jxmp-tick run">●</span>;
  if (s === 'FAILED') return <span className="jxmp-tick fail">✕</span>;
  if (s === 'SKIPPED' || s === 'SUPERSEDED') return <span className="jxmp-tick skip">–</span>;
  return <span className="jxmp-tick idle">○</span>;
}

export default function MissionPanel() {
  const [missions, setMissions] = useState(null); // null = not loaded yet
  const [detail, setDetail] = useState(null);
  const [health, setHealth] = useState(null);
  const [conn, setConn] = useState('ok'); // ok | locked | offline | error (FINAL: honest failure modes)

  const load = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/missions`);
      if (res.status === 401 || res.status === 403) { setConn('locked'); return; }
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error('bad missions payload');
      setMissions(data.missions || []);
      setConn('ok');
      const list = data.missions || [];
      const active = list.find((m) => ACTIVE.includes(m.state)) || list[0] || null;
      if (active) {
        try {
          const r2 = await jexiFetch(`${getBackendUrl()}/api/missions/${active.id}`);
          const d = await r2.json().catch(() => ({}));
          setDetail(d.ok ? d : null);
        } catch { setDetail(null); }
      } else {
        setDetail(null);
      }
      try {
        const r3 = await jexiFetch(`${getBackendUrl()}/api/reasoning/health`);
        const h = await r3.json().catch(() => ({}));
        setHealth(h.ok ? h : null);
      } catch { /* health is supplementary */ }
    } catch {
      setConn('offline');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // 429 fix: was 5s — halves rail traffic
    return () => clearInterval(t);
  }, [load]);

  const active = (missions || []).find((m) => ACTIVE.includes(m.state)) || null;
  const items = detail?.graph?.items || [];
  const resolved = items.filter((i) => RESOLVED.has(i.status)).length;
  // FINAL — no invented progress: with zero graph items there is no percent.
  const pct = items.length ? Math.round((resolved / items.length) * 100) : null;
  const ollama = health?.providers?.ollama;
  const ollamaLive = ollama?.ok === true;

  return (
    <aside className="jx-missionpanel" aria-label="Mission status">
      {conn !== 'ok' && missions === null ? (
        <div className="jxmp-card">
          <div className="jxmp-title"><Crown size={12} /> Active Mission</div>
          <div className="jxmp-empty">
            {conn === 'locked' ? (<>Brain is locked —<br />paste the access key in<br />Settings → System.</>) : (
              <>Brain unreachable —<br />showing nothing rather than<br />something fake.</>)}
          </div>
        </div>
      ) : (
        <>
          <div className="jxmp-card">
            <div className="jxmp-title"><Crown size={12} /> Active Mission</div>
            {active ? (
              <>
                <div className="jxmp-mname">{String(active.objective || active.id).slice(0, 90)}</div>
                <div className="jxmp-mstate">{active.state.replace(/_/g, ' ')}{pct === null ? '' : ` · ${pct}%`}</div>
                {pct !== null && (
                  <div className="jxmp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                )}
              </>
            ) : (
              <div className="jxmp-empty">No active mission.<br />Tell JEXI what to build.</div>
            )}
          </div>

          <div className="jxmp-card">
            <div className="jxmp-title">Current Tasks</div>
            {items.length === 0 ? (
              <div className="jxmp-empty small">{active ? 'Planning tasks…' : 'Nothing running.'}</div>
            ) : (
              <ul className="jxmp-tasks">
                {items.slice(0, 7).map((it) => (
                  <li key={it.id} className={it.status === 'RUNNING' ? 'live' : ''}>
                    {statusIcon(it.status)}
                    <span>{String(it.title || it.id).slice(0, 60)}</span>
                  </li>
                ))}
              </ul>
            )}
            {items.length > 7 && <div className="jxmp-more">+{items.length - 7} more</div>}
          </div>

          {/* FINAL — shown only while a mission is live; rows are real
              RUNNING graph items, never assumed agent names. */}
          {active && (
            <div className="jxmp-card">
              <div className="jxmp-title">Now running</div>
              {items.some((i) => i.status === 'RUNNING') ? (
                <ul className="jxmp-using">
                  {items.filter((i) => i.status === 'RUNNING').slice(0, 4).map((it) => (
                    <li key={it.id}><span className="jxmp-dot on" />{String(it.title || it.id).slice(0, 48)}</li>
                  ))}
                </ul>
              ) : (
                <div className="jxmp-empty small">Between tasks — the next step is being decided.</div>
              )}
              <div className="jxmp-more">models · {ollamaLive ? 'ollama (local) live' : 'remote'}</div>
            </div>
          )}

          <div className="jxmp-note jx-hand-display">Small steps create big things.<br /><span>— JEXI</span></div>
        </>
      )}
    </aside>
  );
}
