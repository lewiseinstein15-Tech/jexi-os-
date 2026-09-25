import { useState, useRef, useEffect } from 'react';
import { SendHorizontal } from 'lucide-react';

/**
 * Premium composer (ui-rebuild-premium). Replaces the Phase 24 composer
 * rendering — same props contract (backend, turn, modes, lastError, onSend,
 * onMode), same semantics: Enter sends, Shift+Enter is a native newline.
 * Upgrades: the textarea auto-grows up to 5 lines, the send button carries
 * a lucide glyph, mode buttons reflect the active interaction mode, and the
 * busy/offline/error states keep their honest disclosure banners.
 */
const MAX_HEIGHT = 120; // ≈ 5 lines at 24px line-height (matches premium.css)

export default function Composer({ backend, turn, modes, lastError, onSend, onMode }) {
  const [text, setText] = useState('');
  const areaRef = useRef(null);
  const busy = turn === 'opening' || turn === 'streaming' || turn === 'awaiting-approval' || turn === 'closing';

  // Auto-grow: shrink to content height, capped at 5 lines via CSS max-height.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = h + 'px';
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [text]);

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText('');
  }

  const interactionMode = modes ? modes.interactionMode : null;

  return (
    <div className="jx-composer-wrap">
      {backend === 'offline' && (
        <div className="jx-offline" role="alert">backend offline — /api/health unreachable</div>
      )}
      {lastError && <div className="jx-send-error" role="alert">send refused: {lastError}</div>}

      <div className={'jx-composer' + (busy ? ' is-busy' : '')}>
        <textarea
          ref={areaRef}
          className="jx-inputarea"
          rows={1}
          placeholder="Ask JEXI anything…  (Enter to send · Shift+Enter for a new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          aria-label="Message"
        />
        <button className="jx-send" onClick={submit} disabled={busy || !text.trim()} aria-label="Send message">
          <SendHorizontal size={15} aria-hidden="true" />
          {busy ? '…' : 'Send'}
        </button>
      </div>

      <div className="jx-composer-meta">
        <span>turn: {turn}</span>
        <span>{modes ? modes.displayMode + ' display' : 'modes: —'}</span>
        <span className="jx-spacer"></span>
        <button
          className={'jx-mode-btn' + (interactionMode === 'plan' ? ' is-active' : '')}
          onClick={() => onMode('plan')}
          title="plan mode — read-only, tools are refused"
        >
          plan
        </button>
        <button
          className={'jx-mode-btn' + (interactionMode === 'act' ? ' is-active' : '')}
          onClick={() => onMode('act')}
          title="act mode — tools may run (destructive ones ask first)"
        >
          act
        </button>
      </div>
    </div>
  );
}
