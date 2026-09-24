import { useEffect, useRef, useState } from 'react';

/**
 * B173 — THINK ROW (DeepSeek Harness `ReasoningRow` port).
 *
 * Reasoning tokens stream into their own collapsible row above the answer:
 *   live    → "💭 Thinking · Mila · 4.2s" + gray text streaming inside
 *             (clamped height, auto-scrolled, blinking caret)
 *   done    → auto-collapses to "💭 Thought for 6.1s — tap to view"
 * The row collapses itself the moment the real answer starts streaming, so
 * thinking never pushes the answer away.
 */
export default function ThinkRow({ text, active, ms, by }) {
  const [expanded, setExpanded] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const boxRef = useRef(null);

  // Auto-collapse when the thinking phase ends (answer started / turn done)
  useEffect(() => { if (!active) setExpanded(false); }, [active]);

  // Live elapsed ticker while thinking
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => clearInterval(t);
  }, [active]);

  // Keep the newest reasoning line in view while live
  useEffect(() => {
    if (expanded && active && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [text, expanded, active]);

  const label = active
    ? `Thinking${by ? ` · ${by}` : ''} · ${elapsed.toFixed(1)}s`
    : `Thought${Number.isFinite(ms) && ms > 0 ? ` for ${(ms / 1000).toFixed(1)}s` : ''} — tap to ${expanded ? 'hide' : 'view'}`;

  return (
    <div className={`jx-think${active ? ' live' : ''}`}>
      <button type="button" className="jx-think-head" onClick={() => setExpanded((e) => !e)}>
        <span className="jx-think-ic">{active ? '💭' : '💭'}</span>
        <span className="jx-think-label">{label}</span>
        <span className={`jx-think-chev${expanded ? ' open' : ''}`}>▸</span>
      </button>
      {expanded && Boolean(text) && (
        <div ref={boxRef} className="jx-think-body">
          <span>{text}</span>
          {active && <span className="jx-caret" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
