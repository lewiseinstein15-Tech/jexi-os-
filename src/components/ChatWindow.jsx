import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, ImagePlus, X, Stethoscope, Plus, Paperclip, FileText, Bot, MessageCircle, Loader2, ThumbsUp, ThumbsDown , Zap } from 'lucide-react';
import { getBackendUrl, jexiFetch, getSessionId } from '../utils/helpers';
import TypedMessage from './TypedMessage';
import AgentPipeline from './AgentPipeline';

const FEEDBACK_ICON = 'text-text-tertiary hover:text-brand';

const SELF_CHECK_QUERY =
  'JEXI, run a full system self-check now. Check your health, memory, eyes and recent errors. If anything is wrong, tell me the exact source file and the fix.';

function QuickAction({ icon: Icon, label, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className="w-10 h-10 flex items-center justify-center bg-surface-1 hover:bg-brand-dim border border-hairline hover:border-brand-line text-text-secondary hover:text-brand rounded-md transition-all duration-200 active:scale-95"
    >
      <Icon className="w-4 h-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

// §7: on narrow screens (<340px available width) the quick-action row collapses
// into a single "+" that opens the actions in a bottom sheet — tap targets stay
// >=40px and the row never squishes.
const QUICK_ACTIONS = [
  { icon: ImagePlus, label: 'PHOTO', title: 'Attach a photo (image analysis)', action: 'photo' },
  { icon: Paperclip, label: 'FILE', title: 'Attach any file (PDF, code, text…)', action: 'file' },
  { icon: Stethoscope, label: 'CHECK', title: 'Run a self-check — JEXI diagnoses her own system', action: 'check' },
];

// B92 — MODE TOGGLE: Agent mode (full multi-agent team) vs Normal mode

export default function ChatWindow({
  messages, logs, isProcessing, onSend, onStop,
  questions, onDismissQuestions, planReview, onDismissPlan,
}) {
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [fileAttachments, setFileAttachments] = useState([]); // { id, name, kind }
  const [uploading, setUploading] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [customAnswers, setCustomAnswers] = useState({}); // B110 — question card custom inputs
  const [cardBusy, setCardBusy] = useState(false);

  // B110 — record answers to the model's pending questions, then nudge the
  // loop to continue with them (dsh tool-ask-user: answer feeds the loop).
  const answerQuestions = async (answers) => {
    setCardBusy(true);
    try {
      const conv = (questions && questions.conv) || getSessionId();
      await jexiFetch(`${getBackendUrl()}/api/questions/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conv, answers }),
      });
      onDismissQuestions && onDismissQuestions(null);
      onSend('Please continue — here are my answers to your questions.');
    } catch (e) { /* noop */ }
    setCardBusy(false);
  };

  // B110 — approve a presented plan (plan mode → implementation).
  const approvePlanNow = async () => {
    setCardBusy(true);
    try {
      const conv = (planReview && planReview.conv) || getSessionId();
      await jexiFetch(`${getBackendUrl()}/api/plan/${conv}/approve`, { method: 'POST' });
      onDismissPlan && onDismissPlan(null);
      onSend('approve the plan');
    } catch (e) { /* noop */ }
    setCardBusy(false);
  };
  const fileRef = useRef(null);   // photo (image/*)
  const anyFileRef = useRef(null); // any file
  const scrollRef = useRef(null);
  const qaRef = useRef(null);
  const [narrowQA, setNarrowQA] = useState(false);

  // §7: measure the quick-action row's real available width — below 340px it
  // collapses to a single "+" that opens the actions in a sheet.
  useEffect(() => {
    const el = qaRef.current;
    if (!el) return;
    // Feature-guard: ResizeObserver needs Chrome 64+; on older WebViews fall
    // back to a window resize listener so the app still boots.
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => setNarrowQA(el.clientWidth < 340);
      window.addEventListener('resize', onResize);
      onResize();
      return () => window.removeEventListener('resize', onResize);
    }
    const ro = new ResizeObserver(() => setNarrowQA(el.clientWidth < 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const runQuickAction = (action) => {
    setQuickOpen(false);
    if (action === 'photo') fileRef.current?.click();
    else if (action === 'file') anyFileRef.current?.click();
    else onSend(SELF_CHECK_QUERY);
  };

  // Upload an arbitrary file → backend → keep { id, name } to send with the message.
  const handleAnyFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('File too large (max 25 MB)'); return; }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const res = await jexiFetch(`${getBackendUrl()}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: b64 }),
      });
      const d = await res.json();
      if (d.ok) setFileAttachments((prev) => [...prev, { id: d.id, name: d.name, kind: d.kind }]);
      else alert(d.error || 'Upload failed');
    } catch (err) { alert('Upload failed: ' + String(err.message || err)); }
    setUploading(false);
  };

  // Auto-scroll to the newest content: when a new message lands AND while the
  // agent pipeline streams live logs (the "JEXI AT WORK" panel grows as agents
  // run — without `logs` in the deps the view stays stuck and you must scroll
  // by hand during every task).
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing, logs]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if ((!input.trim() && !image && !fileAttachments.length) || isProcessing) return;
    onSend(input, image, fileAttachments.length ? fileAttachments : undefined, mode);
    setInput('');
    setImage(null);
    setFileAttachments([]);
  };

  const canSend = (input.trim() || image || fileAttachments.length) && !isProcessing;

  return (
    <div className="surface-card p-4 rounded-xl relative z-10 flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <h2 className="text-[10px] font-bold text-brand tracking-wider">JEXI CHAT</h2>
        {/* B117 — ONE mode: JEXI decides per query (direct answer or full team). */}
        <span className="flex items-center gap-1 rounded-full border border-brand-line/50 bg-brand-dim/30 px-2.5 py-1 text-[8px] font-black tracking-wider text-brand ml-1">
          <Zap className="w-2.5 h-2.5" /> AUTO · JEXI DECIDES
        </span>
        {isProcessing && (
          <span className="ml-auto flex items-center gap-1.5 text-[8px] text-brand font-bold">
            THINKING
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot w-1 h-1 rounded-full bg-brand"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
          </span>
        )}
      </div>

      <div ref={scrollRef} className="space-y-3 mb-3 flex-1 min-h-0 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="py-2 text-center">
            <p className="text-[11px] text-text-tertiary">💬 Send a message — or use the quick actions below to attach photos/files, use your eyes, or run a self-check.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[85%] p-3 rounded-lg rounded-tr-sm bg-gradient-to-br from-brand to-[#00B55C] text-[#04140D] font-medium text-[11px] shadow-[0_4px_18px_rgba(0,210,106,0.28)]">
                  <div className="whitespace-pre-wrap break-words">
                    {msg.image && <img src={msg.image} alt="attachment" className="max-w-[220px] rounded-lg mb-2 border border-black/20" />}
                    {msg.text}
                  </div>
                </div>
              ) : (
                // Build 48, P4 — JEXI's answers live in a large open reading
                // area, NOT a small boxed bubble: full width, no border/panel,
                // larger type. Only the sender chip marks who is talking.
                <div className="w-full">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand shadow-[0_0_8px_rgba(0,255,157,0.8)]" />
                    <span className="text-[9px] font-bold tracking-[0.18em] text-brand">JEXI</span>
                  </div>
                  <TypedMessage text={msg.text} size="text-[13px]" />
                  {!isProcessing && (
                    <div className="flex items-center gap-1 mt-1 opacity-60 hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        aria-label="Helpful"
                        onClick={async () => {
                          try {
                            await jexiFetch(`${getBackendUrl()}/api/feedback`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ conversation: getSessionId(), seq: i, rating: 1 }),
                            });
                          } catch (e) { /* noop */ }
                        }}
                        className={`p-1 rounded ${FEEDBACK_ICON}`}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Not helpful"
                        onClick={async () => {
                          try {
                            await jexiFetch(`${getBackendUrl()}/api/feedback`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ conversation: getSessionId(), seq: i, rating: -1 }),
                            });
                          } catch (e) { /* noop */ }
                        }}
                        className={`p-1 rounded ${FEEDBACK_ICON} hover:text-status-error`}
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ))
        )}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="w-full bg-[#0a0a0c] border border-white/[0.07] rounded-lg overflow-hidden">
              <AgentPipeline logs={logs} isProcessing />
            </div>
          </motion.div>
        )}
      </div>

      {/* File attachment chips (B92 — any file) */}
      {fileAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 flex-shrink-0">
          {fileAttachments.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded-full border border-brand-line bg-brand-dim/30 pl-2 pr-1.5 py-1 text-[9px] text-brand">
              {a.kind === 'image' ? <ImagePlus className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button type="button" onClick={() => setFileAttachments((p) => p.filter((_, j) => j !== i))} className="hover:text-status-error"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {uploading && <span className="flex items-center gap-1 text-[9px] text-text-tertiary"><Loader2 className="w-3 h-3 animate-spin" /> uploading…</span>}
        </div>
      )}

      {/* Image attachment preview */}
      {image && (
        <div className="relative inline-block mb-2 flex-shrink-0">
          <img src={image} alt="attachment" className="w-16 h-16 object-cover rounded-lg border border-[#00D26A]/40" />
          <button
            type="button"
            onClick={() => setImage(null)}
            className="tap-target absolute -top-2 -right-2 w-7 h-7 flex items-center justify-center bg-black border border-gray-700 rounded-full text-gray-400 hover:text-white"
            title="Remove attachment"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* B110 — ask_user_question card (dsh tool-ask-user): the model parked
          questions; the user answers inline and the loop continues. */}
      {questions && questions.questions && questions.questions.length > 0 && (
        <div className="rounded-xl border border-brand-line/60 bg-brand-dim/20 p-3 mb-2 flex-shrink-0 max-h-56 overflow-y-auto">
          <p className="text-[9px] font-black tracking-[0.16em] text-brand mb-2 flex items-center gap-1.5">
            <MessageCircle className="w-3 h-3" /> JEXI NEEDS YOUR INPUT
          </p>
          <div className="space-y-2.5">
            {questions.questions.map((q, qi) => (
              <div key={q.id} className="rounded-lg bg-surface-2 border border-hairline p-2.5">
                <p className="text-[10px] text-text-primary font-semibold">{q.question}</p>
                {q.options && q.options.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {q.options.map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        disabled={cardBusy}
                        onClick={() => answerQuestions([{ id: q.id, selected: [o.label] }])}
                        className="px-2 py-1 rounded-md border border-brand-line text-brand bg-brand-dim/40 text-[9px] font-bold hover:brightness-110 disabled:opacity-50"
                      >
                        {o.label}
                        {o.description ? <span className="block font-normal text-text-tertiary text-[7px] mt-0.5 max-w-[160px]">{o.description}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex gap-1">
                  <input
                    value={customAnswers[q.id] || ''}
                    onChange={(e) => setCustomAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                    placeholder="Or type your own answer…"
                    className="flex-1 bg-surface-1 border border-hairline rounded-md px-2 py-1.5 text-[10px] text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand-line"
                  />
                  <button
                    type="button"
                    disabled={cardBusy || !(customAnswers[q.id] || '').trim()}
                    onClick={() => answerQuestions([{ id: q.id, selected: [], custom: (customAnswers[q.id] || '').trim() }])}
                    className="px-2.5 py-1 rounded-md bg-brand text-[#04140D] text-[9px] font-bold hover:brightness-110 disabled:opacity-50"
                  >
                    SEND
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B110 — plan-mode review card (dsh exit_plan_mode): approve to start
          implementation, or revise with feedback. */}
      {planReview && planReview.plan && (
        <div className="rounded-xl border border-brand-line/60 bg-brand-dim/20 p-3 mb-2 flex-shrink-0 max-h-64 overflow-y-auto">
          <p className="text-[9px] font-black tracking-[0.16em] text-brand mb-1.5 flex items-center gap-1.5">
            <Bot className="w-3 h-3" /> PLAN READY FOR REVIEW
          </p>
          <p className="text-[8px] text-text-tertiary mb-1.5">Plan for visibility — execution continues automatically and updates stream below. The live preview link arrives with the implementation.</p>
          <pre className="text-[10px] text-text-secondary leading-relaxed whitespace-pre-wrap font-sans max-h-36 overflow-y-auto">{String(planReview.plan).slice(0, 4000)}</pre>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={cardBusy}
              onClick={approvePlanNow}
              className="flex-1 px-2.5 py-2 rounded-md bg-brand text-[#04140D] text-[10px] font-bold hover:brightness-110 disabled:opacity-50"
            >
              ✓ APPROVE & START
            </button>
            <button
              type="button"
              onClick={() => onDismissPlan && onDismissPlan(null)}
              className="flex-1 px-2.5 py-2 rounded-md border border-hairline text-text-secondary text-[10px] font-bold hover:border-hairline-strong"
            >
              SEND CHANGES
            </button>
          </div>
        </div>
      )}

      {/* Quick actions (spec §3A) — §7: collapse to a single "+" below 340px */}
      <div ref={qaRef} className="flex gap-1.5 mb-2 flex-shrink-0 min-w-0">
        {narrowQA ? (
          <QuickAction icon={Plus} label="MORE" title="Quick actions" onClick={() => setQuickOpen(true)} />
        ) : (
          QUICK_ACTIONS.map((qa) => (
            <QuickAction key={qa.label} icon={qa.icon} label={qa.label} title={qa.title} onClick={() => runQuickAction(qa.action)} />
          ))
        )}
      </div>

      {/* Input + send — floating frosted bar with a focus glow, pinned to the bottom */}
      <form
        onSubmit={handleSubmit}
        className="surface-float flex gap-2 items-center rounded-xl p-1.5 pl-3 flex-shrink-0 transition-all duration-200 focus-within:border-brand-line focus-within:shadow-[0_0_0_3px_var(--brand-dim)]"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
        <input ref={anyFileRef} type="file" className="hidden" onChange={handleAnyFile} />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message JEXI..."
          className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary rounded-lg py-2 text-xs focus:outline-none"
          disabled={isProcessing}
        />
        {isProcessing ? (
          <button
            type="button"
            onClick={onStop}
            className="w-10 h-10 flex items-center justify-center bg-status-error/10 text-status-error border border-status-error/40 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
            title="Stop"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-brand text-black disabled:bg-surface-2 disabled:text-text-tertiary transition-all duration-200 hover:scale-105 hover:shadow-[0_0_18px_rgba(0,255,157,0.4)] active:scale-95"
            title="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </form>

      {/* Quick-actions bottom sheet (§7 — sheets, not modals) */}
      <AnimatePresence>
        {quickOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
            onClick={() => setQuickOpen(false)}
          >
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-surface-1 border-t border-hairline rounded-t-xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.4)]"
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-4" />
              <p className="eyebrow mb-2">Quick actions</p>
              <div className="space-y-2">
                {QUICK_ACTIONS.map((qa) => (
                  <button
                    key={qa.label}
                    type="button"
                    onClick={() => runQuickAction(qa.action)}
                    className="w-full flex items-center gap-3 bg-surface-2 border border-hairline hover:border-brand-line rounded-lg px-3 py-3 text-left transition-colors"
                  >
                    <span className="w-10 h-10 flex items-center justify-center bg-surface-1 border border-hairline rounded-md text-text-secondary">
                      <qa.icon className="w-4 h-4" />
                    </span>
                    <span>
                      <span className="block text-[12px] font-semibold text-text-primary">{qa.label}</span>
                      <span className="block text-[10px] text-text-tertiary">{qa.title}</span>
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
