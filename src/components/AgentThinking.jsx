import { Component, useEffect, useMemo, useRef, useState } from 'react';
import {
  dedupeActivity, traceChips, hasTrace, formatDuration, safeRows, capTail, capText, sanitizeText,
} from '../utils/agentStream.js';

/**
 * B206 — LOCAL CRASH BOUNDARY for the thinking panel.
 * The app-wide ErrorBoundary exists, but if the PANEL threw, the whole
 * screen would be replaced by the recovery card — the chat dies with the
 * panel. This boundary fails the other way: a panel crash hides the panel
 * (logs to console), and the answer + chat keep rendering. Thinking must
 * never break the UI.
 */
class PanelBoundary extends Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error, info) { console.error('[JEXI thinking panel] render crash (hidden, chat intact):', error, info?.componentStack); }
  render() { return this.state.crashed ? null : this.props.children; }
}

const NARRATION_CAP = 30; // rendered tail caps — a marathon task shows the
const ROW_CAP = 40;       // latest story, never a 500-node subtree
const REASON_CAP = 6000;  // chars of reasoning tail

/**
 * B205 — ARENA-STYLE THINKING PANEL. (B206: HARDENED.)
 *
 * ONE collapsible block per assistant message — narrations (her voice),
 * agent/tool activity rows, dimmed reasoning tokens:
 *
 *   live:   ✻ Thinking · 12.3s    (open, pulsing, auto-scrolling)
 *   done:   ✻ Thought for 43s · 8 agents · 10 sources   ▸   (collapsed)
 *
 * Hardening (B206): every prop is coerced (arrays checked, objects → safe
 * strings — objects as React children would throw), control chars/ANSI
 * stripped, lists rendered tail-capped with "+N earlier" markers, heavy
 * processing memoized so the 10Hz timer tick stays cheap, and the whole
 * panel sits inside a local crash boundary that hides the panel instead of
 * killing the chat.
 */
function AgentThinkingInner({
  narrations, activity, thinking, live, thinkMs, totalMs, by, sourceCount,
}) {
  const [expanded, setExpanded] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const bodyRef = useRef(null);

  // Coerce + dedupe + cap ONCE per data change (not per timer tick)
  const data = useMemo(() => {
    const rawNarr = Array.isArray(narrations) ? narrations.filter((n) => typeof n === 'string' && n.trim()) : [];
    const narr = capTail(rawNarr.map((n) => sanitizeText(n, 400)), NARRATION_CAP);
    const rows = dedupeActivity(safeRows(activity));
    const acts = capTail(rows, ROW_CAP);
    const reason = capText(thinking, REASON_CAP);
    return { narr, acts, reason };
  }, [narrations, activity, thinking]);

  // Auto-collapse the moment the turn finishes — the answer is the star.
  useEffect(() => { if (!live) setExpanded(false); }, [live]);

  // Live elapsed ticker (cheap: header text only, data is memoized)
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => clearInterval(t);
  }, [live]);

  // Keep the newest line in view while live
  const { narr, acts, reason } = data;
  useEffect(() => {
    if (expanded && live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [narr.shown.length, acts.shown.length, reason, expanded, live]);

  const safeBy = typeof by === 'string' ? by : '';
  const safeSourceCount = Number.isFinite(sourceCount) ? sourceCount : 0;

  if (!hasTrace({ narrations, activity, thinking })) return null;

  const chips = traceChips({ activity: safeRows(activity), sourceCount: safeSourceCount, narrations: Array.isArray(narrations) ? narrations : [] });
  const doneMs = Number.isFinite(totalMs) && totalMs > 0
    ? totalMs
    : (Number.isFinite(thinkMs) && thinkMs > 0 ? thinkMs : null);

  const head = (
    <button
      type="button"
      className={`jx-agent-head${live ? ' live' : ''}`}
      onClick={() => setExpanded((e) => !e)}
      aria-expanded={expanded}
    >
      <span className="jx-agent-ic" aria-hidden="true">✻</span>
      <span className="jx-agent-label">
        {live
          ? `Thinking${safeBy ? ` · ${safeBy}` : ''} · ${elapsed.toFixed(1)}s`
          : `Thought${doneMs ? ` for ${formatDuration(doneMs)}` : ''}`}
        {!live && chips.length > 0 && (
          <span className="jx-agent-chips">
            {chips.map((c) => <span key={c} className="jx-agent-chip">{c}</span>)}
          </span>
        )}
      </span>
      <span className={`jx-think-chev${expanded ? ' open' : ''}`} aria-hidden="true">▸</span>
    </button>
  );

  const body = (
    <div ref={bodyRef} className="jx-agent-body">
      {narr.hidden > 0 && <div className="jx-agent-more">+{narr.hidden} earlier note{narr.hidden === 1 ? '' : 's'}</div>}
      {narr.shown.map((line, i) => (
        <div key={`n${i}`} className={`jx-agent-narr${live && i === narr.shown.length - 1 ? ' now' : ''}`}>
          <span className="jx-narration-dot" aria-hidden="true" />
          <span>{line}</span>
        </div>
      ))}
      {acts.hidden > 0 && <div className="jx-agent-more">+{acts.hidden} earlier step{acts.hidden === 1 ? '' : 's'}</div>}
      {acts.shown.map((r, i) => (
        <div key={`a${i}`} className="jx-agent-row">
          <span className="jx-agent-row-who">{r.agent}</span>
          <span className="jx-agent-row-what">{r.message}</span>
        </div>
      ))}
      {reason && (
        <div className="jx-agent-reason">
          <span>{reason}</span>
          {live && <span className="jx-caret" aria-hidden="true" />}
        </div>
      )}
      {live && (
        <div className="jx-agent-narr now">
          <span className="jx-narration-dot" aria-hidden="true" />
          <span className="jx-narration-working">working…</span>
        </div>
      )}
    </div>
  );

  return (
    <div className={`jx-agent${live ? ' live' : ''}`} data-testid={live ? 'agent-thinking-live' : 'agent-thinking-done'}>
      {head}
      {expanded && body}
    </div>
  );
}

export default function AgentThinking(props) {
  return (
    <PanelBoundary>
      <AgentThinkingInner {...props} />
    </PanelBoundary>
  );
}
