import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Compass, DraftingCompass, Code2, PlayCircle, Terminal, Bug, Search,
  FileText, BrainCircuit, BookOpen, GraduationCap, Eye, MemoryStick,
  BookMarked, Stethoscope, Sparkles, Cpu, MousePointerClick, CheckCircle2, Loader2,
  Crown, Palette, ShieldAlert, Rocket, RefreshCw, Newspaper, SlidersHorizontal,
  PenLine, Navigation, FileSearch, ArrowUpDown, Github, Database, Container,
  FileCode2, Languages, Gauge,
} from 'lucide-react';

// Every agent the engine can emit, mapped to its icon + color.
// Includes the specialist coding team (01-09), the search team sub-stages,
// the news team sub-stages, and the memory/computer-use/vision specialists.
const AGENT_META = {
  // --- Sprint team (Think → Plan → Build → Test → Review → Ship → Reflect) ---
  Planner: { icon: Compass, color: 'text-cyan-400' },
  Architect: { icon: DraftingCompass, color: 'text-violet-400' },
  Product: { icon: Crown, color: 'text-amber-300' },
  Designer: { icon: Palette, color: 'text-pink-400' },
  Engineer: { icon: DraftingCompass, color: 'text-violet-300' },
  Coder: { icon: Code2, color: 'text-green-400' },
  'QA Lead': { icon: Bug, color: 'text-amber-400' },
  Reviewer: { icon: FileSearch, color: 'text-blue-300' },
  'Security Officer': { icon: ShieldAlert, color: 'text-red-400' },
  Shipper: { icon: Rocket, color: 'text-orange-400' },
  Reflector: { icon: RefreshCw, color: 'text-teal-300' },
  Runner: { icon: PlayCircle, color: 'text-purple-400' },
  Terminal: { icon: Terminal, color: 'text-yellow-400' },
  Debugger: { icon: Bug, color: 'text-orange-400' },
  Output: { icon: Terminal, color: 'text-slate-300' },
  // --- Search team sub-stages ---
  Search: { icon: Search, color: 'text-sky-400' },
  'Query Analyzer': { icon: SlidersHorizontal, color: 'text-sky-300' },
  Searcher: { icon: Search, color: 'text-sky-400' },
  'Re-Ranker': { icon: ArrowUpDown, color: 'text-blue-300' },
  ReRanker: { icon: ArrowUpDown, color: 'text-blue-300' },
  Extractor: { icon: FileText, color: 'text-blue-400' },
  Synthesizer: { icon: PenLine, color: 'text-indigo-300' },
  Reasoner: { icon: BrainCircuit, color: 'text-indigo-400' },
  Researcher: { icon: BookOpen, color: 'text-teal-400' },
  Scholar: { icon: GraduationCap, color: 'text-emerald-400' },
  // --- News team sub-stages ---
  News: { icon: Newspaper, color: 'text-emerald-400' },
  'News Scout': { icon: Newspaper, color: 'text-emerald-300' },
  'News Filter': { icon: SlidersHorizontal, color: 'text-lime-400' },
  'News Editor': { icon: PenLine, color: 'text-green-300' },
  // --- Memory / computer-use / vision specialists ---
  'Memory Agent': { icon: MemoryStick, color: 'text-pink-400' },
  Books: { icon: BookMarked, color: 'text-amber-400' },
  SelfDiagnose: { icon: Stethoscope, color: 'text-rose-400' },
  ComputerUseAgent: { icon: MousePointerClick, color: 'text-emerald-400' },
  Navigator: { icon: Navigation, color: 'text-cyan-300' },
  Vision: { icon: Eye, color: 'text-fuchsia-400' },
  JEXI: { icon: Sparkles, color: 'text-[#00FF9D]' },
  System: { icon: Cpu, color: 'text-gray-400' },
  // --- Specialist team round 2 — the complete JEXI OS roster ---
  'GitHub Agent': { icon: Github, color: 'text-slate-200' },
  'Data Analyst': { icon: Database, color: 'text-cyan-300' },
  'DevOps Agent': { icon: Container, color: 'text-sky-400' },
  'Technical Writer': { icon: FileCode2, color: 'text-amber-300' },
  Translator: { icon: Languages, color: 'text-emerald-300' },
  'Performance Engineer': { icon: Gauge, color: 'text-lime-400' },
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
    <div className="overflow-hidden rounded-lg bg-[#0a0a0c]">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
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

      {isProcessing && <div className="shimmer-bar" />}

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
              className={`flex items-start gap-2.5 px-3 py-2 border-b border-white/[0.04] last:border-0 transition-colors duration-200 ${
                isRunning ? 'bg-[#00FF9D]/[0.05]' : 'hover:bg-white/[0.02]'
              }`}
            >
              {/* icon tile */}
              <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-md bg-white/[0.05] border border-white/[0.06] flex items-center justify-center ${meta.color}`}>
                <Icon className="w-3 h-3" />
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
                <p className={`text-[9px] mt-0.5 leading-snug ${isRunning ? 'text-gray-200' : 'text-gray-500'} break-words`}>
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
          className="px-3 py-2 bg-gradient-to-r from-[#00FF9D]/[0.08] via-[#22d3ee]/[0.05] to-transparent border-t border-[#00FF9D]/20 flex items-center gap-2"
        >
          <Sparkles className="w-3 h-3 text-[#00FF9D]" />
          <span className="text-[8px] font-black text-[#00FF9D] tracking-wider">MISSION COMPLETE</span>
        </motion.div>
      )}
    </div>
  );
}
