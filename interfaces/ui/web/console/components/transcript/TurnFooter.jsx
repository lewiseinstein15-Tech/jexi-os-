import { useModelStatus } from '../../shell/useStatus.js';

/**
 * components/transcript/TurnFooter.jsx (ui-rebuild-premium-v2)
 *
 * turn-7 · 1,284ms · qwen2.5:7b · custom
 *
 * --jx-font-xs, --jx-text-3, tabular numerals. The ms is the REAL wall-clock
 * measured by mount.js (first envelope of the turn -> turn.completed). Model
 * + provider come from the shared /api/providers/active poller — when the
 * provider is unresolved the footer says so honestly instead of guessing.
 * Token counts are NOT streamed by /api/chat today, so no token figure is
 * shown (disclosed in the event-mapping report).
 */

export default function TurnFooter({ turnId, ms, ok = true, failReason }) {
  const model = useModelStatus();
  const shortTurn = String(turnId || '').replace(/^turn-?/, 'turn-');
  // BUG 1 (ui-rebuild-premium-v2) — the shared signal now merges the unified
  // config, legacy key presence (/api/settings/status) and the provider the
  // LAST completed turn actually used (applyTurnProvider from the done
  // event's meter). "provider unresolved" only when nothing is configured.
  const modelLabel = model.loading
    ? 'model · …'
    : model.configured && (model.model || model.provider)
      ? `${model.model || ''}${model.model && model.provider ? ' · ' : ''}${model.provider || ''}`
      : 'provider unresolved';

  return (
    <div className={'jx-footer jx-num' + (ok ? '' : ' is-fail')}>
      <span className="jx-footer-id">{shortTurn}</span>
      <span className="jx-footer-sep">·</span>
      <span className="jx-footer-ms">{typeof ms === 'number' ? `${ms.toLocaleString('en-US')}ms` : '—'}</span>
      <span className="jx-footer-sep">·</span>
      <span className={'jx-footer-model' + (model.configured ? '' : ' is-unresolved')}>{modelLabel}</span>
      {!ok && failReason ? (
        <>
          <span className="jx-footer-sep">·</span>
          <span className="jx-footer-fail">{String(failReason).slice(0, 80)}</span>
        </>
      ) : null}
    </div>
  );
}
