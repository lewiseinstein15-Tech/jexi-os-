import { X } from 'lucide-react';
import { SHORTCUTS } from './shortcuts.js';

/** Modal shortcuts overlay (Cmd/Ctrl + /). Keyboard mapping in shortcuts.js. */
export default function ShortcutsOverlay({ onClose }) {
  return (
    <div
      className="jx-shortcuts-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="jx-shortcuts-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="jx-shortcuts-title">Keyboard shortcuts</div>
          <button type="button" className="jx-iconbtn" onClick={onClose} aria-label="Close shortcuts">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        {SHORTCUTS.map((s, i) => (
          <div className="jx-shortcut-row" key={i}>
            <span>{s.label}</span>
            <span>
              {s.keys.filter(Boolean).map((k, j) => <span className="jx-kbd" key={j}>{k}</span>)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
