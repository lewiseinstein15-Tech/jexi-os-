import { useEffect, useRef, useState } from 'react';
import { NavIcon } from './icons';
import { getBackendUrl } from '../../utils/helpers';

/* <ChatView /> — v0.8: LIVE. Wired to the brain's POST /api/chat (NDJSON).
   Design language unchanged from the approved preview:
   - JEXI (Director) as the distinct ember voice
   - timestamps left, avatar + name + role rows
   - live pipeline log lines in the same terminal-block styling
   - auto-scroll to bottom on every append
   The preview's mock transcript is replaced by a real conversation with the
   brain (JEXI_MODEL_PROVIDER on Render — Groq). Stream events:
   {type:'log',agent,message} · {type:'stream',text} · {type:'done',summary,success} */

function TermBlock({ title, lines }) {
  return (
    <div className="term">
      <div className="thead">
        <span className="tt">{title}</span>
        <span className="tc">/api/chat</span>
        <span className="tm">live</span>
      </div>
      <pre>{lines.slice(-6).join('\n')}</pre>
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

const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export default function ChatView() {
  const logRef = useRef(null);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const brain = getBackendUrl();
  const brainHost = (() => { try { return brain ? new URL(brain).host : 'no brain configured'; } catch { return brain; } })();

  /* auto-scroll on every change (live feed behavior) */
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const patchLast = (fn) => setMsgs((ms) => {
    if (!ms.length) return ms;
    const next = ms.slice();
    next[next.length - 1] = fn({ ...next[next.length - 1] });
    return next;
  });

  async function send() {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft('');
    setBusy(true);
    const stamp = ts();
    setMsgs((ms) => [
      ...ms,
      { id: `u${Date.now()}`, ts: stamp, voice: 'user', text: q },
      { id: `j${Date.now()}`, ts: stamp, voice: 'jexi', text: '', logs: [], streaming: true, error: '' },
    ]);
    try {
      if (!brain) throw new Error('No brain configured — set the Server address in the sidebar.');
      const res = await fetch(`${brain}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok || !res.body) throw new Error(`Brain replied HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'log' && ev.message) {
            patchLast((m) => ({ ...m, logs: [...(m.logs || []), `${ev.agent ? `${ev.agent}: ` : ''}${ev.message}`] }));
          } else if (ev.type === 'stream' && ev.text) {
            patchLast((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.type === 'done') {
            patchLast((m) => ({
              ...m,
              streaming: false,
              text: (ev.summary && ev.summary.length >= m.text.length) ? ev.summary : m.text,
              success: ev.success !== false,
            }));
          }
        }
      }
      patchLast((m) => ({ ...m, streaming: false, success: m.success !== false && !!m.text }));
    } catch (e) {
      patchLast((m) => ({ ...m, streaming: false, error: (e && e.message) || 'The brain could not be reached.' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chatwrap">
      <div className="chatlog" ref={logRef}>
        {msgs.length === 0 && (
          <div className="cmsg">
            <span className="ts">{ts()}</span>
            <span className="cav avatar jexi">J</span>
            <div className="cbody">
              <div className="chead">
                <span className="cname director">JEXI</span>
                <span className="crole">Director</span>
              </div>
              <div className="cbubble director">
                <div className="ctext">
                  Executive console online. Ask me anything — I run live on {brainHost}. Mission views stay on the approved board data; this chat is the real brain.
                </div>
              </div>
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div className="cmsg" key={m.id}>
            <span className="ts">{m.ts}</span>
            {m.voice === 'jexi'
              ? <span className="cav avatar jexi">J</span>
              : <span className="cav avatar f1">L</span>}
            <div className="cbody">
              <div className="chead">
                <span className={`cname${m.voice === 'jexi' ? ' director' : ''}`}>{m.voice === 'jexi' ? 'JEXI' : 'Lewis'}</span>
                <span className="crole">{m.voice === 'jexi' ? 'Director' : 'owner & creator'}</span>
                {m.voice === 'jexi' && m.streaming && <span className="pill warn" style={{ marginLeft: 6 }}><span className="dot" />running…</span>}
                {m.voice === 'jexi' && !m.streaming && !m.error && m.text && <span className="pill ok" style={{ marginLeft: 6 }}><span className="dot" />answered</span>}
                {m.voice === 'jexi' && m.error && <span className="pill err" style={{ marginLeft: 6 }}><span className="dot" />error</span>}
              </div>
              {m.error
                ? <div className="cbubble director"><div className="ctext" style={{ color: 'var(--jcx-down)' }}>{m.error}</div></div>
                : (m.text || m.streaming) && (
                  <div className={`cbubble${m.voice === 'jexi' ? ' director' : ''}`}>
                    <div className="ctext">
                      {m.text}
                      {m.streaming && !m.text && <span className="status" style={{ color: 'var(--jcx-gold)' }}>thinking…</span>}
                    </div>
                  </div>
                )}
              {m.voice === 'jexi' && m.logs && m.logs.length > 0 && (
                <TermBlock title="LIVE PIPELINE" lines={m.logs} />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="composer">
        <input
          className="hin"
          value={draft}
          placeholder={busy ? 'JEXI is working…' : 'Message JEXI — live from your brain…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          disabled={busy}
          spellCheck="false"
        />
        <button type="button" className={`send live${busy ? ' busy' : ''}`} onClick={send} disabled={busy}>
          <NavIcon name="send" />{busy ? 'Working' : 'Send'}
        </button>
        <span className="note">{busy ? 'streaming from the brain' : `live · ${brainHost}`}</span>
      </div>
    </div>
  );
}
