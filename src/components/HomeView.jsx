import { useEffect, useState } from 'react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';

/**
 * HomeView — the mission-first home (FINAL redesign).
 * No globe, no decorative tiles. Three honest blocks: her greeting in her
 * hand, the live mission state (or a plain idle line — never fake numbers),
 * and flat suggestion chips that send real prompts.
 *
 * Connection honesty: the mission list can fail three ways and each gets its
 * own line — locked (401: this browser has no access key), offline (fetch
 * threw: brain unreachable), error (other HTTP status). A 401 must NEVER
 * render as "no missions yet".
 */
const SUGGESTIONS = [
  { label: 'build an app', query: 'build me a quiz app as a web app' },
  { label: 'solve math', query: 'what is 2/3 + 1/4? show working' },
  { label: 'research', query: 'research the latest AI news' },
  { label: 'show a picture', query: 'show me a picture of a lion' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late — what are we working on?';
  if (h < 12) return 'Good morning — what are we working on?';
  if (h < 18) return 'Good afternoon — what are we working on?';
  return 'Good evening — what are we working on?';
}

const st = (m) => String((m && m.state) || '').toUpperCase();
// Server states are UPPERCASE (PLANNING/EXECUTING/VERIFYING/AWAITING_INPUT…);
// accept legacy lowercase too so no live mission is ever missed.
const LIVE = new Set(['OPEN', 'RUNNING', 'PAUSED', 'AWAITING_APPROVAL', 'AWAITING_INPUT', 'FAILED', 'PLANNING', 'EXECUTING', 'VERIFYING']);

function pickMission(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((m) => LIVE.has(st(m))) || list[0];
}

export default function HomeView({ messages, logs, isProcessing, onSend, onOpenCommand }) {
  const [mission, setMission] = useState(null);
  const [detail, setDetail] = useState(null);
  const [conn, setConn] = useState('ok'); // ok | locked | offline | error
  const [connNote, setConnNote] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const base = getBackendUrl();
        const res = await jexiFetch(`${base}/api/missions`);
        if (!alive) return;
        if (res.status === 401 || res.status === 403) {
          setConn('locked'); setMission(null); setDetail(null); return;
        }
        if (!res.ok) {
          setConn('error'); setConnNote(`HTTP ${res.status}`); setMission(null); setDetail(null); return;
        }
        const r = await res.json().catch(() => ({}));
        if (!alive) return;
        setConn('ok'); setConnNote('');
        const m = pickMission(r && r.missions);
        setMission(m);
        if (m && m.id) {
          try {
            const dres = await jexiFetch(`${base}/api/missions/${m.id}`);
            const d = await dres.json().catch(() => ({}));
            if (alive) setDetail(d && d.mission ? d.mission : d);
          } catch { /* mission list is enough; detail is progressive */ }
        } else {
          setDetail(null);
        }
      } catch { if (alive) { setConn('offline'); setMission(null); setDetail(null); } }
    };
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const m = detail || mission;
  const tasks = (m && (m.tasks || m.plan)) || [];
  const done = tasks.filter((t) => t && (t.state === 'done' || t.status === 'done')).length;
  const live = tasks.find((t) => t && ['running', 'in_progress'].includes(t.state || t.status));
  const active = m && ['OPEN', 'RUNNING', 'PAUSED', 'AWAITING_APPROVAL', 'AWAITING_INPUT', 'PLANNING', 'EXECUTING', 'VERIFYING'].includes(st(m));

  let status;
  if (isProcessing) status = <>Working now — every step streams below as it happens.</>;
  else if (conn === 'locked') status = <>This brain is locked — open <b>Settings → System</b> and paste the access key.</>;
  else if (conn === 'offline') status = <>Brain unreachable — check the connection, then tell me what to build.</>;
  else if (conn === 'error') status = <>Brain answered with {connNote || 'an error'} — mission list unavailable.</>;
  else if (active) status = <>Mission <b>{m.objective || m.title || 'in progress'}</b> is {m.state.replace(/_/g, ' ')}.</>;
  else if (m) status = <>Last mission <b>{m.objective || m.title || ''}</b> {m.state.replace(/_/g, ' ')}. Tell me what is next.</>;
  else status = <>No missions yet — give me the first one.</>;

  return (
    <div className="jx-home">
      <p className="jx-home-greet jx-hand-display">{greeting()}</p>
      <p className="jx-home-status">{status}</p>
      <p className="jx-home-mode" title="There is no mode switch — JEXI routes every request herself.">ONE MODE · JEXI DECIDES</p>

      {conn === 'ok' && m && (
        <div className="jx-home-mission" role="status" aria-label={`Mission: ${m.objective || m.title || m.state}`}>
          <div className="t">{active ? 'ACTIVE MISSION' : 'LAST MISSION'}</div>
          <div className="o">{m.objective || m.title || 'Untitled mission'}</div>
          <div className="s">
            {(m.state || 'unknown').toUpperCase().replace(/_/g, ' ')}
            {tasks.length > 0 && ` · ${done}/${tasks.length} TASKS`}
            {live ? ` · NOW: ${(live.title || live.name || '').slice(0, 60)}` : ''}
          </div>
          {tasks.length > 0 && (
            <div className="bar" aria-hidden="true"><i style={{ width: `${Math.round((done / tasks.length) * 100)}%` }} /></div>
          )}
          {onOpenCommand && (
            <button type="button" className="link" onClick={onOpenCommand}>Open missions →</button>
          )}
        </div>
      )}

      <div className="jx-suggest" role="group" aria-label="Suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.label} type="button" onClick={() => onSend(s.query)}>{s.label}</button>
        ))}
      </div>
    </div>
  );
}
