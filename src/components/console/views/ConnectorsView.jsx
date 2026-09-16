import { CONNECTORS } from '../consoleData';

/* ConnectorsView — MCP servers + grants + the ONE-KEY model bridge,
   exactly as the approved preview. */
export default function ConnectorsView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Connectors</h3>
        <div className="rule" />
        <span className="meta">6 local · 0 external keys required</span>
      </div>
      <div className="card">
        {CONNECTORS.map((c) => (
          <div className="rowline" key={c.name}>
            <span className="sdot s" style={{ background: c.dot }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{c.desc}</div>
            </div>
            <div>{c.grants.map((g) => <span className="grantchip" key={g}>{g}</span>)}</div>
            <span className={`pill ${c.pill[0]}`}><span className="dot" />{c.pill[1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
