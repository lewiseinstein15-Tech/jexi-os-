import { NavIcon } from '../icons';
import { CANVAS_NODES, CANVAS_EDGES } from '../consoleData';

/* WorkGraphView — full graph canvas: 7 nodes, 6 edges, dot-grid background,
   state legend — exactly as the approved preview. */
export default function WorkGraphView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Work Graph — full canvas</h3>
        <div className="rule" />
        <span className="meta">mission m-2184 · 7 nodes · 6 edges · depth 4</span>
      </div>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span className="li"><i style={{ background: 'var(--jcx-up)' }} />verified</span>
        <span className="li"><i style={{ background: 'var(--jcx-ember)' }} />running</span>
        <span className="li"><i style={{ background: 'var(--jcx-ink-3)' }} />pending</span>
        <span className="li"><i style={{ background: 'var(--jcx-down)' }} />failed</span>
        <span className="li" style={{ color: 'var(--jcx-ink-3)' }}>· completion refused until verification spawn passes</span>
      </div>

      <div className="canvas" style={{ height: 400 }}>
        <svg className="edges" viewBox="0 0 1120 400" fill="none" preserveAspectRatio="none">
          {CANVAS_EDGES.map((d, i) => (
            <path key={i} d={d} stroke="#3a3226" strokeWidth="1.5" strokeDasharray={i === 6 ? '4 4' : undefined} />
          ))}
          <circle cx="300" cy="88" r="2.5" fill="#4cc38a" />
          <circle cx="538" cy="88" r="2.5" fill="#4cc38a" />
          <circle cx="822" cy="165" r="2.5" fill="#ff7a3d" />
        </svg>

        {CANVAS_NODES.map((n, i) => (
          <div key={i} className={`wnode${n.running ? ' running' : ''}`} style={{ left: n.x, top: n.y }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`sdot ${n.state}`} />
              <div className="wt">{n.title}</div>
            </div>
            <div className="ws">{n.sub}</div>
            <div className="wrow">
              <span className={`avatar ${n.tone}`} style={{ width: 16, height: 16, fontSize: '7.5px' }}>{n.owner}</span>
              {n.badge
                ? <span className="badge ok" style={{ fontSize: '8.5px' }}><NavIcon name="check" />{n.badge}</span>
                : <span className="ws" style={n.running ? { color: 'var(--jcx-ember)' } : undefined}>{n.foot}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
