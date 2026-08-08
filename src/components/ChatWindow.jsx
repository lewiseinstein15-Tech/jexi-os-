import { useState, useEffect, useRef } from 'react';
import { Send, Square, ImagePlus, X, Camera, Stethoscope } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import TypedMessage from './TypedMessage';
import VisionPanel from './VisionPanel';

const SELF_CHECK_QUERY =
  'JEXI, run a full system self-check now. Check your health, memory, eyes and recent errors. If anything is wrong, tell me the exact source file and the fix.';

function QuickAction({ icon: Icon, label, title, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 bg-[#0f0f0f] hover:bg-[#00FF9D]/10 border border-[#1a1a1a] hover:border-[#00FF9D]/40 text-gray-400 hover:text-[#00FF9D] rounded-lg px-2.5 py-1.5 transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="text-[8px] font-bold tracking-wider">{label}</span>
    </button>
  );
}

export default function ChatWindow({ messages, isProcessing, onSend, onStop, onVisionResult }) {
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [visionOpen, setVisionOpen] = useState(false);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

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
    <div className="glass p-4 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">JEXI CHAT INTERFACE</h2>
        {isProcessing && (
          <span className="ml-auto flex items-center gap-1.5 text-[8px] text-[#00FF9D] font-bold animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00FF9D]" />
            THINKING
          </span>
        )}
      </div>

      <div ref={scrollRef} className="space-y-3 mb-3 max-h-[50vh] overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-gray-600 text-xs italic mb-2">Ready to assist</p>
            <p className="text-[9px] text-gray-700">Ask me to build code, research topics, or learn something new</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] p-3 rounded-lg ${
                msg.role === 'user'
                  ? 'bg-[#00FF9D] text-black font-medium text-[11px]'
                  : 'bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a]'
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
            </div>
          ))
        )}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] p-3 rounded-lg">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" />
                <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Image attachment preview */}
      {image && (
        <div className="relative inline-block mb-2">
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
      <div className="flex gap-1.5 mb-2 flex-wrap">
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

      {/* Input + send */}
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
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
          className="flex-1 bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-[#00FF9D]/50"
          disabled={isProcessing}
        />
        {isProcessing ? (
          <button
            type="button"
            onClick={onStop}
            className="bg-red-500/90 hover:bg-red-500 text-white rounded-lg px-3.5 py-2.5 transition-colors"
            title="Stop"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="bg-[#00FF9D] text-black rounded-lg px-3.5 py-2.5 disabled:opacity-30 transition-opacity"
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
