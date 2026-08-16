import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Target, Zap, Play, Loader2, ChevronRight, ChevronDown, X,
  CheckCircle2, AlertCircle, Clock, PauseCircle, Send, ListChecks,
} from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import PanelHeader from './PanelHeader';
import MarkdownRenderer from './MarkdownRenderer';

/**
 * GOALS — Phase 3: autonomous goals as durable background jobs.
 * Start a goal (Ask = pauses at confirmations, Full = asks for details once
 * then runs end-to-end), watch its live event stream, answer parked goals.
 * Jobs survive restarts and are session-isolated.
 */

const STATUS_META = {
  queued: { label: 'QUEUED', text: 'text-text-tertiary', border: 'border-hairline', dot: 'bg-text-tertiary', Icon: Clock },
  running: { label: 'RUNNING', text: 'text-brand', border: 'border-brand-line', dot: 'bg-brand animate-pulse', Icon: Loader2 },
  'need-info': { label: 'NEEDS DETAILS', text: 'text-status-warn', border: 'border-status-warn/40', dot: 'bg-status-warn animate-pulse', Icon: PauseCircle },
  done: { label: 'DONE', text: 'text-brand', border: 'border-brand-line', dot: 'bg-brand', Icon: CheckCircle2 },
  failed: { label: 'FAILED', text: 'text-status-error', border: 'border-status-error/40', dot: 'bg-status-error', Icon: AlertCircle },
};

const timeAgo = (ts) => {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
};

export default function GoalsScreen() {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [goalText, setGoalText] = useState('');
  const [autonomy, setAutonomy] = useState('full');
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(null); // jobId
  const [logs, setLogs] = useState({}); // jobId → [{type, agent, message, summary}]
  const [answers, setAnswers] = useState({}); // jobId → input
  const [answering, setAnswering] = useState({});
  const [error, setError] = useState('');
  const abortRef = useRef({}); // jobId → AbortController
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/goals`);
      const data = await res.json();
      setGoals(data.goals || []);
    } catch (e) {
      // backend offline — silent, keep last list
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 5000); // poll for status changes
    return () => { clearInterval(timerRef.current); Object.values(abortRef.current).forEach((a) => a?.abort()); };
  }, [load]);

  /** Stream one job's NDJSON events (replay + live). */
  const openStream = useCallback((jobId) => {
    const controller = new AbortController();
    abortRef.current[jobId] = controller;
    setLogs((prev) => ({ ...prev, [jobId]: [] }));
    (async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/goals/${jobId}/stream`, { signal: controller.signal });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type === 'heartbeat') continue;
            setLogs((prev) => ({ ...prev, [jobId]: [...(prev[jobId] || []), ev] }));
          }
        }
      } catch (e) { /* aborted or closed */ }
    })();
  }, []);

  useEffect(() => {
    // Reopen stream when a job expands.
    if (expanded) openStream(expanded);
    return () => { if (expanded && abortRef.current[expanded]) { abortRef.current[expanded].abort(); delete abortRef.current[expanded]; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const startGoal = async () => {
    const goal = goalText.trim();
    if (!goal) return;
    setStarting(true);
    setError('');
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, autonomy }),
      });
      const data = await res.json();
      if (data.ok && data.jobId) {
        setGoalText('');
        await load();
        setExpanded(data.jobId);
      } else {
        setError(data.error || 'Could not start the goal.');
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setStarting(false);
    }
  };

  const answerGoal = async (jobId) => {
    const answer = (answers[jobId] || '').trim();
    if (!answer) return;
    setAnswering((prev) => ({ ...prev, [jobId]: true }));
    try {
      await fetch(`${getBackendUrl()}/api/goals/${jobId}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      setAnswers((prev) => ({ ...prev, [jobId]: '' }));
      // The stream endpoint now replays live events; refresh list shortly after.
      setTimeout(load, 1500);
    } catch (e) { /* noop */ } finally {
      setAnswering((prev) => ({ ...prev, [jobId]: false }));
    }
  };

  const renderLogLine = (ev, i) => {
    if (ev.type === 'log') {
      return (
        <div key={i} className="flex gap-2 text-[10px] leading-relaxed">
          <span className="text-brand shrink-0">▸</span>
          <span className="text-text-tertiary shrink-0">{ev.agent || 'System'}:</span>
          <span className="text-text-secondary">{ev.message}</span>
        </div>
      );
    }
    if (ev.type === 'goal.plan') {
      return <div key={i} className="text-[10px] text-cyan-400">🧭 Plan — intent: <b>{ev.intent}</b> · complexity: {ev.complexity} · {(ev.steps || []).join(' → ')}</div>;
    }
    if (ev.type === 'goal.attempt') {
      return <div key={i} className="text-[10px] text-status-warn">↻ Attempt {ev.attempt}/{ev.max}</div>;
    }
    if (ev.type === 'goal.need-info' || ev.type === 'goal.paused') {
      return <div key={i} className="text-[10px] text-status-warn">📋 {(ev.questions || []).map((q) => q.question).join(' · ') || ev.question}</div>;
    }
    if (ev.type === 'goal.approvals') {
      return <div key={i} className="text-[10px] text-brand">✓ Auto-approved {ev.count} confirmation{ev.count === 1 ? '' : 's'}</div>;
    }
    if (ev.type === 'done') {
      return (
        <div key={i} className="mt-2 rounded-md border border-brand-line bg-surface-1 p-2">
          <div className="text-[9px] font-bold text-brand mb-1">{ev.parked ? 'PARKED — needs your details' : (ev.success ? 'GOAL COMPLETE' : 'GOAL FAILED')}</div>
          {ev.summary ? <MarkdownRenderer content={ev.summary} size="text-[10px]" /> : null}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="px-3 pt-4 pb-8 space-y-3 max-w-[900px] mx-auto">
      <PanelHeader icon={Target} title="GOALS" subtitle="Autonomous missions — JEXI asks for what she needs, then runs the whole team end-to-end." />

      {/* New goal */}
      <div className="bg-surface-2 border border-hairline rounded-md p-3">
        <label className="flex items-center gap-2 text-[10px] font-bold text-text-secondary mb-2">
          <Zap className="w-3 h-3 text-brand" />
          START AN AUTONOMOUS GOAL
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startGoal()}
            placeholder="e.g. book me a flight to Mombasa · plan my vacation · research X then build Y"
            className="flex-1 bg-surface-1 text-text-primary border border-hairline rounded-md px-3 py-2.5 text-xs focus:outline-none focus:border-brand-line"
          />
          <div className="flex gap-1.5">
            {[
              ['ask', 'Ask', 'pauses at confirmations'],
              ['full', 'Full', 'asks details once, runs it all'],
            ].map(([val, label, desc]) => (
              <button
                key={val}
                onClick={() => setAutonomy(val)}
                title={desc}
                className={`px-3 py-2.5 rounded-md text-[10px] font-bold border ${autonomy === val ? 'bg-brand text-black border-brand' : 'bg-surface-1 text-text-secondary border-hairline'}`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={startGoal}
              disabled={starting || !goalText.trim()}
              className="px-4 py-2.5 rounded-md text-[10px] font-bold bg-brand text-black flex items-center gap-1.5 disabled:opacity-40"
            >
              {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} START
            </button>
          </div>
        </div>
        {error && <p className="text-[10px] text-status-error mt-2">{error}</p>}
        <p className="text-[8px] text-text-tertiary mt-2">Tip: you can also just type <span className="font-mono text-text-secondary">/goal book me a flight</span> in chat. Full autonomy = JEXI asks the questions she needs once, then runs to completion and reports when done.</p>
      </div>

      {/* Goal list */}
      <div className="space-y-2">
        {loading && <div className="text-center text-text-tertiary text-xs py-6"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading goals…</div>}
        {!loading && goals.length === 0 && (
          <div className="text-center text-text-tertiary text-xs py-8 border border-dashed border-hairline rounded-md">
            <ListChecks className="w-6 h-6 mx-auto mb-2 opacity-40" />
            No goals yet. Start one above or with <span className="font-mono">/goal …</span> in chat.
          </div>
        )}
        {goals.map((g) => {
          const meta = STATUS_META[g.status] || STATUS_META.queued;
          const Icon = meta.Icon;
          const isOpen = expanded === g.id;
          const jobLogs = logs[g.id] || [];
          return (
            <div key={g.id} className={`bg-surface-2 border rounded-md overflow-hidden ${isOpen ? 'border-brand-line' : 'border-hairline'}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : g.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-1/60"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                <span className={`flex items-center gap-1 text-[8px] font-bold tracking-wider shrink-0 ${meta.text}`}>
                  {Icon && (g.status === 'running' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Icon className="w-2.5 h-2.5" />)}
                  {meta.label}
                </span>
                <span className="text-xs text-text-primary font-semibold truncate flex-1">{g.goal}</span>
                <span className="text-[8px] text-text-tertiary shrink-0 hidden sm:block">{g.autonomy === 'full' ? 'FULL' : 'ASK'}</span>
                <span className="text-[8px] text-text-tertiary shrink-0">{timeAgo(g.updatedAt)}</span>
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-hairline px-3 py-2.5 space-y-2">
                  {/* live stream */}
                  <div className="bg-void/60 border border-hairline rounded-md p-2 max-h-64 overflow-y-auto space-y-1">
                    {jobLogs.length === 0 && <div className="text-[10px] text-text-tertiary">Waiting for events…</div>}
                    {jobLogs.map((ev, i) => renderLogLine(ev, i))}
                  </div>

                  {/* parked goal answer box */}
                  {g.status === 'need-info' && (
                    <div className="flex gap-2">
                      <input
                        value={answers[g.id] || ''}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [g.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && answerGoal(g.id)}
                        placeholder="Answer JEXI's questions here (or just type it in chat)…"
                        className="flex-1 bg-surface-1 text-text-primary border border-status-warn/40 rounded-md px-3 py-2 text-xs focus:outline-none focus:border-status-warn"
                      />
                      <button
                        onClick={() => answerGoal(g.id)}
                        disabled={answering[g.id]}
                        className="px-3 py-2 rounded-md text-[10px] font-bold bg-status-warn/20 text-status-warn border border-status-warn/40 flex items-center gap-1.5"
                      >
                        {answering[g.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} SEND
                      </button>
                    </div>
                  )}

                  {/* meta */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[8px] text-text-tertiary">
                    <span>job {g.id}</span>
                    <span>events: {g.eventCount}</span>
                    <span>auto-approvals: {g.autoApprovals}</span>
                    {g.result?.statistics?.executionTime ? <span>ran {(g.result.statistics.executionTime / 1000).toFixed(1)}s</span> : null}
                    {g.error ? <span className="text-status-error">{g.error}</span> : null}
                  </div>
                  {isOpen && g.status === 'done' && (
                    <button onClick={() => { setExpanded(null); load(); }} className="text-[9px] text-text-tertiary flex items-center gap-1">
                      <X className="w-2.5 h-2.5" /> close
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
