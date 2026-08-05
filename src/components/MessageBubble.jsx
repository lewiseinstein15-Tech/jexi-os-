import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Copy, RefreshCw, Download } from 'lucide-react';
import SourceCard from './SourceCard';

export default function MessageBubble({ msg, onRegenerate }) {
  const isUser = msg.role === 'user';
  
  const copyToClipboard = () => navigator.clipboard.writeText(msg.content);
  
  const downloadNotes = () => {
    const blob = new Blob([msg.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `JEXI_Notes_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full border border-[#00ff9d44] bg-[#00ff9d11] flex items-center justify-center shrink-0 mt-1">
          <span className="text-[10px] font-bold text-[#00FF9D]">J</span>
        </div>
      )}
      
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${isUser ? 'bg-[#00ff9d18] border border-[#00ff9d33]' : 'bg-[#0d1a0d] border border-[#00ff9d15]'}`}>
        {isUser ? (
          <p className="text-xs text-gray-100 whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeHighlight]}
            >
              {msg.content}
            </ReactMarkdown>
            {msg.streaming && <span className="inline-block w-2 h-3 bg-[#00FF9D] animate-pulse ml-1" />}
            
            {msg.sources && msg.sources.length > 0 && !msg.streaming && (
              <div className="mt-3 pt-3 border-t border-[#00ff9d15]">
                <p className="text-[10px] font-bold text-[#00FF9D] mb-2 uppercase tracking-widest">Verified Sources</p>
                {msg.sources.slice(0, 4).map((s, i) => <SourceCard key={i} source={s} index={i} />)}
              </div>
            )}
          </div>
        )}
        
        <div className="flex items-center justify-between mt-2">
          <p className="text-[9px] text-gray-500">{msg.time}</p>
          {!isUser && !msg.streaming && (
            <div className="flex gap-3">
              <button onClick={downloadNotes} className="text-gray-500 hover:text-[#00FF9D] transition-colors flex items-center gap-1">
                <Download className="w-3 h-3" /> <span className="text-[9px]">Notes</span>
              </button>
              <button onClick={copyToClipboard} className="text-gray-500 hover:text-[#00FF9D] transition-colors">
                <Copy className="w-3 h-3" />
              </button>
              {onRegenerate && (
                <button onClick={onRegenerate} className="text-gray-500 hover:text-[#00FF9D] transition-colors">
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
