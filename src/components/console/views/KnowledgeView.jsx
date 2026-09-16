import { ZETTELS, KNOWLEDGE_GRAPH } from '../consoleData';

/* KnowledgeView — zettelkasten: note list + SVG link graph of the Z-0912
   neighborhood, exactly as the approved preview. */
export default function KnowledgeView() {
  const g = KNOWLEDGE_GRAPH;
  return (
    <div className="pad">
      <div className="ph">
        <h3>Knowledge — Zettelkasten</h3>
        <div className="rule" />
        <span className="meta">342 notes · 1,190 links · 6 orphans</span>
      </div>
      <div className="grid2">
        <div className="card">
          <div className="tierhead"><h4>Recent notes</h4><span className="cnt">linked by [id]</span></div>
          {ZETTELS.map((z) => (
            <div className="zet" key={z[0]}>
              <span className="zid">{z[0]}</span>
              <span className="zt">{z[1]}</span>
              <span className="zl">{z[2]}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div className="tierhead" style={{ borderBottom: '1px solid var(--jcx-line-soft)' }}>
            <h4>Link graph</h4><span className="cnt">neighborhood of Z-0912</span>
          </div>
          <svg viewBox="0 0 520 300" style={{ width: '100%', height: 280, display: 'block' }}>
            {g.edges.map(([d, dashed], i) => (
              <path key={i} d={d} stroke="#282318" strokeWidth="1.5" strokeDasharray={dashed ? '4 4' : undefined} />
            ))}
            {g.nodes.map(([x, y, r, id, hot], i) => (
              <g key={i}>
                <circle
                  cx={x} cy={y} r={r}
                  fill={hot ? 'rgba(255,122,61,.14)' : '#1c1915'}
                  stroke={hot ? '#ff7a3d' : '#282318'}
                  strokeWidth={hot ? 1.5 : 1}
                />
                <text x={x} y={y + 4} textAnchor="middle" fill={hot ? '#ff7a3d' : '#a99f90'}
                  fontSize={r >= 26 ? 10 : r >= 20 ? 9 : 8} fontFamily="monospace">{id}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
