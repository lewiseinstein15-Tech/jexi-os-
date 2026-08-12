import { useState, useEffect, useRef } from 'react';
import {
  ListTodo, Rocket, Loader2, Square, RotateCcw, Trash2,
  Globe, Radio, Clock, Activity, ChevronRight, X,
} from 'lucide-react';
import { useTasks } from '../hooks/useTasks';
import { AGENT_COLORS } from './ActivityWindow';
import MarkdownRenderer from './MarkdownRenderer';

/**
 * TASKS — roadmap stage 8: background missions.
 * Launch a mission and it runs server-side on the same Planner → Orchestrator
 * pipeline as chat, but decoupled from the connection: watch the live task.*
 * stream, cancel mid-flight, re-run finished missions, or close the tab and
 * come back — the work keeps running and the record persists.
 */

const STATUS_META = {
  loading: { label: '…', text: 'text-text-tertiary', border: 'border-hairline', dot: 'bg-text-tertiary' },
  queued: { label: 'QUEUED', text: 'text-text-tertiary', border: 'border-hairline', dot: 'bg-text-tertiary' },
  running: { label: 'RUNNING', text: 'text-brand', border: 'border-brand-line', dot: 'bg-brand animate-pulse' },
  done: { label: 'DONE', text: 'text-brand', border: 'border-brand-line', dot: 'bg-brand' },
  failed: { label: 'FAILED', text: 'text-status-error', border: 'border-status-error/40', dot: 'bg-status-error' },
  cancelled: { label: 'CANCELLED', text: 'text-status-warn', border: 'border-status-warn/40', dot: 'bg-status-warn' },
  interrupted: { label: 'INTERRUPTED', text: 'text-status-warn', border: 'border-status-warn/40', dot: 'bg-status-warn' },
};

const timeAgo = (ts) => {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

const fmtDuration = (startedAt, finishedAt) => {
  if (!startedAt) return '—';
  const end = finishedAt || Date.now();
  const s = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.queued;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[8px] font-bold tracking-[0.14em] border rounded-full px-2 py-0.5 ${meta.text} ${meta.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
};

function TaskListItem({ task, active, onClick }) {
  const meta = STATUS_META[task.status] || STATUS_META.queued;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition-all duration-150 active:scale-[0.99] ${
        active
          ? 'bg-brand-dim/60 border-brand-line'
          : 'bg-surface-1 border-hairline hover:border-hairline-strong hover:bg-surface-3/50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-[11px] font-semibold leading-snug line-clamp-2 ${active ? 'text-brand' : 'text-text-primary'}`}>
            {task.query}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
            <span className="text-[8px] font-bold tracking-wider text-text-tertiary uppercase">{task.intent || 'analyzing…'}</span>
            <span className="text-text-tertiary text-[8px]">·</span>
            <span className="text-[8px] text-text-tertiary">{timeAgo(task.createdAt)}</span>
            {task.eventCount > 0 && (
              <>
                <span className="text-text-tertiary text-[8px]">·</span>
                <span className="text-[8px] text-text-tertiary">{task.eventCount} events</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className={`w-3.5 h-3.5 mt-1 flex-shrink-0 transition-colors ${active ? 'text-brand' : 'text-text-tertiary'}`} />
      </div>
    </button>
  );
}

function LogStream({ events, streamOpen }) {
  const ref = useRef(null);
  const logs = events.filter((e) => e.type === 'task.log');
  const sites = events.filter((e) => e.type === 'task.website');

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length, sites.length]);

  const running = events.some((e) => e.type === 'task.started') && !events.some((e) => e.type === 'task.done' || e.type === 'task.failed' || e.type === 'task.cancelled');

  return (
    <div className="rounded-lg border border-hairline bg-surface-2 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline">
        <Radio className="w-3 h-3 text-brand" />
        <p className="text-[8px] font-bold tracking-[0.16em] text-brand">MISSION STREAM</p>
        {streamOpen && running && (
          <span className="ml-auto flex items-center gap-1 text-[7px] font-bold text-brand">
            <span className="w-1 h-1 rounded-full bg-brand animate-ping" /> LIVE
          </span>
        )}
        {sites.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[7px] font-bold text-text-tertiary">
            <Globe className="w-2.5 h-2.5" /> {sites.length} SITES
          </span>
        )}
      </div>
      <div ref={ref} className="max-h-72 overflow-y-auto p-2.5 font-mono text-[10px] leading-[16px] space-y-1">
        {logs.length === 0 ? (
          <p className="text-text-tertiary italic">
            {events.length === 0 ? 'Awaiting launch…' : 'Planning the team…'}
            <span className="text-brand animate-pulse">▊</span>
          </p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-2 leading-tight">
              <span className={`font-bold flex-shrink-0 ${AGENT_COLORS[log.agent] || 'text-gray-500'}`}>[{log.agent}]</span>
              <span className="text-text-secondary break-all flex-1">{log.message}</span>
            </div>
          ))
        )}
        {running && (
          <div className="flex gap-2">
            <span className="text-brand animate-pulse">▊</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskDetail({ task, streamOpen, onCancel, onRerun, onDelete }) {
  const events = task?.events || [];
  const planEvent = [...events].reverse().find((e) => e.type === 'task.plan');
  const steps = planEvent?.steps || task.steps || [];
  const domains = task.domainNames || [];
  const sites = events.filter((e) => e.type === 'task.website');
  const running = task.status === 'running' || task.status === 'queued';

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div className="surface-card p-3.5 rounded-xl">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text-primary leading-snug">{task.query}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusBadge status={task.status} />
              {task.intent && (
                <span className="text-[8px] font-bold tracking-wider text-text-tertiary uppercase border border-hairline rounded-full px-2 py-0.5">{task.intent}</span>
              )}
              <span className="text-[8px] text-text-tertiary font-mono">{task.id}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[8px] text-text-tertiary">
              <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> created {timeAgo(task.createdAt)}</span>
              {task.startedAt && (
                <span className="flex items-center gap-1"><Activity className="w-2.5 h-2.5" /> {fmtDuration(task.startedAt, task.finishedAt)}</span>
              )}
              {task.statistics?.agentsUsed && <span>{task.statistics.agentsUsed} agents</span>}
              {task.statistics?.executionTime > 0 && <span>{(task.statistics.executionTime / 1000).toFixed(1)}s</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            {running ? (
              <button
                type="button"
                onClick={onCancel}
                className="tap-target flex items-center gap-1.5 text-[8px] font-bold tracking-wider text-status-error border border-status-error/40 bg-status-error/10 rounded-lg px-2.5 py-2 transition-all hover:bg-status-error/20 active:scale-95"
              >
                <Square className="w-3 h-3" /> CANCEL
              </button>
            ) : (
              <button
                type="button"
                onClick={onRerun}
                className="tap-target flex items-center gap-1.5 text-[8px] font-bold tracking-wider text-brand border border-brand-line bg-brand-dim rounded-lg px-2.5 py-2 transition-all hover:bg-brand-dim/70 active:scale-95"
              >
                <RotateCcw className="w-3 h-3" /> RE-RUN
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="tap-target flex items-center gap-1.5 text-[8px] font-bold tracking-wider text-text-tertiary border border-hairline rounded-lg px-2.5 py-2 transition-all hover:text-status-error hover:border-status-error/40 active:scale-95"
            >
              <Trash2 className="w-3 h-3" /> DELETE
            </button>
          </div>
        </div>

        {domains.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {domains.map((d) => (
              <span key={d} className="text-agent-research border border-agent-research/40 rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider bg-surface-2">{d.toUpperCase()}</span>
            ))}
          </div>
        )}
        {steps.length > 0 && (
          <div className="mt-3">
            <p className="eyebrow mb-1.5">Plan</p>
            <div className="flex flex-wrap gap-1.5">
              {steps.map((s, i) => (
                <span key={`${s}-${i}`} className="flex items-center gap-1 text-[9px] font-mono text-text-secondary">
                  {i > 0 && <span className="text-text-tertiary">→</span>}
                  <span className="px-1.5 py-0.5 rounded border border-hairline bg-surface-2">{s}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live stream */}
      <LogStream events={events} streamOpen={streamOpen} />

      {/* Websites visited */}
      {sites.length > 0 && (
        <div className="space-y-1">
          {sites.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[9px] bg-surface-1 p-2 rounded-md border border-hairline">
              {e.site?.favicon && <img src={e.site.favicon} alt="" className="w-4 h-4 rounded flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-text-primary truncate font-medium">{e.site?.title}</p>
                <p className="text-text-tertiary truncate">{e.site?.url}</p>
              </div>
              <span className="text-brand font-bold text-[8px]">READ</span>
            </div>
          ))}
        </div>
      )}

      {/* Terminal summary */}
      {(task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') && (
        <div className="surface-card p-3.5 rounded-xl">
          <p className="eyebrow mb-2">
            {task.status === 'done' ? 'Result' : task.status === 'failed' ? 'Failure' : 'Halted'}
          </p>
          {task.status === 'done' ? (
            <div className="max-h-96 overflow-y-auto pr-1">
              <MarkdownRenderer content={task.summary} />
            </div>
          ) : (
            <p className="text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">
              {task.status === 'cancelled'
                ? '⏹ This mission was cancelled — nothing was left half-shipped. Re-run it whenever you are ready.'
                : task.error || task.summary || 'The mission failed without a readable message.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function TasksScreen() {
  const { tasks, detail, selectedId, creating, streamOpen, select, create, cancel, remove, rerun, refresh } = useTasks();
  const [input, setInput] = useState('');

  // Load the persisted mission list on first open.
  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const counts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const runningCount = (counts.running || 0) + (counts.queued || 0);

  const handleLaunch = (e) => {
    e?.preventDefault?.();
    if (!input.trim() || creating) return;
    create(input);
    setInput('');
  };

  return (
    <div className="px-3 pt-4 pb-10 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-brand" />
          <p className="eyebrow">JEXI OS · TASKS</p>
          {runningCount > 0 && (
            <span className="ml-auto flex items-center gap-1.5 text-[8px] font-bold text-brand">
              <Loader2 className="w-3 h-3 animate-spin" /> {runningCount} RUNNING
            </span>
          )}
        </div>
        <h1 className="text-[20px] font-bold tracking-tight text-text-primary mt-1">Background Missions</h1>
        <p className="text-[11px] text-text-secondary mt-1 max-w-[520px] leading-relaxed">
          Launch a mission and it runs server-side on the full agent pipeline — decoupled from this connection.
          Watch it stream live, cancel mid-flight, or come back later; the record persists across restarts.
        </p>
      </div>

      {/* New mission */}
      <form onSubmit={handleLaunch} className="surface-card p-3 rounded-xl mb-4">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Launch a background mission… e.g. research, build, study"
            className="flex-1 bg-surface-2 border border-hairline focus:border-brand-line rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder-text-tertiary focus:outline-none transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim() || creating}
            className="tap-target flex items-center gap-1.5 text-[9px] font-bold tracking-wider text-black bg-brand rounded-lg px-3.5 py-2.5 transition-all hover:shadow-[0_0_16px_rgba(0,210,106,0.35)] active:scale-95 disabled:bg-surface-2 disabled:text-text-tertiary disabled:shadow-none"
          >
            {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
            LAUNCH
          </button>
        </div>
      </form>

      {tasks.length === 0 && !detail ? (
        <div className="text-center py-16 space-y-3">
          <div className="mx-auto w-12 h-12 rounded-xl border border-hairline bg-surface-1 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-text-tertiary" />
          </div>
          <p className="text-[12px] text-text-secondary">No missions yet — launch one above and watch the pipeline run here.</p>
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-[320px_1fr] lg:gap-4 items-start">
          {/* List */}
          <div className={selectedId ? 'hidden lg:block' : 'block'}>
            <p className="eyebrow mb-2">ALL MISSIONS ({tasks.length})</p>
            <div className="space-y-1.5 max-h-[56vh] lg:max-h-[68vh] overflow-y-auto pr-1">
              {tasks.map((t) => (
                <TaskListItem key={t.id} task={t} active={selectedId === t.id} onClick={() => select(t.id)} />
              ))}
            </div>
          </div>

          {/* Detail */}
          <div className={selectedId ? 'mt-3 lg:mt-0' : 'hidden'}>
            <div className="flex items-center justify-between mb-2 lg:hidden">
              <button
                type="button"
                onClick={() => select(null)}
                className="tap-target flex items-center gap-1 text-[9px] font-bold tracking-wider text-text-tertiary hover:text-brand"
              >
                <X className="w-3.5 h-3.5" /> BACK TO MISSIONS
              </button>
            </div>
            {detail ? (
              <TaskDetail
                task={detail}
                streamOpen={streamOpen}
                onCancel={() => cancel(detail.id)}
                onRerun={() => rerun(detail.id)}
                onDelete={() => remove(detail.id)}
              />
            ) : (
              <div className="surface-card p-6 text-center text-text-tertiary text-[11px]">Select a mission to watch it live.</div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
