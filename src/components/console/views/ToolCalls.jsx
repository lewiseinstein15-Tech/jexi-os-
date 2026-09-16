import { TOOL_CALLS } from '../consoleData';

/* <ToolCalls /> — recent tool calls list (name · args · status · duration),
   exactly as the approved preview. */
export default function ToolCalls() {
  return (
    <>
      <div className="ph" style={{ marginTop: 16 }}>
        <h3>Recent Tool Calls</h3>
        <div className="rule" />
        <span className="meta">38 today</span>
      </div>
      <div style={{ border: '1px solid var(--jcx-line)', borderRadius: 10, background: 'var(--jcx-panel)', overflow: 'hidden' }}>
        {TOOL_CALLS.map((t, i) => (
          <div className="tool" key={i}>
            <span className="sdot s" style={{ background: t.c }} />
            <span className="tn">{t.n}</span>
            <span className="ta">{t.a}</span>
            <span className="td">{t.d}</span>
          </div>
        ))}
      </div>
    </>
  );
}
