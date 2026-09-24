import { useEffect, useRef, useState } from 'react';
import { useHud } from './ConsoleApp';
import { subscribeBus, busHistory } from '../../services/brain';

/* <EventStream /> — the LIVE event feed docked to the bottom, always
   visible, same design as the approved preview.

   Phase 7(F): the stream renders the HUD contract — every hud.updated
   push (SSE /api/hud/stream) lands here as a row stamped with the
   payload's own lastEvent + generatedAt. A section the contract does not
   carry is never invented. Local console lines (boot, wake, fleet) stay
   in the feed — they are console-side facts, not brain state. */

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
  const { hud, revision, connected } = useHud();
  const [rows, setRows] = useState([]);
  const bodyRef = useRef(null);
  const seenRev = useRef(0);

  useEffect(() => {
    setRows(busHistory()); // seed with boot-time console events emitted before this mounted
    const unsub = subscribeBus((e) => {
      setRows((rs) => [...rs.slice(-60), e]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!hud || !revision || revision <= seenRev.current) return;
    seenRev.current = revision;
    const d = new Date(hud.generatedAt || Date.now());
    const p = (n) => (n < 10 ? '0' : '') + n;
    const msg = hud.toolCalls?.lastEvent
      ? hud.toolCalls.lastEvent
      : `payload rev ${revision} · ${hud.activeAgents?.length ?? 0} agents · ${hud.todos?.length ?? 0} tasks`;
    setRows((rs) => [...rs.slice(-60), {
      id: `hud-${revision}`,
      ts: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      chip: 'HUD',
      who: 'Brain',
      msg,
      tone: 'var(--jcx-up)',
    }]);
  }, [hud, revision]);

  useEffect(() => {
    const sb = bodyRef.current;
    if (sb) sb.scrollTop = sb.scrollHeight;
  }, [rows]);

  return (
    <footer className="stream">
      <div className="shead">
        <h3>Live Event Stream</h3>
        <span className="live"><span className="dot" />{connected ? 'LIVE' : 'SYNC'}</span>
        <span className="meta">{rows.length} events · hud.updated rev {revision || '—'}</span>
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
