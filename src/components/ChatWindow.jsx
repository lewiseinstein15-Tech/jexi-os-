import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, ImagePlus, X, Camera, Stethoscope, Plus, Copy, Check, RefreshCw, Sparkles } from 'lucide-react';
import TypedMessage from './TypedMessage';
import AgentThinking from './AgentThinking'; // B205 — unified arena-style thinking panel
import OrbCore from './OrbCore'; // B192 — the presence orb (empty state)
import Composer from './Composer'; // B195 — isolated, real-app input
import MarkdownRenderer from './MarkdownRenderer';
import VisionPanel from './VisionPanel';
import TeamLive from './TeamLive'; // B208 — the boss + employees strip (real Director events)
import ComputerPanel from './ComputerPanel'; // B211 B3 — live computer-use telemetry (real events only)

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
export default function ChatWindow({ messages, logs, isProcessing, onSend, onStop, onVisionResult, team, computer }) {
  const [image, setImage] = useState(null);
  const [visionOpen, setVisionOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false); // B193 — + toggle for EYES/PHOTO/CHECK
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

  const handleComposerSend = (t) => {
    if (isProcessing) return; // queueing is handled inside Composer
    onSend(t, image);
    setImage(null);
  };

  return (
    <div className="jx-chatroot">


      {/* Messages scroll area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="space-y-4 mb-3 flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* B208 — TEAM LIVE: the boss + her employees, statuses driven by real
            Director events (assigned → working → delivered → verified). */}
        <TeamLive team={team} live={isProcessing} />
        <ComputerPanel computer={computer} live={isProcessing} />
        {messages.length === 0 && !isProcessing ? (
          /* B192 — ORB HERO: her presence center-stage (the ZOEY_OS look) */
          <div className="jx-orb-wrap">
            <OrbCore size={Math.min(300, 260)} state="idle" label="JEXI CORE" />
            <p className="jx-orb-hello">
              <b>I'm listening.</b> Build something, research anything, watch a video,
              or just talk — I stream every step as I work.
            </p>
            <div className="jx-suggest">
              <button type="button" onClick={() => onSend('build me a quiz app as a web app')}>build an app</button>
              <button type="button" onClick={() => onSend('what is 2/3 + 1/4? show working')}>solve math</button>
              <button type="button" onClick={() => onSend('research the latest AI news')}>research</button>
              <button type="button" onClick={() => onSend('show me a picture of a lion')}>show a picture</button>
            </div>
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
                <div className="w-full min-w-0 group">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-brand/30 to-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-2.5 h-2.5 text-brand" />
                    </div>
                    <span className="text-[9px] font-bold tracking-[0.18em] text-brand jx-writer">
                      {msg.streaming && <span className="dot" aria-hidden="true" />}
                      {msg.streaming && msg.by ? String(msg.by).toUpperCase() : 'JEXI'}
                      {msg.streaming ? ' · WRITING…' : ''}
                    </span>
                  </div>
                  {/* Streaming messages arrive progressively already — render
                      them directly (no typewriter) so the content never
                      re-flows mid-scroll. The typewriter reveal runs once,
                      on the completed answer. */}
                  {/* B205 — UNIFIED ARENA-STYLE THINKING PANEL: narrations +
                      agent/tool activity + reasoning tokens in ONE collapsible
                      block above the answer. Live: "Thinking · 12.3s" open and
                      pulsing; done: "Thought for 43s · 8 agents · 10 sources",
                      collapsed, one tap to review the whole trace. Replaces
                      the old ThinkRow + NarrationFeed + inline ActionFeed. */}
                  <AgentThinking
                    narrations={msg.narrations}
                    activity={msg.activity}
                    thinking={msg.thinking}
                    live={Boolean(msg.streaming)}
                    thinkMs={msg.thinkMs}
                    totalMs={msg.totalMs}
                    by={msg.by}
                    sourceCount={msg.sourceCount}
                  />
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

      {/* B193 — ONE + toggle instead of the EYES/PHOTO/CHECK row */}
      {plusOpen && (
        <div className="jx-plusmenu" role="menu">
          {QUICK_ACTIONS.map((qa) => (
            <button key={qa.label} type="button" role="menuitem" onClick={() => { setPlusOpen(false); runQuickAction(qa.action); }}>
              <qa.icon size={15} strokeWidth={1.8} />
              <span>{qa.label}</span>
              <small>{qa.title}</small>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end mb-2 flex-shrink-0">
        <button
          type="button"
          className={`jx-plusbtn${plusOpen ? ' open' : ''}`}
          aria-label="Camera, photo and self-check"
          aria-expanded={plusOpen}
          onClick={() => setPlusOpen((o) => !o)}
        >
          <Plus size={17} strokeWidth={2.2} style={{ transform: plusOpen ? 'rotate(45deg)' : 'none', transition: 'transform .2s' }} />
        </button>
      </div>

      {/* B195 — isolated composer: typing never re-renders the chat */}
      <Composer isProcessing={isProcessing} onSendText={handleComposerSend} onStop={onStop} />


      <VisionPanel
        open={visionOpen}
        onClose={() => setVisionOpen(false)}
        onVision={(text) => onVisionResult && onVisionResult(text)}
      />
    </div>
  );
}
