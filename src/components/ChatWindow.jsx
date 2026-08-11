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
      className="flex items-center gap-1.5 bg-white/[0.04] hover:bg-[#00FF9D]/10 border border-white/[0.07] hover:border-[#00FF9D]/40 text-gray-400 hover:text-[#00FF9D] rounded-lg px-2.5 py-1.5 transition-all duration-200 active:scale-95"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="text-[8px] font-bold tracking-wider">{label}</span>
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
    <div className="glass p-4 rounded-xl relative z-10 flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">JEXI CHAT INTERFACE</h2>
        {isProcessing && (
          <span className="ml-auto flex items-center gap-1.5 text-[8px] text-[#00FF9D] font-bold">
            THINKING
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot w-1 h-1 rounded-full bg-[#00FF9D]"
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
            <p className="text-[9px] font-bold text-[#00FF9D] tracking-widest mb-2 text-center">⚡ WHAT JEXI CAN DO</p>
            <div className="grid grid-cols-2 gap-2">
              {CAPABILITIES.map((c, i) => (
                <motion.button
                  key={c.label}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.25 }}
                  onClick={() => (c.vision ? setVisionOpen(true) : onSend(c.query))}
                  className="group relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#00FF9D]/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.5),0_0_20px_rgba(0,255,157,0.08)] active:scale-[0.98]"
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center transition-transform duration-200 group-hover:scale-110 ${c.tile}`}>
                    <c.icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold text-gray-200 group-hover:text-[#00FF9D]">{c.label}</p>
                    <p className="text-[8px] text-gray-600 truncate">{c.hint}</p>
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
                  ? 'rounded-2xl rounded-tr-md bg-gradient-to-br from-[#00FF9D] to-[#00d68a] text-black font-medium text-[11px] shadow-[0_4px_18px_rgba(0,255,157,0.28)]'
                  : 'rounded-2xl rounded-tl-md bg-[#0d0d11] text-gray-200 border border-white/[0.07] shadow-[0_4px_16px_rgba(0,0,0,0.4)]'
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

      {/* Quick actions — labeled, in their own row */}
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

      {/* Input + send — frosted field with a focus glow, pinned to the bottom */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 items-center rounded-xl border border-white/[0.07] bg-[#0a0a0c] p-1.5 pl-3 flex-shrink-0 transition-all duration-200 focus-within:border-[#00FF9D]/50 focus-within:shadow-[0_0_0_3px_rgba(0,255,157,0.07),0_0_24px_rgba(0,255,157,0.06)]"
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
          className="flex-1 bg-transparent text-gray-200 placeholder-gray-600 rounded-lg py-2 text-xs focus:outline-none"
          disabled={isProcessing}
        />
        {isProcessing ? (
          <button
            type="button"
            onClick={onStop}
            className="bg-gradient-to-br from-red-500/90 to-red-600/90 text-white rounded-lg px-4 py-2.5 transition-all duration-200 hover:scale-105 active:scale-95"
            title="Stop"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="bg-gradient-to-br from-[#00FF9D] to-[#00d68a] text-black rounded-lg px-4 py-2.5 disabled:opacity-30 disabled:hover:scale-100 transition-all duration-200 hover:scale-105 hover:shadow-[0_0_18px_rgba(0,255,157,0.4)] active:scale-95"
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
