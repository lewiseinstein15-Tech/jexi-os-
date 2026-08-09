import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Compass, DraftingCompass, Code2, PlayCircle, Terminal, Bug, Search,
  FileText, BrainCircuit, BookOpen, GraduationCap, Eye, MemoryStick,
  BookMarked, Stethoscope, Sparkles, Cpu, MousePointerClick, CheckCircle2, Loader2,
} from 'lucide-react';

const AGENT_META = {
  Planner: { icon: Compass, color: 'text-cyan-400' },
  Architect: { icon: DraftingCompass, color: 'text-violet-400' },
  Coder: { icon: Code2, color: 'text-green-400' },
  Runner: { icon: PlayCircle, color: 'text-purple-400' },
  Terminal: { icon: Terminal, color: 'text-yellow-400' },
  Debugger: { icon: Bug, color: 'text-orange-400' },
  Search: { icon: Search, color: 'text-sky-400' },
  Extractor: { icon: FileText, color: 'text-blue-400' },
  Reasoner: { icon: BrainCircuit, color: 'text-indigo-400' },
  Researcher: { icon: BookOpen, color: 'text-teal-400' },
  Scholar: { icon: GraduationCap, color: 'text-emerald-400' },
  Vision: { icon: Eye, color: 'text-fuchsia-400' },
  'Memory Agent': { icon: MemoryStick, color: 'text-pink-400' },
  Books: { icon: BookMarked, color: 'text-amber-400' },
  SelfDiagnose: { icon: Stethoscope, color: 'text-rose-400' },
  JEXI: { icon: Sparkles, color: 'text-[#00FF9D]' },
  System: { icon: Cpu, color: 'text-gray-400' },
  ComputerUseAgent: { icon: MousePointerClick, color: 'text-emerald-400' },
};
const FALLBACK = { icon: Bot, color: 'text-gray-400' };

/**
 * Live agent pipeline — shows exactly which agent is doing what, in order,
 * with a spinner on the active step and a checkmark on completed ones.
 * Turns JEXI from "chatbot with dots" into a visibly-working agent.
 */
export default function AgentPipeline({ logs = [], isProcessing }) {
  // Preserve first-seen order of agents; keep their latest message.
  const order = [];
  const byAgent = {};
  for (const log of logs) {
    if (!log || !log.agent) continue;
    if (!byAgent[log.agent]) { byAgent[log.agent] = []; order.push(log.agent); }
    byAgent[log.agent].push(log.message);
  }

  return (
    <div className="overflow-hidden rounded-lg">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0d0d0d] border-b border-[#161616]">
        <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
          <span className={`absolute inline-flex w-full h-full rounded-full bg-[#00FF9D] opacity-60 ${isProcessing ? 'animate-ping' : ''}`} />
          <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#00FF9D]" />
        </span>
        <span className="text-[8px] font-black text-[#00FF9D] tracking-widest">
          {isProcessing ? 'JEXI AT WORK' : 'AGENT RUN'}
        </span>
        {isProcessing && <span className="ml-auto text-[8px] text-gray-500 font-bold animate-pulse">LIVE</span>}
        {!isProcessing && order.length > 0 && (
          <span className="ml-auto text-[8px] text-[#22c55e] font-black">✓ {order.length} STEP{order.length > 1 ? 'S' : ''}</span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {order.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 py-3 flex items-center gap-2">
            <Loader2 className="w-3 h-3 text-[#00FF9D] animate-spin" />
            <span className="text-[9px] text-gray-500 italic">Assembling agents…</span>
          </motion.div>
        )}

        {order.map((agent, i) => {
          const meta = AGENT_META[agent] || FALLBACK;
          const Icon = meta.icon;
          const lastMsg = byAgent[agent][byAgent[agent].length - 1];
          const isRunning = isProcessing && i === order.length - 1;
          return (
            <motion.div
              key={agent}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-start gap-2.5 px-3 py-2 border-b border-[#121212] last:border-0 bg-[#0a0a0a]"
            >
              <div className={`mt-0.5 flex-shrink-0 ${meta.color}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-black tracking-wider ${meta.color}`}>{agent.toUpperCase()}</span>
                  {isRunning ? (
                    <Loader2 className="w-3 h-3 text-[#00FF9D] animate-spin flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 text-[#22c55e] flex-shrink-0" />
                  )}
                </div>
                <p className={`text-[9px] mt-0.5 leading-snug ${isRunning ? 'text-gray-300' : 'text-gray-500'} break-words`}>
                  {lastMsg}
                </p>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {!isProcessing && order.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-3 py-2 bg-[#00FF9D]/5 border-t border-[#00FF9D]/15 flex items-center gap-2"
        >
          <Sparkles className="w-3 h-3 text-[#00FF9D]" />
          <span className="text-[8px] font-black text-[#00FF9D] tracking-wider">MISSION COMPLETE</span>
        </motion.div>
      )}
    </div>
  );
}
