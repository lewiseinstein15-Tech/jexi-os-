import { useEffect, useRef } from 'react';
import { NavIcon } from './icons';
import { CHAT } from './consoleData';

/* <ChatView /> — the JEXI ↔ agents dialogue, exactly as the approved preview:
   - JEXI (Director) messages as a distinct ember voice
   - agent messages with avatar + name + role
   - inline terminal blocks (header = tool + command, output below)
   - inline code diffs
   - collapsible tool calls (details closed by default → args + result)
   - inline status ("running…", "verifying…")
   - timestamps on the left, auto-scroll to bottom, disabled composer

   Mock transcript until this view is wired to the real /api/chat backend in a
   later scope. */

function TermBlock({ t }) {
  return (
    <div className="term">
      <div className="thead">
        <span className="tt">{t.tool}</span>
        <span className="tc">{t.cmd}</span>
        <span className="tm">{t.ms}</span>
      </div>
      <pre dangerouslySetInnerHTML={{ __html: t.out }} />
    </div>
  );
}

function DiffBlock({ d }) {
  return (
    <div className="diff">
      <div className="dhead">
        <span className="df">{d.file}</span>
        <span className="dh">{d.hunk}</span>
        <span className="dh" style={{ marginLeft: 'auto' }}>{d.stat}</span>
      </div>
      <div className="dlines">
        {d.lines.map((l, i) => <span key={i} className={`dl ${l[0]}`}>{l[1]}</span>)}
      </div>
    </div>
  );
}

function CallBlock({ c }) {
  return (
    <details className="call">
      <summary>
        <svg className="car" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor"><path d="M9 6l6 6-6 6" /></svg>
        <span className="cn">{c.name}</span>
        <span className="cd">{c.desc}</span>
        <span className="cs ok">{c.status}</span>
      </summary>
      <div className="cbody2">
        <div><span className="k">args</span> <span className="v">{c.args}</span></div>
        <div><span className="k">result</span></div>
        <pre dangerouslySetInnerHTML={{ __html: c.result }} />
      </div>
    </details>
  );
}

export default function ChatView() {
  const logRef = useRef(null);

  /* newest at bottom — auto-scroll on mount (the transcript is static mock
     data; the real feed will re-scroll on every appended message) */
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div className="chatwrap">
      <div className="chatlog" ref={logRef}>
        {CHAT.map((m, i) => (
          <div className="cmsg" key={i}>
            <span className="ts">{m.ts}</span>
            {m.kind === 'director'
              ? <span className="cav avatar jexi">J</span>
              : <span className={`cav avatar ${m.tone}`}>{m.ini}</span>}
            <div className="cbody">
              <div className="chead">
                <span className={`cname${m.kind === 'director' ? ' director' : ''}`}>{m.name}</span>
                <span className="crole">{m.role}</span>
                {m.pill && <span className={`pill ${m.pill[0]}`} style={{ marginLeft: 6 }}><span className="dot" />{m.pill[1]}</span>}
              </div>
              {m.bubble
                ? <div className={`cbubble${m.kind === 'director' ? ' director' : ''}`}><div className="ctext">{m.text}{m.status && <>{' '}<span className="status" style={{ color: m.status[1] }}>{m.status[0]}</span></>}</div></div>
                : <div className="ctext">{m.text}{m.status && <>{' '}<span className="status" style={{ color: m.status[1] }}>{m.status[0]}</span></>}</div>}
              {m.term && <TermBlock t={m.term} />}
              {m.diff && <DiffBlock d={m.diff} />}
              {m.call && <CallBlock c={m.call} />}
            </div>
          </div>
        ))}
      </div>
      <div className="composer">
        <div className="hin">Message JEXI or @mention an agent…</div>
        <span className="send"><NavIcon name="send" />Send</span>
        <span className="note">preview only — composer disabled</span>
      </div>
    </div>
  );
}
