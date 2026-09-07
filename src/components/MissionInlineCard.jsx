/**
 * The "Mission in Progress" card that lives INSIDE the chat (reference image).
 * 100% live: polls /api/missions + detail, progress from the real work graph.
 * Renders null when there is no mission to show — never a fake card.
 */
import { useState, useEffect, useCallback } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

const ACTIVE = ['PLANNING', 'EXECUTING', 'VERIFYING', 'AWAITING_INPUT'];
const RESOLVED = new Set(['DONE', 'SKIPPED', 'SUPERSEDED']);

function fmtTime(v) {
  if (!v) return '';
  const d = new Date(typeof v === 'number' ? v : v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function MissionInlineCard() {
  const [mission, setMission] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/missions`);
      const data = await res.json().catch(() => ({}));
      const list = data.ok ? data.missions || [] : [];
      const m = list.find((x) => ACTIVE.includes(x.state)) || list[0] || null;
      setMission(m);
      if (m) {
        try {
          const r2 = await jexiFetch(`${getBackendUrl()}/api/missions/${m.id}`);
          const d = await r2.json().catch(() => ({}));
          setDetail(d.ok ? d : null);
        } catch { setDetail(null); }
      } else {
        setDetail(null);
      }
    } catch { /* offline: card hides, chat keeps working */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!mission) return null;
  const items = detail?.graph?.items || [];
  const resolved = items.filter((i) => RESOLVED.has(i.status)).length;
  const pct = items.length ? Math.round((resolved / items.length) * 100) : (ACTIVE.includes(mission.state) ? 3 : 0);
  const live = ACTIVE.includes(mission.state);

  return (
    <div className="jx-missioncard" aria-live="polite">
      <div className="jx-missioncard-head">
        <span className={`jx-missioncard-dot${live ? ' live' : ''}`} />
        <span className="jx-missioncard-kicker">{live ? 'Mission in Progress' : `Mission ${mission.state.replace(/_/g, ' ').toLowerCase()}`}</span>
      </div>
      <div className="jx-missioncard-obj">{String(mission.objective || mission.id).slice(0, 120)}</div>
      <div className="jx-missioncard-row">
        <div className="jx-missioncard-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="jx-missioncard-pct">{pct}%</span>
      </div>
      <div className="jx-missioncard-time">{fmtTime(mission.updatedAt || mission.createdAt)}</div>
    </div>
  );
}
