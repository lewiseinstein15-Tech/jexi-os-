import { motion } from 'framer-motion';
import { Globe, Terminal, Activity } from 'lucide-react';

export default function ActivityWindow({ logs, websites, isProcessing }) {
  return (
    <div className="space-y-3">
      {/* WEBSITE VISIT PANEL */}
      <div className="glass p-3 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-4 h-4 text-[#00d4ff]" />
          <h2 className="text-[10px] font-bold text-[#00d4ff] tracking-wider">WEBSITE VISIT PANEL</h2>
          {websites.length > 0 && (
            <span className="ml-auto text-[9px] text-[#00d4ff] font-bold">
              {websites.length} ACTIVE
            </span>
          )}
        </div>
        <div className="space-y-1 max-h-28 overflow-y-auto">
          {websites.length === 0 ? (
            <p className="text-[9px] text-gray-700 italic px-2 py-1">No active connections</p>
          ) : (
            websites.map((site, i) => (
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
            ))
          )}
        </div>
      </div>

      {/* LIVE SYSTEM STREAM */}
      <div className="glass p-3 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="w-4 h-4 text-[#00FF9D]" />
          <h2 className="text-[10px] font-bold text-[#00FF9D] tracking-wider">LIVE SYSTEM STREAM</h2>
          {isProcessing && (
            <span className="ml-auto text-[9px] text-[#00FF9D] animate-pulse font-bold">
              ● PROCESSING
            </span>
          )}
        </div>
        <div className="bg-[#050505] p-3 rounded-lg max-h-64 overflow-y-auto font-mono text-[10px] space-y-1">
          {logs.length === 0 && !isProcessing ? (
            <p className="text-gray-700 italic">Awaiting commands...</p>
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
      </div>
    </div>
  );
}
