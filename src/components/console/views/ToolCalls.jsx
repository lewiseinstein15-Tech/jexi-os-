import { useEffect, useState } from 'react';
import { subscribeBus, busCount } from '../../../services/brain';

/* <ToolCalls /> — recent activity from the REAL event bus. Every row is a
   live event that actually happened in this session: boot lines, health
   checks, fleet loads, chat pipeline logs, self-test verdicts. When the
   session is young, the panel honestly says so. */
export default function ToolCalls() {
  const [rows, setRows] = useState([]);

  useEffect(() => subscribeBus((e) => {
    setRows((rs) => [e, ...rs].slice(0, 8));
  }), []);

  const total = busCount();

  const tone = { 'var(--jcx-up)': 'var(--jcx-up)', 'var(--jcx-down)': 'var(--jcx-down)', 'var(--jcx-gold)': 'var(--jcx-gold)', 'var(--jcx-ember)': 'var(--jcx-ember)' };

  return (
    <>
      <div className="ph" style={{ marginTop: 16 }}>
        <h3>Live Activity</h3>
        <div className="rule" />
        <span className="meta">{total} event{total === 1 ? '' : 's'} this session · newest first</span>
      </div>
      <div style={{ border: '1px solid var(--jcx-line)', borderRadius: 10, background: 'var(--jcx-panel)', overflow: 'hidden' }}>
        {rows.length === 0 && (
          <div className="empty" style={{ margin: 10 }}>no events yet — they appear the moment the brain or you act</div>
        )}
        {rows.map((e) => (
          <div className="tool" key={e.id}>
            <span className="sdot s" style={{ background: tone[e.tone] || 'var(--jcx-ink-3)' }} />
            <span className="tn">{e.who}</span>
            <span className="ta">{e.msg}</span>
            <span className="td">{e.ts}</span>
          </div>
        ))}
      </div>
    </>
  );
}
