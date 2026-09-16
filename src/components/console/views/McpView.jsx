import { MCP } from '../consoleData';

/* McpView — MCP registry with per-agent grants and the community force-gate
   posture, exactly as the approved preview. */
export default function McpView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>MCP Registry</h3>
        <div className="rule" />
        <span className="meta">42 registered · 6 local enabled · community ships disabled (force-gate)</span>
      </div>
      <div className="card">
        {MCP.map((m) => (
          <div className="rowline" key={m.name}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {m.name} <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{m.meta}</span>
              </div>
              {m.grants && (
                <div style={{ marginTop: 3 }}>
                  {m.grants.map((g) => <span className="grantchip" key={g}>{g}</span>)}
                </div>
              )}
              {m.note && (
                <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-3)' }}>{m.note}</div>
              )}
            </div>
            <span className={`pill ${m.pill[0]}`}><span className="dot" />{m.pill[1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
