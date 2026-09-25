/**
 * components/transcript/ToolCallBlock.jsx (ui-rebuild-premium-v2)
 *
 * Structured tool-call block rendered from REAL runtime tool rows
 * (tool.started / tool.completed / tool.failed taxonomy events — emitted by
 * the runtime's own tool intents and the /gui dispatch path). Consecutive
 * tool rows of the same toolCallId group into ONE block:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ ⚙ tool.<name>                 started    │
 *   ├─────────────────────────────────────────┤
 *   │ { params json — mono }                  │
 *   ├─────────────────────────────────────────┤
 *   │ ✓ result ok                     12ms    │
 *   └─────────────────────────────────────────┘
 *
 * Plain /api/chat turns stream no tool events today — the block exists and
 * is wired, it just does not render for those turns (disclosed in the
 * event-mapping report).
 */

export default function ToolCallBlock({ name, params, result, state, ms }) {
  const stCls =
    state === 'failed' ? 'fail' :
    state === 'completed' ? 'ok' : 'run';
  const stLabel =
    state === 'failed' ? 'failed ✗' :
    state === 'completed' ? `completed ✓${ms ? ` ${ms}ms` : ''}` : 'started';

  return (
    <div className={`jx-tool is-${stCls}`}>
      <div className="jx-tool-head">
        <span className="jx-tool-glyph" aria-hidden="true">⚙</span>
        <span className="jx-tool-name">{name || 'tool'}</span>
        <span className={`jx-tool-state jx-num is-${stCls}`}>{stLabel}</span>
      </div>
      {params ? (
        <div className="jx-tool-row">
          <span className="jx-tool-k">params</span>
          <span className="jx-tool-v">{params}</span>
        </div>
      ) : null}
      {result ? (
        <div className="jx-tool-row">
          <span className="jx-tool-k">result</span>
          <span className={'jx-tool-v' + (stCls === 'fail' ? ' is-fail' : '')}>{result}</span>
        </div>
      ) : null}
    </div>
  );
}
