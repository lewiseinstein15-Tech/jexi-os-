import { useEffect, useRef, useState } from 'react';
import { subscribeBus } from '../../services/brain';

/* <EventStream /> — the LIVE event feed docked to the bottom, always
   visible, same design as the approved preview — but 100% real now.
   Every line comes from the shared event bus: boot sequence, brain
   wake retries, fleet loads, health heartbeats, chat pipeline logs and
   self-test verdicts. No scripted ticker, no pre-written rows. */

function EvRow({ ts, chip, children }) {
  return (
    <div className="ev">
      <span className="ts">{ts}</span>
      <span className={`chip ${chip}`}>{chip}</span>
      <span className="msg">{children}</span>
    </div>
  );
}

const TONE = { 'var(--jcx-up)': 'up', 'var(--jcx-down)': 'down', 'var(--jcx-gold)': 'gold', 'var(--jcx-ember)': 'ember', 'var(--jcx-peach)': 'peach' };

export default function EventStream() {
  const [rows, setRows] = useState([]);
  const bodyRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeBus((e) => {
      setRows((rs) => [...rs.slice(-60), e]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const sb = bodyRef.current;
    if (sb) sb.scrollTop = sb.scrollHeight;
  }, [rows]);

  return (
    <footer className="stream">
      <div className="shead">
        <h3>Live Event Stream</h3>
        <span className="live"><span className="dot" />LIVE</span>
        <span className="meta">{rows.length} events · observer bus</span>
      </div>
      <div className="sbody" ref={bodyRef}>
        {rows.length === 0 && (
          <EvRow ts="—" chip="SYS">listening — boot lines, health checks and chat pipeline events land here live…</EvRow>
        )}
        {rows.map((e) => (
          <EvRow key={e.id} ts={e.ts} chip={e.chip}>
            <span className="who">{e.who}</span>{' — '}
            <span className="d" style={TONE[e.tone] ? { color: e.tone } : undefined}>{e.msg}</span>
          </EvRow>
        ))}
      </div>
    </footer>
  );
}
