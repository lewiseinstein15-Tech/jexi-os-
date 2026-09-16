import { useEffect, useRef, useState } from 'react';
import { EVENTS, LIVE_TICKER } from './consoleData';

/* <EventStream /> — the LIVE event feed docked to the bottom, always visible,
   exactly as the approved preview: static opening events + a 3.5s ticker that
   appends pre-written events and advances the event counter. */

function EvRow({ ts, chip, children }) {
  return (
    <div className="ev">
      <span className="ts">{ts}</span>
      <span className={`chip ${chip}`}>{chip}</span>
      <span className="msg">{children}</span>
    </div>
  );
}

export default function EventStream() {
  const [extra, setExtra] = useState([]);
  const [count, setCount] = useState(2184);
  const bodyRef = useRef(null);
  const iRef = useRef(0);
  const baseRef = useRef(14 * 3600 + 26 * 60 + 42); /* continues the mission clock */

  useEffect(() => {
    const t = setInterval(() => {
      const e = LIVE_TICKER[iRef.current++ % LIVE_TICKER.length];
      setExtra((xs) => [...xs.slice(-40), e]);
      setCount(2185 + iRef.current);
      const sb = bodyRef.current;
      if (sb) sb.scrollTop = sb.scrollHeight;
    }, 3500);
    return () => clearInterval(t);
  }, []);

  const fmt = (s) => {
    const p = (n) => (n < 10 ? '0' : '') + n;
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
  };

  return (
    <footer className="stream">
      <div className="shead">
        <h3>Live Event Stream</h3>
        <span className="live"><span className="dot" />LIVE</span>
        <span className="meta">{count} events · observer bus</span>
      </div>
      <div className="sbody" ref={bodyRef}>
        {EVENTS.map((e, idx) => (
          <EvRow key={`s${idx}`} ts={e[0]} chip={e[1]}>
            {e[1] === 'SYS'
              ? (<>{'Snapshot frozen for verification — completion '}<b>refused until Vera's spawn passes</b>{' '}<span className="d">{e[4]}</span></>)
              : e[6]
                ? (<><span className="who">{e[2]}</span>{' '}<span className="d">{e[3]}</span><span className="d" style={{ color: 'var(--jcx-down)' }}>{e[4]}</span>{e[5]}</>)
                : e[7]
                  ? (<><span className="who">{e[2]}</span>{' '}<span className="d">{e[3]}</span><span className="d" style={{ color: 'var(--jcx-up)' }}>{e[4]}</span>{e[5]}</>)
                  : (<><span className="who">{e[2]}</span>{' '}{e[3]}<span className="d">{e[4]}</span>{e[5]}</>)}
          </EvRow>
        ))}
        {extra.map((e, idx) => (
          <EvRow key={`l${idx}`} ts={fmt(baseRef.current + idx * 3.5 | 0)} chip={e[0]}>
            <span className="who">{e[1]}</span>{' — '}{e[2]}{' '}
            <span className="d" style={{ color: e[4] }}>{e[3]}</span>
          </EvRow>
        ))}
      </div>
    </footer>
  );
}
