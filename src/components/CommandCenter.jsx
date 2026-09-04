import { useState } from 'react';
import { motion } from 'framer-motion';
import { Radio, Loader2, Check, Users, ChevronDown, ChevronUp } from 'lucide-react';
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
  const rosterCount = plan?.teamSlugs?.length || 0;
  const activeStep = isProcessing ? steps.length - 1 : -1;
  // B53 P1 — the plan header must stay compact: collapsed to the first few
  // stages by default so the chat owns the surface; expand on demand.
  const [planExpanded, setPlanExpanded] = useState(false);
  const COLLAPSED_STAGES = 5;
  const visibleSteps = planExpanded ? steps : steps.slice(0, COLLAPSED_STAGES);
  const hiddenCount = steps.length - visibleSteps.length;

  return (
    // B79 — the Command Center is a FIXED work surface (ChatGPT/Claude-style):
    // the page never scrolls. A huge plan header scrolls INSIDE its own card
    // (capped height), and the conversation scrolls inside ChatWindow.
    <div className={isDesktop ? 'flex gap-4 items-stretch h-full min-h-0 px-4 overflow-hidden' : 'flex flex-col gap-3 flex-1 min-h-0 px-3 overflow-hidden'}>
      {/* Main column — full work surface width (B53 P1: no 680px center strip) */}
      <div className={isDesktop ? 'flex flex-col gap-3 w-full min-w-0 min-h-0' : 'flex flex-col gap-3 flex-1 min-h-0'}>
        {/* Task / plan header — capped height so a long plan scrolls inside
            the card instead of pushing the page (B79) */}
        <div className="surface-card p-3.5 rounded-xl flex-shrink-0 max-h-[36%] overflow-y-auto">
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

          {/* Build 47 — context intelligence chip (continuation / switch / new) */}
          {plan?.intel && (
            <div className={`flex items-center gap-1.5 mb-2 rounded-md border px-2 py-1.5 ${plan.intel.classification === 'clarify' ? 'border-acc-automation/40 bg-acc-automation/[0.06]' : 'border-brand-line bg-brand-dim/40'}`}>
              <span className={`text-[8px] font-black tracking-wider ${plan.intel.classification === 'clarify' ? 'text-acc-automation' : 'text-brand'}`}>
                {String(plan.intel.classification || '').toUpperCase()}
              </span>
              {plan.intel.taskTitle && (
                <span className="text-[8px] font-mono text-text-secondary truncate">
                  {plan.intel.taskId ? `${plan.intel.taskId} · ` : ''}{plan.intel.taskTitle}
                </span>
              )}
              {typeof plan.intel.confidence === 'number' && (
                <span className="ml-auto text-[7px] font-mono text-text-tertiary flex-shrink-0">
                  {Math.round(plan.intel.confidence * 100)}%
                </span>
              )}
            </div>
          )}

          {steps.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-1.5">
                <p className="eyebrow">Plan</p>
                {rosterCount > 0 && (
                  <span className="flex items-center gap-1 text-[8px] font-bold tracking-wider text-text-tertiary">
                    <Users className="w-2.5 h-2.5" /> {rosterCount} AGENT{rosterCount !== 1 ? 'S' : ''} · {steps.length} STAGE{steps.length !== 1 ? 'S' : ''}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {visibleSteps.map((s, i) => {
                  const done = isProcessing && i < activeStep;
                  const current = isProcessing && i === activeStep;
                  return (
                    <span key={`${s}-${i}`} className="flex items-center gap-1 text-[8px] font-mono text-text-secondary">
                      {i > 0 && <span className="text-text-tertiary">→</span>}
                      <span className={`px-1 py-0.5 rounded border flex items-center gap-1 transition-all duration-200 ${
                        done
                          ? 'border-hairline bg-surface-2 text-text-tertiary'
                          : current
                            ? 'border-brand-line bg-brand-dim text-brand animate-pulse'
                            : 'border-hairline bg-surface-2'
                      }`}>
                        {done && <Check className="w-2 h-2" />}
                        {s}
                      </span>
                    </span>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setPlanExpanded((v) => !v)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-brand-line/50 bg-brand-dim/30 text-[8px] font-bold text-brand hover:bg-brand-dim transition-colors"
                  >
                    {planExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                    {planExpanded ? 'SHOW LESS' : `+${hiddenCount} MORE`}
                  </button>
                )}
              </div>
              {plan.skillsLine && !planExpanded && (
                <p className="text-[8px] text-text-tertiary font-mono mt-1.5 truncate">skills: {plan.skillsLine}</p>
              )}
            </>
          ) : (
            isProcessing ? (
              <div className="space-y-1.5">
                <div className="shimmer-bar h-2 rounded-full w-2/3" />
                <div className="shimmer-bar h-2 rounded-full w-1/3" />
              </div>
            ) : (
              <p className="text-[10px] text-text-tertiary italic">Idle — ask JEXI what to build, research, or solve.</p>
            )
          )}
        </div>

        {/* Conversation workspace */}
        <ChatWindow
          messages={engine.messages}
          logs={engine.logs}
          isProcessing={engine.isProcessing}
          onSend={engine.runSearch}
          onStop={engine.stopGeneration}
          questions={engine.questions}
          onDismissQuestions={engine.setQuestions}
          planReview={engine.planReview}
              team={engine.team}
              computer={engine.computer}
          onDismissPlan={engine.setPlanReview}
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
