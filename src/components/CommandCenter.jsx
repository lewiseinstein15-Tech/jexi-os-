import { motion } from 'framer-motion';
import { Radio, Loader2 } from 'lucide-react';
import ActivityWindow from './ActivityWindow';
import ChatWindow from './ChatWindow';

/**
 * Command Center — the working surface of the OS (spec §11/§45):
 * current task + plan + roster on top, live activity, and the conversation
 * workspace with ONE command input. Desktop gets a persistent right rail.
 */
export default function CommandCenter({ engine, isDesktop }) {
  const { plan, logs, websites, isProcessing, messages } = engine;

  const steps = plan?.steps || [];
  const domains = plan?.domainNames || [];

  return (
    <div className={isDesktop ? 'flex gap-4 items-stretch justify-center h-full min-h-0 px-4' : 'flex flex-col gap-3 flex-1 min-h-0 px-3'}>
      {/* Main column */}
      <div className={isDesktop ? 'flex flex-col gap-3 w-full max-w-[680px] min-h-0' : 'flex flex-col gap-3 flex-1 min-h-0'}>
        {/* Task / plan header */}
        <div className="surface-card p-3.5 rounded-xl flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Radio className="w-3.5 h-3.5 text-brand" />
            <p className="text-[9px] font-bold tracking-[0.18em] text-brand">COMMAND CENTER</p>
            {isProcessing && (
              <span className="ml-auto flex items-center gap-1.5 text-[8px] font-bold text-brand">
                <Loader2 className="w-3 h-3 animate-spin" /> RUNNING
              </span>
            )}
          </div>

          {domains.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {domains.map((d) => (
                <span key={d} className="acc-research border rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider bg-surface-2">
                  {d.toUpperCase()}
                </span>
              ))}
            </div>
          )}

          {steps.length > 0 ? (
            <>
              <p className="eyebrow mb-1.5">Plan</p>
              <div className="flex flex-wrap gap-1.5">
                {steps.map((s, i) => (
                  <span key={`${s}-${i}`} className="flex items-center gap-1 text-[9px] font-mono text-text-secondary">
                    {i > 0 && <span className="text-text-tertiary">→</span>}
                    <span className={`px-1.5 py-0.5 rounded border ${i === steps.length - 1 && isProcessing ? 'border-brand-line bg-brand-dim text-brand' : 'border-hairline bg-surface-2'}`}>
                      {s}
                    </span>
                  </span>
                ))}
              </div>
              {plan.skillsLine && (
                <p className="text-[9px] text-text-tertiary font-mono mt-2 truncate">skills: {plan.skillsLine}</p>
              )}
            </>
          ) : (
            <p className="text-[10px] text-text-tertiary italic">
              {isProcessing ? 'Planning the team for this task…' : 'Idle — ask JEXI what to build, research, or solve.'}
            </p>
          )}
        </div>

        {/* Conversation workspace */}
        <ChatWindow
          messages={engine.messages}
          logs={engine.logs}
          isProcessing={engine.isProcessing}
          onSend={engine.runSearch}
          onStop={engine.stopGeneration}
          onVisionResult={(text) => engine.pushMessage('jexi', text)}
        />
      </div>

      {/* Desktop: persistent activity rail */}
      {isDesktop && (
        <aside className="w-[300px] flex-shrink-0 min-h-0">
          <ActivityWindow logs={logs} websites={websites} isProcessing={isProcessing} rail />
        </aside>
      )}
    </div>
  );
}
