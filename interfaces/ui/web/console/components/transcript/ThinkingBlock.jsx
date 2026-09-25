import { useState } from 'react';

/**
 * components/transcript/ThinkingBlock.jsx (ui-rebuild-premium-v2)
 *
 * Arena-style thinking block: collapsible, muted, monospace. Streams the
 * model's reasoning text as it arrives from the REAL /api/chat 'think'
 * NDJSON events (relay: backendAgent recon narration -> mount recon row
 * merge -> this block). Nothing is fabricated: if the backend never
 * streamed thinking for a turn, this block does not render.
 *
 * Duration is the REAL wall-clock span from the first think chunk to the
 * row that follows it (mount stamps every row with Date.now()).
 */

export default function ThinkingBlock({ text, t0, t1, streaming }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;

  const secs = t0 ? Math.max(1, Math.round(((t1 || Date.now()) - t0) / 1000)) : null;

  return (
    <div className={'jx-think' + (streaming ? ' is-streaming' : '') + (open ? ' is-open' : '')}>
      <button type="button" className="jx-think-head" onClick={() => setOpen(!open)}>
        <span className="jx-think-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="jx-think-label">{streaming ? 'thinking…' : secs ? `thought for ${secs}s` : 'thought'}</span>
      </button>
      {open && (
        <div className="jx-think-body" data-streaming={streaming ? 'true' : 'false'}>
          {text}
          {streaming ? <span className="jx-cursor" aria-hidden="true" /> : null}
        </div>
      )}
    </div>
  );
}
