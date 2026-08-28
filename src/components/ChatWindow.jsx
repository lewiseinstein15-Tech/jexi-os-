import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, ImagePlus, X, Camera, Stethoscope, Plus, Copy, Check, RefreshCw, Sparkles } from 'lucide-react';
import TypedMessage from './TypedMessage';
import MarkdownRenderer from './MarkdownRenderer';
import VisionPanel from './VisionPanel';
import AgentPipeline from './AgentPipeline';

const SELF_CHECK_QUERY =
  'JEXI, run a full system self-check now. Check your health, memory, eyes and recent errors. If anything is wrong, tell me the exact source file and the fix.';

/* ------------------------------------------------------------------ */
/* Quick-copy helper                                                    */
/* ------------------------------------------------------------------ */
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); return true;
    } catch { return false; }
  }
}



/* ------------------------------------------------------------------ */
/* Quick-action button                                                  */
/* ------------------------------------------------------------------ */
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

const QUICK_ACTIONS = [
  { icon: Camera, label: 'EYES', title: 'Give JEXI eyes — camera vision', action: 'vision' },
  { icon: ImagePlus, label: 'PHOTO', title: 'Attach an image', action: 'photo' },
  { icon: Stethoscope, label: 'CHECK', title: 'Run a self-check — JEXI diagnoses her own system', action: 'check' },
];

/* ------------------------------------------------------------------ */
/* Message Action Bar                                                   */
/* ------------------------------------------------------------------ */
function MessageActions({ text, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wider transition-all duration-200 hover:bg-surface-2"
        style={{
          color: copied ? 'var(--brand)' : 'var(--text-tertiary)',
          border: `1px solid ${copied ? 'rgba(0,210,106,0.3)' : 'transparent'}`,
        }}
        title="Copy response"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-wider text-text-tertiary transition-all duration-200 hover:bg-surface-2 hover:text-text-secondary"
          title="Regenerate response"
        >
          <RefreshCw className="w-3 h-3" />
          Regenerate
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main ChatWindow                                                      */
/* ------------------------------------------------------------------ */
export default function ChatWindow({ messages, logs, isProcessing, onSend, onStop, onVisionResult }) {
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [visionOpen, setVisionOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const qaRef = useRef(null);
  const [narrowQA, setNarrowQA] = useState(false);

  useEffect(() => {
    const el = qaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrowQA(el.clientWidth < 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const runQuickAction = (action) => {
    setQuickOpen(false);
    if (action === 'vision') setVisionOpen(true);
    else if (action === 'photo') fileRef.current?.click();
    else onSend(SELF_CHECK_QUERY);
  };

  // Auto-scroll — but ONLY while the reader is already at the bottom.
  // Fix: the old code forced scrollTop to the bottom on EVERY stream event,
  // so during a long streaming answer any attempt to scroll up was instantly
  // yanked back — the answer was literally unscrollable. Now a scroll listener
  // tracks whether the user is near the bottom (~120px) and only then do we
  // pin to the newest content; scroll up and the view stays exactly where
  // the reader put it.
  const stickToBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
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
    if ((!input.trim() && !image) || isProcessing) return;
    onSend(input, image);
    setInput('');
    setImage(null);
  };

  const canSend = (input.trim() || image) && !isProcessing;

  return (
    <div className="surface-card p-4 rounded-xl relative z-10 flex flex-col flex-1 min-h-0">


      {/* Messages scroll area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="space-y-4 mb-3 flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {messages.length === 0 && !isProcessing ? (
          /* Empty state — minimal welcome, vertically centered */
          <div className="min-h-[55vh] flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5 text-brand" />
            </div>
            <p className="text-[13px] text-text-secondary font-medium mb-1">What can I help with?</p>
            <p className="text-[11px] text-text-tertiary">Ask me anything — code, research, math, creative work, and more.</p>
          </div>
        ) : (
          /* Message list */
          messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                /* ---- USER MESSAGE ---- */
                <div className="max-w-[85%] relative group">
                  <div className="p-3 rounded-lg rounded-tr-sm bg-gradient-to-br from-brand to-[#00B55C] text-[#04140D] font-medium text-[11px] shadow-[0_4px_18px_rgba(0,210,106,0.28)]">
                    <div className="whitespace-pre-wrap break-words">
                      {msg.image && (
                        <img src={msg.image} alt="attachment" className="max-w-[220px] rounded-lg mb-2 border border-black/20" />
                      )}
                      {msg.text}
                    </div>
                  </div>
                </div>
              ) : (
                /* ---- AI MESSAGE ---- */
                <div className="w-full group">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-brand/30 to-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-2.5 h-2.5 text-brand" />
                    </div>
                    <span className="text-[9px] font-bold tracking-[0.18em] text-brand">
                      {msg.streaming && msg.by ? String(msg.by).toUpperCase() : 'JEXI'}
                      {msg.streaming ? ' · WRITING…' : ''}
                    </span>
                  </div>
                  {/* Streaming messages arrive progressively already — render
                      them directly (no typewriter) so the content never
                      re-flows mid-scroll. The typewriter reveal runs once,
                      on the completed answer. */}
                  {msg.streaming ? (
                    <div className="jx-streaming-text">
                      <MarkdownRenderer content={msg.text} size="text-[13px]" />
                      <span className="jx-caret" aria-hidden="true" />
                    </div>
                  ) : (
                    <TypedMessage text={msg.text} size="text-[13px]" />
                  )}
                  <MessageActions text={msg.text} onRegenerate={i === messages.length - 1 ? () => onSend(msg.text) : null} />
                </div>                )}
            </motion.div>
          ))
        )}

        {/* Inline processing indicator — no card, just a streaming line */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="pl-1"
          >
            <AgentPipeline logs={logs} isProcessing />
          </motion.div>
        )}
      </div>

      {/* Image attachment preview */}
      {image && (
        <div className="relative inline-block mb-2 flex-shrink-0">
          <img src={image} alt="attachment" className="w-16 h-16 object-cover rounded-lg border border-brand/40" />
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

      {/* Quick actions */}
      <div ref={qaRef} className="flex gap-1.5 mb-2 flex-shrink-0 min-w-0">
        {narrowQA ? (
          <QuickAction icon={Plus} label="MORE" title="Quick actions" onClick={() => setQuickOpen(true)} />
        ) : (
          QUICK_ACTIONS.map((qa) => (
            <QuickAction key={qa.label} icon={qa.icon} label={qa.label} title={qa.title} onClick={() => runQuickAction(qa.action)} />
          ))
        )}
      </div>

      {/* Input bar */}
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

      {/* Quick-actions bottom sheet */}
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

      <VisionPanel
        open={visionOpen}
        onClose={() => setVisionOpen(false)}
        onVision={(text) => onVisionResult && onVisionResult(text)}
      />
    </div>
  );
}
