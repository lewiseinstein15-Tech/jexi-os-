import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X, ChevronRight, Terminal, Layers, Zap } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import { coreColor } from './JexiCore';

/**
 * Stage 7 — Agent workspace list (spec §13).
 * OS-style rows: status dot, name, current task, activity indicator. Tapping
 * an agent opens its detail sheet: status, task, log timeline, role, skills.
 * Live state is derived from the event stream (logs + plan.roster); roster
 * metadata (role/skills) enriches it from /api/roster.
 */
export default function ActiveAgents({ logs, isProcessing, plan }) {
  const [selected, setSelected] = useState(null);
  const [roster, setRoster] = useState([]);
  const [skillsBySlug, setSkillsBySlug] = useState(new Map());

  useEffect(() => {
    (async () => {
      try {
        const res = await jexiFetch(`${getBackendUrl()}/api/roster`);
        const data = await res.json();
        setRoster(data.agents || []);
        setSkillsBySlug(new Map((data.skills || []).map((s) => [s.slug, s])));
      } catch (e) {
        /* roster is enrichment only — the list works without it */
      }
    })();
  }, []);

  const metaBySlug = useMemo(() => {
    const m = new Map();
    for (const a of roster) m.set(a.name.toLowerCase(), a);
    return m;
  }, [roster]);

  const active = useMemo(() => {
    const order = [];
    const byAgent = {};
    for (const log of logs) {
      if (!log || !log.agent) continue;
      if (!byAgent[log.agent]) { byAgent[log.agent] = []; order.push(log.agent); }
      byAgent[log.agent].push(log.message);
    }
    return order.map((name, i) => {
      const lines = byAgent[name];
      const meta = metaBySlug.get(name.toLowerCase());
      const isRunning = isProcessing && i === order.length - 1;
      return {
        name,
        meta,
        lines,
        last: lines[lines.length - 1],
        count: lines.length,
        status: isRunning ? 'running' : 'done',
      };
    });
  }, [logs, isProcessing, metaBySlug]);

  // Planned but not yet seen agents (from the plan) — shown as waiting.
  const waiting = (plan?.steps || []).filter((s) => !active.some((a) => a.name.toLowerCase() === String(s).toLowerCase()));

  const selectedAgent = selected && (active.find((a) => a.name === selected) || null);

  return (
    <div className="space-y-3">
      {active.length === 0 && waiting.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-10 text-center">
          <p className="text-[11px] text-text-tertiary italic">
            No agents deployed yet — ask JEXI something in the Command Center and the team appears here in real time.
          </p>
        </div>
      ) : (
        <>
          {/* Running / finished agents */}
          <div className="space-y-1.5">
            {active.map((a, i) => (
              <motion.button
                key={a.name}
                type="button"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18, delay: Math.min(i * 0.04, 0.3) }}
                onClick={() => setSelected(a.name)}
                className="w-full flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3 py-3 text-left transition-all duration-150 hover:border-hairline-strong hover:bg-surface-2 active:scale-[0.99]"
              >
                <span className="relative flex-shrink-0 w-2.5 h-2.5">
                  <span
                    className={`absolute inline-flex w-full h-full rounded-full opacity-60 ${a.status === 'running' ? 'animate-ping' : ''}`}
                    style={{ background: coreColor(a.name) }}
                  />
                  <span className="relative inline-flex w-2.5 h-2.5 rounded-full" style={{ background: coreColor(a.name) }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[12px] font-semibold text-text-primary truncate">{a.name}</p>
                    <span
                      className="text-[7.5px] font-bold tracking-wider px-1.5 py-0.5 rounded-full border flex-shrink-0"
                      style={{
                        color: a.status === 'running' ? coreColor(a.name) : '#46515D',
                        borderColor: a.status === 'running' ? `${coreColor(a.name)}55` : 'rgba(255,255,255,0.08)',
                        background: a.status === 'running' ? `${coreColor(a.name)}14` : 'transparent',
                      }}
                    >
                      {a.status === 'running' ? 'RUNNING' : 'DONE'}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary font-mono truncate mt-0.5">{a.last}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="flex items-center gap-1 text-[8px] font-bold text-text-tertiary">
                    <Zap className="w-2.5 h-2.5" /> {a.count}
                  </span>
                  {a.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: coreColor(a.name) }} />}
                  <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
                </div>
              </motion.button>
            ))}
          </div>

          {/* Planned / waiting */}
          {waiting.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Queued by the planner</p>
              <div className="flex flex-wrap gap-1.5">
                {waiting.map((s) => {
                  // B49 P4 — honest execution: personas folded into a composite
                  // pass are tagged "composed" so the PLAN view never implies
                  // an independent agent ran when one did not.
                  const bundled = (plan?.execution?.bundled || []).some((n) => String(n).toLowerCase() === String(s).toLowerCase());
                  return (
                    <span key={s} className="flex items-center gap-1.5 border border-hairline bg-surface-2 rounded-full px-2.5 py-1 text-[9px] text-text-tertiary font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" /> {s}
                      {bundled && <span className="text-[7.5px] uppercase tracking-wide opacity-55">· composed</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail drawer */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-end"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ y: 90 }}
              animate={{ y: 0 }}
              exit={{ y: 90 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-h-[86vh] overflow-y-auto surface-card rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            >
              <div className="w-8 h-1 bg-white/15 rounded-full mx-auto mb-4" />
              <div className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center text-xl font-bold"
                  style={{ background: `${coreColor(selectedAgent.name)}1A`, borderColor: `${coreColor(selectedAgent.name)}33`, color: coreColor(selectedAgent.name) }}
                >
                  {selectedAgent.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-text-primary">{selectedAgent.name}</h3>
                    <span
                      className="text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded-full border flex-shrink-0"
                      style={{
                        color: selectedAgent.status === 'running' ? coreColor(selectedAgent.name) : '#46515D',
                        borderColor: selectedAgent.status === 'running' ? `${coreColor(selectedAgent.name)}55` : 'rgba(255,255,255,0.08)',
                      }}
                    >
                      {selectedAgent.status === 'running' ? '● RUNNING' : '✓ DONE'}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                    {selectedAgent.meta?.role || 'Specialist agent on the active team.'}
                  </p>
                </div>
                <button onClick={() => setSelected(null)} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-white/[0.04]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current task */}
              <div className="mt-4">
                <p className="eyebrow mb-1.5">Current task</p>
                <p className="text-[11px] text-text-primary font-mono leading-relaxed bg-surface-2 border border-hairline rounded-md px-3 py-2.5">
                  {selectedAgent.last}
                </p>
              </div>

              {/* Timeline */}
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Terminal className="w-3 h-3 text-brand" />
                  <p className="eyebrow">Activity timeline · {selectedAgent.count}</p>
                </div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {selectedAgent.lines.map((msg, i) => (
                    <div key={i} className="flex gap-2 bg-surface-2 border border-hairline rounded-md px-2.5 py-2">
                      <span className="text-[8px] font-mono text-text-tertiary flex-shrink-0 pt-0.5">#{i + 1}</span>
                      <p className="text-[10.5px] text-text-secondary font-mono leading-snug break-words flex-1">{msg}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Skills */}
              {(selectedAgent.meta?.skills || []).length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Layers className="w-3 h-3 text-brand" />
                    <p className="eyebrow">Mastered skills</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedAgent.meta.skills.map((slug) => {
                      const s = skillsBySlug.get(slug);
                      return (
                        <span key={slug} className="border border-hairline bg-surface-2 text-text-secondary rounded-full px-2.5 py-1 text-[9px]">
                          {s?.name || slug}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
