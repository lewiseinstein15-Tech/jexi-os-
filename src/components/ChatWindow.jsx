import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Paperclip, Mic, Square } from 'lucide-react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';

export default function ChatWindow({ messages, isProcessing, onSend, onStop }) {
  const [input, setInput] = useState("");
  const chatContainerRef = useRef(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <section className="flex flex-col h-[45vh] glass rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-[#00ff9d15] flex items-center gap-2 shrink-0">
        <span className="text-[#00FF9D] text-sm">💬</span>
        <h2 className="text-xs font-semibold text-[#00FF9D]">JEXI CHAT INTERFACE</h2>
      </div>

      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-3 space-y-4">
        {messages.length === 0 && (
          <div className="text-center opacity-50 py-10">
            <div className="w-12 h-12 rounded-full border-2 border-[#00ff9d44] flex items-center justify-center mx-auto mb-2">
              <span className="text-lg font-bold text-[#00FF9D]">J</span>
            </div>
            <p className="text-xs text-gray-400">Initialize query to begin.</p>
          </div>
        )}
        
        <AnimatePresence>
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
        </AnimatePresence>
        
        {isProcessing && messages[messages.length-1]?.role === 'user' && <TypingIndicator />}
      </div>

      <div className="p-2 border-t border-[#00ff9d15] shrink-0" style={{ paddingBottom: 'calc(0.5rem + var(--safe-bottom))' }}>
        <div className="flex items-center gap-2 bg-black/40 border border-[#00ff9d22] rounded-2xl px-3 py-2">
          <Paperclip className="w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="Ask anything..."
            disabled={isProcessing}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-gray-600 disabled:opacity-50"
          />
          {isProcessing ? (
            <button onClick={onStop} className="p-2 rounded-full bg-red-500 text-white">
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <Mic className="w-4 h-4 text-gray-500" />
              <button onClick={handleSend} disabled={!input.trim()} className="p-2 rounded-full bg-[#00FF9D] text-black disabled:opacity-40">
                <Send className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
