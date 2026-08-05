import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';

export default function AgentTimeline({ logs }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div ref={containerRef} className="bg-black/40 rounded-xl border border-[#00ff9d15] p-3 h-48 overflow-y-auto font-mono text-[11px] scroll-smooth">
      <p className="text-[9px] text-gray-500 mb-2 uppercase tracking-widest">Live System Stream</p>
      <AnimatePresence initial={false}>
        {logs.length === 0 && <p className="text-gray-600 italic">Awaiting input...</p>}
        {logs.map(log => (
          <motion.div 
            key={log.id} 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-1.5 flex gap-2"
          >
            <span className="text-gray-600 shrink-0">{log.time}</span>
            <span className="text-[#00FF9D] shrink-0">{log.agent}:</span>
            <span className="text-gray-300 break-all">{log.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
