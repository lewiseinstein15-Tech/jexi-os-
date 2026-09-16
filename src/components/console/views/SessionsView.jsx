import { SESSIONS } from '../consoleData';

/* SessionsView — session list with JSONL child tree + raw JSONL tail,
   exactly as the approved preview. */
export default function SessionsView() {
  return (
    <div className="pad">
      <div className="ph">
        <h3>Sessions</h3>
        <div className="rule" />
        <span className="meta">3 roots · JSONL persisted · resume-safe checkpoints</span>
      </div>
      <div className="grid2">
        <div className="card">
          <div className="tierhead"><h4>Session tree</h4><span className="cnt">3 roots · 2 children</span></div>
          {SESSIONS.roots.map((r, ri) => (
            <div key={ri}>
              <div className="rowline">
                <span className="sdot s" style={{ background: r.dot }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  <div className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{r.meta}</div>
                </div>
                <span className={`pill ${r.pill[0]}`}><span className="dot" />{r.pill[1]}</span>
              </div>
              {r.children && (
                <div className="tree-line">
                  {r.children.map((c, ci) => (
                    <div className="rowline" key={ci}>
                      <span className="sdot s" style={{ background: c.dot }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{c.title}</div>
                        <div className="mono" style={{ fontSize: '9.5px', color: 'var(--jcx-ink-3)' }}>{c.meta}</div>
                      </div>
                      <span className={`pill ${c.pill[0]}`}><span className="dot" />{c.pill[1]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="tierhead"><h4>JSONL tail — sess_01H9XK4</h4><span className="cnt">line 2,182 → 2,184</span></div>
          <div className="pad" style={{ padding: '10px 12px' }}>
            <pre className="mono" style={{ fontSize: 10, lineHeight: 1.6, color: 'var(--jcx-ink-2)', whiteSpace: 'pre-wrap', margin: 0 }}>
              {SESSIONS.jsonl.join('\n')}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
