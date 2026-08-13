import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Globe, Loader2, CheckCircle2, XCircle, Radio, Activity } from 'lucide-react';
import JexiCore, { coreColor } from './JexiCore';
import RosterPanel from './RosterPanel';
import ActiveAgents from './ActiveAgents';

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`tap-target px-3 py-2 rounded-lg text-[9px] font-bold tracking-wider transition-all duration-200 ${
        active ? 'bg-brand-dim text-brand border border-brand-line' : 'text-text-tertiary border border-transparent hover:text-text-secondary hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  );
}

function PipelineTab({ logs, websites, isProcessing, plan }) {
  const roster = plan?.roster || [];
  const activeAgent = logs.length > 0 ? logs[logs.length - 1].agent : null;
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, isProcessing]);

  // Timeline: preserve first-seen order of agents; latest message per agent.
  const order = [];
  const byAgent = {};
  for (const log of logs) {
    if (!log || !log.agent) continue;
    if (!byAgent[log.agent]) { byAgent[log.agent] = []; order.push(log.agent); }
    byAgent[log.agent].push(log.message);
  }

  return (
    <div className="space-y-4">
      {/* The Core hero (spec §6) — full size atop the pipeline */}
      <div className="surface-card p-5 flex flex-col items-center">
        <JexiCore size={120} roster={roster} activeAgent={activeAgent} running={isProcessing} done={!isProcessing && roster.length > 0} />
        <p className="eyebrow mt-3 text-center">
          {isProcessing
            ? (activeAgent ? `${activeAgent} · ACTIVE` : 'Assembling agents…')
            : order.length > 0 ? `${order.length} of ${roster.length || order.length} specialists ran` : 'Idle — ask JEXI anything'}
        </p>
        {plan?.domainNames?.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {plan.domainNames.map((d) => (
              <span key={d} className="bg-brand-dim/40 border border-brand-line/40 text-brand rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider">
                {d.toUpperCase()}
              </span>
            ))}
          </div>
        )}
        {roster.length > 0 && (
          <p className="text-[9px] text-text-tertiary mt-2 text-center max-w-[240px] leading-snug">
            {roster.join(' · ')}
          </p>
        )}
      </div>

      {/* Timeline spine */}
      <div className="surface-card p-3">
        <div className="flex items-center gap-2 mb-2.5">
          <Radio className="w-3 h-3 text-brand" />
          <p className="text-[9px] font-bold text-brand tracking-wider">AGENT TIMELINE</p>
          {isProcessing && <span className="ml-auto text-[8px] text-text-tertiary font-bold animate-pulse">LIVE</span>}
        </div>
        {order.length === 0 ? (
          <p className="text-[10px] text-text-tertiary italic py-3 text-center">No agents have run yet — the timeline appears here as JEXI works.</p>
        ) : (
          <div className="relative pl-6">
            {/* spine */}
            <div className="absolute left-[11px] top-2 bottom-2 w-px bg-hairline" />
            {order.map((agent, i) => {
              const isRunning = isProcessing && i === order.length - 1;
              const isDone = !isRunning;
              const lastMsg = byAgent[agent][byAgent[agent].length - 1];
              const color = coreColor(agent);
              return (
                <motion.div
                  key={agent}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="relative pb-3.5 last:pb-1"
                >
                  {/* node on the spine */}
                  <div
                    className="absolute left-0 top-0.5 w-[22px] h-[22px] -translate-x-1/2 rounded-full border flex items-center justify-center"
                    style={{
                      background: isRunning ? `${color}1A` : isDone ? color : 'transparent',
                      borderColor: isRunning ? color : isDone ? `${color}66` : 'rgba(255,255,255,0.12)',
                      boxShadow: isRunning ? `0 0 10px ${color}55` : 'none',
                    }}
                  >
                    {isRunning ? (
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color }} />
                    ) : isDone ? (
                      <CheckCircle2 className="w-3 h-3" style={{ color }} />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                    )}
                  </div>
                  {/* card */}
                  <div className={`rounded-md border px-2.5 py-2 ${isRunning ? 'border-brand-line bg-brand-dim/5' : 'border-hairline bg-surface-2'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-black tracking-wider" style={{ color }}>{agent.toUpperCase()}</span>
                      <span className="text-[8px] font-bold tracking-wider" style={{ color: isRunning ? color : '#616166' }}>
                        {isRunning ? 'RUNNING' : 'PASS'}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1 font-mono leading-snug break-words">{lastMsg}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live log panel — attached under the active node */}
      <div className="surface-card p-3">
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="w-3 h-3 text-brand" />
          <p className="text-[9px] font-bold text-brand tracking-wider">LIVE STREAM</p>
        </div>
        <div ref={logRef} className="bg-surface-2 border border-hairline rounded-md p-2.5 max-h-40 overflow-y-auto font-mono text-[10px] leading-[15px] space-y-1">
          {logs.length === 0 && !isProcessing ? (
            <p className="text-text-tertiary italic">Awaiting commands <span className="text-brand animate-pulse">▊</span></p>
          ) : (
            logs.map((log, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="flex gap-2">
                <span className="font-bold flex-shrink-0" style={{ color: coreColor(log.agent) }}>[{log.agent}]</span>
                <span className="text-text-secondary break-all flex-1">{log.message}</span>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Visited sites */}
      {websites.length > 0 && (
        <div className="surface-card p-3">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-3 h-3 text-cyan-400" />
            <p className="text-[9px] font-bold text-cyan-400 tracking-wider">VISITED SITES</p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {websites.map((site, i) => (
              <motion.a
                key={i}
                href={site.url}
                target="_blank"
                rel="noreferrer"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="w-[120px] flex-shrink-0 bg-surface-2 border border-hairline rounded-md p-2 block hover:border-hairline-strong"
              >
                <img src={site.favicon} alt="" className="w-4 h-4 rounded mb-1.5" />
                <p className="text-[9px] text-text-primary truncate font-medium">{site.title}</p>
                <p className="text-[8px] text-text-tertiary truncate">{site.url}</p>
              </motion.a>
            ))}
          </div>
        </div>
      )}

      {/* Failure indicator if any agent errored */}
      {!isProcessing && logs.some((l) => l.agent === 'Error' || /Critical Error/i.test(l.message)) && (
        <div className="flex items-center gap-2 bg-status-error/10 border border-status-error/30 rounded-md px-3 py-2">
          <XCircle className="w-3.5 h-3.5 text-status-error" />
          <span className="text-[10px] text-status-error font-semibold">An agent reported an error — check the stream above.</span>
        </div>
      )}
    </div>
  );
}

export default function AgentsScreen({ logs, websites, isProcessing, plan }) {
  const [tab, setTab] = useState('pipeline');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Tab active={tab === 'active'} onClick={() => setTab('active')}>ACTIVE</Tab>
        <Tab active={tab === 'pipeline'} onClick={() => setTab('pipeline')}>PIPELINE</Tab>
        <Tab active={tab === 'roster'} onClick={() => setTab('roster')}>ROSTER</Tab>
        {tab === 'active' && isProcessing && (
          <span className="ml-auto flex items-center gap-1.5 text-[8px] text-brand font-bold">
            <Activity className="w-3 h-3" />
            LIVE
          </span>
        )}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {tab === 'active' ? (
            <ActiveAgents logs={logs} isProcessing={isProcessing} plan={plan} />
          ) : tab === 'pipeline' ? (
            <PipelineTab logs={logs} websites={websites} isProcessing={isProcessing} plan={plan} />
          ) : (
            <RosterPanel />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
