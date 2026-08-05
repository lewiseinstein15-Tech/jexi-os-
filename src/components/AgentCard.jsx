import { motion } from 'framer-motion';
import { Brain, Globe, Code2, Play, Database, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const iconMap = { Brain, Globe, Code2, Play, Database };

export default function AgentCard({ agent }) {
  const Icon = iconMap[agent.icon] || Brain;
  const isActive = agent.status === 'working';
  const isCompleted = agent.status === 'completed';
  const isFailed = agent.status === 'failed';

  return (
    <motion.div 
      layout
      className={`relative p-2.5 rounded-xl border overflow-hidden transition-colors duration-300 
      ${isActive ? 'border-[#00FF9D] bg-[#00FF9D11]' : isCompleted ? 'border-[#00ff9d33] bg-black/40' : isFailed ? 'border-red-500 bg-red-900/20' : 'border-[#00ff9d11] bg-black/40'}`}
      animate={{ boxShadow: isActive ? `0 0 15px ${agent.color}44` : '0 0 0px transparent' }}
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: agent.color + '22', color: agent.color }}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-bold tracking-wider truncate" style={{ color: agent.color }}>{agent.name}</p>
          <p className="text-[8px] text-gray-400 truncate">{agent.task}</p>
        </div>
        {isCompleted && <CheckCircle2 className="w-3 h-3 text-[#00FF9D]" />}
        {isFailed && <AlertCircle className="w-3 h-3 text-red-500" />}
        {isActive && <Loader2 className="w-3 h-3 text-[#00FF9D] animate-spin" />}
      </div>
      <div className="mt-2 h-1 bg-black/60 rounded-full overflow-hidden">
        <motion.div 
          className="h-full rounded-full" 
          style={{ backgroundColor: agent.color }}
          animate={{ width: `${agent.progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  );
}
