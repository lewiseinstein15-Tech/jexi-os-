import { DISPLAY_MODES, INTERACTION_MODES } from '../../../../ui/web/console/chat/modes.js';
import * as runtime from '../../../../ui/web/console/chat/runtime.js';

/** Live mode switches on the console session — reflected in the chat route. */
export default function ModeSection({ sessionId, modes, onLive }) {
  function set(patch) {
    runtime.mode(sessionId, patch);
    onLive();
  }

  return (
    <section className="p24-section">
      <h2 className="p24-section-title">Modes</h2>
      <div className="p24-srow">
        <div className="p24-srow-label">
          <div className="p24-srow-name">Display mode</div>
          <div className="p24-srow-sub">row verbosity in chat (applies to next events)</div>
        </div>
        <div className="p24-btn-group" role="radiogroup" aria-label="Display mode">
          {DISPLAY_MODES.map((m) => (
            <button
              key={m}
              className={'p24-mode-btn' + (modes && modes.displayMode === m ? ' is-active' : '')}
              onClick={() => set({ displayMode: m })}
            >{m}</button>
          ))}
        </div>
      </div>
      <div className="p24-srow">
        <div className="p24-srow-label">
          <div className="p24-srow-name">Interaction mode</div>
          <div className="p24-srow-sub">plan gates write tools; act runs them</div>
        </div>
        <div className="p24-btn-group" role="radiogroup" aria-label="Interaction mode">
          {INTERACTION_MODES.map((m) => (
            <button
              key={m}
              className={'p24-mode-btn' + (modes && modes.interactionMode === m ? ' is-active' : '')}
              onClick={() => set({ interactionMode: m })}
            >{m}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
