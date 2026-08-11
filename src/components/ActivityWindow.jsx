import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Terminal, Activity, ChevronDown, Cpu, Radio } from 'lucide-react';

function StatusPill({ icon: Icon, label, value, tone, pulse }) {
  const tones = {
    good: 'text-[#00FF9D] border-[#00FF9D]/30 bg-[#00FF9D]/10',
    warn: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    dim: 'text-gray-500 border-[#1c1c1c] bg-[#0a0a0a]',
  };
  return (
    <div className={`rounded-xl border px-2 py-2 text-center transition-colors duration-200 hover:brightness-125 ${tones[tone]}`}>
      <div className="w-6 h-6 mx-auto mb-1 rounded-md bg-black/25 border border-white/10 flex items-center justify-center">
        <Icon className={`w-3 h-3 ${pulse ? 'animate-pulse' : ''}`} />
      </div>
      <p className="text-[7px] font-bold tracking-wider opacity-60">{label}</p>
      <p className="text-[9px] font-black mt-0.5">{value}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[8px] font-bold tracking-wider transition-all duration-200 ${
        active
          ? 'bg-[#00FF9D]/15 text-[#00FF9D] border border-[#00FF9D]/35 shadow-[0_0_14px_rgba(0,255,157,0.15)]'
          : 'text-gray-500 border border-transparent hover:text-gray-300 hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  );
}

// Agent → stream color. Covers the specialist sprint team (01-09), the search
// and news sub-teams, and the memory / computer-use / vision specialists.
const AGENT_COLORS = {
  Error: 'text-red-500',
  Output: 'text-blue-400',
  Terminal: 'text-yellow-400',
  Runner: 'text-purple-400',
  Product: 'text-amber-300',
  Designer: 'text-pink-400',
  Engineer: 'text-violet-300',
  Coder: 'text-green-400',
  Architect: 'text-green-400',
  'QA Lead': 'text-amber-400',
  Reviewer: 'text-blue-300',
  'Security Officer': 'text-red-400',
  Shipper: 'text-orange-400',
  Reflector: 'text-teal-300',
  Debugger: 'text-orange-400',
  'Memory Agent': 'text-pink-400',
  'Query Analyzer': 'text-sky-300',
  Searcher: 'text-cyan-400',
  'Re-Ranker': 'text-blue-300',
  ReRanker: 'text-blue-300',
  Search: 'text-cyan-400',
  Extractor: 'text-cyan-400',
  Synthesizer: 'text-indigo-300',
  Reasoner: 'text-indigo-400',
  Researcher: 'text-teal-400',
  Scholar: 'text-emerald-400',
  News: 'text-emerald-400',
  'News Scout': 'text-emerald-300',
  'News Filter': 'text-lime-400',
  'News Editor': 'text-green-300',
  ComputerUseAgent: 'text-emerald-400',
  Navigator: 'text-cyan-300',
  Vision: 'text-purple-400',
  Planner: 'text-cyan-400',
  'GitHub Agent': 'text-slate-200',
  'Data Analyst': 'text-cyan-300',
  'DevOps Agent': 'text-sky-400',
  'Technical Writer': 'text-amber-300',
  Translator: 'text-emerald-300',
  'Performance Engineer': 'text-lime-400',
  JEXI: 'text-[#00FF9D]',
  System: 'text-gray-500',
};

function StreamView({ logs, isProcessing }) {
  // Auto-scroll the live stream to the newest event — JEXI's work must stay
  // visible as it streams in, never leave you chasing the scrollbar.
  const streamRef = useRef(null);
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [logs, isProcessing]);

  return (
    <div ref={streamRef} className="bg-black/40 border border-white/[0.05] p-3 rounded-lg max-h-44 overflow-y-auto font-mono text-[10px] space-y-1">
      {logs.length === 0 && !isProcessing ? (
        <p className="text-gray-700 italic flex items-center gap-1.5">
          Awaiting commands
          <span className="text-[#00FF9D] animate-pulse">▊</span>
        </p>
      ) : (
        logs.map((log, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-2 leading-tight"
          >
            <span className={`font-bold flex-shrink-0 ${AGENT_COLORS[log.agent] || 'text-gray-500'}`}>
              [{log.agent}]
            </span>
            <span className="text-gray-300 break-all flex-1">{log.message}</span>
          </motion.div>
        ))
      )}
      {isProcessing && (
        <div className="flex gap-2">
          <span className="text-[#00FF9D] animate-pulse">▊</span>
        </div>
      )}
    </div>
  );
}

function SitesView({ websites }) {
  if (websites.length === 0) {
    return (
      <div className="bg-black/40 border border-white/[0.05] rounded-lg p-4 text-center">
        <Globe className="w-4 h-4 mx-auto mb-2 text-gray-700" />
        <p className="text-[9px] text-gray-700 italic">No active connections — JEXI will show sites she visits here</p>
      </div>
    );
  }
  return (
    <div className="space-y-1 max-h-44 overflow-y-auto">
      {websites.map((site, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 text-[9px] bg-[#0a0a0a] p-2 rounded border border-[#111]"
        >
          <img src={site.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white truncate font-medium">{site.title}</p>
            <p className="text-gray-600 truncate">{site.url}</p>
          </div>
          <span className="text-[#00FF9D] font-bold text-[8px]">READ</span>
        </motion.div>
      ))}
    </div>
  );
}

export default function ActivityWindow({ logs, websites, isProcessing, compact }) {
  const [tab, setTab] = useState('stream');
  // Idle = collapsed (the chat owns the screen). Working = auto-expand so you
  // can watch JEXI's agents run — it never blocks the chat below it.
  const [userToggled, setUserToggled] = useState(false);
  const expanded = compact
    ? userToggled || isProcessing || logs.length > 0 || websites.length > 0
    : userToggled || logs.length > 0 || websites.length > 0;

  const toggle = () => {
    setUserToggled((v) => !v);
  };

  return (
    <div className="space-y-3">
      {/* SYSTEM STATUS strip — compact in app mode so it never steals the screen */}
      <div className={`glass ${compact ? 'p-2.5' : 'p-3'} rounded-xl flex-shrink-0`}>
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#00FF9D]" />
          <h2 className="text-[9px] font-bold text-[#00FF9D] tracking-wider">SYSTEM STATUS</h2>
          <button
            onClick={toggle}
            className="ml-auto text-gray-500 hover:text-[#00FF9D] transition-colors p-1"
            title={expanded ? 'Hide activity' : 'Show activity'}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <StatusPill
            icon={Cpu}
            label="BRAIN"
            value={isProcessing ? 'WORKING' : 'ONLINE'}
            tone={isProcessing ? 'warn' : 'good'}
            pulse={isProcessing}
          />
          <StatusPill
            icon={Globe}
            label="SITES"
            value={websites.length > 0 ? `${websites.length} ACTIVE` : 'IDLE'}
            tone={websites.length > 0 ? 'good' : 'dim'}
          />
          <StatusPill
            icon={Radio}
            label="STREAM"
            value={logs.length > 0 ? `${logs.length} EVENTS` : 'STANDBY'}
            tone={logs.length > 0 ? 'good' : 'dim'}
          />
        </div>
      </div>

      {/* Collapsible activity card: live stream + websites */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="glass p-3 rounded-xl">
              <div className="flex items-center gap-1 mb-2.5">
                <TabButton active={tab === 'stream'} onClick={() => setTab('stream')}>
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3 h-3" /> LIVE STREAM
                  </span>
                </TabButton>
                <TabButton active={tab === 'sites'} onClick={() => setTab('sites')}>
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3" /> WEBSITES
                    {websites.length > 0 && (
                      <span className="bg-[#00FF9D] text-black rounded-full px-1.5 text-[7px] font-black">
                        {websites.length}
                      </span>
                    )}
                  </span>
                </TabButton>
              </div>
              {tab === 'stream' ? <StreamView logs={logs} isProcessing={isProcessing} /> : <SitesView websites={websites} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
