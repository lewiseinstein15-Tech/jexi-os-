import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Send, Square, ImagePlus, X, Camera, Stethoscope, Hammer, Search, GraduationCap, Link2 } from 'lucide-react';
import TypedMessage from './TypedMessage';
import VisionPanel from './VisionPanel';
import AgentPipeline from './AgentPipeline';

const SELF_CHECK_QUERY =
  'JEXI, run a full system self-check now. Check your health, memory, eyes and recent errors. If anything is wrong, tell me the exact source file and the fix.';

// Agent capability launcher shown when the chat is empty — makes JEXI feel
// like a mission control for an agent that can DO things, not a blank chat.
const CAPABILITIES = [
  { icon: Hammer, label: 'BUILD AN APP', hint: 'calculator, tracker, website…', query: 'Build me a calculator web app', tile: 'bg-gradient-to-br from-emerald-400/25 to-emerald-400/5 text-emerald-300 border-emerald-400/25' },
  { icon: Search, label: 'RESEARCH', hint: 'facts, how-to, current events', query: 'Research how solar panels work and explain it to me', tile: 'bg-gradient-to-br from-cyan-400/25 to-cyan-400/5 text-cyan-300 border-cyan-400/25' },
  { icon: GraduationCap, label: 'STUDY', hint: 'deep-learn a topic, save it', query: 'Study the basics of machine learning and save it to my knowledge', tile: 'bg-gradient-to-br from-violet-400/25 to-violet-400/5 text-violet-300 border-violet-400/25' },
  { icon: Link2, label: 'OPEN A LINK', hint: 'YouTube, TikTok, articles', query: 'Open a popular YouTube video about artificial intelligence and tell me what it is about', tile: 'bg-gradient-to-br from-sky-400/25 to-sky-400/5 text-sky-300 border-sky-400/25' },
  { icon: Camera, label: 'USE MY EYES', hint: 'camera vision', vision: true, tile: 'bg-gradient-to-br from-pink-400/25 to-pink-400/5 text-pink-300 border-pink-400/25' },
  { icon: Stethoscope, label: 'SELF-CHECK', hint: 'health + source of issues', query: SELF_CHECK_QUERY, tile: 'bg-gradient-to-br from-amber-400/25 to-amber-400/5 text-amber-300 border-amber-400/25' },
];

function QuickAction({ icon: Icon, label, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center bg-surface-1 hover:bg-brand-dim border border-hairline hover:border-brand-line text-text-secondary hover:text-brand rounded-md transition-all duration-200 active:scale-95"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

export default function ChatWindow({ messages, logs, isProcessing, onSend, onStop, onVisionResult }) {
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [visionOpen, setVisionOpen] = useState(false);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);

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
    if ((!input.trim() && !image) || isProcessing) return;
    onSend(input, image);
    setInput('');
    setImage(null);
  };

  const canSend = (input.trim() || image) && !isProcessing;

  return (
    <div className="surface-card p-4 rounded-xl relative z-10 flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <h2 className="text-[10px] font-bold text-brand tracking-wider">JEXI CHAT INTERFACE</h2>
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
          <div className="py-2">
            <p className="eyebrow mb-3 text-center">⚡ What JEXI can do</p>
            <div className="grid grid-cols-2 gap-3">
              {CAPABILITIES.map((c, i) => (
                <motion.button
                  key={c.label}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.25 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => (c.vision ? setVisionOpen(true) : onSend(c.query))}
                  className="group relative flex items-center gap-2.5 overflow-hidden rounded-lg border border-hairline bg-surface-1 px-3 py-3 text-left transition-all duration-200 hover:border-hairline-strong active:scale-[0.98]"
                >
                  <div className={`flex-shrink-0 w-10 h-10 rounded-md border flex items-center justify-center transition-transform duration-200 group-hover:scale-110 ${c.tile}`}>
                    <c.icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-text-primary group-hover:text-brand">{c.label}</p>
                    <p className="text-[10px] text-text-tertiary truncate">{c.hint}</p>
                  </div>
                </motion.button>
              ))}
            </div>
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
              <div className={`max-w-[90%] p-3 ${
                msg.role === 'user'
                  ? 'rounded-lg rounded-tr-sm bg-gradient-to-br from-brand to-[#00D98A] text-[#04140D] font-medium text-[11px] shadow-[0_4px_18px_rgba(0,255,157,0.28)]'
                  : 'rounded-lg rounded-tl-sm bg-surface-1 text-text-primary border border-hairline'
              }`}>
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap break-words">
                    {msg.image && <img src={msg.image} alt="attachment" className="max-w-[220px] rounded-lg mb-2 border border-black/20" />}
                    {msg.text}
                  </div>
                ) : (
                  <TypedMessage text={msg.text} />
                )}
              </div>
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

      {/* Image attachment preview */}
      {image && (
        <div className="relative inline-block mb-2 flex-shrink-0">
          <img src={image} alt="attachment" className="w-16 h-16 object-cover rounded-lg border border-[#00FF9D]/40" />
          <button
            type="button"
            onClick={() => setImage(null)}
            className="absolute -top-2 -right-2 bg-black border border-gray-700 rounded-full p-0.5 text-gray-400 hover:text-white"
            title="Remove attachment"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Quick actions — labeled icon chips (spec §3A) */}
      <div className="flex gap-1.5 mb-2 flex-wrap flex-shrink-0">
        <QuickAction
          icon={Camera}
          label="EYES"
          title="Give JEXI eyes — camera vision"
          onClick={() => setVisionOpen(true)}
        />
        <QuickAction
          icon={ImagePlus}
          label="PHOTO"
          title="Attach an image"
          onClick={() => fileRef.current?.click()}
        />
        <QuickAction
          icon={Stethoscope}
          label="CHECK"
          title="Run a self-check — JEXI diagnoses her own system"
          onClick={() => onSend(SELF_CHECK_QUERY)}
        />
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

      <VisionPanel
        open={visionOpen}
        onClose={() => setVisionOpen(false)}
        onVision={(text) => onVisionResult && onVisionResult(text)}
      />
    </div>
  );
}
