import { motion } from 'framer-motion';

export default function SearchProgress({ task, progress }) {
  if (!task) return null;
  return (
    <div className="bg-black/30 rounded-xl border border-[#00ff9d22] p-3">
      <p className="text-[10px] text-gray-300 truncate mb-2">◎ {task}</p>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-black/50 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-gradient-to-r from-[#00FF9D] to-[#00d4ff] rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <span className="text-[9px] text-[#00FF9D] font-mono w-8 text-right">{progress}%</span>
      </div>
    </div>
  );
}
