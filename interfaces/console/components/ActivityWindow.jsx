import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Terminal, Cpu, ChevronDown, Radio, ExternalLink } from 'lucide-react';

export const AGENT_COLORS = {
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
  JEXI: 'text-brand',
  System: 'text-gray-500',
  'Fact Checker': 'text-violet-300',
  Critic: 'text-violet-300',
};

function StatusPill({ icon: Icon, label, value, active, pulse, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap-target flex items-center gap-2 rounded-md px-2.5 py-1.5 border transition-all duration-200 active:scale-95 ${
        active
          ? 'bg-brand-dim border-brand-line text-brand'
          : 'bg-surface-1 border-hairline text-text-secondary hover:border-hairline-strong'
      }`}
    >
      <Icon className={`w-3 h-3 ${pulse ? 'animate-pulse' : ''}`} />
      <span className="text-[8px] font-bold tracking-wider">{label}</span>
      <span className="text-[9px] font-black ml-auto">{value}</span>
    </button>
  );
}

function StreamView({ logs, isProcessing, onOpenFull }) {
  const streamRef = useRef(null);
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [logs, isProcessing]);

  return (
    <div className="relative">
      <div ref={streamRef} className="bg-surface-2 rounded-lg max-h-40 overflow-y-auto font-mono text-[11px] leading-[16px] space-y-1 p-2.5">
        {logs.length === 0 && !isProcessing ? (
          <p className="text-text-tertiary italic flex items-center gap-1.5">
            Awaiting commands
            <span className="text-brand animate-pulse">▊</span>
          </p>
        ) : (
          logs.map((log, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="flex gap-2 leading-tight"
            >
              <span className={`font-bold flex-shrink-0 ${AGENT_COLORS[log.agent] || 'text-gray-500'}`}>
                [{log.agent}]
              </span>
              <span className="text-text-secondary break-all flex-1">{log.message}</span>
            </motion.div>
          ))
        )}
        {isProcessing && (
          <div className="flex gap-2">
            <span className="text-brand animate-pulse">▊</span>
          </div>
        )}
      </div>
      {onOpenFull && (
        <button
          onClick={onOpenFull}
          className="tap-target mt-1.5 flex items-center gap-1 text-[8px] font-bold tracking-wider text-brand hover:text-brand/80 transition-colors"
        >
          VIEW FULL PIPELINE <ExternalLink className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

function SitesView({ websites }) {
  if (websites.length === 0) {
    return (
      <div className="bg-surface-2 rounded-lg p-4 text-center">
        <Globe className="w-4 h-4 mx-auto mb-2 text-text-tertiary" />
        <p className="text-[9px] text-text-tertiary italic">No active connections — JEXI will show sites she visits here</p>
      </div>
    );
  }
  return (
    <div className="space-y-1 max-h-40 overflow-y-auto">
      {websites.map((site, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 text-[9px] bg-surface-2 p-2 rounded-md border border-hairline"
        >
          <img src={site.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-text-primary truncate font-medium">{site.title}</p>
            <p className="text-text-tertiary truncate">{site.url}</p>
          </div>
          <span className="text-brand font-bold text-[8px]">READ</span>
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Activity window (spec §3A + §7):
 * - collapsed: 3 status pills in one slim row (36px feel, 40px hit areas)
 * - expanded: pipeline mini-view (LIVE STREAM / WEBSITES tabs), capped ~180px
 * - `rail` (desktop ≥768px): persistent right rail — always expanded, no pills
 * - `full`: full-page mode used by callers that render their own chrome
 * - short screens (<700px tall): collapsed by default; auto-expands for the
 *   first 3s of a new run, then re-collapses so it never eats the viewport
 */
export default function ActivityWindow({ logs, websites, isProcessing, compact, full = false, rail = false, onOpenFull }) {
  const [tab, setTab] = useState('stream');
  const [userToggled, setUserToggled] = useState(false);
  const [shortScreen, setShortScreen] = useState(false);
  const [autoPeek, setAutoPeek] = useState(false);
  const wasProcessing = useRef(isProcessing);

  // §7: short screens (landscape / split-screen phones) collapse by default.
  useEffect(() => {
    const onResize = () => setShortScreen(window.innerHeight < 700);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // §7: on short screens, auto-expand for the first 3s of a new run only.
  useEffect(() => {
    if (isProcessing && !wasProcessing.current) {
      setAutoPeek(true);
      const t = setTimeout(() => setAutoPeek(false), 3000);
      wasProcessing.current = isProcessing;
      return () => clearTimeout(t);
    }
    wasProcessing.current = isProcessing;
  }, [isProcessing]);

  const hasActivity = isProcessing || logs.length > 0 || websites.length > 0;
  const expanded = full || rail ? true : userToggled || (shortScreen ? autoPeek : hasActivity);
  const pinned = full || rail;

  const brainActive = isProcessing || logs.length > 0;
  const sitesActive = websites.length > 0;
  const streamActive = logs.length > 0;

  return (
    <div className={rail ? 'space-y-2 h-full flex flex-col' : full ? 'space-y-4' : 'space-y-2 flex-shrink-0'}>
      {/* Collapsed strip — 3 status pills, one row (spec: 36px strip, 40px targets) */}
      {!rail && (
        <div className={`${compact ? 'px-1' : ''} flex items-center justify-between gap-2`}>
          <StatusPill icon={Cpu} label="BRAIN" value={isProcessing ? 'WORK' : 'ON'} active={brainActive} pulse={isProcessing} onClick={() => setUserToggled(true)} />
          <StatusPill icon={Globe} label="SITES" value={sitesActive ? `${websites.length}` : 'IDLE'} active={sitesActive} onClick={() => setUserToggled(true)} />
          <StatusPill icon={Radio} label="STREAM" value={streamActive ? `${logs.length}` : 'STBY'} active={streamActive} pulse={streamActive && isProcessing} onClick={() => setUserToggled(true)} />
          {!pinned && (
            <button
              type="button"
              onClick={() => setUserToggled((v) => !v)}
              className="tap-target ml-auto flex items-center gap-1 text-text-tertiary hover:text-brand transition-colors p-2"
              title={expanded ? 'Hide activity' : 'Show activity'}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      )}

      {rail && (
        <div className="flex items-center gap-2">
          <Radio className="w-3 h-3 text-brand" />
          <p className="text-[9px] font-bold text-brand tracking-wider">ACTIVITY</p>
          {isProcessing && <span className="ml-auto text-[8px] text-text-tertiary font-bold animate-pulse">LIVE</span>}
        </div>
      )}

      {/* Expanded pipeline mini-view */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={rail ? 'overflow-hidden flex-1 min-h-0' : 'overflow-hidden'}
          >
            <div className="surface-card p-3 h-full flex flex-col">
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
                      <span className="bg-brand text-black rounded-full px-1.5 text-[7px] font-black">{websites.length}</span>
                    )}
                  </span>
                </TabButton>
              </div>
              <div className="min-h-0 flex-1">
                {tab === 'stream'
                  ? <StreamView logs={logs} isProcessing={isProcessing} onOpenFull={full ? undefined : onOpenFull} />
                  : <SitesView websites={websites} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap-target px-2.5 py-2 rounded-lg text-[8px] font-bold tracking-wider transition-all duration-200 ${
        active
          ? 'bg-brand-dim text-brand border border-brand-line'
          : 'text-text-tertiary border border-transparent hover:text-text-secondary hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  );
}
