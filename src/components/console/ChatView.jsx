import { useEffect, useRef, useState } from 'react';
import { NavIcon } from './icons';
import { getBackendUrl } from '../../utils/helpers';
import { consumeAutoTest, emitEvent, AUTO_TEST_QUESTION } from '../../services/brain';
import { useHud } from './ConsoleApp';

/* <ChatView /> — v0.12: the agent-run timeline (FreeBuff / Codebuff / Arena /
   opencode pattern, JEXI colors untouched). One JEXI reply is a RUN:
     BRAIN TASKS strip — the brain's real task list (hud.todos), pinned
     PLAN card        — the brain's plan steps as a todo checklist (+ roster)
     thinking card    — chain-of-thought from `think` deltas, expandable
     tool cards       — every pipeline `log` line, collapsed, tap to expand
     narration        — the brain's spoken progress as paragraphs
     answer           — streamed text with inline `code` chips
     sources          — hostnames the run touched (done.sources)
   Status pill times the run for real: THINKING → WORKING → ANSWERED · Ns.
   Stream events (probe-verified shapes):
   {type:'log',agent,message} · {type:'team',event} · {type:'narration',text}
   {type:'plan',steps[],roster[],complexity} · {type:'think',text,by} deltas
   {type:'stream',text} · {type:'done',success,summary,sources[]} */

const ts = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/* the brain sometimes ships structured payloads (team event objects, task
   updates) inside fields the UI renders as text — coerce EVERYTHING to a
   string before it touches a React child (React error #31 guard) */
const str = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const s = v.message || v.text || v.summary || v.title || v.event || v.state || v.type;
    return typeof s === 'string' ? s : JSON.stringify(v);
  }
  return String(v);
};

const hostOf = (s) => {
  try { return new URL(String(s)).host; } catch { return String(s).slice(0, 42); }
};

/* ── BRAIN TASKS strip — the brain's real task ledger, never faked ── */
function TaskStrip({ tasks }) {
  if (!tasks || !tasks.length) return null;
  const active = tasks.filter((t) => str(t.status).toLowerCase() === 'active').length;
  return (
    <div className="taskstrip" data-probe="taskstrip">
      <div className="tshead">BRAIN TASKS · {active} active / {tasks.length} total</div>
      {tasks.slice(0, 5).map((t, i) => {
        const s = (str(t.status) || 'pending').toLowerCase();
        const cls = s === 'completed' || s === 'done' ? 'ok' : (s === 'active' || s === 'running') ? 'run' : 'idle';
        return (
          <div className="trow" key={i}>
            <span className={`tbadge ${cls}`}>{s.toUpperCase()}</span>
            <span className="ttitle">{str(t.title || t.name || t.description) || 'untitled task'}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── thinking card — one expandable chain-of-thought per run ── */
function ThinkCard({ think, live }) {
  if (!think || !think.text) return null;
  const prev = `${String(think.text).replace(/\s+/g, ' ').trim().slice(0, 44)}`;
  return (
    <details className="thinkbar" open data-probe="think">
      <summary>
        <span className="tico"><NavIcon name="bolt" /></span>
        <span className="tt1">thinking · {think.by || 'JEXI'}</span>
        <span className="tprev">{prev}{think.text.length > 44 ? '…' : ''}</span>
        <span className="tchev"><NavIcon name="chevdown" /></span>
      </summary>
      <div className="tbody">{think.text}{live ? ' ▊' : ''}</div>
    </details>
  );
}

/* ── PLAN card — the brain's plan as a todo checklist ── */
function PlanCard({ plan }) {
  if (!plan) return null;
  const steps = (plan.steps && plan.steps.length ? plan.steps : plan.roster) || [];
  if (!steps.length) return null;
  const roster = plan.roster || [];
  const sub = roster.length
    ? `${steps.length} step${steps.length === 1 ? '' : 's'} · ${roster.join(', ')}`
    : `${steps.length} step${steps.length === 1 ? '' : 's'}`;
  return (
    <div className="plancard" data-probe="plan">
      <div className="phead">
        <span className="pt">PLAN</span>
        <span className="psub">{sub}</span>
        <span className={`pill ${plan.done ? 'ok' : 'run'} ppill`}><span className="dot" />{plan.done ? 'DONE' : 'RUNNING'}</span>
      </div>
      {steps.map((s, i) => {
        const txt = typeof s === 'string' ? s : (s && (s.description || s.title || s.name || s.step)) || JSON.stringify(s);
        return (
          <div className="prow" key={i}>
            <span className={`pdot ${plan.done ? 'done' : i === 0 ? 'live' : ''}`} />
            <span className="ptxt">{txt}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── tool card — one collapsed pipeline log line, tap to expand ── */
function ToolCard({ t }) {
  return (
    <details className="tcard" data-probe="toolcard">
      <summary>
        <span className="tico"><NavIcon name="terminal" /></span>
        <span className="tn">{str(t.agent) || 'JEXI'}</span>
        <span className="tm">{t.msg}</span>
        <span className="tchev"><NavIcon name="chevdown" /></span>
      </summary>
      <div className="tbody">{`${t.agent ? `${t.agent}: ` : ''}${t.msg}`}</div>
    </details>
  );
}

/* answer text with inline `code` chips */
function AnswerText({ text }) {
  const parts = String(text || '').split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => (p.length > 1 && p.startsWith('`') && p.endsWith('`')
        ? <code key={i}>{p.slice(1, -1)}</code>
        : <span key={i}>{p}</span>))}
    </>
  );
}

/* status pill: THINKING → WORKING → ANSWERED · Ns (all real time) */
function StatusPill({ m, now }) {
  if (m.phase === 'error') return <span className="pill err"><span className="dot" />FAILED</span>;
  if (m.phase === 'done') {
    const s = Math.max(1, Math.round(((m.endedAt || m.startedAt) - m.startedAt) / 1000));
    return <span className="pill ok"><span className="dot" />ANSWERED · {s}S</span>;
  }
  const s = Math.max(0, Math.round((now - m.startedAt) / 1000));
  return (
    <span className="pill run">
      <span className="dot" />
      {m.stage === 'thinking' ? 'THINKING' : 'WORKING'}
      <span className="wave"><i /><i /><i /></span>
      · {s}S
    </span>
  );
}

export default function ChatView() {
  const logRef = useRef(null);
  const stickRef = useRef(true);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const brain = getBackendUrl();
  const brainHost = (() => { try { return brain ? new URL(brain).host : 'no brain configured'; } catch { return brain; } })();

  /* live seconds ticker while a run is streaming */
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  /* smart stick-to-bottom: follow the stream until the owner scrolls up */
  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [msgs, now]);

  const onScroll = () => {
    const el = logRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  /* real brain task strip — Phase 7(F): fed by hud.todos (the contract),
   which updates live over SSE after every run. Never faked. */
  const { hud } = useHud();
  const tasks = (hud?.todos || []).map((t) => ({ id: t.id, title: t.text, status: t.status, owner: t.owner }));

  const patchLast = (fn) => setMsgs((ms) => {
    if (!ms.length) return ms;
    const next = ms.slice();
    next[next.length - 1] = fn({ ...next[next.length - 1] });
    return next;
  });

  /* boot self-test handshake: <BootScreen /> armed a live replay of the
     automatic test question — run it for real, in full view, right here */
  const armedRef = useRef(false);
  useEffect(() => {
    if (armedRef.current) return;
    armedRef.current = true;
    if (consumeAutoTest()) {
      emitEvent({ chip: 'SYS', who: 'Chat', msg: `boot self-test replay: “${AUTO_TEST_QUESTION}”`, tone: 'var(--jcx-ember)' });
      runSend(AUTO_TEST_QUESTION);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSend(q) {
    if (!q || busy) return;
    setBusy(true);
    stickRef.current = true;
    const stamp = ts();
    const startedAt = Date.now();
    setMsgs((ms) => [
      ...ms,
      { id: `u${startedAt}`, ts: stamp, voice: 'user', text: q },
      {
        id: `j${startedAt}`, ts: stamp, voice: 'jexi', text: '',
        phase: 'run', stage: 'thinking', startedAt,
        tools: [], think: null, plan: null, narr: [], sources: [],
        success: false, error: '',
      },
    ]);
    try {
      if (!brain) throw new Error('No brain configured — set the Server address in the sidebar.');
      emitEvent({ chip: 'AGENT', who: 'JEXI', msg: `dispatched to /api/chat · “${q.slice(0, 60)}${q.length > 60 ? '…' : ''}”`, tone: 'var(--jcx-ember)' });
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
            const who = str(ev.agent) || 'JEXI';
            const msg2 = str(ev.message);
            patchLast((m) => ({ ...m, tools: [...m.tools, { agent: who, msg: msg2 }] }));
            emitEvent({ chip: 'TOOL', who, msg: msg2, tone: 'var(--jcx-ink-2)' });
          } else if (ev.type === 'think' && ev.text) {
            patchLast((m) => ({
              ...m,
              stage: 'thinking',
              think: { by: str(ev.by) || (m.think && m.think.by) || '', text: ((m.think && m.think.text) || '') + str(ev.text) },
            }));
          } else if (ev.type === 'plan' && (ev.steps || ev.roster)) {
            const n = (ev.steps || ev.roster || []).length;
            patchLast((m) => ({ ...m, plan: { steps: ev.steps || [], roster: ev.roster || [], done: false } }));
            emitEvent({ chip: 'PLAN', who: 'JEXI', msg: `plan · ${n} step${n === 1 ? '' : 's'}${ev.complexity ? ` · ${str(ev.complexity)}` : ''}`, tone: 'var(--jcx-gold)' });
          } else if (ev.type === 'narration' && ev.text) {
            patchLast((m) => ({ ...m, narr: [...m.narr, str(ev.text)] }));
          } else if (ev.type === 'team' && (ev.event || ev.message)) {
            /* team events are structured brain telemetry — they feed the live
               event stream (bus); the log lines already carry the same text */
            const t0 = ev.event && typeof ev.event === 'object' ? ev.event : {};
            const who = str(t0.agentName || t0.agentId || ev.agent) || 'JEXI';
            const msg2 = str(t0.summary || t0.title || t0.type || ev.event || ev.message);
            if (msg2) emitEvent({ chip: 'TOOL', who, msg: msg2, tone: 'var(--jcx-ink-2)' });
          } else if (ev.type === 'stream' && ev.text) {
            patchLast((m) => ({ ...m, stage: 'working', text: m.text + ev.text }));
          } else if (ev.type === 'done') {
            patchLast((m) => ({
              ...m,
              text: (ev.summary && ev.summary.length >= m.text.length) ? ev.summary : m.text,
              sources: Array.isArray(ev.sources) ? ev.sources.map(str) : (m.sources || []),
              success: ev.success !== false,
              plan: m.plan ? { ...m.plan, done: true } : m.plan,
            }));
          }
        }
      }
      patchLast((m) => ({
        ...m,
        phase: 'done',
        endedAt: Date.now(),
        success: m.success !== false && !!m.text,
      }));
      emitEvent({ chip: 'OK', who: 'Chat', msg: 'answer complete · stream closed', tone: 'var(--jcx-up)' });
    } catch (e) {
      patchLast((m) => ({ ...m, phase: 'error', endedAt: Date.now(), error: (e && e.message) || 'The brain could not be reached.' }));
      emitEvent({ chip: 'WARN', who: 'Chat', msg: `chat failed · ${(e && e.message) || 'error'}`, tone: 'var(--jcx-down)' });
    } finally {
      setBusy(false);
      // the run's task changes surface through the HUD stream (hud.todos)
    }
  }

  const send = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft('');
    runSend(q);
  };

  return (
    <div className="chatwrap">
      <div className="chatlog" ref={logRef} onScroll={onScroll}>
        <TaskStrip tasks={tasks} />
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
                  Executive console online. Ask me anything — I run live on {brainHost}. Every reply shows the real plan, the thinking, and each pipeline step as it happens.
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
                {m.voice === 'jexi' && <StatusPill m={m} now={now} />}
              </div>
              {m.voice === 'jexi' && (
                <>
                  <ThinkCard think={m.think} live={m.phase === 'run' && m.stage === 'thinking'} />
                  <PlanCard plan={m.plan} />
                  {(m.tools || []).map((t, i) => <ToolCard t={t} key={`${m.id}-t${i}`} />)}
                  {(m.narr || []).map((n, i) => <div className="cnarr" key={`${m.id}-n${i}`}>{n}</div>)}
                </>
              )}
              {m.error ? (
                <div className="cbubble director"><div className="ctext" style={{ color: 'var(--jcx-down)' }}>{m.error}</div></div>
              ) : ((m.text || (m.voice === 'jexi' && m.phase === 'run')) && (
                <div className={`cbubble${m.voice === 'jexi' ? ' director' : ''}`}>
                  <div className="ctext">
                    {m.voice === 'jexi' ? <AnswerText text={m.text} /> : m.text}
                    {m.voice === 'jexi' && m.phase === 'run' && !m.text && (
                      <span className="status" style={{ color: 'var(--jcx-gold)' }}>listening to the pipeline…</span>
                    )}
                  </div>
                </div>
              ))}
              {m.voice === 'jexi' && m.sources && m.sources.length > 0 && (
                <div className="srcc">
                  {m.sources.map((s, i) => (
                    <span className="sc" key={i}>{hostOf(s)}</span>
                  ))}
                </div>
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
