import { motion } from 'framer-motion';
import { Clock, FileText, Target, Cpu, HardDrive, Zap } from 'lucide-react';

export default function StatsPanel({ stats }) {
  const items = [
    { label: 'Duration', value: `${stats.duration}s`, icon: Clock, color: '#00FF9D' },
    { label: 'Words', value: stats.words, icon: FileText, color: '#22c55e' },
    { label: 'Sources', value: stats.sources, icon: Target, color: '#3b82f6' },
    { label: 'Confidence', value: `${stats.confidence}%`, icon: Zap, color: '#a855f7' },
    { label: 'Tokens', value: stats.tokens, icon: Cpu, color: '#f59e0b' },
    { label: 'Memory', value: `${stats.memory}MB`, icon: HardDrive, color: '#ef4444' },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <motion.div 
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-2 rounded-lg flex flex-col items-center justify-center"
          >
            <Icon className="w-3.5 h-3.5 mb-1" style={{ color: item.color }} />
            <span className="text-[11px] font-bold text-white">{item.value}</span>
            <span className="text-[8px] text-gray-500 uppercase tracking-wider">{item.label}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
