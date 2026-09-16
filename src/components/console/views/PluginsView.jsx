import { PLUGINS } from '../consoleData';

/* PluginsView — installed plugins with version, skills contributed and
   enable state, exactly as the approved preview. */
export default function PluginsView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Installed Plugins</h3>
        <div className="rule" />
        <span className="meta">52 installed · 51 enabled · catalog-resolved skills</span>
      </div>
      <div className="card">
        {PLUGINS.map((p) => (
          <div className="rowline" key={p[0]}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {p[0]} <span className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{p[1]}</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-2)' }}>{p[2]}</div>
            </div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--jcx-ink-3)' }}>{p[3]}</span>
            <span className={`pill ${p[4][0]}`}><span className="dot" />{p[4][1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
