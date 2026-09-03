import { useEffect, useRef, useState } from 'react';
import { dedupeActivity, traceChips, hasTrace, formatDuration } from '../utils/agentStream.js';

/**
 * B205 — ARENA-STYLE THINKING PANEL.
 *
 * ONE collapsible block per assistant message, replacing the old scattered
 * trio (ThinkRow + NarrationFeed + chat-inline ActionFeed/AgentPipeline),
 * in the pattern of the Arena agent's streaming "thinking":
 *
 *   ┌────────────────────────────────────────────┐
 *   │ ✻ Thinking · 12.3s                       ▾ │   live: open + pulsing
 *   │                                            │
 *   │ ● I'm on it — let me break this down.      │   narrations — her voice
 *   │ ● I found 30 sources across 6 engines.     │
 *   │                                            │
 *   │ 🔎 Query Analyzer   Analyzing the best…    │   activity — compact rows
 *   │ 🔍 Searcher         scan done — 20 sources │
 *   │ 📖 Extractor        ✓ Read Wikipedia       │
 *   │                                            │
 *   │ (raw reasoning tokens, dimmed, if any)     │
 *   └────────────────────────────────────────────┘
 *   (the answer streams below, token by token)
 *
 *   done → auto-collapses to:
 *   ✻ Thought for 43s · 8 agents · 10 sources   ▸   (tap to review the trace)
 *
 * Direct answers with no trace (no narrations, no activity, no reasoning)
 * render no panel at all — a clean answer, nothing in the way.
 */
export default function AgentThinking({
  narrations, activity, thinking, live, thinkMs, totalMs, by, sourceCount,
}) {
  const [expanded, setExpanded] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const bodyRef = useRef(null);

  // Auto-collapse the moment the turn finishes — the answer is the star;
  // the trace is one tap away.
  useEffect(() => { if (!live) setExpanded(false); }, [live]);

  // Live elapsed ticker (from totalMs when finished, wall clock while live)
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => clearInterval(t);
  }, [live]);

  // Keep the newest line in view while live
  const rows = dedupeActivity(activity);
  useEffect(() => {
    if (expanded && live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [narrations?.length, rows.length, thinking, expanded, live]);

  if (!hasTrace({ narrations, activity, thinking })) return null;

  const chips = traceChips({ activity, sourceCount, narrations });
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
      <span className="jx-agent-ic" aria-hidden="true">{live ? '✻' : '✻'}</span>
      <span className="jx-agent-label">
        {live
          ? `Thinking${by ? ` · ${by}` : ''} · ${elapsed.toFixed(1)}s`
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
      {/* Her first-person running commentary — the primary voice */}
      {(narrations || []).filter(Boolean).map((line, i) => (
        <div key={`n${i}`} className={`jx-agent-narr${live && i === narrations.length - 1 ? ' now' : ''}`}>
          <span className="jx-narration-dot" aria-hidden="true" />
          <span>{line}</span>
        </div>
      ))}
      {/* Compact agent/tool rows */}
      {rows.map((r, i) => (
        <div key={`a${i}`} className="jx-agent-row">
          <span className="jx-agent-row-who">{r.agent}</span>
          <span className="jx-agent-row-what">{r.message}</span>
        </div>
      ))}
      {/* Raw reasoning tokens (providers with a reasoning channel), dimmed */}
      {thinking && String(thinking).trim() && (
        <div className="jx-agent-reason">
          <span>{thinking}</span>
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
