import { useMemo, useState } from 'react';
import { getBackendUrl } from '../utils/helpers';

/**
 * B211 B3 — COMPUTER PANEL: Atlas's live computer-use telemetry.
 *
 * Shows ONLY what actually happened: every row is a real COMPUTER_* event
 * from the backend (act / observe / blocked). If the environment has no
 * browser, the panel shows the honest block — never a fabricated page.
 * The screenshot is the real virtual-desktop capture (saved by the backend
 * during execution); if none was saved, no image is shown.
 *
 * Layout rules (B207 lessons): min-width:0 everywhere, truncation instead of
 * overflow, capped list height — safe at phone width by construction.
 */
export default function ComputerPanel({ computer, live = false }) {
  const [shotBroken, setShotBroken] = useState(false);

  const events = Array.isArray(computer) ? computer : [];
  const last = events[events.length - 1] || null;

  // the newest real screenshot referenced by any observe event
  const shot = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const f = events[i]?.data?.screenshot;
      if (f) return f;
    }
    return null;
  }, [events]);

  if (!events.length) return null;

  const icon = (t) => {
    if (t === 'COMPUTER_ACT') return '🖱️';
    if (t === 'COMPUTER_OBSERVE') return '👀';
    if (t === 'COMPUTER_BLOCKED') return '⛔';
    return '🖥️';
  };

  return (
    <div className="jx-computer-panel" style={{
      margin: '6px 0', borderRadius: 12, border: '1px solid rgba(0,255,157,.18)',
      background: 'rgba(5,10,8,.55)', overflow: 'hidden', minWidth: 0, maxWidth: '100%',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
        borderBottom: '1px solid rgba(0,255,157,.12)', minWidth: 0,
      }}>
        <span style={{ fontSize: 13 }}>🖥️</span>
        <span style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '.04em', color: '#00D26A',
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          COMPUTER USE — {last?.agentName || 'Atlas'}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, color: '#7d8a84', flexShrink: 0,
        }}>
          {live ? 'live' : `${events.length} event${events.length > 1 ? 's' : ''}`}
        </span>
      </div>

      {shot && !shotBroken && (
        <div style={{ position: 'relative', background: '#050505' }}>
          <img
            src={`${getBackendUrl()}/api/desktop/screenshots/${encodeURIComponent(String(shot))}`}
            alt="Real virtual-desktop capture"
            onError={() => setShotBroken(true)}
            style={{ display: 'block', width: '100%', maxHeight: 190, objectFit: 'cover', objectPosition: 'top' }}
          />
          <span style={{
            position: 'absolute', right: 6, bottom: 6, fontSize: 9, color: '#9aa8a1',
            background: 'rgba(0,0,0,.55)', padding: '1px 6px', borderRadius: 6,
          }}>
            real capture
          </span>
        </div>
      )}

      <div style={{ maxHeight: 150, overflowY: 'auto', padding: '6px 10px', minWidth: 0 }}>
        {events.slice(-14).map((e, i) => (
          <div key={i} style={{
            display: 'flex', gap: 7, alignItems: 'baseline', padding: '2px 0',
            fontSize: 11, color: e.type === 'COMPUTER_BLOCKED' ? '#e8a13c' : '#b9c6c0',
            minWidth: 0,
          }}>
            <span style={{ flexShrink: 0 }}>{icon(e.type)}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {String(e.summary || e.type)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
