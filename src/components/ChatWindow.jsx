import { useState, useEffect, useRef } from 'react';
import { getBackendUrl, jexiFetch, getSessionId } from '../utils/helpers';

const SELF_CHECK_QUERY =
  'JEXI, run a full system self-check now. Check your health, memory, eyes and recent errors. If anything is wrong, tell me the exact source file and the fix.';

/* ── agent process steps (Cursor-style: spinner → check, terminal blocks) ── */
function looksTerminal(msg) {
  return /✓|✗|ALL TESTS|PASS|\$ |npm |node |error|compiled|running/i.test(String(msg || ''));
}

function ProcessSteps({ logs, done }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="jx-process">
        <div className="jx-step">
          <span className="ic"><span className="jx-spin" /></span>
          <span className="label">thinking…</span>
        </div>
      </div>
    );
  }
  return (
    <div className="jx-process">
      {logs.map((log, i) => {
        const last = i === logs.length - 1;
        const text = log && (log.message || log.text || '');
        return (
          <div key={i}>
            <div className="jx-step">
              <span className="ic">
                {last && !done ? <span className="jx-spin" /> : (
                  <svg className="jx-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6 9 17l-5-5" /></svg>
                )}
              </span>
              <span className="label">{String(text).split('\n')[0].slice(0, 90)}</span>
            </div>
            {looksTerminal(text) && text.split('\n').length > 1 && (
              <div className="jx-term">{text}</div>
            )}
          </div>
        );
      })}
      {done && logs.length > 0 && <div className="jx-recall" style={{ marginTop: 8 }}>— steps executed · verified by running —</div>}
    </div>
  );
}

/* ── flat markdown-ish renderer (b/code/pre/lists only — keeps it light) ── */
function SimpleText({ text }) {
  const parts = String(text || '').split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  parts.forEach((line, idx) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(<pre key={`c${idx}`}>{codeBuf.join('\n')}</pre>);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }
    if (inCode) { codeBuf.push(line); return; }
    const bold = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      seg.startsWith('**') && seg.endsWith('**')
        ? <b key={j}>{seg.slice(2, -2)}</b>
        : seg.includes('`')
          ? seg.split(/(`[^`]+`)/g).map((s2, k) => s2.startsWith('`') && s2.endsWith('`') ? <code key={`${j}-${k}`}>{s2.slice(1, -1)}</code> : s2)
          : seg
    );
    if (line.trim() === '') out.push(<p key={idx}>&nbsp;</p>);
    else if (/^#{1,3}\s/.test(line)) out.push(<p key={idx}><b>{line.replace(/^#+\s*/, '')}</b></p>);
    else if (/^\s*[-•]\s/.test(line)) out.push(<p key={idx}>— {line.replace(/^\s*[-•]\s*/, '')}</p>);
    else out.push(<p key={idx}>{bold}</p>);
  });
  if (inCode) out.push(<pre key="c-end">{codeBuf.join('\n')}</pre>);
  return <>{out}</>;
}

export default function ChatWindow({
  messages, logs, isProcessing, onSend, onStop,
  questions, onDismissQuestions, planReview, onDismissPlan,
}) {
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [fileAttachments, setFileAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [customAnswers, setCustomAnswers] = useState({});
  const [plusOpen, setPlusOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const scrollRef = useRef(null);
  const photoRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, logs, isProcessing]);

  const answerQuestions = async (answers) => {
    setCardBusy(true);
    try {
      const conv = (questions && questions.conv) || getSessionId();
      await jexiFetch(`${getBackendUrl()}/api/questions/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conv, answers }),
      });
      onDismissQuestions();
      onSend('Please continue — here are my answers to your questions.');
    } catch (e) { /* noop */ }
    setCardBusy(false);
  };

  const approvePlan = async () => {
    setCardBusy(true);
    try {
      const conv = (planReview && planReview.conv) || getSessionId();
      await jexiFetch(`${getBackendUrl()}/api/plan/${encodeURIComponent(conv)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      onDismissPlan();
      onSend('approve the plan');
    } catch (e) { /* noop */ }
    setCardBusy(false);
  };

  const runSelfCheck = () => onSend(SELF_CHECK_QUERY);

  const onPhotoPicked = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(file);
  };

  const onFilesPicked = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] || '');
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const res = await jexiFetch(`${getBackendUrl()}/api/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, data }),
        });
        if (res.ok) {
          const rec = await res.json();
          if (rec && rec.ok) setFileAttachments((p) => [...p, { id: rec.id, name: rec.name, kind: rec.kind }]);
        }
      }
    } catch (err) { /* noop */ }
    setUploading(false);
  };

  const submit = () => {
    if ((!input.trim() && !image && !fileAttachments.length) || isProcessing) return;
    onSend(input.trim(), image, fileAttachments.length ? fileAttachments : undefined);
    setPlusOpen(false);
    setInput('');
    setImage(null);
    setFileAttachments([]);
  };

  return (
    <div className="jx-chatwrap" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* messages */}
      <div ref={scrollRef} className="jx-scroll">
        {messages.length === 0 && !isProcessing && (
          <div className="jx-view-inner">
            <div className="jx-vtitle">JEXI</div>
            <div className="jx-vsub">Your personal AI — it remembers everything and works step by step. Ask anything, or say “build an app”.</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`jx-msg ${msg.role === 'user' ? 'user' : 'jexi'}`}>
            <div className="jx-gutter">{msg.role === 'user' ? 'A' : 'J'}</div>
            <div className="jx-body">
              {msg.image && <img className="jx-img" src={msg.image} alt="attachment" />}
              <SimpleText text={msg.text} />
              {msg.role === 'jexi' && !isProcessing && (
                <div className="jx-feedback">
                  <button
                    type="button"
                    title="Helpful"
                    onClick={async () => {
                      try {
                        await jexiFetch(`${getBackendUrl()}/api/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ conversation: getSessionId(), seq: i, rating: 1 }),
                        });
                      } catch (e) { /* noop */ }
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>
                  </button>
                  <button
                    type="button"
                    title="Not helpful"
                    onClick={async () => {
                      try {
                        await jexiFetch(`${getBackendUrl()}/api/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ conversation: getSessionId(), seq: i, rating: -1 }),
                        });
                      } catch (e) { /* noop */ }
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7 0h3a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" /></svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* agent process block while working */}
        {isProcessing && (
          <div className="jx-msg jexi">
            <div className="jx-gutter">J</div>
            <div className="jx-body">
              <ProcessSteps logs={logs} done={false} />
            </div>
          </div>
        )}
      </div>

      {/* flat notices: questions / plan (no cards) */}
      {questions && questions.questions && questions.questions.length > 0 && (
        <div className="jx-notice">
          <div className="nt">JEXI needs your input</div>
          {questions.questions.map((q) => (
            <div key={q.id}>
              <div className="nq">{q.question}</div>
              {q.options && q.options.length > 0 && (
                <div className="opts">
                  {q.options.map((o) => (
                    <button key={o.label} type="button" className="opt" disabled={cardBusy} onClick={() => answerQuestions([{ id: q.id, selected: [o.label] }])}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="custom">
                <input
                  value={customAnswers[q.id] || ''}
                  onChange={(e) => setCustomAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                  placeholder="Type your answer…"
                />
                <button type="button" disabled={cardBusy} onClick={() => answerQuestions([{ id: q.id, selected: [customAnswers[q.id] || ''], custom: customAnswers[q.id] || '' }])}>
                  Answer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {planReview && planReview.plan && (
        <div className="jx-notice">
          <div className="nt">Plan ready — approve to execute</div>
          <div className="plan-text">{planReview.plan}</div>
          <div className="approve-row">
            <button type="button" disabled={cardBusy} onClick={approvePlan}>Approve &amp; execute</button>
            <button type="button" className="ghost" disabled={cardBusy} onClick={onDismissPlan}>Not now</button>
          </div>
        </div>
      )}

      {/* attachment chips */}
      {(fileAttachments.length > 0 || image || uploading) && (
        <div style={{ padding: '10px 24px 0' }}>
          <div className="jx-chips">
            {image && (
              <span className="jx-chip">
                📷 photo
                <button type="button" onClick={() => setImage(null)}>✕</button>
              </span>
            )}
            {fileAttachments.map((a, i) => (
              <span key={i} className="jx-chip">
                {a.kind === 'image' ? '🖼' : '📄'} {a.name}
                <button type="button" onClick={() => setFileAttachments((p) => p.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
            {uploading && <span className="jx-chip">uploading…</span>}
          </div>
        </div>
      )}

      {/* composer */}
      <div className="jx-composer">
        <div className="jx-plus-row">
          <div className="jx-plus-wrap">
            <button type="button" className="jx-plus-top" title="Add photo or file" aria-label="Add" onClick={() => setPlusOpen((o) => !o)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            {plusOpen && (
              <>
                <div className="jx-plus-backdrop" onClick={() => setPlusOpen(false)} />
                <div className="jx-plus-menu">
                  <button
                    type="button"
                    onClick={() => { setPlusOpen(false); photoRef.current?.click(); }}
                  >
                    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></svg>
                    Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPlusOpen(false); fileRef.current?.click(); }}
                  >
                    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                    File
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="jx-bar">
          <textarea
            rows={1}
            value={input}
            placeholder="Ask JEXI anything…"
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          />
          <button type="button" className="jx-send" disabled={!isProcessing && (!input.trim() && !image && !fileAttachments.length)} onClick={isProcessing ? onStop : submit}>
            {isProcessing ? 'Stop' : 'Send'}
          </button>
        </div>
        <div className="jx-hint">JEXI works step by step — you see everything happening · files land in Workshop</div>
      </div>

      <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhotoPicked} />
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onFilesPicked} />
    </div>
  );
}
