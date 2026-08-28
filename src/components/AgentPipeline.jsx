import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * AgentPipeline — B159: a real STEP-BY-STEP streaming feed.
 *
 * While JEXI works, every streamed log line becomes a visible step:
 *   ✓ completed steps (checkmark + agent + message)
 *   ◌ the CURRENT step (spinner + live message)
 *   plus a live elapsed timer and step counter.
 *
 * After the task ends it collapses to one quiet line ("✓ finished · 8 steps ·
 * 12.4s") so the transcript stays clean. Pure jx- classes (monochrome design
 * system) — no cards, no borders, just the flowing process.
 */

function StepRow({ log, state }) {
  return (
    <div className={`jx-step ${state}`}>
      <span className="ic">
        {state === 'current'
          ? <span className="jx-spin" />
          : (
            <svg className="jx-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
      </span>
      <span className="label">{log.agent || 'JEXI'}</span>
      <span className="detail">{log.message || ''}</span>
    </div>
  );
}

export default function AgentPipeline({ logs = [], isProcessing }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const [finishedSummary, setFinishedSummary] = useState(null);

  // Live elapsed timer — ticks only while working.
  useEffect(() => {
    if (isProcessing) {
      if (!startRef.current) startRef.current = Date.now();
      setFinishedSummary(null);
      const t = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 200);
      return () => clearInterval(t);
    }
    if (startRef.current && logs.length) {
      const secs = (Date.now() - startRef.current) / 1000;
      setFinishedSummary({ steps: logs.length, secs });
    }
    startRef.current = null;
    setElapsed(0);
  }, [isProcessing]); // eslint-disable-line react-hooks/exhaustive-deps

  // The last N steps worth showing live (older steps scroll away naturally).
  const visible = useMemo(() => {
    if (!isProcessing) return [];
    const MAX = 6;
    return logs.slice(-MAX);
  }, [logs, isProcessing]);

  const current = visible.length ? visible[visible.length - 1] : null;
  const done = visible.length > 1 ? visible.slice(0, -1) : [];

  if (!isProcessing) {
    if (!finishedSummary) return null;
    return (
      <div className="jx-process">
        <div className="jx-step done">
          <span className="ic">
            <svg className="jx-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          <span className="label">finished</span>
          <span className="detail">{finishedSummary.steps} steps · {finishedSummary.secs.toFixed(1)}s</span>
        </div>
      </div>
    );
  }

  return (
    <div className="jx-process" role="status" aria-live="polite">
      <div className="jx-pipe-head">
        <span className="jx-pipe-count">STEP {logs.length}</span>
        <span className="jx-pipe-time">{elapsed.toFixed(1)}s</span>
      </div>
      {done.map((l, i) => <StepRow key={`d${i}-${l.agent}-${l.message?.slice?.(0, 24) || ''}`} log={l} state="done" />)}
      {current && <StepRow key={`c-${current.agent}-${current.message?.slice?.(0, 24) || ''}`} log={current} state="current" />}
      {!current && (
        <div className="jx-step current">
          <span className="ic"><span className="jx-spin" /></span>
          <span className="label">JEXI</span>
          <span className="detail">thinking…</span>
        </div>
      )}
    </div>
  );
}
