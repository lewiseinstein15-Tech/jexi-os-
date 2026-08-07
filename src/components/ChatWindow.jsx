import { useState, useEffect, useRef } from 'react';
import { Send, Square } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

export default function ChatWindow({ messages, isProcessing, onSend, onStop }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    onSend(input);
    setInput('');
  };

  return (
    <div className="glass p-4 rounded-xl">
      <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider mb-3">JEXI CHAT INTERFACE</h2>
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
                  <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                ) : (
                  <MarkdownRenderer content={msg.text} />
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
                <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" style={{animationDelay: '0.2s'}} />
                <div className="w-2 h-2 rounded-full bg-[#00FF9D] animate-pulse" style={{animationDelay: '0.4s'}} />
              </div>
            </div>
          </div>
        )}
      </div>
      
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message JEXI..."
          className="flex-1 bg-[#0a0a0a] text-gray-200 border border-[#1a1a1a] rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-[#00FF9D]/50"
          disabled={isProcessing}
        />
        <button
          type="submit"
          disabled={isProcessing || !input.trim()}
          className="bg-[#00FF9D] text-black rounded-lg px-4 py-2.5 disabled:opacity-30"
        >
          {isProcessing ? <Square className="w-4 h-4" onClick={onStop} /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}
