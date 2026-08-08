import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Terminal, Activity, ChevronDown, Cpu, Radio } from 'lucide-react';

function StatusPill({ icon: Icon, label, value, tone, pulse }) {
  const tones = {
    good: 'text-[#00FF9D] border-[#00FF9D]/30 bg-[#00FF9D]/10',
    warn: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    dim: 'text-gray-500 border-[#1c1c1c] bg-[#0a0a0a]',
  };
  return (
    <div className={`rounded-lg border px-2 py-2 text-center ${tones[tone]}`}>
      <Icon className={`w-3 h-3 mx-auto mb-1 ${pulse ? 'animate-pulse' : ''}`} />
      <p className="text-[7px] font-bold tracking-wider opacity-60">{label}</p>
      <p className="text-[9px] font-black mt-0.5">{value}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[8px] font-bold tracking-wider transition-colors ${
        active
          ? 'bg-[#00FF9D]/15 text-[#00FF9D] border border-[#00FF9D]/30'
          : 'text-gray-500 border border-transparent hover:text-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

function StreamView({ logs, isProcessing }) {
  return (
    <div className="bg-[#050505] p-3 rounded-lg max-h-44 overflow-y-auto font-mono text-[10px] space-y-1">
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
            <span className={`font-bold flex-shrink-0 ${
              log.agent === 'Error' ? 'text-red-500' :
              log.agent === 'Output' ? 'text-blue-400' :
              log.agent === 'Terminal' ? 'text-yellow-400' :
              log.agent === 'Runner' ? 'text-purple-400' :
              log.agent === 'Coder' || log.agent === 'Architect' ? 'text-green-400' :
              log.agent === 'Debugger' ? 'text-orange-400' :
              log.agent === 'Memory Agent' ? 'text-pink-400' :
              log.agent === 'Search' || log.agent === 'Extractor' ? 'text-cyan-400' :
              log.agent === 'Reasoner' ? 'text-indigo-400' :
              log.agent === 'Researcher' ? 'text-teal-400' :
              log.agent === 'Scholar' ? 'text-emerald-400' :
              'text-gray-500'
            }`}>
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
      <div className="bg-[#050505] rounded-lg p-4 text-center">
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

export default function ActivityWindow({ logs, websites, isProcessing }) {
  const [tab, setTab] = useState('stream');
  const [expanded, setExpanded] = useState(logs.length > 0 || websites.length > 0);

  return (
    <div className="space-y-3">
      {/* SYSTEM STATUS strip */}
      <div className="glass p-3 rounded-xl">
        <div className="flex items-center gap-2 mb-2.5">
          <Activity className="w-4 h-4 text-[#00FF9D]" />
          <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">SYSTEM STATUS</h2>
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto text-gray-500 hover:text-[#00FF9D] transition-colors p-1"
            title={expanded ? 'Hide activity' : 'Show activity'}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
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
