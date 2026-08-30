import { useEffect, useRef, useState } from 'react';

/**
 * B184 — ACTION FEED (arena agent-mode style).
 * Shows what JEXI is DOING as a live timeline of her own words:
 *   "✍️ I created index.html (412 bytes)"
 *   "▶ I ran `node app.js` → success — "Server ready""
 *   "🔁 I fixed it — the rerun passed."
 * Auto-collapses to the last action + count when idle; expands while working.
 */
export default function ActionFeed({ logs = [], isProcessing }) {
  const [expanded, setExpanded] = useState(true);
  const boxRef = useRef(null);

  useEffect(() => { if (isProcessing) setExpanded(true); }, [isProcessing]);

  useEffect(() => {
    if (expanded && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [logs.length, expanded]);

  if (!logs.length) return null;
  const last = logs[logs.length - 1];
  const actions = logs.filter((l) => /I (created|patched|ran|read|inserted|fixed|wrote|scanned|generated|scheduled)|✅ Done|🔁/.test(String(l.message)));

  const icon = (m) => {
    const s = String(m);
    if (s.includes('✍️')) return '✍️';
    if (s.includes('🔧')) return '🔧';
    if (s.includes('➕')) return '➕';
    if (s.includes('👀')) return '👀';
    if (s.includes('▶')) return '⚡';
    if (s.includes('🔁')) return '🔁';
    if (s.includes('✅')) return '🏁';
    if (s.includes('⚠')) return '⚠';
    return '•';
  };

  return (
    <div className={`jx-feed${isProcessing ? ' live' : ''}`}>
      <button type="button" className="jx-feed-head" onClick={() => setExpanded((e) => !e)}>
        <span className="jx-feed-ic">{isProcessing ? '🤖' : '🏁'}</span>
        <span className="jx-feed-last">{icon(last.message)} {String(last.message).slice(0, 78)}</span>
        <span className="jx-feed-meta">
          {actions.length > 0 && `${actions.length} action${actions.length > 1 ? 's' : ''}`}
          {!isProcessing && ' · tap for the full story'}
        </span>
        <span className={`jx-think-chev${expanded ? ' open' : ''}`}>▸</span>
      </button>
      {expanded && (
        <div ref={boxRef} className="jx-feed-body">
          {logs.slice(-40).map((l, i) => (
            <div key={i} className={`jx-feed-item${i === logs.slice(-40).length - 1 && isProcessing ? ' now' : ''}`}>
              <span className="jx-feed-dot">{icon(l.message)}</span>
              <span className="jx-feed-agent">{l.agent}</span>
              <span className="jx-feed-msg">{String(l.message)}</span>
            </div>
          ))}
          {isProcessing && <div className="jx-feed-item now"><span className="jx-feed-dot">⏳</span><span className="jx-feed-msg jx-feed-working">working…</span></div>}
        </div>
      )}
    </div>
  );
}
