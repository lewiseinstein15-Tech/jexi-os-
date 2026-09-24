import React, { useEffect, useRef } from 'react';

/**
 * B200 — ARENA-STYLE NARRATION FEED.
 * JEXI's own first-person words about what she is doing, streamed live into
 * the assistant message — the running commentary during a long task:
 *
 *   "I'm on it — let me break this question down first."
 *   "I found 30 sources across 6 search engines."
 *   "I finished reading — 9 pages gave me real content. Writing the answer now…"
 *
 * While she works, the lines appear one by one (open, live). Once the answer
 * lands they collapse into a compact "how I worked" summary the user can
 * reopen — the story of the work, never in the way of the answer itself.
 */
export default function NarrationFeed({ lines, live = false }) {
  const boxRef = useRef(null);
  const shown = (lines || []).filter(Boolean);

  useEffect(() => {
    if (live && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown.length, live]);

  if (!shown.length) return null;

  const body = (
    <div ref={boxRef} className={`jx-narration-body${live ? ' live' : ''}`}>
      {shown.map((line, i) => (
        <div key={i} className={`jx-narration-line${live && i === shown.length - 1 ? ' now' : ''}`}>
          <span className="jx-narration-dot" aria-hidden="true" />
          <span className="jx-narration-text">{line}</span>
        </div>
      ))}
      {live && (
        <div className="jx-narration-line now">
          <span className="jx-narration-dot" aria-hidden="true" />
          <span className="jx-narration-text jx-narration-working">working…</span>
        </div>
      )}
    </div>
  );

  if (live) {
    return (
      <div className="jx-narration" data-testid="narration-live">
        <div className="jx-narration-head">
          <span className="jx-narration-badge">JEXI · WORKING</span>
        </div>
        {body}
      </div>
    );
  }

  return (
    <details className="jx-narration" data-testid="narration-done">
      <summary className="jx-narration-collapsed">
        <span className="jx-narration-badge done">HOW I WORKED</span>
        <span className="jx-narration-count">{shown.length} step{shown.length === 1 ? '' : 's'}</span>
        <span className="jx-think-chev">▸</span>
      </summary>
      {body}
    </details>
  );
}
