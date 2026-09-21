import { useState } from 'react';

/**
 * Phase 24 Scope B — composer. Enter sends. Backend-offline is surfaced,
 * never silent. Mode switches go through mount's mode() (runtime Scope H).
 */
export default function Composer({ backend, turn, modes, lastError, onSend, onMode }) {
  const [text, setText] = useState('');
  const busy = turn === 'opening' || turn === 'streaming' || turn === 'awaiting-approval' || turn === 'closing';

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText('');
  }

  return (
    <div className="p24-composer-wrap">
      {backend === 'offline' && (
        <div className="p24-offline" role="alert">backend offline — /api/health unreachable</div>
      )}
      {lastError && <div className="p24-send-error" role="alert">send refused: {lastError}</div>}
      <div className="p24-composer">
        <input
          className="p24-input"
          placeholder="Ask JEXI anything…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          aria-label="Message"
        />
        <button className="p24-send" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
      <div className="p24-composer-meta">
        <span className="p24-meta-turn">turn: {turn}</span>
        <span className="p24-meta-modes">
          {modes ? modes.displayMode + ' / ' + modes.interactionMode : 'modes: —'}
        </span>
        <span className="p24-meta-actions">
          <button className="p24-mode-btn" onClick={() => onMode('plan')}>plan</button>
          <button className="p24-mode-btn" onClick={() => onMode('act')}>act</button>
        </span>
      </div>
    </div>
  );
}
