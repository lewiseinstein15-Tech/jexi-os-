import { motion, AnimatePresence } from 'framer-motion';
import { Activity } from 'lucide-react';
import AgentCard from './AgentCard';
import AgentTimeline from './AgentTimeline';
import WebsiteCard from './WebsiteCard';
import StatsPanel from './StatsPanel';
import SearchProgress from './SearchProgress';

export default function ActivityWindow({ agents, logs, websites, stats, currentTask, taskProgress }) {
  return (
    <section className="glass p-3 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-[#00FF9D]" />
          <h2 className="text-xs font-semibold text-[#00FF9D]">ACTIVITY WINDOW (LIVE)</h2>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#00ff9d15] border border-[#00ff9d44]">
          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-[#00FF9D]" />
          <span className="text-[9px] font-bold text-[#00FF9D]">LIVE</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 mb-3">
        {agents.map(agent => <AgentCard key={agent.id} agent={agent} />)}
      </div>

      <SearchProgress task={currentTask} progress={taskProgress} />

      <div className="mt-3">
        <StatsPanel stats={stats} />
      </div>

      <div className="mt-3">
        <p className="text-[9px] text-gray-500 mb-2 uppercase tracking-widest">Website Visit Panel</p>
        <AnimatePresence>
          {websites.length === 0 && <p className="text-[10px] text-gray-600 italic">No active connections.</p>}
          {websites.map((site, i) => <WebsiteCard key={i} site={site} />)}
        </AnimatePresence>
      </div>

      <div className="mt-3">
        <AgentTimeline logs={logs} />
      </div>
    </section>
  );
}
